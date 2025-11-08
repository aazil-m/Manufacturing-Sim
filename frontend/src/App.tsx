import { useEffect, useRef, useState } from "react";
import { getState, resetSimulation } from "./api";
import Factory from "./scene/Factory";
import Controls from "./ui/Controls";
import Metrics from "./ui/Metrics";
import type { StateSnapshot } from "./api";

// One point in the history series we’ll chart
export type HistoryPoint = {
  t: number;               // sim timestamp (seconds)
  throughput: number;      // items/sec
  items_in_system: number; // WIP
  avg_utilization: number; // 0..1
};

// we sample ~every 5s → keep ~10 minutes => 120 points
const HISTORY_MAX = 120;
const SAMPLE_MS = 5000;

export default function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [focusedMachineId, setFocusedMachineId] = useState<number | null>(null);
  const [chartsKey, setChartsKey] = useState(0); // force Metrics remount on reset

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<number | null>(null);
  const lastSampleRef = useRef<number>(0);

  // direct to backend in dev, same-origin in prod
  const wsUrl = useRef(
    import.meta.env.DEV
      ? `${location.protocol === "https:" ? "wss" : "ws"}://localhost:8000/ws/state`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/state`
  ).current;

  // Central place to apply a new snapshot and append a history point (throttled)
  const applySnapshot = (s: StateSnapshot) => {
    setSnapshot(s);

    const now = Date.now();
    if (now - lastSampleRef.current < SAMPLE_MS) return;
    lastSampleRef.current = now;

    const avgUtil =
      s.machines.length > 0
        ? s.machines.reduce((acc, m) => acc + (m.utilization ?? 0), 0) / s.machines.length
        : 0;

    setHistory((prev) => {
      const next = [
        ...prev,
        {
          t: s.timestamp,
          throughput: s.throughput,
          items_in_system: s.items_in_system,
          avg_utilization: avgUtil,
        },
      ];
      if (next.length > HISTORY_MAX) next.splice(0, next.length - HISTORY_MAX);
      return next;
    });
  };

  const setPolling = () => {
    clearPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await getState();
        applySnapshot(s);
      } catch {}
    }, SAMPLE_MS);
  };

  const clearPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const connectWS = () => {
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        clearPolling(); // stop polling when socket is up
      };

      ws.onmessage = (ev) => {
        try {
          const s = JSON.parse(ev.data) as StateSnapshot;
          applySnapshot(s);
        } catch (e) {
          console.error("bad ws message", e);
        }
      };

      ws.onerror = () => {
        wsRef.current = null;
        setPolling(); // fallback to polling
      };

      ws.onclose = () => {
        wsRef.current = null;
        setPolling();
        setTimeout(connectWS, 2000); // backoff & reconnect
      };
    } catch {
      setPolling();
    }
  };

  // Initial bootstrap: try WS; also prime once
  useEffect(() => {
    connectWS();
    getState().then(applySnapshot).catch(() => {});
    return () => {
      wsRef.current?.close();
      clearPolling();
    };
  }, []);

  const isRunning = !!snapshot?.running;

  // NEW: full reset flow (backend + charts)
  const handleReset = async () => {
    try {
      await resetSimulation();    // resets & pauses on backend
      setHistory([]);             // clear throughput history
      setChartsKey((k) => k + 1); // clear Metrics' local utilization history
      // Prime once so UI shows fresh zeroed snapshot immediately
      getState().then(applySnapshot).catch(() => {});
    } catch (e) {
      console.error("reset failed", e);
    }
  };

  const refreshOnce = async () => {
    try {
      const s = await getState();
      applySnapshot(s);
    } catch (e) {
      console.error("refresh failed", e);
    }
  };

// App.tsx  — replace these style blocks

const appStyle: React.CSSProperties = {
  minHeight: "90vh",       // use minHeight so page can grow if panels need more room
  display: "flex",
  flexDirection: "column",
  background: "#f7f7f8",
  fontFamily:
    'Inter, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
};

const vizStyle: React.CSSProperties = {
  height: "66vh",           // was 56vh → gives the canvas more room
  background: "#fff",
  borderBottom: "1px solid rgba(0,0,0,0.12)",
};

const panelsStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  gap: 24,
  padding: "24px 16px 16px 16px", // drop panels slightly
  alignItems: "flex-start",
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
          <Controls onRefresh={refreshOnce} isRunning={isRunning} />
        </div>
        <div style={{ ...card, flex: "0 0 34%", minWidth: 320 }}>
          {/* key forces Metrics to drop its internal rolling arrays */}
          <Metrics key={chartsKey} snapshot={snapshot as any} history={history} />
        </div>
      </div>
    </div>
  );
}
