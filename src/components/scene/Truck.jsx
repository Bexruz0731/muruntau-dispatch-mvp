import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { pathDirectionAt } from '../../simulation/constants';

const CHASSIS_COLOR = '#3a4356';
const CAB_COLOR = '#232a38';
const BODY_COLOR = '#e8b44c';
const WHEEL_COLOR = '#12151c';
const ACCENT_COLOR = '#8fc3ff';

const WHEEL_POSITIONS = [
  [-1.4, -0.4, 0.9],
  [-1.4, -0.4, -0.9],
  [0.2, -0.4, 0.9],
  [0.2, -0.4, -0.9],
  [1.1, -0.4, 0.9],
  [1.1, -0.4, -0.9],
];

// Позиция машины в момент `now`: во время LOADING/ENTERING/DONE —
// фиксированная точка (truck.position), иначе — линейная интерполяция
// вдоль truck.path пропорционально доле пройденного времени текущей фазы.
function interpolatedPosition(truck, now) {
  if (truck.phase === 'LOADING' || truck.phase === 'ENTERING' || truck.phase === 'DONE') {
    return truck.position;
  }
  const t = Math.min(1, Math.max(0, (now - truck.phaseStartedAt) / truck.phaseDurationMs));
  const path = truck.path;
  const segCount = path.length - 1;
  const segT = t * segCount;
  const segIndex = Math.min(segCount - 1, Math.floor(segT));
  const localT = segT - segIndex;
  const a = path[segIndex];
  const b = path[segIndex + 1];
  return [
    a[0] + (b[0] - a[0]) * localT,
    a[1] + (b[1] - a[1]) * localT,
    a[2] + (b[2] - a[2]) * localT,
  ];
}

export default function Truck({ truck }) {
  const groupRef = useRef();
  const progressRef = useRef();
  const bodyMatRef = useRef();

  useFrame(() => {
    const now = performance.now();
    const [x, y, z] = interpolatedPosition(truck, now);
    if (groupRef.current) groupRef.current.position.set(x, y, z);

    if ((truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') && groupRef.current) {
      const t = Math.min(1, Math.max(0, (now - truck.phaseStartedAt) / truck.phaseDurationMs));
      const dir = pathDirectionAt(truck.path, t);
      if (dir) {
        const [dx, dz] = dir;
        // Кабина смотрит вдоль локальной -X (см. геометрию ниже: кабина на
        // x=-1.5, кузов на x=+0.6) — доворачиваем группу вокруг Y так, чтобы
        // локальная -X совпала с мировым направлением движения (dx, dz).
        // Проверено численно (localToWorld кабины/кузова против точки впереди
        // по курсу) — кабина ближе к направлению движения, кузов сзади.
        groupRef.current.rotation.y = Math.atan2(dz, -dx);
      }
    }

    const loading = truck.phase === 'LOADING';
    if (progressRef.current) {
      const progress = loading
        ? Math.min(1, (now - truck.phaseStartedAt) / truck.phaseDurationMs)
        : 0;
      progressRef.current.visible = loading;
      progressRef.current.scale.x = Math.max(0.001, progress);
    }
    if (bodyMatRef.current) {
      bodyMatRef.current.emissiveIntensity = loading ? 0.4 + Math.sin(now * 0.006) * 0.3 : 0;
    }
  });

  return (
    <group ref={groupRef}>
      {/* мягкое пятно контакта с землёй — сцена без теней, это замена */}
      <mesh position={[0, -0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 24]} />
        <meshBasicMaterial color="#000814" transparent opacity={0.45} depthWrite={false} />
      </mesh>

      <mesh>
        <boxGeometry args={[2.6, 0.6, 1.6]} />
        <meshStandardMaterial color={CHASSIS_COLOR} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[-1.5, 0.55, 0]}>
        <boxGeometry args={[0.9, 1.1, 1.5]} />
        <meshStandardMaterial color={CAB_COLOR} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[-1.96, 0.3, 0]}>
        <boxGeometry args={[0.06, 0.15, 1.2]} />
        <meshBasicMaterial color={ACCENT_COLOR} transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* кузов-самосвал — жёлтая пульсация emissive во время погрузки */}
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]}>
        <boxGeometry args={[1.6, 0.9, 1.7]} />
        <meshStandardMaterial
          ref={bodyMatRef}
          color={BODY_COLOR}
          emissive={BODY_COLOR}
          emissiveIntensity={0}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>
      {WHEEL_POSITIONS.map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.35, 16]} />
          <meshStandardMaterial color={WHEEL_COLOR} roughness={0.9} />
        </mesh>
      ))}

      {/* полоска прогресса погрузки — видна и растёт только в фазе LOADING */}
      <mesh position={[0.6, 1.35, 0]} ref={progressRef} scale={[0.001, 1, 1]} visible={false}>
        <boxGeometry args={[1.6, 0.12, 0.12]} />
        <meshBasicMaterial color="#8fc3ff" transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>

      <Html position={[0.6, 1.6, 0]} center>
        <div className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold whitespace-nowrap">
          №{truck.number}
        </div>
      </Html>
    </group>
  );
}
