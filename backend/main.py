from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import time, threading

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

class StateSnapshot(BaseModel):
    timestamp: float
    items_in_system: int
    throughput: float
    total_started: int
    total_completed: int
    avg_cycle_time: float
    machines: List[Dict[str, Any]]

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
t0 = time.time()
last_tick = t0

# Metrics
total_started = 0
total_completed = 0
cycle_times: List[float] = []  # per item (completed_time - created_time)
item_id_seq = 0

# -----------------------------
# Simulation engine (background)
# -----------------------------
TICK_SEC = 0.1

def now() -> float:
    return time.time() - t0

def start_processing_if_possible(m: Machine, current_time: float):
    # Fill machine from its queue into in_progress if it has capacity (1 item at a time for simplicity)
    if len(m.in_progress) == 0 and len(m.queue) > 0:
        item = m.queue.pop(0)
        item["start_time"] = current_time
        if "entered_machine_at" not in item:
            item["entered_machine_at"] = current_time
        m.in_progress.append(item)
        m.last_state_change = current_time

def try_push_to_next(m: Machine, current_time: float):
    # If item finished processing, send to next machine's buffer or complete if None
    if len(m.in_progress) == 0:
        return
    item = m.in_progress[0]
    elapsed = current_time - item["start_time"]
    if elapsed >= m.takt_time:
        # item finished here
        m.in_progress.pop(0)
        m.completed += 1
        m.busy_time += m.takt_time
        m.last_state_change = current_time

        nxt = m.next
        if nxt is None:
            # completed the line
            global total_completed, cycle_times
            total_completed += 1
            cycle_times.append(current_time - item["created_at"])
        else:
            # push to next buffer if space, otherwise wait (re-queue in this machine until space)
            next_m = get_machine(nxt)
            if len(next_m.queue) < next_m.buffer:
                next_m.queue.append(item)
            else:
                # If next buffer full, keep item at the head of our queue to retry next tick
                m.queue.insert(0, item)

def get_machine(mid: int) -> Machine:
    for m in machines:
        if m.id == mid:
            return m
    raise KeyError(f"Machine {mid} not found")

def spawn_new_item_if_possible(current_time: float):
    """
    Simple source: always try to add a new item to the first machine's buffer if space exists.
    This keeps a constant WIP pressure on the line (good enough for demo).
    """
    global item_id_seq, total_started
    first = machines[0]
    if len(first.queue) < first.buffer:
        item_id_seq += 1
        item = {"item_id": item_id_seq, "created_at": current_time}
        first.queue.append(item)
        total_started += 1

def simulation_loop():
    global running, last_tick
    while True:
        with state_lock:
            if not running:
                pass  # fall through and sleep
            else:
                current_time = now()

                # 1) Try to complete items and push downstream
                for m in machines[::-1]:
                    try_push_to_next(m, current_time)

                # 2) Pull from queues into processing if idle
                for m in machines:
                    start_processing_if_possible(m, current_time)

                # 3) Source tries to feed the line
                spawn_new_item_if_possible(current_time)

                last_tick = current_time

        time.sleep(TICK_SEC)

def ensure_thread():
    global sim_thread
    if sim_thread is None or not sim_thread.is_alive():
        t = threading.Thread(target=simulation_loop, daemon=True)
        t.start()
        sim_thread = t

# Start the thread on import
ensure_thread()

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
            # If shrinking buffer below current queue length, keep extra items (no drop) — still valid logically
            m.buffer = req.buffer
        if req.name is not None:
            m.name = req.name
        if req.next is not None or req.next is None:
            m.next = req.next

        return {
            "message": "Machine updated",
            "machine": {
                "id": m.id,
                "name": m.name,
                "next": m.next,
                "takt_time": m.takt_time,
                "buffer": m.buffer
            }
        }

@app.post("/start_simulation")
def start_simulation():
    global running
    with state_lock:
        running = True
    ensure_thread()
    return {"message": "Simulation started/resumed"}

@app.post("/pause_simulation")
def pause_simulation():
    global running
    with state_lock:
        running = False
    return {"message": "Simulation paused"}

@app.get("/state", response_model=StateSnapshot)
def get_state():
    with state_lock:
        current_time = now()
        in_system = sum(len(m.queue) + len(m.in_progress) for m in machines)
        throughput = (total_completed / current_time) if current_time > 0 else 0.0
        avg_ct = (sum(cycle_times) / len(cycle_times)) if cycle_times else 0.0

        machines_view = []
        for m in machines:
            status = "processing" if len(m.in_progress) > 0 else ("idle" if len(m.queue) == 0 else "queued")
            machines_view.append({
                "id": m.id,
                "name": m.name,
                "status": status,
                "in_progress": len(m.in_progress),
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
            machines=machines_view
        )
