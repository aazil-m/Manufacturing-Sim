import React from "react";
import type { StateSnapshot } from "../api";
import type { HistoryPoint } from "../App";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export default function Metrics({
  snapshot,
  history,
}: {
  snapshot: StateSnapshot | null;
  history: HistoryPoint[];
}) {
  // Prepare chart data (clone so we can map labels without mutating state)
  const data = history.map((d) => ({
    t: d.t,
    // label time as “t-xxs” from the latest point
    // (we show absolute seconds on the axis tooltip anyway)
    throughput: Number(d.throughput?.toFixed(4)),
    util_pct: Math.round(d.avg_utilization * 1000) / 10, // 0..100 with 0.1 precision
    wip: d.items_in_system,
  }));

  const latest = snapshot;

  return (
    <div>
      <h3>Metrics</h3>
      <ul style={{ lineHeight: 1.8 }}>
        <li>time = {latest ? `${latest.timestamp.toFixed(2)}s` : "—"}</li>
        <li>items_in_system = {latest ? latest.items_in_system : "—"}</li>
        <li>
          throughput ={" "}
          {latest ? `${latest.throughput.toFixed(3)} items/s (${(latest.throughput * 60).toFixed(1)} items/min)` : "—"}
        </li>
        <li>completed = {latest ? latest.total_completed : "—"}</li>
        <li>avg_cycle_time = {latest ? `${latest.avg_cycle_time.toFixed(3)}s` : "—"}</li>
      </ul>

      <div style={{ height: 200, marginTop: 8 }}>
        <h4 style={{ margin: "6px 0" }}>Throughput (items/sec)</h4>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              tickFormatter={(v) => `${v.toFixed(0)}s`}
              minTickGap={24}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(v) => v.toFixed(2)}
              width={50}
            />
            <Tooltip
              formatter={(val: any) => (typeof val === "number" ? val.toFixed(4) : val)}
              labelFormatter={(v) => `t = ${v.toFixed(2)}s`}
            />
            <Legend />
            <Line type="monotone" dataKey="throughput" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 200, marginTop: 18 }}>
        <h4 style={{ margin: "6px 0" }}>Average Utilization (%)</h4>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              tickFormatter={(v) => `${v.toFixed(0)}s`}
              minTickGap={24}
            />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={50} />
            <Tooltip
              formatter={(val: any) =>
                typeof val === "number" ? `${val.toFixed(1)}%` : val
              }
              labelFormatter={(v) => `t = ${v.toFixed(2)}s`}
            />
            <Legend />
            <Line type="monotone" dataKey="util_pct" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
