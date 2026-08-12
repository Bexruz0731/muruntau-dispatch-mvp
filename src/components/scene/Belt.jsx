import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { groundPosition, BELT_POINT } from '../../simulation/constants';
import { statusColorForQueue } from '../../simulation/dispatch';

const HOPPER_COLOR = '#3a4356';
const RAMP_COLOR = '#232a38';
const GLOW_COLOR = '#8fc3ff';
const RAMP_LENGTH = 7;
const STRIPE_COUNT = 5;

// Бункер + наклонный конвейерный жёлоб снаружи карьера (BELT_POINT — за
// пределами PIT_TOP_RADIUS). Полоски на жёлобе непрерывно "едут" вдоль
// него через useFrame (не привязано к конкретной машине) — постоянная
// фоновая анимация, которая читается как "лента работает".
export default function Belt({ queueCount = 0 }) {
  const stripeRefs = useRef([]);
  const [x, y, z] = groundPosition(BELT_POINT.position);
  // Бункер (местный -X) смотрит на центр карьера — тот же способ вывода
  // угла, что и в Truck.jsx (доворот носом по курсу), только курс здесь —
  // направление от ленты к центру карьера (-x, -z).
  const rotationY = Math.atan2(-z, x);
  const ringColor = statusColorForQueue(queueCount);

  useFrame(() => {
    const t = performance.now() * 0.00015;
    stripeRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const localT = (t + i / STRIPE_COUNT) % 1;
      mesh.position.x = (localT - 0.5) * RAMP_LENGTH;
    });
  });

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* бункер — приёмный короб у начала ленты */}
      <mesh position={[-2.4, 1.3, 0]}>
        <boxGeometry args={[2.6, 2.6, 3]} />
        <meshStandardMaterial color={HOPPER_COLOR} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* светящаяся кромка сверху бункера — очередь у ленты */}
      <mesh position={[-2.4, 2.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.6, 24]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* наклонный жёлоб конвейера + бегущие полоски внутри одной группы,
          чтобы полоски автоматически следовали наклону жёлоба */}
      <group position={[1.8, 2.1, 0]} rotation={[0, 0, -0.35]}>
        <mesh>
          <boxGeometry args={[RAMP_LENGTH, 0.4, 1.6]} />
          <meshStandardMaterial color={RAMP_COLOR} roughness={0.6} metalness={0.4} />
        </mesh>
        {Array.from({ length: STRIPE_COUNT }).map((_, i) => (
          <mesh key={i} ref={(el) => { stripeRefs.current[i] = el; }} position={[0, 0.25, 0]}>
            <boxGeometry args={[0.3, 0.08, 1.4]} />
            <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* опоры */}
      {[-1, 1, 3].map((sx) => (
        <mesh key={sx} position={[sx, 1.1, 0.6]}>
          <boxGeometry args={[0.18, 2.2, 0.18]} />
          <meshStandardMaterial color={RAMP_COLOR} roughness={0.7} metalness={0.3} />
        </mesh>
      ))}

      <Html position={[-2.4, 3.4, 0]} center>
        <div className="px-2 py-0.5 rounded bg-black/70 text-white text-xs whitespace-nowrap">
          Лента ({queueCount})
        </div>
      </Html>
    </group>
  );
}
