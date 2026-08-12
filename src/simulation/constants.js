// Фиксированные точки въезда/выезда и точки погрузки на карьере.
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
// используются только для статичного размещения объектов на сцене.

export const ENTRY_POINT = { id: 'entry', name: 'Въезд', position: [0, 26] };
// За пределами воронки (радиус > PIT_TOP_RADIUS) — там стоит бункер и
// конвейерная лента (см. components/scene/Belt.jsx), машина едет туда
// после LOADING (EXITING), разгружается (UNLOADING) и возвращается в
// карьер (RETURNING) — бесконечный цикл, без терминального состояния.
export const BELT_POINT = { id: 'belt', name: 'Лента', position: [6, 38] };

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

// Строит плавный путь (массив 3D-точек) от одной плоской точки к другой:
// угол интерполируется по кратчайшей дуге (не через 359° в обратную
// сторону), радиус и высота — линейно по t. Высота НЕ считывается со
// ступенчатой terrainHeightAt на каждом шаге — иначе путь дёргался бы на
// границах уступов; движение машины — отдельный, более плавный слой поверх
// рельефа. Используется для маршрутов машин между фазами (см. simulation/store.js).
export function buildRoutePoints(fromXZ, toXZ, fromY, toY, steps = 8) {
  const [fx, fz] = fromXZ;
  const [tx, tz] = toXZ;
  const rFrom = Math.hypot(fx, fz);
  const rTo = Math.hypot(tx, tz);
  const thFrom = Math.atan2(fz, fx);
  const thToRaw = Math.atan2(tz, tx);
  const twoPi = Math.PI * 2;
  let dTh = thToRaw - thFrom;
  while (dTh > Math.PI) dTh -= twoPi;
  while (dTh < -Math.PI) dTh += twoPi;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = thFrom + dTh * t;
    const r = rFrom + (rTo - rFrom) * t;
    const y = fromY + (toY - fromY) * t;
    points.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return points;
}

// Суммарная длина ломаной по осям x/z (высота игнорируется — это дистанция
// по земле, не по фактической 3D-траектории). Используется для начисления
// пробега/топлива в simulation/fuel.js.
export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [x1, , z1] = path[i - 1];
    const [x2, , z2] = path[i];
    total += Math.hypot(x2 - x1, z2 - z1);
  }
  return total;
}

// Направление движения (ненормализованный вектор [dx, dz] по осям x/z) в
// точке t∈[0,1] пути — используется, чтобы довернуть модель машины носом по
// ходу движения (см. components/scene/Truck.jsx). Высота (y) не участвует —
// поворот модели только вокруг вертикальной оси. Возвращает null, если
// сегмент в этой точке вырожден (нулевой длины) — вызывающий код тогда
// сохраняет прежний курс, а не дёргает модель к (0,0).
export function pathDirectionAt(path, t) {
  const segCount = path.length - 1;
  const clampedT = Math.min(1, Math.max(0, t));
  const segT = clampedT * segCount;
  const segIndex = Math.min(segCount - 1, Math.floor(segT));
  const [ax, , az] = path[segIndex];
  const [bx, , bz] = path[segIndex + 1];
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;
  return [dx, dz];
}
