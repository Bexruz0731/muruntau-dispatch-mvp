import { describe, it, expect } from 'vitest';
import {
  accrueFuelAndDistance,
  actualLPerHour,
  deviationPercent,
  statusColorForDeviation,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
} from './fuel';

function makeTruck(overrides = {}) {
  return {
    phase: 'TO_LOAD',
    phaseStartedAt: 0,
    phaseDurationMs: 10000,
    phaseAccountedMs: 0,
    path: [[0, 0, 0], [100, 0, 0]], // 100 м
    fuelLevel: FUEL_TANK_CAPACITY_L,
    fuelConsumedThisShift: 0,
    distanceThisShift: 0,
    movingMs: 0,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    ...overrides,
  };
}

describe('accrueFuelAndDistance', () => {
  it('начисляет топливо и пробег пропорционально прошедшему времени в TO_LOAD', () => {
    const truck = makeTruck();
    const result = accrueFuelAndDistance(truck, 5000); // половина фазы (5000 из 10000 мс)

    expect(result.fuelConsumedThisShift).toBeCloseTo(FALLBACK_FUEL_NORM_L_PER_HOUR * (5000 / 3600000));
    expect(result.fuelLevel).toBeCloseTo(FUEL_TANK_CAPACITY_L - result.fuelConsumedThisShift);
    expect(result.distanceThisShift).toBeCloseTo(50); // половина от 100 м
    expect(result.movingMs).toBe(5000);
    expect(result.phaseAccountedMs).toBe(5000);
  });

  it('не начисляет дважды одно и то же время при повторном вызове с тем же now', () => {
    const truck = makeTruck();
    const once = accrueFuelAndDistance(truck, 5000);
    const twice = accrueFuelAndDistance(once, 5000);
    expect(twice.fuelConsumedThisShift).toBeCloseTo(once.fuelConsumedThisShift);
    expect(twice.distanceThisShift).toBeCloseTo(once.distanceThisShift);
  });

  it('в фазе LOADING начисляет расход, но не пробег', () => {
    const truck = makeTruck({ phase: 'LOADING' });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.distanceThisShift).toBe(0);
    expect(result.fuelConsumedThisShift).toBeGreaterThan(0);
  });

  it('в фазе EXITING начисляет пробег, но не топливо', () => {
    const truck = makeTruck({ phase: 'EXITING' });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.distanceThisShift).toBeCloseTo(50);
    expect(result.fuelConsumedThisShift).toBe(0);
  });

  it('не начисляет больше длительности фазы, даже если now намного больше', () => {
    const truck = makeTruck();
    const result = accrueFuelAndDistance(truck, 999999);
    expect(result.distanceThisShift).toBeCloseTo(100); // весь путь, не больше
    expect(result.phaseAccountedMs).toBe(10000);
  });
});

describe('deviationPercent / statusColorForDeviation', () => {
  it('при фактическом расходе равном норме отклонение — 0%, цвет зелёный', () => {
    const truck = makeTruck({ movingMs: 3600000, fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR });
    expect(deviationPercent(truck)).toBeCloseTo(0);
    expect(statusColorForDeviation(deviationPercent(truck))).toBe('#22c55e');
  });

  it('перерасход > 15% даёт красный цвет', () => {
    const truck = makeTruck({ movingMs: 3600000, fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.2 });
    expect(deviationPercent(truck)).toBeGreaterThan(15);
    expect(statusColorForDeviation(deviationPercent(truck))).toBe('#ef4444');
  });

  it('пока машина не двигалась, actualLPerHour равен норме (не делит на 0)', () => {
    const truck = makeTruck({ movingMs: 0 });
    expect(actualLPerHour(truck)).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });
});
