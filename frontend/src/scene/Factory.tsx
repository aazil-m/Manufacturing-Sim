import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MachineBox from "./MachineBox";
import ItemSphere from "./ItemSphere";
import { useMemo, useRef } from "react";
import { StateSnapshot } from "../types";

// Wider spacing for clearer motion
const MACHINE_X_SPACING = 6.0;
// Box is 2 units along X; offset a bit more to avoid touching faces.
const FACE_OFFSET = 1.15;

function SceneContent({
  snapshot,
  focusedMachineId,
  onSelectMachine
}: {
  snapshot: StateSnapshot | null;
  focusedMachineId: number | null;
  onSelectMachine: (id: number | null) => void;
}) {
  const machinePositions = useMemo(() => {
    const m = snapshot?.machines ?? [];
    return new Map(m.map((mm, idx) => [mm.id, [idx * MACHINE_X_SPACING, 0.5, 0] as [number, number, number]]));
  }, [snapshot]);

  const firstMachineId = snapshot?.machines?.[0]?.id ?? null;
  const lastMachineId  = snapshot?.machines?.[snapshot?.machines.length - 1]?.id ?? null;

  const sourcePos = useMemo<[number, number, number] | null>(() => {
    if (!firstMachineId) return null;
    const first = machinePositions.get(firstMachineId)!;
    return [first[0] - MACHINE_X_SPACING, 0.5, 0];
  }, [firstMachineId, machinePositions]);

  const sinkPos = useMemo<[number, number, number] | null>(() => {
    if (!lastMachineId) return null;
    const last = machinePositions.get(lastMachineId)!;
    return [last[0] + MACHINE_X_SPACING, 0.5, 0];
  }, [lastMachineId, machinePositions]);

  // Build render lists: tiny translucent queue dots + moving spheres
  const renderItems = useMemo(() => {
    if (!snapshot) return { queues: [] as [number, number, number][], moving: [] as [number, number, number][] };
    const queues: [number, number, number][] = [];
    const moving: [number, number, number][] = [];

    // Queues: compact, semi-transparent, offset away from left face
    snapshot.machines.forEach((m) => {
      const pos = machinePositions.get(m.id)!;
      for (let q = 0; q < m.queue; q++) {
        queues.push([pos[0] - (FACE_OFFSET + 0.3) - q * 0.3, 0.12, 0]);
      }
    });

    // In-progress with face offsets so spheres don't intersect boxes
    snapshot.machines.forEach((m) => {
      const details = m.in_progress_detail ?? [];
      const here = machinePositions.get(m.id)!;

      // from:
      let fromPos: [number, number, number] = [here[0] + FACE_OFFSET, here[1], here[2]];
      if (m.id === firstMachineId && sourcePos) {
        // source -> first: start at source
        fromPos = [sourcePos[0], sourcePos[1], sourcePos[2]];
      }

      // to:
      let toPos: [number, number, number] = m.next
        ? [ (machinePositions.get(m.next) ?? here)[0] - FACE_OFFSET, here[1], here[2] ]
        : (m.id === lastMachineId && sinkPos
            ? [sinkPos[0], sinkPos[1], sinkPos[2]]
            : [here[0] - FACE_OFFSET, here[1], here[2]]);

      details.forEach((d) => {
        const t = Math.min(Math.max(d.progress, 0), 1);
        const x = fromPos[0] + (toPos[0] - fromPos[0]) * t;
        const y = 0.22 + 0.8 * Math.sin(t * Math.PI); // smooth arc
        moving.push([x, y, 0]);
      });
    });

    return { queues, moving };
  }, [snapshot, machinePositions, firstMachineId, lastMachineId, sourcePos, sinkPos]);

  // --- Camera / OrbitControls handling ---
  const orbitRef = useRef<any>(null);

  // pick a nice default (2nd machine if present)
  const defaultTarget: [number, number, number] = useMemo(() => {
    if (!snapshot?.machines?.length) return [0, 0.5, 0];
    const midIdx = Math.min(1, snapshot.machines.length - 1);
    const midId = snapshot.machines[midIdx].id;
    return machinePositions.get(midId)!;
  }, [snapshot, machinePositions]);

  // One-shot tween state (so user remains free to move when no tween is active)
  const tweenRef = useRef<{
    active: boolean;
    t: number; // 0..1
    from: [number, number, number];
    to: [number, number, number];
  }>({ active: false, t: 0, from: [0, 0.5, 0], to: defaultTarget });

  const startFocusTween = (to: [number, number, number]) => {
    const ctrl = orbitRef.current;
    if (!ctrl) return;
    const current = [ctrl.target.x, ctrl.target.y, ctrl.target.z] as [number, number, number];
    tweenRef.current = { active: true, t: 0, from: current, to };
  };

  // progress tween for ~400ms using a smoothstep
  useFrame((state, delta) => {
    if (!tweenRef.current.active) return;
    const { from, to } = tweenRef.current;
    const speed = 3; // larger = quicker
    tweenRef.current.t = Math.min(1, tweenRef.current.t + delta * speed);
    const u = tweenRef.current.t;
    const s = u * u * (3 - 2 * u); // smoothstep

    const x = from[0] + (to[0] - from[0]) * s;
    const y = from[1] + (to[1] - from[1]) * s;
    const z = from[2] + (to[2] - from[2]) * s;

    orbitRef.current.target.set(x, y, z);
    orbitRef.current.update();

    if (u >= 1) tweenRef.current.active = false; // stop — user is free again
  });

  // when user clicks a machine, start a one-shot tween to its position
  const handleSelect = (id: number) => {
    onSelectMachine(id);
    const p = machinePositions.get(id) ?? defaultTarget;
    startFocusTween(p);
  };

  return (
    <>
      <ambientLight />
      <directionalLight position={[6, 10, 6]} intensity={1} />
      <gridHelper args={[46, 46]} />
      <OrbitControls ref={orbitRef as any} />

      {snapshot?.machines.map((m) => {
        const p = machinePositions.get(m.id)!;
        const color =
          m.status === "processing" ? "#34d399" : m.status === "queued" ? "#fbbf24" : "#60a5fa";
        return (
          <MachineBox
            key={m.id}
            label={m.name}
            position={p}
            color={color}
            onClick={() => handleSelect(m.id)}
          />
        );
      })}

      {/* Queues: tiny, translucent */}
      {renderItems.queues.map((p, i) => (
        <mesh key={`q-${i}`} position={p} scale={[0.24, 0.24, 0.24]}>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial transparent opacity={0.6} color="#9ca3af" />
        </mesh>
      ))}

      {/* Moving items */}
      {renderItems.moving.map((p, i) => (
        <ItemSphere key={`m-${i}`} position={p} />
      ))}
    </>
  );
}

export default function Factory({
  snapshot,
  focusedMachineId,
  onSelectMachine
}: {
  snapshot: StateSnapshot | null;
  focusedMachineId: number | null;
  onSelectMachine: (id: number | null) => void;
}) {
  return (
    <Canvas camera={{ position: [12, 6.5, 14], fov: 50 }}>
      <SceneContent
        snapshot={snapshot}
        focusedMachineId={focusedMachineId}
        onSelectMachine={onSelectMachine}
      />
    </Canvas>
  );
}
