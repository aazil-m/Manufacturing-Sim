import { useEffect, useRef, useState } from "react";
import Factory from "./scene/Factory";
import Controls from "./ui/Controls";
import Metrics from "./ui/Metrics";
import { StateSnapshot } from "./types";
import { getState } from "./api";

export default function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const lastTsRef = useRef<number>(0);

  const refresh = async () => {
    const s: StateSnapshot = await getState();
    setSnapshot(s);
    // If timestamp advanced, we consider the sim running
    if (s?.timestamp > lastTsRef.current) {
      setIsRunning(true);
    } else if (s && s.timestamp === lastTsRef.current) {
      setIsRunning(false);
    }
    lastTsRef.current = s?.timestamp ?? 0;
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="layout">
      <div>
        <Factory snapshot={snapshot} />
      </div>
      <div className="bottom" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Controls onRefresh={refresh} isRunning={isRunning} />
        <Metrics snapshot={snapshot} />
      </div>
    </div>
  );
}
