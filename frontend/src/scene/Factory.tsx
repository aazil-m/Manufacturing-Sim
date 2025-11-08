import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import MachineBox from "./MachineBox";
import ItemSphere from "./ItemSphere";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StateSnapshot } from "../api";

const MACHINE_X_SPACING = 6.0;
const LANE_Z_SPACING = -4.0;

// ------- Helpers to order boxes left→right within each lane -------
function orderLaneChain(laneMachines: StateSnapshot["machines"]) {
  const idMap = new Map(laneMachines.map((m) => [m.id, m]));
  const targets = new Set<number>();
  laneMachines.forEach((m) => {
    if (m.next != null) {
      const nxt = idMap.get(m.next);
      if (nxt && nxt.lane === m.lane) targets.add(m.next);
    }
  });
  const sources = laneMachines.filter((m) => !targets.has(m.id));
  const ordered: number[] = [];
  for (const s of sources) {
    let cur: number | null = s.id;
    while (cur != null && !ordered.includes(cur)) {
      ordered.push(cur);
      const m = idMap.get(cur);
      if (!m || m.next == null) break;
      const nextM = idMap.get(m.next);
      if (!nextM || nextM.lane !== m.lane) break;
      cur = nextM.id;
    }
  }
  for (const m of laneMachines) if (!ordered.includes(m.id)) ordered.push(m.id);
  return ordered;
}

// -------- Event-driven sphere animation --------
type Trail = {
  key: string;                // unique
  lane: number;
  kind: "approach" | "emerge";
  startMs: number;
  durMs: number;
  from: [number, number, number];
  to: [number, number, number];
};

function nowMs() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }
function smoothstep(u: number) { return u * u * (3 - 2 * u); }

function SceneContent({
  snapshot,
  onSelectMachine,
}: {
  snapshot: StateSnapshot | null;
  onSelectMachine: (id: number | null) => void;
}) {
  // --- layout per lane ---
  const laneOrder = useMemo(() => {
    const byLane = new Map<number, number[]>();
    if (!snapshot?.machines) return byLane;
    const lanes = Array.from(new Set(snapshot.machines.map((m) => m.lane))).sort((a, b) => a - b);
    for (const lane of lanes) {
      const laneMs = snapshot.machines.filter((m) => m.lane === lane);
      byLane.set(lane, orderLaneChain(laneMs));
    }
    return byLane;
  }, [snapshot]);

  // id -> position
  const machinePositions = useMemo(() => {
    const pos = new Map<number, [number, number, number]>();
    const y = 0.5;
    for (const [lane, ids] of Array.from(laneOrder.entries()).sort((a, b) => a[0] - b[0])) {
      ids.forEach((id, idx) => {
        pos.set(id, [-8.0 + idx * MACHINE_X_SPACING, y, lane * LANE_Z_SPACING]);
      });
    }
    return pos;
  }, [laneOrder]);

  // --- store previous per-machine state to detect transitions ---
  const prevRef = useRef<Map<number, { processing: boolean; itemId: number | null }>>(new Map());
  const [trails, setTrails] = useState<Trail[]>([]);

  // Detect start/finish events whenever we get a new snapshot
  useEffect(() => {
    if (!snapshot?.machines) return;
    const GAP = 0.9;
    const Y = 0.35;

    const addTrail = (t: Trail) =>
      setTrails((old) => [...old.filter((x) => nowMs() - x.startMs < x.durMs), t]);

    const seenNow = new Map<number, { processing: boolean; itemId: number | null }>();

    snapshot.machines.forEach((m) => {
      const pos = machinePositions.get(m.id) ?? [-8, 0.5, 0];
      const leftX = pos[0] - 1.0;
      const rightX = pos[0] + 1.0;

      const prev = prevRef.current.get(m.id) ?? { processing: false, itemId: null };
      const curItem = (m.in_progress_detail && m.in_progress_detail[0]?.item_id) ?? null;
      const processingNow = m.status === "processing";

      // START: not processing -> processing (or new item id)
      if (processingNow && (!prev.processing || prev.itemId !== curItem) && curItem != null) {
        addTrail({
          key: `in-${m.id}-${curItem}-${nowMs()}`,
          lane: m.lane,
          kind: "approach",
          startMs: nowMs(),
          durMs: 600, // ms
          from: [leftX - GAP, Y, pos[2]],
          to: [leftX, Y, pos[2]],
        });
      }

      // FINISH: processing -> not processing (item left)
      if (prev.processing && !processingNow) {
        addTrail({
          key: `out-${m.id}-${prev.itemId ?? "x"}-${nowMs()}`,
          lane: m.lane,
          kind: "emerge",
          startMs: nowMs(),
          durMs: 600,
          from: [rightX, Y, pos[2]],
          to: [rightX + GAP, Y, pos[2]],
        });
      }

      seenNow.set(m.id, { processing: processingNow, itemId: curItem });
    });

    prevRef.current = seenNow;
  }, [snapshot, machinePositions]);

  // advance and prune trails per frame
  const animatedSpheres = useMemo(() => trails, [trails]);

  useFrame(() => {
    setTrails((old) => old.filter((t) => nowMs() - t.startMs < t.durMs));
  });

  // --- orbit focus tween ---
  const orbitRef = useRef<any>(null);
  const tweenRef = useRef<{ active: boolean; t: number; from: [number, number, number]; to: [number, number, number]; }>({
    active: false, t: 0, from: [0, 0.5, 0], to: [0, 0.5, 0],
  });

  const startFocusTween = (to: [number, number, number]) => {
    const ctrl = orbitRef.current;
    if (!ctrl) return;
    const current: [number, number, number] = [ctrl.target.x, ctrl.target.y, ctrl.target.z];
    tweenRef.current = { active: true, t: 0, from: current, to };
  };

  useFrame((_, delta) => {
    if (!tweenRef.current.active) return;
    const { from, to } = tweenRef.current;
    const u = Math.min(1, tweenRef.current.t + delta * 3);
    tweenRef.current.t = u;
    const s = smoothstep(u);
    const x = from[0] + (to[0] - from[0]) * s;
    const y = from[1] + (to[1] - from[1]) * s;
    const z = from[2] + (to[2] - from[2]) * s;
    orbitRef.current.target.set(x, y, z);
    orbitRef.current.update();
    if (u >= 1) tweenRef.current.active = false;
  });

  const handleSelect = (id: number) => {
    onSelectMachine(id);
    const p = machinePositions.get(id) ?? [0, 0.5, 0];
    startFocusTween(p);
  };

  // Interpolate trail positions deterministically (no drift)
  const renderTrails = () =>
    animatedSpheres.map((t) => {
      const u = Math.min(1, Math.max(0, (nowMs() - t.startMs) / t.durMs));
      const s = smoothstep(u);
      const x = t.from[0] + (t.to[0] - t.from[0]) * s;
      const y = t.from[1] + (t.to[1] - t.from[1]) * s;
      const z = t.from[2] + (t.to[2] - t.from[2]) * s;
      return <ItemSphere key={t.key} position={[x, y, z]} lane={t.lane} />;
    });

  return (
    <>
      <ambientLight />
      <directionalLight position={[6, 10, 6]} intensity={1} />
      <gridHelper args={[46, 46]} />
      <OrbitControls ref={orbitRef as any} />

      {snapshot?.machines.map((m) => {
        const p = machinePositions.get(m.id) ?? [-8, 0.5, 0];
        // Yellow if queued OR blocked; Green if actively processing; Blue otherwise
        const color =
          (m.blocked || m.status === "queued") ? "#fbbf24" :
          m.status === "processing" ? "#34d399" :
          "#60a5fa";
        return (
          <MachineBox
            key={m.id}
            label={`${m.name} (L${m.lane})`}
            position={p}
            color={color}
            onClick={() => handleSelect(m.id)}
          />
        );
      })}

      {renderTrails()}
    </>
  );
}

export default function Factory({
  snapshot,
  focusedMachineId,
  onSelectMachine,
}: {
  snapshot: StateSnapshot | null;
  focusedMachineId: number | null;
  onSelectMachine: (id: number | null) => void;
}) {
  return (
    <Canvas camera={{ position: [12, 6.5, 14], fov: 50 }}>
      <SceneContent snapshot={snapshot} onSelectMachine={onSelectMachine} />
    </Canvas>
  );
}