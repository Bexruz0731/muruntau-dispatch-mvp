import * as THREE from 'three';
import {
  PIT_RINGS,
  PIT_TOP_RADIUS,
  PIT_BOTTOM_RADIUS,
  PIT_DEPTH,
} from '../../simulation/constants';

const RING_SEGMENTS = 64;

function ringRadius(i) {
  const t = i / PIT_RINGS;
  return PIT_TOP_RADIUS - t * (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS);
}

function benchColor(i) {
  const t = i / PIT_RINGS;
  const light = { r: 0xc9, g: 0x9b, b: 0x5a };
  const dark = { r: 0x6b, g: 0x4a, b: 0x2c };
  const r = Math.round(light.r + (dark.r - light.r) * t);
  const g = Math.round(light.g + (dark.g - light.g) * t);
  const b = Math.round(light.b + (dark.b - light.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function PitTerrain() {
  const benches = [];
  const risers = [];

  for (let i = 0; i <= PIT_RINGS; i++) {
    const outer = i === 0 ? PIT_TOP_RADIUS + 6 : ringRadius(i - 1);
    const inner = ringRadius(i);
    const y = -(i / PIT_RINGS) * PIT_DEPTH;

    benches.push(
      <mesh key={`bench-${i}`} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[inner, outer, RING_SEGMENTS]} />
        <meshStandardMaterial color={benchColor(i)} roughness={0.95} metalness={0} />
      </mesh>,
    );

    if (i < PIT_RINGS) {
      const topY = y;
      const bottomY = -((i + 1) / PIT_RINGS) * PIT_DEPTH;
      const topRadius = ringRadius(i);
      const bottomRadius = ringRadius(i + 1);
      const riserHeight = topY - bottomY;

      risers.push(
        <mesh key={`riser-${i}`} position={[0, bottomY + riserHeight / 2, 0]} receiveShadow>
          <cylinderGeometry args={[topRadius, bottomRadius, riserHeight, RING_SEGMENTS, 1, true]} />
          <meshStandardMaterial color={benchColor(i + 0.5)} roughness={1} side={THREE.DoubleSide} />
        </mesh>,
      );
    }
  }

  benches.push(
    <mesh key="pit-floor" position={[0, -PIT_DEPTH, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[PIT_BOTTOM_RADIUS, RING_SEGMENTS]} />
      <meshStandardMaterial color={benchColor(PIT_RINGS)} roughness={0.95} />
    </mesh>,
  );

  return (
    <group>
      {benches}
      {risers}
    </group>
  );
}
