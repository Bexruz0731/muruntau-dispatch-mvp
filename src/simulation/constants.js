// Фиксированные точки въезда/выезда и точки погрузки на карьере.
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
// используются только для статичного размещения объектов на сцене.

export const ENTRY_POINT = { id: 'entry', name: 'Въезд', position: [0, 26] };
export const EXIT_POINT = { id: 'exit', name: 'Выезд', position: [3, 26] };

// Точки погрузки на разных уступах (level 1-5), угол — просто для
// равномерного визуального разброса по кругу (секторной привязки для
// маркеров не требуется — в отличие от прежней версии, уступы здесь не
// прорезаются пандусами, так что любая точка на уступе одинаково "ровная").
export const LOAD_POINTS = [
  { id: 'lp-a', name: 'Точка A', position: [23.5, 0], color: '#f97316' },
  { id: 'lp-b', name: 'Точка B', position: [9.6, 16.6], color: '#38bdf8' },
  { id: 'lp-c', name: 'Точка C', position: [-7.4, 12.8], color: '#a78bfa' },
  { id: 'lp-d', name: 'Точка D', position: [-10.5, 0], color: '#f472b6' },
  { id: 'lp-e', name: 'Точка E', position: [-9.6, -16.6], color: '#4ade80' },
  { id: 'lp-f', name: 'Точка F', position: [7.4, -12.8], color: '#facc15' },
];

// Геометрия ступенчатой воронки карьера.
export const PIT_RINGS = 6; // число уступов (по радиусу/высоте)
export const PIT_TOP_RADIUS = 30; // радиус верхнего края
export const PIT_BOTTOM_RADIUS = 4; // радиус дна
export const PIT_DEPTH = 18; // общая глубина воронки

export const BENCH_WIDTH = (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS) / PIT_RINGS;
export const LEVEL_DROP = PIT_DEPTH / PIT_RINGS;

// Каждый уступ разбит по кругу на SECTORS отдельных "кирпичей" с зазором
// между ними — это и даёт чёткую раздельность (не сливаются в одно пятно),
// без риска несостыковки геометрии, которым страдал прежний вариант с
// прорезанными в стене пандусами.
export const SECTORS = 10;
export const SECTOR_ANGLE = (Math.PI * 2) / SECTORS;
export const SECTOR_GAP = 0.055; // рад, зазор между соседними секторами

export function levelOuterRadius(level) {
  return PIT_TOP_RADIUS - level * BENCH_WIDTH;
}

export function levelBenchY(level) {
  return -level * LEVEL_DROP;
}

export function sectorStartAngle(sector) {
  return sector * SECTOR_ANGLE;
}

// Высота (y <= 0) рельефа на заданном расстоянии от центра. Уступы —
// дискретные ровные площадки; секторные зазоры визуальные (см. PitTerrain),
// на высоту не влияют, поэтому этой функции угол не нужен.
export function terrainHeightAt(radius) {
  if (radius >= PIT_TOP_RADIUS) return 0; // земля вокруг карьера
  if (radius <= PIT_BOTTOM_RADIUS) return levelBenchY(PIT_RINGS); // дно

  let level = Math.floor((PIT_TOP_RADIUS - radius) / BENCH_WIDTH) + 1;
  level = Math.min(Math.max(level, 1), PIT_RINGS);
  return levelBenchY(level);
}

// Переводит плоскую точку [x, z] в 3D-координату, лежащую на поверхности рельефа.
export function groundPosition([x, z]) {
  const radius = Math.hypot(x, z);
  return [x, terrainHeightAt(radius), z];
}
