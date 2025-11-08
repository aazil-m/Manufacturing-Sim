import { Billboard, Text } from "@react-three/drei";

export default function MachineBox({
  position, label, color = "#60a5fa", onClick, eta
}: {
  position: [number, number, number],
  label: string,
  color?: string,
  onClick?: () => void,
  eta?: number | null
}) {
  return (
    <group position={position} onClick={onClick}>
      <mesh>
        <boxGeometry args={[2, 1, 2]} />
        <meshStandardMaterial color={color} />
      </mesh>

      <Billboard position={[0, 1.1, 0]}>
        <Text fontSize={0.55} color="#111" outlineWidth={0.02} outlineColor="#fff" anchorX="center" anchorY="bottom">
          {label}
        </Text>
      </Billboard>
      {typeof eta === "number" && (
        <Billboard position={[0, 0.1, 1.2]}>
          <Text fontSize={0.28} color="#111" outlineWidth={0.01} outlineColor="#fff" anchorX="center" anchorY="middle">
            ETA: {eta.toFixed(1)}s
          </Text>
        </Billboard>
      )}
    </group>
  );
}
