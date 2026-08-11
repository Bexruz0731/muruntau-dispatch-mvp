import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { groundPosition } from '../../simulation/constants';

const POLE_HEIGHT = 4.2;
const CAP_SIZE = 0.55;

export default function LoadPointMarker({ name, position, color, queueCount = 0 }) {
  const [x, y, z] = groundPosition(position);

  return (
    <group position={[x, y, z]}>
      {/* landing pad ring, flat on the ground, glowing against the dark terrain */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.8, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* thin pole */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, POLE_HEIGHT, 8]} />
        <meshStandardMaterial color="#8fa3c0" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* vertical beacon beam */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.16, 0.16, POLE_HEIGHT, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* beacon cap */}
      <mesh position={[0, POLE_HEIGHT, 0]}>
        <octahedronGeometry args={[CAP_SIZE, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} roughness={0.3} />
      </mesh>

      <Html position={[0, POLE_HEIGHT + CAP_SIZE + 0.6, 0]} center>
        <div className="px-2 py-0.5 rounded bg-black/70 text-white text-xs whitespace-nowrap">
          {name} ({queueCount})
        </div>
      </Html>
    </group>
  );
}
