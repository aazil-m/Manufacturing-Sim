// Simple fetch helpers with Vite proxy to backend.
// In vite.config, proxy /api -> http://localhost:8000
const BASE = "/api";

export type Machine = {
  id: number;
  name: string;
  takt_time: number;
  buffer: number;
  next: number | null;
};

export type StateSnapshot = {
  timestamp: number;
  items_in_system: number;
  throughput: number;
  total_started: number;
  total_completed: number;
  avg_cycle_time: number;
  running: boolean;
  machines: Array<{
    id: number;
    name: string;
    next: number | null;
    status: "processing" | "queued" | "idle";
    in_progress: number;
    in_progress_detail?: Array<{ item_id: number; progress: number }>;
    queue: number;
    buffer: number;
    takt_time: number;
    completed: number;
    utilization: number;
    blocked: boolean; // <-- now included in type
  }>;
};

async function json(r: Response) {
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getMachines(): Promise<Machine[]> {
  return json(await fetch(`${BASE}/machines`));
}

export async function getState(): Promise<StateSnapshot> {
  return json(await fetch(`${BASE}/state`));
}

export async function startSim() {
  return json(await fetch(`${BASE}/start_simulation`, { method: "POST" }));
}

export async function pauseSim() {
  return json(await fetch(`${BASE}/pause_simulation`, { method: "POST" }));
}

export async function updateMachine(body: Partial<Machine> & { id: number }) {
  return json(
    await fetch(`${BASE}/update_machine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

// Dynamic line editing
export async function addMachine(params: {
  name: string;
  takt_time: number;
  buffer: number;
  insert_after_id?: number | null;
  next?: number | null;
}) {
  return json(
    await fetch(`${BASE}/add_machine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
  );
}

export async function removeMachine(id: number) {
  return json(
    await fetch(`${BASE}/remove_machine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  );
}

// Persistence
export async function saveState() {
  return json(await fetch(`${BASE}/save_state`, { method: "POST" }));
}
export async function loadState() {
  return json(await fetch(`${BASE}/load_state`, { method: "POST" }));
}

// NEW: Reset whole simulation on the backend
export async function resetSimulation() {
  return json(await fetch(`${BASE}/reset_simulation`, { method: "POST" }));
}
