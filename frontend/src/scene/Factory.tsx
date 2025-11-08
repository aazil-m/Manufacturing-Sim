import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MachineBox from "./MachineBox";
import ItemSphere from "./ItemSphere";
import { useMemo, useRef } from "react";
import { StateSnapshot } from "../types";

const MACHINE_X_SPACING = 6.0;

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
    return new Map(
      m.map((mm, idx) => [mm.id, [-8.0 + idx * MACHINE_X_SPACING, 0.5, 0] as [number, number, number]])
    );
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

  // ---- Moving items ONLY: approach (visible) -> inside (hidden) -> emerge (visible) ----
  const movingItems = useMemo(() => {
    if (!snapshot) return [] as [number, number, number][];

    const out: [number, number, number][] = [];
    const APPROACH_FRAC = 0.20; // first 20% of processing shows approach
    const EMERGE_FRAC   = 0.20; // last 20% shows emerge
    const Y_LEVEL = 0.35;       // slightly above box top (box top ≈ 1.0)
    const Y_ARC   = 0.20;       // gentle arch so it's not a flat line
    const GAP     = 0.9;        // how far before/after the face we render approach/emerge

    snapshot.machines.forEach((m) => {
      const details = m.in_progress_detail ?? [];
      const here = machinePositions.get(m.id)!;
      const leftFaceX  = here[0] - 1.0;
      const rightFaceX = here[0] + 1.0;

      const approachStartX =
        m.id === firstMachineId && sourcePos ? sourcePos[0] : leftFaceX - GAP;

      const emergeEndX =
        m.id === lastMachineId && sinkPos ? sinkPos[0] : rightFaceX + GAP;

      details.forEach((d) => {
        const t = Math.min(Math.max(d.progress, 0), 1);

        if (t <= APPROACH_FRAC) {
          const u = t / APPROACH_FRAC;
          const x = approachStartX + (leftFaceX - approachStartX) * u;
          const y = Y_LEVEL + Y_ARC * Math.sin(u * Math.PI);
          out.push([x, y, 0]);
        } else if (t >= 1 - EMERGE_FRAC) {
          const u = (t - (1 - EMERGE_FRAC)) / EMERGE_FRAC;
          const x = rightFaceX + (emergeEndX - rightFaceX) * u;
          const y = Y_LEVEL + Y_ARC * Math.sin(u * Math.PI);
          out.push([x, y, 0]);
        } else {
          // Inside machine: hidden
        }
      });
    });

    return out;
  }, [snapshot, machinePositions, firstMachineId, lastMachineId, sourcePos, sinkPos]);

  // --- Camera / OrbitControls (one-shot tween to focus, then free orbit) ---
  const orbitRef = useRef<any>(null);

  const defaultTarget: [number, number, number] = useMemo(() => {
    if (!snapshot?.machines?.length) return [0, 0.5, 0];
    const midIdx = Math.min(1, snapshot.machines.length - 1);
    const midId = snapshot.machines[midIdx].id;
    return machinePositions.get(midId)!;
  }, [snapshot, machinePositions]);

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

  useFrame((_, delta) => {
    if (!tweenRef.current.active) return;
    const { from, to } = tweenRef.current;
    const speed = 3;
    tweenRef.current.t = Math.min(1, tweenRef.current.t + delta * speed);
    const u = tweenRef.current.t;
    const s = u * u * (3 - 2 * u); // smoothstep

    const x = from[0] + (to[0] - from[0]) * s;
    const y = from[1] + (to[1] - from[1]) * s;
    const z = from[2] + (to[2] - from[2]) * s;

    orbitRef.current.target.set(x, y, z);
    orbitRef.current.update();

    if (u >= 1) tweenRef.current.active = false; // free orbit again
  });

  const handleSelect = (id: number) => {
    onSelectMachine(id);
    const p = machinePositions.get(id) ?? defaultTarget;
    startFocusTween(p);
  };

  // helper: color by state with BLOCKED = yellow
  const colorForMachine = (m: any) => {
    if (m.status === "processing") {
      // If backend provides `blocked: true`, prefer that
      if (m.blocked) return "#facc15"; // yellow
      return "#22c55e"; // green
    }
    if (m.status === "queued") return "#fbbf24"; // amber
    if (m.status === "idle") return "#60a5fa"; // blue
    return "#9ca3af";
  };

  return (
    <>
      <ambientLight />
      <directionalLight position={[6, 10, 6]} intensity={1} />
      <gridHelper args={[46, 46]} />
      <OrbitControls ref={orbitRef as any} />

      {snapshot?.machines.map((m) => {
        const p = machinePositions.get(m.id)!;
        return (
          <MachineBox
            key={m.id}
            label={m.name}
            position={p}
            color={colorForMachine(m)}
            onClick={() => handleSelect(m.id)}
          />
        );
      })}

      {/* Visible segments only: approach & emerge */}
      {movingItems.map((p, i) => (
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
