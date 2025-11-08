import { useEffect, useState } from "react";
import { getState } from "./api";
import Factory from "./scene/Factory";
import Controls from "./ui/Controls";
import Metrics from "./ui/Metrics";
import type { StateSnapshot } from "./api";

export default function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [focusedMachineId, setFocusedMachineId] = useState<number | null>(null);

  const refresh = async () => {
    try {
      const s = await getState();
      setSnapshot(s);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  const isRunning = !!snapshot?.running;

  // ---- simple inline layout (no external CSS needed) ----
  const appStyle: React.CSSProperties = {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f7f7f8",
    fontFamily:
      'Inter, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
  };

  const vizStyle: React.CSSProperties = {
    height: "56vh", // big canvas
    background: "#fff",
    borderBottom: "1px solid rgba(0,0,0,0.12)",
  };

  const panelsStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    gap: 16,
    padding: 12,
    alignItems: "stretch",
  };

  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 8,
    padding: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    overflow: "auto",
  };

  return (
    <div style={appStyle}>
      <div style={vizStyle}>
        <Factory
          snapshot={snapshot}
          focusedMachineId={focusedMachineId}
          onSelectMachine={(id) => setFocusedMachineId(id)}
        />
      </div>

      <div style={panelsStyle}>
        <div style={{ ...card, flex: "1 1 0", minWidth: 520 }}>
          <Controls onRefresh={refresh} isRunning={isRunning} />
        </div>
        <div style={{ ...card, flex: "0 0 34%", minWidth: 320 }}>
          <Metrics snapshot={snapshot as any} />
        </div>
      </div>
    </div>
  );
}
