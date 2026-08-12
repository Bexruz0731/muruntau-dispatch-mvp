import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTruck,
  simulationTick,
  resetCounters,
  getQueueCounts,
  MAX_ACTIVE_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';

beforeEach(() => {
  resetCounters();
});

describe('createTruck', () => {
  it('создаёт машину в фазе ENTERING БЕЗ цели — её назначит диспетчер', () => {
    const truck = createTruck(1000);
    expect(truck.phase).toBe('ENTERING');
    expect(truck.targetLoadPointId).toBeNull();
    expect(truck.phaseStartedAt).toBe(1000);
  });

  it('выдаёт уникальные id для каждой новой машины', () => {
    const a = createTruck(0);
    const b = createTruck(0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('getQueueCounts', () => {
  it('считает только машины в фазах TO_LOAD и LOADING', () => {
    const trucks = [
      { phase: 'TO_LOAD', targetLoadPointId: 'lp-a' },
      { phase: 'LOADING', targetLoadPointId: 'lp-a' },
      { phase: 'EXITING', targetLoadPointId: 'lp-a' },
      { phase: 'ENTERING', targetLoadPointId: null },
    ];
    expect(getQueueCounts(trucks)).toEqual({ 'lp-a': 2 });
  });
});

describe('simulationTick — dispatch integration', () => {
  it('назначает цель через диспетчерский алгоритм при выходе из ENTERING и логирует событие', () => {
    const truck = createTruck(0);
    const state = {
      trucks: [truck],
      nextSpawnAt: 1e9,
      events: [],
      scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
    };
    const result = simulationTick(state, truck.phaseDurationMs);
    const advanced = result.trucks.find((t) => t.id === truck.id);

    expect(advanced.phase).toBe('TO_LOAD');
    expect(LOAD_POINTS.some((lp) => lp.id === advanced.targetLoadPointId)).toBe(true);
    expect(advanced.path.length).toBeGreaterThan(1);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].truckNumber).toBe(truck.number);
    expect(result.events[0].toLoadPointId).toBe(advanced.targetLoadPointId);
    expect(result.events[0].fromLabel).toBe('Въезд');
    expect(typeof result.events[0].reason).toBe('string');
  });

  it('проходит весь цикл TO_LOAD -> LOADING -> EXITING -> DONE через последовательные тики', () => {
    let truck = createTruck(0);
    let state = {
      trucks: [truck],
      nextSpawnAt: 1e9,
      events: [],
      scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
    };

    // +1 мс запаса на каждой границе: phaseStartedAt/phaseDurationMs — не
    // целые числа (randomInRange), и (a + b) - a изредка на 1 бит с плавающей
    // точкой не равно b тютелька в тютельку — без запаса elapsed < duration
    // может оказаться true ровно на границе и тест изредка падает.
    state = simulationTick(state, truck.phaseDurationMs + 1);
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('TO_LOAD');

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1);
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('LOADING');

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1);
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('EXITING');

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1);
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck).toBeUndefined(); // DONE -> отфильтрована
  });
});

describe('simulationTick', () => {
  it('никогда не превышает MAX_ACTIVE_TRUCKS и не пустеет после разгона', () => {
    let state = {
      trucks: [],
      nextSpawnAt: 0,
      events: [],
      scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
    };
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
    const state = simulationTick(
      {
        trucks: [truck],
        nextSpawnAt: 0,
        events: [],
        scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
      },
      200,
    );
    expect(state.trucks.find((t) => t.id === truck.id)).toBeUndefined();
  });
});
