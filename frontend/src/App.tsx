import React, { useEffect, useRef, useState } from "react";
import { getState } from "./api";
import Factory from "./scene/Factory";
import Controls from "./ui/Controls";
import Metrics from "./ui/Metrics";
import type { StateSnapshot } from "./api";

export default function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [focusedMachineId, setFocusedMachineId] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<number | null>(null);

  // Direct to backend in dev; same-origin in prod
  const wsUrl = useRef(
    import.meta.env.DEV
      ? `${location.protocol === "https:" ? "wss" : "ws"}://localhost:8000/ws/state`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/state`
  ).current;

  // ---- polling fallback ------------------------------------------------------
  const clearPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const setPolling = () => {
    clearPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await getState();
        setSnapshot(s);
      } catch (e) {
        console.error("poll error", e);
      }
    }, 1000);
  };

  // ---- websocket connect/retry ----------------------------------------------
  const connectWS = () => {
    try {
      // guard: don't create multiple sockets
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // stop polling when socket is up
        clearPolling();
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as StateSnapshot;
          setSnapshot(data);
        } catch (e) {
          console.error("bad ws message", e);
        }
      };

      ws.onerror = () => {
        // fall back to polling
        wsRef.current = null;
        setPolling();
      };

      ws.onclose = () => {
        wsRef.current = null;
        // keep UI fresh via polling; try reconnecting shortly
        setPolling();
        setTimeout(connectWS, 2000);
      };
    } catch (e) {
      console.error("ws connect failed", e);
      setPolling();
    }
  };

  // ---- bootstrap -------------------------------------------------------------
  useEffect(() => {
    connectWS();
    // prime once so UI isn't empty while WS connects
    getState().then(setSnapshot).catch(() => {});
    return () => {
      try { wsRef.current?.close(); } catch {}
      clearPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRunning = !!snapshot?.running;

  // ---- styles ----------------------------------------------------------------
  const appStyle: React.CSSProperties = {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f7f7f8",
    fontFamily:
      'Inter, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
  };
  const vizStyle: React.CSSProperties = {
    height: "56vh",
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

  const refreshOnce = async () => {
    try {
      const s = await getState();
      setSnapshot(s);
    } catch (e) {
      console.error(e);
    }
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
          <Metrics snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}
