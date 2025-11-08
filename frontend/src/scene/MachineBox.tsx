import { Text } from "@react-three/drei";

export default function MachineBox({
  position, label, color = "#60a5fa"
}: { position: [number, number, number], label: string, color?: string }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[2, 1, 2]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Text position={[0, 0.9, 0]} fontSize={0.35} anchorX="center" anchorY="bottom">
        {label}
      </Text>
    </group>
  );
}
