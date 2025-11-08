import asyncio
import json
from fastapi import WebSocket, WebSocketDisconnect
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import time, threading
from collections import deque
import os

app = FastAPI(title="Manufacturing Line Simulator")

# -----------------------------
# In-memory state & data models
# -----------------------------
class Machine(BaseModel):
    id: int
    name: str
    next: Optional[int] = None
    takt_time: float = 1.0
    buffer: int = 1
    lane: int = 0
    in_progress: List[Dict[str, Any]] = Field(default_factory=list)
    queue: List[Dict[str, Any]] = Field(default_factory=list)
    completed: int = 0
    busy_time: float = 0.0
    last_state_change: float = 0.0
    blocked: bool = False

class UpdateMachineRequest(BaseModel):
    id: int
    takt_time: Optional[float] = None
    buffer: Optional[int] = None
    name: Optional[str] = None
    next: Optional[int] = None
    lane: Optional[int] = None

class AddMachineRequest(BaseModel):
    name: str
    takt_time: float = 1.0
    buffer: int = 1
    insert_after_id: Optional[int] = None
    next: Optional[int] = None
    lane: int = 0

class RemoveMachineRequest(BaseModel):
    id: int

class StateSnapshot(BaseModel):
    timestamp: float
    items_in_system: int
    throughput: float
    total_started: int
    total_completed: int
    avg_cycle_time: float
    machines: List[Dict[str, Any]]
    running: bool

# --- WebSocket connection manager ---
class WSManager:
    def __init__(self):
        self.active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def broadcast(self, msg: str):
        if not self.active:
            return
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = WSManager()

# Initial line (lane=0)
machines: List[Machine] = [
    Machine(id=1, name="Cutting",   next=2, takt_time=5.0, buffer=2, lane=0),
    Machine(id=2, name="Assembly",  next=3, takt_time=7.5, buffer=2, lane=0),
    Machine(id=3, name="Packaging", next=None, takt_time=3.0, buffer=1, lane=0),
]

# Global simulation state
state_lock = threading.Lock()
running = False
sim_thread: Optional[threading.Thread] = None

# Simulation clock
sim_time = 0.0
_last_wall = time.time()

# Metrics
total_started = 0
total_completed = 0
cycle_times: List[float] = []
item_id_seq = 0
completions = deque(maxlen=5000)

SAVE_PATH = os.path.join(os.path.dirname(__file__), "sim_state.json")

# -----------------------------
# Simulation engine
# -----------------------------
TICK_SEC = 0.1

def get_machine(mid: int) -> Machine:
    for m in machines:
        if m.id == mid:
            return m
    raise KeyError(f"Machine {mid} not found")

def lanes_present() -> List[int]:
    return sorted(set(m.lane for m in machines))

def lane_sources(lane: int) -> List[Machine]:
    """Machines in lane that are not a 'next' target in that same lane."""
    lane_ms = [m for m in machines if m.lane == lane]
    idmap = {m.id: m for m in lane_ms}
    targets = {m.next for m in lane_ms if m.next is not None and m.next in idmap}
    return [m for m in lane_ms if m.id not in targets]

def lane_tail(lane: int) -> Optional[Machine]:
    """Follow pointers within a lane to find its tail (last machine)."""
    lane_ms = [m for m in machines if m.lane == lane]
    if not lane_ms:
        return None
    idmap = {m.id: m for m in lane_ms}
    # find sources (heads)
    targets = {m.next for m in lane_ms if m.next is not None and m.next in idmap}
    heads = [m for m in lane_ms if m.id not in targets] or [lane_ms[0]]
    cur = heads[0]
    seen = set()
    while True:
        if cur.next is None or cur.next not in idmap or cur.id in seen:
            return cur
        seen.add(cur.id)
        cur = idmap[cur.next]

def start_processing_if_possible(m: Machine, current_time: float):
    if m.blocked:
        return
    if len(m.in_progress) == 0 and len(m.queue) > 0:
        item = m.queue.pop(0)
        item["start_time"] = current_time
        if "entered_machine_at" not in item:
            item["entered_machine_at"] = current_time
        m.in_progress.append(item)
        m.last_state_change = current_time

def try_push_to_next(m: Machine, current_time: float):
    if len(m.in_progress) == 0:
        m.blocked = False
        return

    item = m.in_progress[0]
    elapsed = current_time - item["start_time"]

    if elapsed < m.takt_time:
        m.blocked = False
        return

    nxt = m.next
    if nxt is None:
        m.in_progress.pop(0)
        m.completed += 1
        m.busy_time += m.takt_time
        m.last_state_change = current_time
        m.blocked = False

        global total_completed, cycle_times
        total_completed += 1
        cycle_times.append(current_time - item["created_at"])
        completions.append(current_time)
        return

    next_m = get_machine(nxt)
    # Only push if next has buffer (lane is already enforced when wiring)
    if len(next_m.queue) < next_m.buffer:
        m.in_progress.pop(0)
        m.completed += 1
        m.busy_time += m.takt_time
        m.last_state_change = current_time
        m.blocked = False
        next_m.queue.append(item)
    else:
        # Finished but cannot push → blocked
        m.blocked = True

def spawn_new_items_per_lane(current_time: float):
    """For each lane, spawn into each source machine if it has space."""
    global item_id_seq, total_started
    for lane in lanes_present():
        for src in lane_sources(lane):
            if len(src.queue) < src.buffer:
                item_id_seq += 1
                item = {
                    "item_id": item_id_seq,
                    "created_at": current_time,
                    "lane": lane,
                    "type": "A",   # placeholder for future item types
                }
                src.queue.append(item)
                total_started += 1

def simulation_loop():
    global running, sim_time, _last_wall
    while True:
        with state_lock:
            now_wall = time.time()
            if running:
                dt = max(now_wall - _last_wall, 0.0)
                sim_time += dt

                for m in machines[::-1]:
                    try_push_to_next(m, sim_time)
                for m in machines:
                    start_processing_if_possible(m, sim_time)
                spawn_new_items_per_lane(sim_time)

            _last_wall = now_wall
        time.sleep(TICK_SEC)

def ensure_thread():
    global sim_thread
    if sim_thread is None or not sim_thread.is_alive():
        t = threading.Thread(target=simulation_loop, daemon=True)
        t.start()
        sim_thread = t

ensure_thread()

# -----------------------------
# Helpers / state build
# -----------------------------
def next_id() -> int:
    return (max((m.id for m in machines), default=0) + 1)

def index_of(mid: int) -> int:
    for i, m in enumerate(machines):
        if m.id == mid:
            return i
    raise KeyError

def upstream_of(target_id: int) -> List[Machine]:
    return [m for m in machines if m.next == target_id]

def build_state_dict() -> Dict[str, Any]:
    t = sim_time
    in_system = sum(len(m.queue) + len(m.in_progress) for m in machines)
    throughput = (total_completed / t) if t > 0 else 0.0
    avg_ct = (sum(cycle_times) / len(cycle_times)) if cycle_times else 0.0

    machines_view = []
    for m in machines:
        detail = []
        if m.in_progress:
            it = m.in_progress[0]
            p = min(max((t - it["start_time"]) / m.takt_time, 0.0), 1.0)
            detail.append({"item_id": it.get("item_id", -1), "progress": p})
        status = "processing" if len(m.in_progress) > 0 else ("idle" if len(m.queue) == 0 else "queued")
        machines_view.append({
            "id": m.id,
            "name": m.name,
            "next": m.next,
            "lane": m.lane,
            "status": status,
            "in_progress": len(m.in_progress),
            "in_progress_detail": detail,
            "queue": len(m.queue),
            "buffer": m.buffer,
            "takt_time": m.takt_time,
            "completed": m.completed,
            "utilization": (m.busy_time / t) if t > 0 else 0.0,
            "blocked": m.blocked
        })

    return {
        "timestamp": round(t, 2),
        "items_in_system": in_system,
        "throughput": round(throughput, 4),
        "total_started": total_started,
        "total_completed": total_completed,
        "avg_cycle_time": round(avg_ct, 3),
        "machines": machines_view,
        "running": running,
    }

# -----------------------------
# API routes
# -----------------------------
@app.get("/")
def root():
    return {"message": "Manufacturing Line Simulator API. See /docs for endpoints."}

@app.get("/machines")
def get_machines():
    with state_lock:
        return [m.model_dump() for m in machines]

@app.post("/update_machine")
def update_machine(req: UpdateMachineRequest):
    with state_lock:
        try:
            m = get_machine(req.id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Machine not found")

        provided = req.model_dump(exclude_unset=True)

        if "takt_time" in provided:
            if req.takt_time is None or req.takt_time <= 0:
                raise HTTPException(status_code=400, detail="takt_time must be > 0")
            m.takt_time = float(req.takt_time)

        if "buffer" in provided:
            if req.buffer is None or req.buffer < 0:
                raise HTTPException(status_code=400, detail="buffer must be >= 0")
            m.buffer = int(req.buffer)

        if "name" in provided:
            m.name = str(req.name)

        if "next" in provided:
            m.next = req.next

        if "lane" in provided:
            m.lane = int(req.lane) if req.lane is not None else 0

        return {
            "message": "Machine updated",
            "machine": {
                "id": m.id, "name": m.name, "next": m.next,
                "takt_time": m.takt_time, "buffer": m.buffer, "lane": m.lane
            }
        }

@app.post("/add_machine")
def add_machine(req: AddMachineRequest):
    with state_lock:
        new_id = next_id()

        # Create machine; lane may be adjusted if inserting after a specific machine
        new_m = Machine(
            id=new_id, name=req.name, takt_time=req.takt_time,
            buffer=req.buffer, next=None, lane=req.lane
        )

        if req.insert_after_id is not None:
            # Insert in the same lane as the reference machine and rewire within that lane
            try:
                idx = index_of(req.insert_after_id)
            except KeyError:
                raise HTTPException(404, f"insert_after_id {req.insert_after_id} not found")

            prev = machines[idx]
            new_m.lane = prev.lane  # force same lane as the machine we're inserting after

            old_next = prev.next
            prev.next = new_id

            # Keep the old_next only if it is in the same lane chain
            if old_next is not None:
                try:
                    nxt_m = get_machine(old_next)
                    if nxt_m.lane == prev.lane:
                        new_m.next = old_next
                    else:
                        new_m.next = None
                except KeyError:
                    new_m.next = None

            machines.insert(idx + 1, new_m)

        else:
            # Append at the tail of the requested lane
            tail = lane_tail(new_m.lane)
            if tail is not None:
                old_next = tail.next
                tail.next = new_id
                # Preserve old_next only if it was within the same lane (rare; defensive)
                if old_next is not None:
                    try:
                        nxt_m = get_machine(old_next)
                        if nxt_m.lane == new_m.lane:
                            new_m.next = old_next
                        else:
                            new_m.next = None
                    except KeyError:
                        new_m.next = None
            machines.append(new_m)

        return {"message": "Machine added", "machine": new_m.model_dump()}

@app.post("/remove_machine")
def remove_machine(req: RemoveMachineRequest):
    with state_lock:
        try:
            idx = index_of(req.id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Machine not found")
        victim = machines[idx]

        # Rewire only upstream machines (any lane) that pointed to victim
        for u in upstream_of(victim.id):
            u.next = victim.next

        # Migrate WIP/queue downstream
        if victim.in_progress:
            item = victim.in_progress.pop(0)
            item["start_time"] = sim_time
            if victim.next is not None:
                get_machine(victim.next).queue.append(item)
        while victim.queue:
            if victim.next is not None:
                get_machine(victim.next).queue.append(victim.queue.pop(0))
            else:
                global total_completed, cycle_times
                it = victim.queue.pop(0)
                total_completed += 1
                cycle_times.append(sim_time - it["created_at"])

        machines.pop(idx)
        return {"message": "Machine removed", "removed_id": req.id}

@app.post("/start_simulation")
def start_simulation():
    global running, _last_wall
    with state_lock:
        running = True
        _last_wall = time.time()
    ensure_thread()
    return {"message": "Simulation started/resumed"}

@app.post("/pause_simulation")
def pause_simulation():
    global running, _last_wall
    with state_lock:
        running = False
        _last_wall = time.time()
    return {"message": "Simulation paused"}

@app.get("/state", response_model=StateSnapshot)
def get_state():
    with state_lock:
        return StateSnapshot(**build_state_dict())

# --- Persistence ---
@app.post("/save_state")
def save_state():
    with state_lock:
        data = {
            "sim_time": sim_time,
            "running": running,
            "total_started": total_started,
            "total_completed": total_completed,
            "cycle_times": cycle_times,
            "item_id_seq": item_id_seq,
            "machines": [m.model_dump() for m in machines],
        }
        with open(SAVE_PATH, "w") as f:
            json.dump(data, f, indent=2)
    return {"message": f"State saved to {os.path.basename(SAVE_PATH)}"}

@app.post("/load_state")
def load_state():
    global sim_time, running, total_started, total_completed, cycle_times, item_id_seq
    if not os.path.exists(SAVE_PATH):
        raise HTTPException(status_code=404, detail="No saved state found")
    with state_lock:
        if running:
            raise HTTPException(status_code=400, detail="Pause simulation before loading state")
        with open(SAVE_PATH, "r") as f:
            data = json.load(f)

        sim_time = data.get("sim_time", 0.0)
        running = False
        total_started = data.get("total_started", 0)
        total_completed = data.get("total_completed", 0)
        cycle_times = data.get("cycle_times", [])
        item_id_seq = data.get("item_id_seq", 0)

        machines.clear()
        for md in data.get("machines", []):
            md.setdefault("lane", 0)
            machines.append(Machine(**md))

    return {"message": "State restored successfully"}

# --- WebSocket streaming ---
@app.websocket("/ws/state")
async def ws_state(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            with state_lock:
                payload = json.dumps(build_state_dict())
            await ws.send_text(payload)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
    except Exception as e:
        print("WS error:", repr(e))
        ws_manager.disconnect(ws)

# --- Reset endpoint ---
@app.post("/reset_simulation")
def reset_simulation():
    global running, sim_time, _last_wall, total_started, total_completed, cycle_times, item_id_seq
    with state_lock:
        running = False
        sim_time = 0.0
        _last_wall = time.time()
        total_started = 0
        total_completed = 0
        cycle_times = []
        item_id_seq = 0
        for m in machines:
            m.in_progress.clear()
            m.queue.clear()
            m.completed = 0
            m.busy_time = 0.0
            m.last_state_change = 0.0
            m.blocked = False
    return {"message": "Simulation reset (paused). Click Start to run."}
