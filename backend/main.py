from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import time, threading
from collections import deque
# --- added for persistence ---
import json, os
# -----------------------------

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
    in_progress: List[Dict[str, Any]] = Field(default_factory=list)  # items being processed with start_time
    queue: List[Dict[str, Any]] = Field(default_factory=list)        # waiting items (buffer)
    completed: int = 0
    busy_time: float = 0.0  # for utilization
    last_state_change: float = 0.0

class UpdateMachineRequest(BaseModel):
    id: int
    takt_time: Optional[float] = None
    buffer: Optional[int] = None
    name: Optional[str] = None
    next: Optional[int] = None

class AddMachineRequest(BaseModel):
    name: str
    takt_time: float = 1.0
    buffer: int = 1
    insert_after_id: Optional[int] = None
    next: Optional[int] = None

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

# Initial line (spec example)
machines: List[Machine] = [
    Machine(id=1, name="Cutting",   next=2, takt_time=5.0, buffer=2),
    Machine(id=2, name="Assembly",  next=3, takt_time=7.5, buffer=2),
    Machine(id=3, name="Packaging", next=None, takt_time=3.0, buffer=1),
]

# Global simulation state
state_lock = threading.Lock()
running = False
sim_thread: Optional[threading.Thread] = None

# Simulation clock (advances only when running)
sim_time = 0.0
_last_wall = time.time()

# Metrics
total_started = 0
total_completed = 0
cycle_times: List[float] = []  # per item (completed_time - created_time)
item_id_seq = 0
completions = deque(maxlen=5000)  # optional: for future rolling throughput

# --- added: path to save file ---
SAVE_PATH = os.path.join(os.path.dirname(__file__), "sim_state.json")
# --------------------------------

# -----------------------------
# Simulation engine (background)
# -----------------------------
TICK_SEC = 0.1

def get_machine(mid: int) -> Machine:
    for m in machines:
        if m.id == mid:
            return m
    raise KeyError(f"Machine {mid} not found")

def start_processing_if_possible(m: Machine, current_time: float):
    if len(m.in_progress) == 0 and len(m.queue) > 0:
        item = m.queue.pop(0)
        item["start_time"] = current_time
        if "entered_machine_at" not in item:
            item["entered_machine_at"] = current_time
        m.in_progress.append(item)
        m.last_state_change = current_time

def try_push_to_next(m: Machine, current_time: float):
    if len(m.in_progress) == 0:
        return
    item = m.in_progress[0]
    elapsed = current_time - item["start_time"]
    if elapsed >= m.takt_time:
        m.in_progress.pop(0)
        m.completed += 1
        m.busy_time += m.takt_time
        m.last_state_change = current_time

        nxt = m.next
        if nxt is None:
            global total_completed, cycle_times
            total_completed += 1
            cycle_times.append(current_time - item["created_at"])
            completions.append(current_time)
        else:
            next_m = get_machine(nxt)
            if len(next_m.queue) < next_m.buffer:
                next_m.queue.append(item)
            else:
                m.queue.insert(0, item)

def spawn_new_item_if_possible(current_time: float):
    global item_id_seq, total_started
    if not machines:
        return
    first = machines[0]
    if len(first.queue) < first.buffer:
        item_id_seq += 1
        item = {"item_id": item_id_seq, "created_at": current_time}
        first.queue.append(item)
        total_started += 1

def simulation_loop():
    global running, sim_time, _last_wall
    while True:
        with state_lock:
            now_wall = time.time()
            if running:
                dt = max(now_wall - _last_wall, 0.0)
                sim_time += dt

                # 1) complete/push downstream (reverse)
                for m in machines[::-1]:
                    try_push_to_next(m, sim_time)
                # 2) pull into processing
                for m in machines:
                    start_processing_if_possible(m, sim_time)
                # 3) source feed
                spawn_new_item_if_possible(sim_time)

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
# Helpers for dynamic editing
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

        if req.takt_time is not None:
            if req.takt_time <= 0:
                raise HTTPException(status_code=400, detail="takt_time must be > 0")
            m.takt_time = req.takt_time
        if req.buffer is not None:
            if req.buffer < 0:
                raise HTTPException(status_code=400, detail="buffer must be >= 0")
            m.buffer = req.buffer
        if req.name is not None:
            m.name = req.name
        if req.next is not None or req.next is None:
            m.next = req.next

        return {
            "message": "Machine updated",
            "machine": {
                "id": m.id, "name": m.name, "next": m.next,
                "takt_time": m.takt_time, "buffer": m.buffer
            }
        }

@app.post("/add_machine")
def add_machine(req: AddMachineRequest):
    with state_lock:
        new_id = next_id()
        new_m = Machine(
            id=new_id, name=req.name, takt_time=req.takt_time,
            buffer=req.buffer, next=None
        )
        if req.insert_after_id is not None:
            try:
                idx = index_of(req.insert_after_id)
            except KeyError:
                raise HTTPException(404, f"insert_after_id {req.insert_after_id} not found")
            prev = machines[idx]
            old_next = prev.next
            prev.next = new_id
            new_m.next = req.next if (req.next is not None) else old_next
            machines.insert(idx + 1, new_m)
        else:
            if machines:
                machines[-1].next = new_id
            new_m.next = req.next if (req.next is not None) else None
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

        # rewire upstream
        for u in upstream_of(victim.id):
            u.next = victim.next

        # migrate WIP/queue downstream (ignore buffer on this one-time move)
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
        _last_wall = time.time()  # reset wall baseline so dt is correct
    ensure_thread()
    return {"message": "Simulation started/resumed"}

@app.post("/pause_simulation")
def pause_simulation():
    global running, _last_wall
    with state_lock:
        running = False
        _last_wall = time.time()  # reset baseline
    return {"message": "Simulation paused"}

@app.get("/state", response_model=StateSnapshot)
def get_state():
    with state_lock:
        current_time = sim_time
        in_system = sum(len(m.queue) + len(m.in_progress) for m in machines)
        throughput = (total_completed / current_time) if current_time > 0 else 0.0
        avg_ct = (sum(cycle_times) / len(cycle_times)) if cycle_times else 0.0

        machines_view = []
        for m in machines:
            status = "processing" if len(m.in_progress) > 0 else ("idle" if len(m.queue) == 0 else "queued")
            detail = []
            if m.in_progress:
                for it in m.in_progress:
                    p = min(max((current_time - it["start_time"]) / m.takt_time, 0.0), 1.0)
                    detail.append({"item_id": it.get("item_id", -1), "progress": p})
            machines_view.append({
                "id": m.id,
                "name": m.name,
                "next": m.next,
                "status": status,
                "in_progress": len(m.in_progress),
                "in_progress_detail": detail,
                "queue": len(m.queue),
                "buffer": m.buffer,
                "takt_time": m.takt_time,
                "completed": m.completed,
                "utilization": (m.busy_time / current_time) if current_time > 0 else 0.0
            })

        return StateSnapshot(
            timestamp=round(current_time, 2),
            items_in_system=in_system,
            throughput=round(throughput, 4),
            total_started=total_started,
            total_completed=total_completed,
            avg_cycle_time=round(avg_ct, 3),
            machines=machines_view,
            running=running
        )

# -----------------------------
# Persistence endpoints (added)
# -----------------------------
@app.post("/save_state")
def save_state():
    with state_lock:
        data = {
            "sim_time": sim_time,
            "running": running,          # will be set false on load
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
        running = False  # always load as paused; user can Start explicitly
        total_started = data.get("total_started", 0)
        total_completed = data.get("total_completed", 0)
        cycle_times = data.get("cycle_times", [])
        item_id_seq = data.get("item_id_seq", 0)

        machines.clear()
        for md in data.get("machines", []):
            machines.append(Machine(**md))

    return {"message": "State restored successfully"}
