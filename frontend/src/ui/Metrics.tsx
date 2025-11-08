import { StateSnapshot } from "../types";

export default function Metrics({ snapshot }: { snapshot: StateSnapshot | null }) {
  const itemsPerSec = snapshot?.throughput ?? 0;
  const itemsPerMin = itemsPerSec * 60;

  // Theoretical = 1 / max(takt_time)
  const theoreticalPerSec = snapshot
    ? (snapshot.machines.length ? 1 / Math.max(...snapshot.machines.map(m => m.takt_time)) : 0)
    : 0;
  const theoreticalPerMin = theoreticalPerSec * 60;

  return (
    <div className="panel">
      <h3>Metrics</h3>
      {snapshot ? (
        <ul style={{margin:0, paddingLeft:18}}>
          <li>time = {snapshot.timestamp.toFixed(2)}s</li>
          <li>items_in_system = {snapshot.items_in_system}</li>
          <li>throughput = {itemsPerSec.toFixed(3)} items/s ({itemsPerMin.toFixed(1)} items/min)</li>
          <li>theoretical (bottleneck) = {theoreticalPerSec.toFixed(3)} items/s ({theoreticalPerMin.toFixed(1)} items/min)</li>
          <li>completed = {snapshot.total_completed}</li>
          <li>avg_cycle_time = {snapshot.avg_cycle_time}s</li>
        </ul>
      ) : <p>—</p>}
    </div>
  );
}
