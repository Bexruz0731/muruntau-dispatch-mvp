import { pathLength } from './constants';

// Норма расхода — общий fallback на весь автопарк (модель БелАЗ-75131,
// середина диапазона 100-120 л/ч). Этап 6 сможет заменить конкретное
// значение, с которым создаётся машина (RAG-запрос к AnythingLLM), не
// трогая расчёты здесь.
export const FALLBACK_FUEL_NORM_L_PER_HOUR = 110;
export const FUEL_TANK_CAPACITY_L = 1050;

export const FUEL_DEVIATION_GREEN_MAX = 5; // |откл| <= 5% — зелёный
export const FUEL_DEVIATION_YELLOW_MAX = 15; // 5-15% — жёлтый, > 15% — красный

// Начисляет расход топлива и пробег за время, фактически прошедшее в
// ТЕКУЩЕЙ фазе с последнего учёта (truck.phaseAccountedMs) — считает по
// реальной разнице времени, а не по предположению о фиксированном шаге
// тика, поэтому корректно работает и при произвольном вызове из тестов, и
// при дрейфе реального setInterval. Топливо расходуется в TO_LOAD и
// LOADING; пробег — в TO_LOAD и EXITING (ТЗ, раздел 5).
export function accrueFuelAndDistance(truck, now) {
  const cappedElapsed = Math.min(now - truck.phaseStartedAt, truck.phaseDurationMs);
  const deltaMs = Math.max(0, cappedElapsed - truck.phaseAccountedMs);

  let { fuelLevel, fuelConsumedThisShift, distanceThisShift, movingMs } = truck;

  if (deltaMs > 0) {
    if (truck.phase === 'TO_LOAD' || truck.phase === 'LOADING') {
      const deltaFuel = truck.fuelBurnRatePerHour * (deltaMs / 3600000);
      fuelConsumedThisShift += deltaFuel;
      fuelLevel = Math.max(0, fuelLevel - deltaFuel);
      movingMs += deltaMs;
    }
    if (truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') {
      const legLength = pathLength(truck.path);
      distanceThisShift += legLength * (deltaMs / truck.phaseDurationMs);
    }
  }

  return {
    ...truck,
    fuelLevel,
    fuelConsumedThisShift,
    distanceThisShift,
    movingMs,
    phaseAccountedMs: cappedElapsed,
  };
}

// Фактический часовой расход по итогам смены (л/ч). Пока машина ещё не
// двигалась — считается равным норме (нечего делить).
export function actualLPerHour(truck) {
  if (truck.movingMs <= 0) return truck.fuelBurnRatePerHour;
  return truck.fuelConsumedThisShift / (truck.movingMs / 3600000);
}

// Отклонение фактического расхода от нормы, % (положительное — перерасход).
export function deviationPercent(truck) {
  const norm = truck.fuelBurnRatePerHour;
  if (norm <= 0) return 0;
  return ((actualLPerHour(truck) - norm) / norm) * 100;
}

export function statusColorForDeviation(pct) {
  const abs = Math.abs(pct);
  if (abs > FUEL_DEVIATION_YELLOW_MAX) return '#ef4444';
  if (abs > FUEL_DEVIATION_GREEN_MAX) return '#eab308';
  return '#22c55e';
}
