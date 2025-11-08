export type InProgressDetail = { item_id: number; progress: number };

export type MachineView = {
  id: number;
  name: string;
  next: number | null;
  status: "processing" | "idle" | "queued";
  in_progress: number;
  in_progress_detail?: InProgressDetail[];
  queue: number;
  buffer: number;
  takt_time: number;
  completed: number;
  utilization: number;
};

export type StateSnapshot = {
  timestamp: number;
  items_in_system: number;
  throughput: number;
  total_started: number;
  total_completed: number;
  avg_cycle_time: number;
  machines: MachineView[];
};
