import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MachineBox from "./MachineBox";
import ItemSphere from "./ItemSphere";
import { useMemo } from "react";
import { StateSnapshot } from "../types";

// Wider spacing for clearer motion
const MACHINE_X_SPACING = 6.0;

export default function Factory({ snapshot }: { snapshot: StateSnapshot | null }) {
  const machinePositions = useMemo(() => {
    const m = snapshot?.machines ?? [];
    return new Map(m.map((mm, idx) => [mm.id, [idx * MACHINE_X_SPACING, 0.5, 0] as [number, number, number]]));
  }, [snapshot]);

  const renderItems = useMemo(() => {
    if (!snapshot) return [];
    const items: [number, number, number][] = [];

    // Queues: line up left of each machine
    snapshot.machines.forEach((m) => {
      const pos = machinePositions.get(m.id)!;
      for (let q = 0; q < m.queue; q++) items.push([pos[0] - 1.2 + q * 0.35, 0.2, 0]);
    });

    // In-progress: lerp between current machine and next (small arc)
    snapshot.machines.forEach((m) => {
      const details = m.in_progress_detail ?? [];
      const fromPos = machinePositions.get(m.id)!;
      const toPos = m.next ? machinePositions.get(m.next) ?? fromPos : fromPos;
      details.forEach((d) => {
        const t = Math.min(Math.max(d.progress, 0), 1);
        const x = fromPos[0] + (toPos[0] - fromPos[0]) * t;
        const y = 0.25 + 0.8 * Math.sin(t * Math.PI); // smoother arc
        items.push([x, y, 0]);
      });
    });

    return items;
  }, [snapshot, machinePositions]);

  return (
    <Canvas camera={{ position: [8, 6, 12], fov: 50 }}>
      <ambientLight />
      <directionalLight position={[6, 10, 6]} intensity={1} />
      <gridHelper args={[40, 40]} />
      <OrbitControls />

      {snapshot?.machines.map((m) => {
        const p = machinePositions.get(m.id)!;
        const color =
          m.status === "processing" ? "#34d399" : m.status === "queued" ? "#fbbf24" : "#60a5fa";
        return <MachineBox key={m.id} label={m.name} position={p} color={color} />;
      })}

      {renderItems.map((p, i) => (
        <ItemSphere key={i} position={p} />
      ))}
    </Canvas>
  );
}
