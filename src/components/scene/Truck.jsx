import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { groundPosition } from '../../simulation/constants';

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

export default function Truck({ number, position }) {
  const [x, y, z] = groundPosition(position);

  return (
    <group position={[x, y + 0.9, z]}>
      {/* soft ground-contact glow — stands in for a dropped shadow, since this scene has none */}
      <mesh position={[0, -0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 24]} />
        <meshBasicMaterial color="#000814" transparent opacity={0.45} depthWrite={false} />
      </mesh>

      {/* chassis */}
      <mesh castShadow={false}>
        <boxGeometry args={[2.6, 0.6, 1.6]} />
        <meshStandardMaterial color={CHASSIS_COLOR} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* cab */}
      <mesh position={[-1.5, 0.55, 0]}>
        <boxGeometry args={[0.9, 1.1, 1.5]} />
        <meshStandardMaterial color={CAB_COLOR} roughness={0.5} metalness={0.4} />
      </mesh>
      {/* headlight accent */}
      <mesh position={[-1.96, 0.3, 0]}>
        <boxGeometry args={[0.06, 0.15, 1.2]} />
        <meshBasicMaterial color={ACCENT_COLOR} transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* dump body */}
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]}>
        <boxGeometry args={[1.6, 0.9, 1.7]} />
        <meshStandardMaterial color={BODY_COLOR} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* wheels */}
      {WHEEL_POSITIONS.map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.35, 16]} />
          <meshStandardMaterial color={WHEEL_COLOR} roughness={0.9} />
        </mesh>
      ))}

      <Html position={[0.6, 1.6, 0]} center>
        <div className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold whitespace-nowrap">
          №{number}
        </div>
      </Html>
    </group>
  );
}
