import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTruck,
  advanceTruck,
  simulationTick,
  resetCounters,
  MAX_ACTIVE_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';

beforeEach(() => {
  resetCounters();
});

describe('createTruck', () => {
  it('создаёт машину в фазе ENTERING с целью среди LOAD_POINTS', () => {
    const truck = createTruck(1000);
    expect(truck.phase).toBe('ENTERING');
    expect(LOAD_POINTS.some((lp) => lp.id === truck.targetLoadPointId)).toBe(true);
    expect(truck.phaseStartedAt).toBe(1000);
  });

  it('выдаёт уникальные id для каждой новой машины', () => {
    const a = createTruck(0);
    const b = createTruck(0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('advanceTruck', () => {
  it('не меняет машину, пока время текущей фазы не истекло', () => {
    const truck = createTruck(0);
    const result = advanceTruck(truck, truck.phaseDurationMs - 1);
    expect(result).toBe(truck);
  });

  it('проходит весь цикл ENTERING -> TO_LOAD -> LOADING -> EXITING -> DONE', () => {
    let truck = createTruck(0);

    truck = advanceTruck(truck, truck.phaseDurationMs);
    expect(truck.phase).toBe('TO_LOAD');
    expect(truck.path.length).toBeGreaterThan(1);

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('LOADING');

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('EXITING');
    expect(truck.path.length).toBeGreaterThan(1);

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('DONE');
  });
});

describe('simulationTick', () => {
  it('никогда не превышает MAX_ACTIVE_TRUCKS и не пустеет после разгона', () => {
    let state = { trucks: [], nextSpawnAt: 0 };
    let now = 0;
    for (let i = 0; i < 300; i++) {
      now += 1500;
      state = simulationTick(state, now);
      expect(state.trucks.length).toBeLessThanOrEqual(MAX_ACTIVE_TRUCKS);
    }
    expect(state.trucks.length).toBeGreaterThan(0);
  });

  it('убирает машины, завершившие маршрут (DONE)', () => {
    const truck = { ...createTruck(0), phase: 'EXITING', phaseStartedAt: 0, phaseDurationMs: 100 };
    const state = simulationTick({ trucks: [truck], nextSpawnAt: 0 }, 200);
    expect(state.trucks.find((t) => t.id === truck.id)).toBeUndefined();
  });
});
