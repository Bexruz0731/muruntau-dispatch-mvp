import * as THREE from 'three';
import {
  PIT_RINGS,
  PIT_TOP_RADIUS,
  PIT_BOTTOM_RADIUS,
  RAMP_ANGULAR_WIDTH,
  levelOuterRadius,
  levelBenchY,
  rampStartAngle,
} from '../../simulation/constants';

const RADIAL_SEGMENTS = 96;
const RAMP_SEGMENTS = 24;

function benchColor(level) {
  const t = level / PIT_RINGS;
  const light = { r: 0xe8, g: 0xc0, b: 0x7d };
  const dark = { r: 0x3a, g: 0x2a, b: 0x1a };
  const r = Math.round(light.r + (dark.r - light.r) * t);
  const g = Math.round(light.g + (dark.g - light.g) * t);
  const b = Math.round(light.b + (dark.b - light.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function PitTerrain() {
  const treads = [];
  const walls = [];
  const ramps = [];

  // flat bench platforms — plain rings, real height (y) per level, same
  // levelOuterRadius/levelBenchY the markers and (later) trucks snap to.
  for (let level = 0; level <= PIT_RINGS; level++) {
    const outer = level === 0 ? PIT_TOP_RADIUS + 3 : levelOuterRadius(level - 1);
    const inner = levelOuterRadius(level);
    const y = levelBenchY(level);
    treads.push(
      <mesh key={`tread-${level}`} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[inner, outer, RADIAL_SEGMENTS]} />
        <meshStandardMaterial color={benchColor(level)} roughness={0.92} />
      </mesh>,
    );
  }
  treads.push(
    <mesh key="floor" position={[0, levelBenchY(PIT_RINGS), 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[PIT_BOTTOM_RADIUS, RADIAL_SEGMENTS]} />
      <meshStandardMaterial color={benchColor(PIT_RINGS)} roughness={0.92} />
    </mesh>,
  );

  // vertical walls between levels, with one narrow arc cut out per level
  // for the ramp — both built from stock CylinderGeometry (thetaStart /
  // thetaLength are its own well-tested params, no hand-rolled math), and
  // both driven by the exact same rampStartAngle/BENCH_WIDTH the terrain
  // height function (and therefore the markers) already use.
  for (let level = 0; level < PIT_RINGS; level++) {
    const topR = levelOuterRadius(level);
    const bottomR = levelOuterRadius(level + 1);
    const topY = levelBenchY(level);
    const bottomY = levelBenchY(level + 1);
    const height = topY - bottomY;
    const rStart = rampStartAngle(level);
    const rEnd = rStart + RAMP_ANGULAR_WIDTH;

    // Vertical: constant radius = topR, matching both tread(level)'s inner
    // edge and tread(level+1)'s outer edge (levelOuterRadius(level) is the
    // shared boundary — using bottomR here left a bench-width gap before).
    walls.push(
      <mesh key={`wall-${level}`} position={[0, bottomY + height / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry
          args={[topR, topR, height, RADIAL_SEGMENTS, 1, true, rEnd, Math.PI * 2 - RAMP_ANGULAR_WIDTH]}
        />
        <meshStandardMaterial color={benchColor(level + 0.5)} roughness={1} side={THREE.DoubleSide} />
      </mesh>,
    );

    ramps.push(
      <mesh key={`ramp-${level}`} position={[0, bottomY + height / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[topR, bottomR, height, RAMP_SEGMENTS, 1, true, rStart, RAMP_ANGULAR_WIDTH]} />
        <meshStandardMaterial color="#c9b48a" roughness={0.75} side={THREE.DoubleSide} />
      </mesh>,
    );
  }

  return (
    <group>
      {treads}
      {walls}
      {ramps}
    </group>
  );
}
