export default function ItemSphere({
  position
}: { position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.2, 16, 16]} />
      <meshStandardMaterial />
    </mesh>
  );
}
