import { deviationPercent, FUEL_DEVIATION_YELLOW_MAX } from './fuel';

// Вероятность, с которой новая машина при спавне получает засеянную
// аномалию, и множители, которыми эта аномалия меняет её тайминги/расход
// (ТЗ, раздел 6). Обычная логика диспетчеризации не меняется — машина едет
// по тем же правилам, просто с другими числами.
export const ANOMALY_SEED_PROBABILITY = 0.25;
export const IDLE_OVERRUN_MULTIPLIER_RANGE = [3, 5];
export const MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE = [1.3, 1.6];

// Порог детекта простоя: фаза LOADING считается затянувшейся, если реально
// прошедшее в ней время превысило обычную длительность больше чем в 1.5 раза.
export const IDLE_OVERRUN_TIME_MULTIPLIER = 1.5;

function randomInRange([min, max], random) {
  return min + random() * (max - min);
}

// При спавне: ~25% машин получают аномалию, поровну между двумя типами.
export function rollSeededAnomaly(random = Math.random) {
  if (random() >= ANOMALY_SEED_PROBABILITY) return null;
  return random() < 0.5 ? 'IDLE_OVERRUN' : 'MECHANICAL_FAULT';
}

// IDLE_OVERRUN: LOADING-фаза этой машины длится в 3-5 раз дольше обычного —
// перерасход в литрах возникает естественно (машина реально дольше стоит и
// жжёт топливо на холостом ходу), без отдельного расчёта.
export function loadingDurationForSeed(baseDurationMs, seededAnomaly, random = Math.random) {
  if (seededAnomaly !== 'IDLE_OVERRUN') return baseDurationMs;
  return baseDurationMs * randomInRange(IDLE_OVERRUN_MULTIPLIER_RANGE, random);
}

// MECHANICAL_FAULT: персональная фактическая ставка расхода (см.
// simulation/fuel.js — truck.actualBurnRatePerHour) в 1.3-1.6 раза выше
// нормы автопарка; сама норма (truck.fuelBurnRatePerHour) не меняется —
// иначе не с чем было бы сравнивать, и отклонение всегда было бы 0%.
export function actualBurnRateForSeed(normLPerHour, seededAnomaly, random = Math.random) {
  if (seededAnomaly !== 'MECHANICAL_FAULT') return normLPerHour;
  return normLPerHour * randomInRange(MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE, random);
}

function idleOverrunRecommendation(truck, normalLoadingDurationMs) {
  const elapsedS = Math.round(truck.phaseAccountedMs / 1000);
  const normS = Math.round(normalLoadingDurationMs / 1000);
  return `Машина №${truck.number} превысила нормативное время стоянки на точке погрузки (${elapsedS} с вместо ~${normS} с) — перерасход на холостом ходу. Рекомендация: проверить причину простоя, при повторении — направить на технический осмотр.`;
}

function mechanicalFaultRecommendation(truck, dev) {
  const devStr = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`;
  return `Машина №${truck.number} показывает стабильный перерасход топлива (${devStr}) при штатном режиме движения, простой не выявлен. Рекомендация: направить машину на внеплановый технический осмотр.`;
}

// Детект (тик диспетчера, ТЗ раздел 6) — применяется КО ВСЕМ машинам, не
// только к засеянным при спавне: это общее правило, а не спецкейс.
//
// Простой на LOADING проверяется первым и НЕ через deviationPercent — при
// равномерном учёте топлива/пробега соотношение факт/норма не зависит от
// одной лишь длительности простоя (числитель и знаменатель растут
// пропорционально), поэтому долгий простой сам по себе и есть сигнал.
// Красная зона отклонения расхода (см. simulation/fuel.js) детектит
// оставшийся случай — штатные тайминги, но повышенный фактический расход.
export function detectAnomaly(truck, normalLoadingDurationMs) {
  if (truck.phase === 'LOADING' && truck.phaseAccountedMs > normalLoadingDurationMs * IDLE_OVERRUN_TIME_MULTIPLIER) {
    return {
      anomalyType: 'IDLE_OVERRUN',
      anomalyRecommendation: idleOverrunRecommendation(truck, normalLoadingDurationMs),
    };
  }

  const dev = deviationPercent(truck);
  if (Math.abs(dev) > FUEL_DEVIATION_YELLOW_MAX) {
    return {
      anomalyType: 'MECHANICAL_FAULT',
      anomalyRecommendation: mechanicalFaultRecommendation(truck, dev),
    };
  }

  return { anomalyType: null, anomalyRecommendation: null };
}

// Промпт для сценария "Объяснить причину" (ТЗ, "Интеграция AnythingLLM",
// сценарий 4) — дословно по шаблону из раздела "Аномалии".
export function buildAnomalyExplainPrompt(truck, normalLoadingDurationMs) {
  const dev = deviationPercent(truck);
  const devStr = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`;
  const normS = Math.round(normalLoadingDurationMs / 1000);
  const elapsedS = Math.round(truck.phaseAccountedMs / 1000);
  return `Объясни диспетчеру простым языком, почему машину ${truck.number} рекомендовано направить на технический осмотр. Причина: ${truck.anomalyType}. Отклонение расхода топлива: ${devStr}, текущая фаза: ${truck.phase}, время в фазе: ${elapsedS} сек (норма ~${normS} сек).`;
}
