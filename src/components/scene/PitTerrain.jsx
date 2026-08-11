import * as THREE from 'three';
import { useMemo } from 'react';
import {
  PIT_RINGS,
  PIT_TOP_RADIUS,
  PIT_BOTTOM_RADIUS,
  LEVEL_DROP,
  SECTORS,
  SECTOR_ANGLE,
  SECTOR_GAP,
  levelOuterRadius,
  levelBenchY,
  sectorStartAngle,
} from '../../simulation/constants';

// Each bench is drawn as its own annular-SECTOR wedge (not a full ring) with
// a small gap to its neighbours — that reads as distinct terraced steps even
// at a glance, instead of blending into one gradient. No shadow mapping
// anywhere in this scene: depth is carried by colour + a glowing crest/toe
// line per bench, which sidesteps shadow-acne entirely rather than fighting it.
const FLOOR_TOP = new THREE.Color('#c9d8ec');
const FLOOR_DEEP = new THREE.Color('#3c5578');
const WALL_TOP = new THREE.Color('#7fa0c9');
const WALL_DEEP = new THREE.Color('#243654');
const CREST_COLOR = new THREE.Color('#8fc3ff');

function Bench({ level, sector }) {
  const outer = levelOuterRadius(level - 1);
  const inner = levelOuterRadius(level);
  const y = levelBenchY(level);
  const t0 = sectorStartAngle(sector) + SECTOR_GAP / 2;
  const tLen = SECTOR_ANGLE - SECTOR_GAP;
  const segments = Math.max(6, Math.round(tLen * 18));
  const depth01 = (level - 1) / (PIT_RINGS - 1 || 1);

  const floorGeo = useMemo(
    () => new THREE.RingGeometry(inner, outer, segments, 1, t0, tLen),
    [inner, outer, segments, t0, tLen],
  );
  const wallGeo = useMemo(
    () => new THREE.CylinderGeometry(outer, outer * 0.985, LEVEL_DROP, segments, 1, true, t0, tLen),
    [outer, segments, t0, tLen],
  );
  const crestGeo = useMemo(
    () => new THREE.RingGeometry(outer * 0.988, outer, segments, 1, t0, tLen),
    [outer, segments, t0, tLen],
  );
  const toeGeo = useMemo(
    () => new THREE.RingGeometry(inner, inner * 1.012, segments, 1, t0, tLen),
    [inner, segments, t0, tLen],
  );

  const floorColor = useMemo(() => FLOOR_TOP.clone().lerp(FLOOR_DEEP, depth01), [depth01]);
  const wallColor = useMemo(() => WALL_TOP.clone().lerp(WALL_DEEP, depth01), [depth01]);

  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={floorGeo} attach="geometry" />
        <meshStandardMaterial color={floorColor} roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, y + LEVEL_DROP / 2, 0]}>
        <primitive object={wallGeo} attach="geometry" />
        <meshStandardMaterial color={wallColor} roughness={0.92} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, y + LEVEL_DROP - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={crestGeo} attach="geometry" />
        <meshBasicMaterial
          color={CREST_COLOR}
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={toeGeo} attach="geometry" />
        <meshBasicMaterial
          color={CREST_COLOR}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default function PitTerrain() {
  const benches = [];
  for (let level = 1; level <= PIT_RINGS; level++) {
    for (let sector = 0; sector < SECTORS; sector++) {
      benches.push(<Bench key={`bench-${level}-${sector}`} level={level} sector={sector} />);
    }
  }

  return (
    <group>
      {/* ground collar just outside the rim */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIT_TOP_RADIUS, PIT_TOP_RADIUS + 3, 96]} />
        <meshStandardMaterial color={FLOOR_TOP} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {benches}
      {/* pit floor */}
      <mesh position={[0, levelBenchY(PIT_RINGS), 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[PIT_BOTTOM_RADIUS, 64]} />
        <meshStandardMaterial color={FLOOR_DEEP} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
