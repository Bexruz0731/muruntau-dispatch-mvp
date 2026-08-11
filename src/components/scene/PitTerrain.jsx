import * as THREE from 'three';
import { PIT_RINGS, PIT_TOP_RADIUS, PIT_BOTTOM_RADIUS, PIT_DEPTH } from '../../simulation/constants';

const RADIAL_SEGMENTS = 96;
const RAMP_SEGMENTS = 24;
// Each level's ramp cut is rotated relative to the previous one, so
// descending ramp -> shelf -> next ramp traces one continuous spiral —
// this is also the truck path a later phase will reuse.
const RAMP_ANGULAR_WIDTH = (Math.PI * 2) / PIT_RINGS - 0.35;
const RAMP_ANGLE_STEP = (Math.PI * 2) / PIT_RINGS + 1.35;

function ringRadius(level) {
  return PIT_TOP_RADIUS - level * ((PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS) / PIT_RINGS);
}

function levelY(level) {
  return -level * (PIT_DEPTH / PIT_RINGS);
}

export function rampStartAngle(level) {
  return level * RAMP_ANGLE_STEP;
}

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

  // flat bench platforms — plain rings, real height (y) per level
  for (let level = 0; level <= PIT_RINGS; level++) {
    const outer = level === 0 ? PIT_TOP_RADIUS + 3 : ringRadius(level - 1);
    const inner = ringRadius(level);
    const y = levelY(level);
    treads.push(
      <mesh key={`tread-${level}`} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[inner, outer, RADIAL_SEGMENTS]} />
        <meshStandardMaterial color={benchColor(level)} roughness={0.92} />
      </mesh>,
    );
  }
  treads.push(
    <mesh key="floor" position={[0, levelY(PIT_RINGS), 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[PIT_BOTTOM_RADIUS, RADIAL_SEGMENTS]} />
      <meshStandardMaterial color={benchColor(PIT_RINGS)} roughness={0.92} />
    </mesh>,
  );

  // vertical walls between levels, with one narrow arc cut out per level
  // for the ramp — both built from stock CylinderGeometry (thetaStart /
  // thetaLength are its own well-tested params, no hand-rolled math).
  for (let level = 0; level < PIT_RINGS; level++) {
    const topR = ringRadius(level);
    const bottomR = ringRadius(level + 1);
    const topY = levelY(level);
    const bottomY = levelY(level + 1);
    const height = topY - bottomY;
    const rStart = rampStartAngle(level);
    const rEnd = rStart + RAMP_ANGULAR_WIDTH;

    // Vertical: constant radius = topR. This has to equal BOTH tread(level)'s
    // inner edge AND tread(level+1)'s outer edge for a seamless connection —
    // ringRadius(level) is exactly that shared radius (bottomR would leave a
    // gap the width of a whole bench, which is the bug that was here before).
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
