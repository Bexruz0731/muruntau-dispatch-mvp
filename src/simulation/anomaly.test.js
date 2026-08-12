import { describe, it, expect } from 'vitest';
import {
  rollSeededAnomaly,
  loadingDurationForSeed,
  actualBurnRateForSeed,
  detectAnomaly,
  ANOMALY_SEED_PROBABILITY,
  IDLE_OVERRUN_MULTIPLIER_RANGE,
  MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE,
} from './anomaly';
import { FALLBACK_FUEL_NORM_L_PER_HOUR } from './fuel';

// Детерминированная последовательность значений вместо Math.random — по
// одному значению на каждый вызов random() внутри тестируемой функции.
function fakeRandomSequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeTruck(overrides = {}) {
  return {
    number: '42',
    phase: 'TO_LOAD',
    phaseAccountedMs: 0,
    movingMs: 0,
    fuelConsumedThisShift: 0,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    ...overrides,
  };
}

describe('rollSeededAnomaly', () => {
  it('возвращает null, если первый бросок выше порога вероятности', () => {
    const random = fakeRandomSequence([ANOMALY_SEED_PROBABILITY + 0.01]);
    expect(rollSeededAnomaly(random)).toBeNull();
  });

  it('возвращает IDLE_OVERRUN, если аномалия есть и второй бросок < 0.5', () => {
    const random = fakeRandomSequence([0.01, 0.2]);
    expect(rollSeededAnomaly(random)).toBe('IDLE_OVERRUN');
  });

  it('возвращает MECHANICAL_FAULT, если аномалия есть и второй бросок >= 0.5', () => {
    const random = fakeRandomSequence([0.01, 0.8]);
    expect(rollSeededAnomaly(random)).toBe('MECHANICAL_FAULT');
  });
});

describe('loadingDurationForSeed', () => {
  it('не меняет длительность без засеянной аномалии', () => {
    expect(loadingDurationForSeed(6000, null)).toBe(6000);
    expect(loadingDurationForSeed(6000, 'MECHANICAL_FAULT')).toBe(6000);
  });

  it('раздувает длительность в диапазоне IDLE_OVERRUN_MULTIPLIER_RANGE для IDLE_OVERRUN', () => {
    const random = fakeRandomSequence([0]); // множитель = нижняя граница диапазона
    const result = loadingDurationForSeed(6000, 'IDLE_OVERRUN', random);
    expect(result).toBeCloseTo(6000 * IDLE_OVERRUN_MULTIPLIER_RANGE[0]);
  });
});

describe('actualBurnRateForSeed', () => {
  it('не меняет ставку без засеянной аномалии', () => {
    expect(actualBurnRateForSeed(110, null)).toBe(110);
    expect(actualBurnRateForSeed(110, 'IDLE_OVERRUN')).toBe(110);
  });

  it('повышает ставку в диапазоне MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE для MECHANICAL_FAULT', () => {
    const random = fakeRandomSequence([1]); // множитель = верхняя граница диапазона
    const result = actualBurnRateForSeed(110, 'MECHANICAL_FAULT', random);
    expect(result).toBeCloseTo(110 * MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE[1]);
  });
});

describe('detectAnomaly', () => {
  it('не находит аномалию у машины без перерасхода и без затянувшегося простоя', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 4000 });
    expect(detectAnomaly(truck, 8000)).toEqual({ anomalyType: null, anomalyRecommendation: null });
  });

  it('находит IDLE_OVERRUN у машины в LOADING дольше normalLoadingDurationMs * 1.5', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 13000 });
    const result = detectAnomaly(truck, 8000); // порог 12000
    expect(result.anomalyType).toBe('IDLE_OVERRUN');
    expect(result.anomalyRecommendation).toContain('№42');
    expect(result.anomalyRecommendation).toContain('технический осмотр');
  });

  it('не находит IDLE_OVERRUN ровно на границе (не больше, а равно)', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 12000 });
    expect(detectAnomaly(truck, 8000).anomalyType).toBeNull();
  });

  it('находит MECHANICAL_FAULT у машины с перерасходом > 15% вне LOADING', () => {
    const truck = makeTruck({
      phase: 'TO_LOAD',
      movingMs: 3600000,
      fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.3, // +30%
    });
    const result = detectAnomaly(truck, 8000);
    expect(result.anomalyType).toBe('MECHANICAL_FAULT');
    expect(result.anomalyRecommendation).toContain('№42');
    expect(result.anomalyRecommendation).toContain('технический осмотр');
  });

  it('не находит аномалию при отклонении ровно 15% (порог строгий)', () => {
    const truck = makeTruck({
      phase: 'TO_LOAD',
      movingMs: 3600000,
      fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.15,
    });
    expect(detectAnomaly(truck, 8000).anomalyType).toBeNull();
  });
});
