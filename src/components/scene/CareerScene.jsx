import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

// No shadow mapping anywhere in this scene — depth reads from colour
// gradients and glowing crest/toe lines on the terrain instead (see
// PitTerrain). Shadows on the near-vertical bench walls were a repeated
// source of acne/artifacts; dropping them entirely removes that whole
// class of bugs rather than tuning around it.
export default function CareerScene({ children }) {
  return (
    <Canvas camera={{ position: [0, 32, 42], fov: 45 }} className="w-full h-full" gl={{ antialias: true }}>
      <color attach="background" args={['#050912']} />
      <fogExp2 attach="fog" args={['#050912', 0.012]} />
      <ambientLight intensity={0.35} color="#8fb0dc" />
      <hemisphereLight args={['#5e86c4', '#060b16', 0.55]} />
      <directionalLight position={[25, 40, 15]} intensity={1.3} color="#eaf2ff" />
      <directionalLight position={[-20, 20, -15]} intensity={0.4} color="#e8b44c" />
      <pointLight position={[0, -10, 0]} intensity={400} distance={60} color="#3d7eff" />
      {children}
      <OrbitControls
        target={[0, -8, 0]}
        minDistance={20}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2.3}
      />
    </Canvas>
  );
}
