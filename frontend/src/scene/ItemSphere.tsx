export default function ItemSphere({
  position,
  lane = 0,
}: { position: [number, number, number], lane?: number }) {
  // simple palette per lane
  const colors = ["#111827", "#1f2937", "#374151", "#4b5563", "#6b7280"]; // dark grays
  const c = colors[Math.abs(lane) % colors.length];

  return (
    <mesh position={position}>
      <sphereGeometry args={[0.2, 16, 16]} />
      <meshStandardMaterial color={c} />
    </mesh>
  );
}
