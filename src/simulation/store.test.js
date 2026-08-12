import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../lib/anythingllm', () => ({
  chatWithWorkspace: vi.fn(),
  resolveWorkspaceSlug: (preferred, fallback) => preferred || fallback || null,
  WORKSPACE_DOCS_SLUG: null,
  WORKSPACE_DISPATCH_SLUG: null,
}));

import {
  createTruck,
  simulationTick,
  resetCounters,
  getQueueCounts,
  getBeltQueueCount,
  useSimulationStore,
  FLEET_SIZE,
  LAPS_PER_SHIFT,
  SCRIPTED_CONGESTION_TRUCKS,
} from './store';
import { LOAD_POINTS, BELT_POINT } from './constants';
import { FALLBACK_FUEL_NORM_L_PER_HOUR, FUEL_TANK_CAPACITY_L, FUEL_NORM_RAG_PROMPT } from './fuel';
import { chatWithWorkspace } from '../lib/anythingllm';

const EMPTY_SCRIPTED = { active: false, remaining: 0, targetId: null, triggerAt: 0 };

beforeEach(() => {
  resetCounters();
});

describe('createTruck', () => {
  it('создаёт машину в фазе ENTERING без цели, с полным баком и нормой автопарка', () => {
    const truck = createTruck(1000);
    expect(truck.phase).toBe('ENTERING');
    expect(truck.targetLoadPointId).toBeNull();
    expect(truck.fuelLevel).toBe(FUEL_TANK_CAPACITY_L);
    expect(truck.fuelBurnRatePerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
    expect(truck.lapsCompletedThisShift).toBe(0);
  });

  it('выдаёт уникальные id', () => {
    const a = createTruck(0);
    const b = createTruck(0);
    expect(a.id).not.toBe(b.id);
  });

  it('использует переданную норму, а не FALLBACK, если она указана', () => {
    expect(createTruck(0, 130).fuelBurnRatePerHour).toBe(130);
  });
});

describe('getQueueCounts / getBeltQueueCount', () => {
  it('getQueueCounts считает только TO_LOAD и LOADING по точкам погрузки', () => {
    const trucks = [
      { phase: 'TO_LOAD', targetLoadPointId: 'lp-a' },
      { phase: 'LOADING', targetLoadPointId: 'lp-a' },
      { phase: 'EXITING', targetLoadPointId: 'lp-a' },
      { phase: 'ENTERING', targetLoadPointId: null },
    ];
    expect(getQueueCounts(trucks)).toEqual({ 'lp-a': 2 });
  });

  it('getBeltQueueCount считает EXITING и UNLOADING', () => {
    const trucks = [{ phase: 'EXITING' }, { phase: 'UNLOADING' }, { phase: 'RETURNING' }, { phase: 'LOADING' }];
    expect(getBeltQueueCount(trucks)).toBe(2);
  });
});

describe('simulationTick — бесконечный цикл без DONE', () => {
  it('проходит весь круг и возвращается в ENTERING, не исчезая', () => {
    let truck = createTruck(0);
    let state = { trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };

    const advanceOnce = () => {
      state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1);
      truck = state.trucks.find((t) => t.id === truck.id);
    };

    advanceOnce(); expect(truck.phase).toBe('TO_LOAD');
    advanceOnce(); expect(truck.phase).toBe('LOADING');
    advanceOnce(); expect(truck.phase).toBe('EXITING');
    advanceOnce(); expect(truck.phase).toBe('UNLOADING');
    advanceOnce(); expect(truck.phase).toBe('RETURNING');
    advanceOnce();
    expect(truck.phase).toBe('ENTERING'); // не DONE, машина никуда не делась
    expect(truck.lapsCompletedThisShift).toBe(1);

    advanceOnce();
    expect(truck.phase).toBe('TO_LOAD'); // цикл действительно продолжается
    expect(state.trucks).toHaveLength(1);
  });

  it('никогда не меняет число машин — фиксированный парк FLEET_SIZE, без спавна/деспавна', () => {
    let state = { trucks: [], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    for (let i = 0; i < FLEET_SIZE; i++) {
      state = { ...state, trucks: [...state.trucks, createTruck(0)] };
    }
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now += 1500;
      state = simulationTick(state, now);
      expect(state.trucks).toHaveLength(FLEET_SIZE);
    }
  });
});

describe('EXITING/UNLOADING нацелены на BELT_POINT, RETURNING — на ENTRY_POINT', () => {
  it('после LOADING машина едет к BELT_POINT', () => {
    const truck = {
      ...createTruck(0),
      phase: 'LOADING',
      targetLoadPointId: LOAD_POINTS[0].id,
      phaseStartedAt: 0,
      phaseDurationMs: 100,
    };
    const state = simulationTick({ trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED }, 200);
    const advanced = state.trucks[0];
    expect(advanced.phase).toBe('EXITING');
    const last = advanced.path[advanced.path.length - 1];
    expect(last[0]).toBeCloseTo(BELT_POINT.position[0], 0);
    expect(last[2]).toBeCloseTo(BELT_POINT.position[1], 0);
  });
});

describe('пересменка каждые LAPS_PER_SHIFT рейсов', () => {
  it('на рейсах, не кратных LAPS_PER_SHIFT, sessionLog не пополняется и счётчики не сбрасываются', () => {
    const truck = {
      ...createTruck(0),
      phase: 'UNLOADING',
      phaseStartedAt: 0,
      phaseDurationMs: 100,
      lapsCompletedThisShift: 1, // станет 2 — не кратно LAPS_PER_SHIFT(5)
      distanceThisShift: 999,
      fuelConsumedThisShift: 50,
    };
    const state = simulationTick({ trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED }, 200);
    const advanced = state.trucks[0];
    expect(advanced.phase).toBe('RETURNING');
    expect(advanced.lapsCompletedThisShift).toBe(2);
    expect(advanced.distanceThisShift).toBe(999);
    expect(state.sessionLog).toHaveLength(0);
  });

  it('на LAPS_PER_SHIFT-м рейсе пишет sessionLog со сменными цифрами, сбрасывает счётчики и дозаправляет бак', () => {
    const truck = {
      ...createTruck(0),
      phase: 'UNLOADING',
      phaseStartedAt: 0,
      phaseDurationMs: 100,
      lapsCompletedThisShift: LAPS_PER_SHIFT - 1,
      distanceThisShift: 42000,
      fuelConsumedThisShift: 500,
      fuelLevel: 10,
      movingMs: 3600000,
    };
    const state = simulationTick({ trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED }, 200);
    const advanced = state.trucks[0];
    expect(advanced.lapsCompletedThisShift).toBe(LAPS_PER_SHIFT);
    expect(advanced.distanceThisShift).toBe(0);
    expect(advanced.fuelConsumedThisShift).toBe(0);
    expect(advanced.fuelLevel).toBe(FUEL_TANK_CAPACITY_L);

    expect(state.sessionLog).toHaveLength(1);
    expect(state.sessionLog[0].truckNumber).toBe(truck.number);
    expect(state.sessionLog[0].totalDistanceM).toBe(42000);
    expect(state.sessionLog[0].totalFuelConsumed).toBe(500);
    expect(state.sessionLog[0].status).toBe('завершила смену');
  });
});

describe('заскриптованный сценарий с затором', () => {
  it('направляет SCRIPTED_CONGESTION_TRUCKS машин подряд в одну точку, затем возвращается к обычной логике', () => {
    let state = {
      trucks: [],
      events: [],
      sessionLog: [],
      scripted: { active: true, remaining: SCRIPTED_CONGESTION_TRUCKS, targetId: null, triggerAt: 5000 },
    };
    const forcedTargets = [];

    for (let i = 0; i < SCRIPTED_CONGESTION_TRUCKS; i++) {
      const truck = createTruck(5000);
      state = { ...state, trucks: [...state.trucks, truck] };
      state = simulationTick(state, 5000 + truck.phaseDurationMs);
      const advanced = state.trucks.find((t) => t.id === truck.id);
      forcedTargets.push(advanced.targetLoadPointId);
    }

    expect(new Set(forcedTargets).size).toBe(1);
    expect(state.scripted.active).toBe(false);
    expect(state.events[0].reason).toContain('заскриптован');

    const nextTruck = createTruck(5000);
    state = { ...state, trucks: [...state.trucks, nextTruck] };
    state = simulationTick(state, 5000 + nextTruck.phaseDurationMs + 1000);
    expect(state.events[0].reason).not.toContain('заскриптован');
  });
});

describe('аномалии', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('засевает IDLE_OVERRUN, если оба броска Math.random попадают в нужные диапазоны', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2)
      .mockReturnValue(0.5);
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBe('IDLE_OVERRUN');
    expect(truck.actualBurnRatePerHour).toBe(truck.fuelBurnRatePerHour);
  });

  it('засевает MECHANICAL_FAULT и повышает actualBurnRatePerHour относительно нормы', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValue(0.5);
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBe('MECHANICAL_FAULT');
    expect(truck.actualBurnRatePerHour).toBeGreaterThan(truck.fuelBurnRatePerHour);
  });

  it('не засевает аномалию, если первый бросок выше порога', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBeNull();
    expect(truck.anomalyType).toBeNull();
  });

  it('simulationTick помечает IDLE_OVERRUN у машины, застрявшей на LOADING дольше нормы', () => {
    const base = createTruck(0);
    const truck = {
      ...base,
      phase: 'LOADING',
      targetLoadPointId: LOAD_POINTS[0].id,
      path: [[0, 0, 0], [0, 0, 0]],
      phaseStartedAt: 0,
      phaseDurationMs: 40000,
      phaseAccountedMs: 0,
      seededAnomaly: 'IDLE_OVERRUN',
    };
    const state = { trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    const result = simulationTick(state, 20000);
    const advanced = result.trucks.find((t) => t.id === truck.id);
    expect(advanced.phase).toBe('LOADING');
    expect(advanced.anomalyType).toBe('IDLE_OVERRUN');
    expect(advanced.anomalyRecommendation).toContain(`№${truck.number}`);
  });

  it('simulationTick помечает MECHANICAL_FAULT у машины с повышенным фактическим расходом в TO_LOAD', () => {
    const base = createTruck(0);
    const truck = {
      ...base,
      phase: 'TO_LOAD',
      targetLoadPointId: LOAD_POINTS[0].id,
      path: [[0, 0, 0], [1000, 0, 0]],
      phaseStartedAt: 0,
      phaseDurationMs: 10000,
      phaseAccountedMs: 0,
      actualBurnRatePerHour: base.fuelBurnRatePerHour * 1.5,
    };
    const state = { trucks: [truck], events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    const result = simulationTick(state, 5000);
    const advanced = result.trucks.find((t) => t.id === truck.id);
    expect(advanced.phase).toBe('TO_LOAD');
    expect(advanced.anomalyType).toBe('MECHANICAL_FAULT');
    expect(advanced.anomalyRecommendation).toContain(`№${truck.number}`);
  });
});

describe('fetchFleetNorm', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('обновляет fleetNormLPerHour при успешном ответе с распознаваемым числом', async () => {
    chatWithWorkspace.mockResolvedValueOnce({ ok: true, error: null, text: 'Норма — 125 л/ч', sources: [] });
    useSimulationStore.setState({ fleetNormLPerHour: FALLBACK_FUEL_NORM_L_PER_HOUR });
    await useSimulationStore.getState().fetchFleetNorm();
    expect(useSimulationStore.getState().fleetNormLPerHour).toBe(125);
    expect(chatWithWorkspace).toHaveBeenCalledWith(null, FUEL_NORM_RAG_PROMPT);
  });

  it('тихо оставляет fallback-норму, если AnythingLLM недоступен', async () => {
    chatWithWorkspace.mockResolvedValueOnce({ ok: false, error: 'network', text: null, sources: [] });
    useSimulationStore.setState({ fleetNormLPerHour: FALLBACK_FUEL_NORM_L_PER_HOUR });
    await useSimulationStore.getState().fetchFleetNorm();
    expect(useSimulationStore.getState().fleetNormLPerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });

  it('тихо оставляет fallback-норму, если текст ответа не парсится в число', async () => {
    chatWithWorkspace.mockResolvedValueOnce({ ok: true, error: null, text: 'не знаю', sources: [] });
    useSimulationStore.setState({ fleetNormLPerHour: FALLBACK_FUEL_NORM_L_PER_HOUR });
    await useSimulationStore.getState().fetchFleetNorm();
    expect(useSimulationStore.getState().fleetNormLPerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });
});
