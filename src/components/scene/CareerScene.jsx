import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky } from '@react-three/drei';

export default function CareerScene({ children }) {
  return (
    <Canvas shadows camera={{ position: [0, 32, 42], fov: 45 }} className="w-full h-full">
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
        shadow-bias={-0.0015}
        shadow-normalBias={0.4}
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
      <OrbitControls
        target={[0, -8, 0]}
        minDistance={20}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2.3}
      />
    </Canvas>
  );
}
