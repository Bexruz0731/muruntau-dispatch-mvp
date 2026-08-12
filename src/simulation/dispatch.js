import { LOAD_POINTS } from './constants';

// Очередь >= этого числа считается перегруженной ("занято") — ТЗ, раздел 4.
export const OVERLOAD_THRESHOLD = 2;

function distance([x1, z1], [x2, z2]) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Обычный код, без LLM (ТЗ, раздел 4): для машины, готовой ехать от `fromXZ`,
// выбирает точку погрузки — ближайшую среди незагруженных
// (очередь < OVERLOAD_THRESHOLD); если все перегружены — с минимальной
// очередью (при равенстве — ближайшую из них). Возвращает решение и
// человекочитаемую причину для ленты событий.
export function chooseLoadPoint(fromXZ, queueCounts) {
  const candidates = LOAD_POINTS.map((lp) => ({
    lp,
    distance: distance(fromXZ, lp.position),
    queue: queueCounts[lp.id] || 0,
  }));

  const free = candidates.filter((c) => c.queue < OVERLOAD_THRESHOLD);
  const pool = free.length > 0 ? free : candidates;
  const compare = free.length > 0
    ? (a, b) => a.distance - b.distance
    : (a, b) => (a.queue - b.queue) || (a.distance - b.distance);
  const best = [...pool].sort(compare)[0];

  const reason = free.length > 0
    ? `${best.lp.name} — ближайшая свободная точка (${Math.round(best.distance)} м, очередь ${best.queue})`
    : `все точки перегружены (очередь ≥ ${OVERLOAD_THRESHOLD}), выбрана ${best.lp.name} с минимальной очередью (${best.queue})`;

  return { targetLoadPointId: best.lp.id, reason };
}

// Цвет индикатора загрузки точки: зелёный — свободна, жёлтый — на грани
// (очередь == OVERLOAD_THRESHOLD), красный — перегружена.
export function statusColorForQueue(queue) {
  if (queue >= OVERLOAD_THRESHOLD + 1) return '#ef4444';
  if (queue >= OVERLOAD_THRESHOLD) return '#eab308';
  return '#22c55e';
}

// Промпт для сценария "Объяснить решение" (ТЗ, "Интеграция AnythingLLM",
// сценарий 1) — строится из уже накопленных полей события ленты диспетчера,
// включая человекочитаемую причину (reason), которую уже сформировал
// chooseLoadPoint/сценарий с затором.
export function buildDispatchExplainPrompt(event, loadPoints) {
  const point = loadPoints.find((lp) => lp.id === event.toLoadPointId);
  const pointName = point ? point.name : event.toLoadPointId;
  return `Объясни диспетчерское решение простым языком для диспетчера карьера: машина №${event.truckNumber} выехала из точки «${event.fromLabel}» и направлена в точку «${pointName}». Причина решения алгоритма: ${event.reason}.`;
}
