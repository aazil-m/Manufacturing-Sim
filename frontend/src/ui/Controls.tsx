import { useEffect, useMemo, useState } from "react";
import {
  getMachines,
  startSim,
  pauseSim,
  updateMachine,
  addMachine,
  removeMachine,
} from "../api";

type Machine = {
  id: number;
  name: string;
  takt_time: number;
  buffer: number;
  next: number | null;
};

// --- added: local helpers to call persistence endpoints via the vite proxy (/api) ---
async function saveState() {
  const r = await fetch("/api/save_state", { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
}
async function loadState() {
  const r = await fetch("/api/load_state", { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
}
// ------------------------------------------------------------------------------------

export default function Controls({
  onRefresh,
  isRunning,
}: {
  onRefresh: () => void;
  isRunning: boolean;
}) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [busy, setBusy] = useState(false);

  // add form state
  const [newName, setNewName] = useState("New Machine");
  const [newTakt, setNewTakt] = useState<number>(3);
  const [newBuf, setNewBuf] = useState<number>(1);

  // NOTE: make this a string so the <select> has a single value type
  // "end" or the stringified machine id (e.g. "2")
  const [insertAfter, setInsertAfter] = useState<string>("end");

  const load = async () => setMachines(await getMachines());

  useEffect(() => {
    load();
  }, []);

  const onUpdate = async (
    m: Machine,
    field: "takt_time" | "buffer" | "name",
    val: number | string
  ) => {
    setBusy(true);
    try {
      await updateMachine({ id: m.id, [field]: val } as any);
      await load();
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    setBusy(true);
    try {
      await addMachine({
        name: newName.trim() || "New Machine",
        takt_time: Number(newTakt) || 1,
        buffer: Number(newBuf) || 1,
        insert_after_id: insertAfter === "end" ? null : Number(insertAfter),
      });
      setNewName("New Machine");
      await load();
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (m: Machine) => {
    if (!confirm(`Remove machine "${m.name}" (id=${m.id})?`)) return;
    setBusy(true);
    try {
      await removeMachine(m.id);
      await load();
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  // All option values are strings
  const insertAfterOptions = useMemo(
    () =>
      [
        { value: "end", label: "— append to end —" },
        ...machines.map((m) => ({
          value: String(m.id),
          label: `After ${m.name} (#${m.id})`,
        })),
      ] as Array<{ value: string; label: string }>,
    [machines]
  );

  return (
    <div className="panel">
      <div style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          disabled={busy || isRunning}
          onClick={async () => {
            setBusy(true);
            try {
              await startSim();
            } finally {
              setBusy(false);
              onRefresh();
            }
          }}
        >
          Start
        </button>

        <button
          disabled={busy || !isRunning}
          onClick={async () => {
            setBusy(true);
            try {
              await pauseSim();
            } finally {
              setBusy(false);
              onRefresh();
            }
          }}
        >
          Pause
        </button>

        {/* --- added: Save / Load --- */}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await saveState();
              alert("State saved");
            } catch (e) {
              alert("Save failed");
              console.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </button>

        <button
          disabled={busy || isRunning}
          onClick={async () => {
            setBusy(true);
            try {
              await loadState();
              await load();
              onRefresh();
              alert("State loaded");
            } catch (e) {
              alert("Load failed (pause the simulation first?)");
              console.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Load
        </button>
        {/* ------------------------- */}

        <button
          disabled={busy}
          onClick={async () => {
            await load();
            onRefresh();
          }}
        >
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 18,
          margin: "8px 0 12px 0",
          fontSize: 13,
          opacity: 0.9,
        }}
      >
        <Swatch color="#34d399" label="Processing" />
        <Swatch color="#fbbf24" label="Queued (items waiting)" />
        <Swatch color="#60a5fa" label="Idle" />
      </div>

      <h3>Machines</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>takt_time</th>
            <th>buffer</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id}>
              <td>
                <input
                  type="text"
                  defaultValue={m.name}
                  onBlur={(e) => onUpdate(m, "name", e.currentTarget.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  defaultValue={m.takt_time}
                  onBlur={(e) => onUpdate(m, "takt_time", parseFloat(e.currentTarget.value))}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="1"
                  defaultValue={m.buffer}
                  onBlur={(e) => onUpdate(m, "buffer", parseInt(e.currentTarget.value))}
                />
              </td>
              <td>
                <button className="danger" disabled={busy} onClick={() => handleRemove(m)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {/* Add new machine row */}
          <tr>
            <td>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New machine name"
              />
            </td>
            <td>
              <input
                type="number"
                step="0.1"
                value={newTakt}
                onChange={(e) => setNewTakt(parseFloat(e.target.value))}
              />
            </td>
            <td>
              <input
                type="number"
                step="1"
                value={newBuf}
                onChange={(e) => setNewBuf(parseInt(e.target.value))}
              />
            </td>
            <td>
              <button disabled={busy} onClick={handleAdd}>
                Add
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 13, opacity: 0.85 }}>Insert position: </label>{" "}
        <select value={insertAfter} onChange={(e) => setInsertAfter(e.target.value)}>
          {insertAfterOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 14,
          height: 14,
          background: color,
          borderRadius: 3,
          display: "inline-block",
          border: "1px solid #0001",
        }}
      />
      <span>{label}</span>
    </div>
  );
}
