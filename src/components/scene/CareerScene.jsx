import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, ContactShadows } from '@react-three/drei';

export default function CareerScene({ children }) {
  return (
    <Canvas shadows camera={{ position: [0, 32, 42], fov: 45 }} className="w-full h-full">
      <fog attach="fog" args={['#dce8f2', 45, 120]} />
      <hemisphereLight args={['#cfe3f2', '#8a6b3e', 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[25, 40, 15]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <Sky
        distance={450}
        sunPosition={[25, 40, 15]}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.01}
        mieDirectionalG={0.85}
      />
      {children}
      <ContactShadows position={[0, -18.2, 0]} opacity={0.5} scale={80} blur={2.5} far={20} />
      <OrbitControls
        target={[0, -8, 0]}
        minDistance={20}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
    </Canvas>
  );
}
