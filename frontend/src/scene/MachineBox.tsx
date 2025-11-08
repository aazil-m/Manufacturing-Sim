import { Billboard, Text } from "@react-three/drei";

export default function MachineBox({
  position, label, color = "#60a5fa", onClick
}: {
  position: [number, number, number],
  label: string,
  color?: string,
  onClick?: () => void
}) {
  return (
    <group position={position} onClick={onClick}>
      <mesh>
        <boxGeometry args={[2, 1, 2]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Clickable label */}
      <Billboard position={[0, 1.1, 0]}>
        <Text
          fontSize={0.55}
          color="#111"
          outlineWidth={0.02}
          outlineColor="#fff"
          anchorX="center"
          anchorY="bottom"
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}
