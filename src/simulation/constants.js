// Фиксированные точки въезда/выезда и точки погрузки на карьере.
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
// используются только для статичного размещения объектов на сцене.

export const ENTRY_POINT = { id: 'entry', name: 'Въезд', position: [0, 26] };
export const EXIT_POINT = { id: 'exit', name: 'Выезд', position: [3, 26] };

export const LOAD_POINTS = [
  { id: 'lp-a', name: 'Точка A', position: [6, 3], color: '#f97316' },
  { id: 'lp-b', name: 'Точка B', position: [-10, 6], color: '#38bdf8' },
  { id: 'lp-c', name: 'Точка C', position: [13, -7], color: '#a78bfa' },
  { id: 'lp-d', name: 'Точка D', position: [-16, 5], color: '#f472b6' },
  { id: 'lp-e', name: 'Точка E', position: [4, -20], color: '#4ade80' },
  { id: 'lp-f', name: 'Точка F', position: [-20, -8], color: '#facc15' },
];

// Геометрия ступенчатой воронки карьера.
export const PIT_RINGS = 6; // число уступов
export const PIT_TOP_RADIUS = 30; // радиус верхнего края
export const PIT_BOTTOM_RADIUS = 4; // радиус дна
export const PIT_DEPTH = 18; // общая глубина воронки

// Высота (y <= 0) ступенчатого рельефа на заданном расстоянии от центра.
// Квантуется в PIT_RINGS дискретных уровней, чтобы получились уступы, а не гладкий конус.
export function terrainHeightAt(radius) {
  const clamped = Math.min(Math.max(radius, PIT_BOTTOM_RADIUS), PIT_TOP_RADIUS);
  const t = 1 - (clamped - PIT_BOTTOM_RADIUS) / (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS);
  const step = Math.floor(t * PIT_RINGS) / PIT_RINGS;
  // -step * PIT_DEPTH produces -0 when step is 0; normalize to +0.
  const height = -step * PIT_DEPTH;
  return height === 0 ? 0 : height;
}

// Переводит плоскую точку [x, z] в 3D-координату, лежащую на поверхности рельефа.
export function groundPosition([x, z]) {
  const radius = Math.hypot(x, z);
  return [x, terrainHeightAt(radius), z];
}
