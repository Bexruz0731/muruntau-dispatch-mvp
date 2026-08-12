import { describe, it, expect } from 'vitest';
import { buildFuelReportRows, buildFuelSummaryPrompt } from './fuelReportSummary';
import { FALLBACK_FUEL_NORM_L_PER_HOUR } from './fuel';

function makeActiveTruck(overrides = {}) {
  return {
    number: '42',
    distanceThisShift: 5000,
    fuelConsumedThisShift: 100,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    movingMs: 3600000,
    ...overrides,
  };
}

describe('buildFuelReportRows', () => {
  it('объединяет активные и уехавшие машины в единый список строк', () => {
    const trucks = [makeActiveTruck()];
    const sessionLog = [
      { truckNumber: '17', totalDistanceM: 8000, totalFuelConsumed: 150, normLPerHour: 110, deviationPercent: 10, status: 'завершила смену' },
    ];
    const rows = buildFuelReportRows(trucks, sessionLog);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ truckNumber: '42', distanceKm: 5, status: 'активна' });
    expect(rows[1]).toMatchObject({ truckNumber: '17', distanceKm: 8, status: 'завершила смену' });
  });
});

describe('buildFuelSummaryPrompt', () => {
  it('возвращает заглушку-промпт, если данных ещё нет', () => {
    const prompt = buildFuelSummaryPrompt([], []);
    expect(prompt).toContain('данных');
  });

  it('включает агрегаты и худших по отклонению машин в промпт', () => {
    const trucks = [
      makeActiveTruck({ number: '01', fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5, actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5 }),
      makeActiveTruck({ number: '02' }),
    ];
    const prompt = buildFuelSummaryPrompt(trucks, []);
    expect(prompt).toContain('2');
    expect(prompt).toContain('№01');
    expect(prompt).toMatch(/\+50\.0%/);
  });
});
