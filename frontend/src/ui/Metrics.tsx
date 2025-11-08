import { useEffect, useMemo, useRef, useState } from "react";
import type { StateSnapshot } from "../api";
import {
  LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer
} from "recharts";

type HistoryPoint = {
  t: number;          // seconds
  throughput: number; // items / s
};

type UtilRow = {
  t: number;
  [k: string]: number; // m_<id>: utilization (0..1)
};

const MAX_POINTS = 120; // ~10 minutes at 5s sampling
const COLORS = ["#2563eb","#16a34a","#f59e0b","#ef4444","#8b5cf6","#0ea5e9","#22c55e","#eab308","#f97316","#dc2626"];
const SAMPLE_SEC = 5;

export default function Metrics({
  snapshot,
  history,
}: {
  snapshot: StateSnapshot | null;
  history?: HistoryPoint[];
}) {
  const [view, setView] = useState<"throughput" | "util">("throughput");

  // Build per-machine utilization time series (sampled every 5s)
  const [utilRows, setUtilRows] = useState<UtilRow[]>([]);
  const nameMapRef = useRef<Map<string,string>>(new Map()); // "m_<id>" -> name
  const lastUtilTRef = useRef<number>(0);

  useEffect(() => {
    if (!snapshot) return;
    const t = snapshot.timestamp ?? 0;

    if (t - lastUtilTRef.current < SAMPLE_SEC - 1e-3) return; // sample ~every 5s
    lastUtilTRef.current = t;

    const row: UtilRow = { t };
    snapshot.machines.forEach((m) => {
      const key = `m_${m.id}`;
      row[key] = clamp01(m.utilization ?? 0);
      nameMapRef.current.set(key, m.name);
    });

    setUtilRows(prev => {
      const next = [...prev, row];
      if (next.length > MAX_POINTS) next.shift();
      return next;
    });
  }, [snapshot]);

  const utilSeriesKeys = useMemo(() => {
    return Array.from(nameMapRef.current.keys()).sort((a, b) => {
      const ia = parseInt(a.slice(2), 10);
      const ib = parseInt(b.slice(2), 10);
      return ia - ib;
    });
  }, [utilRows.length]);

  const labelFor = (key: string) => nameMapRef.current.get(key) || key;

  const summary = useMemo(() => {
    if (!snapshot) return null;
    return [
      ["time", `${snapshot.timestamp.toFixed(2)}s`],
      ["items_in_system", String(snapshot.items_in_system)],
      ["throughput", `${snapshot.throughput.toFixed(3)} items/s (${(snapshot.throughput*60).toFixed(1)} items/min)`],
      ["total_completed", String(snapshot.total_completed)],
      ["avg_cycle_time", `${snapshot.avg_cycle_time.toFixed(3)}s`],
    ];
  }, [snapshot]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Metrics</h3>
        <select
          value={view}
          onChange={(e) => setView(e.target.value as any)}
          style={{ padding: "4px 8px" }}
          aria-label="Select metrics view"
        >
          <option value="throughput">Throughput (line)</option>
          <option value="util">Per-machine utilization (lines)</option>
        </select>
      </div>

      {summary && (
        <ul style={{ marginTop: 6, marginBottom: 12 }}>
          {summary.map(([k, v]) => (
            <li key={k}><strong>{k}</strong> = {v}</li>
          ))}
        </ul>
      )}

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          {view === "throughput" ? (
            <LineChart data={(history ?? [])}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" domain={["dataMin","dataMax"]} tickFormatter={(v) => `${v}s`} />
              <YAxis tickFormatter={(v) => Number(v).toFixed(3)} label={{ value: "items/s", angle: -90, position: "insideLeft" }} />
              <Tooltip
                labelFormatter={(v) => `t=${v}s`}
                formatter={(val: any) => [`${Number(val).toFixed(3)} items/s`, "throughput"]} />
              <Legend />
              <Line type="monotone" dataKey="throughput" dot={false} strokeWidth={2} />
            </LineChart>
          ) : (
            <LineChart data={utilRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="t" type="number" domain={["dataMin","dataMax"]} tickFormatter={(v) => `${v}s`} />
              <YAxis domain={[0,1]} tickFormatter={(v) => `${Math.round(Number(v)*100)}%`} label={{ value: "utilization", angle: -90, position: "insideLeft" }} />
              <Tooltip
                labelFormatter={(v) => `t=${v}s`}
                formatter={(val: any, name: string) => [`${Math.round(Number(val)*100)}%`, labelFor(name)]}
              />
              <Legend formatter={(val) => labelFor(String(val))} />
              {utilSeriesKeys.map((key, idx) => (
                <Line key={key} type="monotone" dataKey={key} dot={false} stroke={COLORS[idx % COLORS.length]} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function clamp01(x: number) {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
