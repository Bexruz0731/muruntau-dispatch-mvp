// Фиксированные точки въезда/выезда и точки погрузки на карьере.
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
// используются только для статичного размещения объектов на сцене.

export const ENTRY_POINT = { id: 'entry', name: 'Въезд', position: [0, 26] };
export const EXIT_POINT = { id: 'exit', name: 'Выезд', position: [3, 26] };

// Точки погрузки расставлены на РАЗНЫХ уступах (level 1-4) под углом,
// заведомо избегающим пандуса именно ЭТОГО уступа (см. rampFractionAt) —
// иначе маркер норовит встать на наклонный въезд, а не на ровную площадку.
export const LOAD_POINTS = [
  { id: 'lp-a', name: 'Точка A', position: [23.5, 0], color: '#f97316' },
  { id: 'lp-b', name: 'Точка B', position: [9.6, 16.6], color: '#38bdf8' },
  { id: 'lp-c', name: 'Точка C', position: [-7.4, 12.8], color: '#a78bfa' },
  { id: 'lp-d', name: 'Точка D', position: [-10.5, 0], color: '#f472b6' },
  { id: 'lp-e', name: 'Точка E', position: [-9.6, -16.6], color: '#4ade80' },
  { id: 'lp-f', name: 'Точка F', position: [7.4, -12.8], color: '#facc15' },
];

// Геометрия ступенчатой воронки карьера.
export const PIT_RINGS = 6; // число уступов
export const PIT_TOP_RADIUS = 30; // радиус верхнего края
export const PIT_BOTTOM_RADIUS = 4; // радиус дна
export const PIT_DEPTH = 18; // общая глубина воронки

export const BENCH_WIDTH = (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS) / PIT_RINGS;
export const LEVEL_DROP = PIT_DEPTH / PIT_RINGS;

// Спиральный пандус-серпантин: на уступе `level` узкая угловая дуга шириной
// RAMP_ANGULAR_WIDTH, начинающаяся с rampStartAngle(level), заменяет
// вертикальную стенку плавным спуском. Шаг поворота равен самой ширине дуги,
// поэтому пандус уступа level+1 начинается ровно там, где заканчивается
// пандус уступа level — визуально они читаются как один непрерывный виток,
// а не разрозненные заплатки. Эти функции — общий источник правды и для
// 3D-геометрии (PitTerrain), и для расстановки объектов на поверхности
// (groundPosition ниже), и в будущем — для маршрута движения машин.
export const RAMP_ANGULAR_WIDTH = ((Math.PI * 2) / PIT_RINGS) * 0.85;
export const RAMP_ANGLE_STEP = RAMP_ANGULAR_WIDTH;

export function levelOuterRadius(level) {
  return PIT_TOP_RADIUS - level * BENCH_WIDTH;
}

export function levelBenchY(level) {
  return -level * LEVEL_DROP;
}

export function rampStartAngle(level) {
  return level * RAMP_ANGLE_STEP;
}

// Доля (0..1) прохождения пандуса уступа `level` на угле theta, или null,
// если theta вне дуги этого пандуса (обычная ровная площадка).
export function rampFractionAt(level, theta) {
  const start = rampStartAngle(level);
  const twoPi = Math.PI * 2;
  let rel = (theta - start) % twoPi;
  if (rel < 0) rel += twoPi;
  if (rel <= RAMP_ANGULAR_WIDTH) return rel / RAMP_ANGULAR_WIDTH;
  return null;
}

// Высота (y <= 0) рельефа в точке (радиус, угол): плоская площадка на своём
// уступе почти везде, и плавный спуск вдоль дуги пандуса.
export function terrainHeightAt(radius, theta = 0) {
  if (radius >= PIT_TOP_RADIUS) return 0; // земля вокруг карьера
  if (radius <= PIT_BOTTOM_RADIUS) return levelBenchY(PIT_RINGS); // дно

  let level = Math.floor((PIT_TOP_RADIUS - radius) / BENCH_WIDTH);
  level = Math.min(Math.max(level, 0), PIT_RINGS - 1);

  const f = rampFractionAt(level, theta);
  if (f === null) return levelBenchY(level);
  return levelBenchY(level) + (levelBenchY(level + 1) - levelBenchY(level)) * f;
}

// Переводит плоскую точку [x, z] в 3D-координату, лежащую на поверхности рельефа.
export function groundPosition([x, z]) {
  const radius = Math.hypot(x, z);
  const twoPi = Math.PI * 2;
  const theta = ((Math.atan2(z, x) % twoPi) + twoPi) % twoPi;
  return [x, terrainHeightAt(radius, theta), z];
}
