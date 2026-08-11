import { useMemo } from 'react';
import * as THREE from 'three';

// Тонкая светящаяся труба вдоль пути машины — визуальная "дорога" под
// колёсами, без которой движение выглядит как скольжение по воздуху.
// Не часть рельефа (см. design spec "Дороги") — отдельный полупрозрачный
// слой поверх сцены, построенный по тем же точкам, что и сама интерполяция
// движения (src/simulation/store.js -> pathTo -> buildRoutePoints).
export default function RouteTube({ path, color = '#8fc3ff' }) {
  const geometry = useMemo(() => {
    const points = path.map(([x, y, z]) => new THREE.Vector3(x, y - 0.3, z));
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, Math.max(8, path.length * 4), 0.22, 6, false);
  }, [path]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}
