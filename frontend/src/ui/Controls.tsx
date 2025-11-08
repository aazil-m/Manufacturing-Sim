import { useEffect, useState } from "react";
import { getMachines, startSim, pauseSim, updateMachine } from "../api";

type Machine = { id:number; name:string; takt_time:number; buffer:number; next:number|null; };

export default function Controls({ onRefresh, isRunning }: { onRefresh: () => void; isRunning: boolean }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => setMachines(await getMachines());

  useEffect(() => { load(); }, []);

  const onUpdate = async (m: Machine, idx: number, field: "takt_time"|"buffer", val: number) => {
    setBusy(true);
    try {
      await updateMachine({ id: m.id, [field]: val });
      await load();
      onRefresh();
    } finally { setBusy(false); }
  };

  const swatch = (c: string, label: string) => (
    <div style={{display:"flex", alignItems:"center", gap:8}}>
      <span style={{width:14, height:14, background:c, borderRadius:3, display:"inline-block", border:"1px solid #0001"}} />
      <span>{label}</span>
    </div>
  );

  return (
    <div className="panel">
      <div style={{ marginBottom: 8, display:"flex", gap:8 }}>
        <button disabled={busy || isRunning} onClick={async ()=>{
          setBusy(true); try { await startSim(); } finally { setBusy(false); onRefresh(); }
        }}>Start</button>

        <button disabled={busy || !isRunning} onClick={async ()=>{
          setBusy(true); try { await pauseSim(); } finally { setBusy(false); onRefresh(); }
        }}>Pause</button>

        <button disabled={busy} onClick={async ()=>{ await load(); onRefresh(); }}>Refresh</button>
      </div>

      {/* Legend */}
      <div style={{display:"flex", gap:18, margin:"8px 0 12px 0", fontSize:13, opacity:0.9}}>
        {swatch("#34d399", "Processing")}
        {swatch("#fbbf24", "Queued (items waiting)")}
        {swatch("#60a5fa", "Idle")}
      </div>

      <h3>Machines</h3>
      <table>
        <thead><tr><th>Name</th><th>takt_time</th><th>buffer</th></tr></thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  defaultValue={m.takt_time}
                  onBlur={(e)=>onUpdate(m, m.id, "takt_time", parseFloat(e.currentTarget.value))}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="1"
                  defaultValue={m.buffer}
                  onBlur={(e)=>onUpdate(m, m.id, "buffer", parseInt(e.currentTarget.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
