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
  useSimulationStore,
  MAX_ACTIVE_TRUCKS,
  SCRIPTED_CONGESTION_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';
import { FALLBACK_FUEL_NORM_L_PER_HOUR, FUEL_TANK_CAPACITY_L, FUEL_NORM_RAG_PROMPT } from './fuel';
import { chatWithWorkspace } from '../lib/anythingllm';

const EMPTY_SCRIPTED = { active: false, remaining: 0, targetId: null, triggerAt: 0 };

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

  it('стартует с полным баком и нормой автопарка', () => {
    const truck = createTruck(0);
    expect(truck.fuelLevel).toBe(FUEL_TANK_CAPACITY_L);
    expect(truck.fuelBurnRatePerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
    expect(truck.fuelConsumedThisShift).toBe(0);
    expect(truck.distanceThisShift).toBe(0);
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
    const state = { trucks: [truck], nextSpawnAt: 1e9, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
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
    let state = { trucks: [truck], nextSpawnAt: 1e9, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };

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
    let state = { trucks: [], nextSpawnAt: 0, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    let now = 0;
    for (let i = 0; i < 300; i++) {
      now += 1500;
      state = simulationTick(state, now);
      expect(state.trucks.length).toBeLessThanOrEqual(MAX_ACTIVE_TRUCKS);
    }
    expect(state.trucks.length).toBeGreaterThan(0);
  });

  it('убирает машины, завершившие маршрут (DONE), и фиксирует запись в sessionLog', () => {
    const truck = { ...createTruck(0), phase: 'EXITING', phaseStartedAt: 0, phaseDurationMs: 100 };
    const state = simulationTick(
      { trucks: [truck], nextSpawnAt: 0, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED },
      200,
    );
    expect(state.trucks.find((t) => t.id === truck.id)).toBeUndefined();
    expect(state.sessionLog).toHaveLength(1);
    expect(state.sessionLog[0].truckNumber).toBe(truck.number);
    expect(state.sessionLog[0].status).toBe('завершила смену');
  });
});

describe('заскриптованный сценарий с затором', () => {
  it('направляет SCRIPTED_CONGESTION_TRUCKS машин подряд в одну точку, затем сценарий исчерпывается и алгоритм возвращается к обычной логике', () => {
    let state = {
      trucks: [],
      nextSpawnAt: 1e9,
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

describe('учёт топлива и пробега', () => {
  it('копит топливо и пробег во время движения, и фиксирует финальные цифры в sessionLog при DONE', () => {
    let truck = createTruck(0);
    let state = { trucks: [truck], nextSpawnAt: 1e9, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };

    state = simulationTick(state, truck.phaseDurationMs + 1); // ENTERING -> TO_LOAD
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('TO_LOAD');
    expect(truck.fuelConsumedThisShift).toBe(0); // фаза только началась

    const halfway = truck.phaseStartedAt + truck.phaseDurationMs / 2;
    state = simulationTick(state, halfway);
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.fuelConsumedThisShift).toBeGreaterThan(0);
    expect(truck.distanceThisShift).toBeGreaterThan(0);

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1); // -> LOADING
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('LOADING');

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1); // -> EXITING
    truck = state.trucks.find((t) => t.id === truck.id);
    expect(truck.phase).toBe('EXITING');

    state = simulationTick(state, truck.phaseStartedAt + truck.phaseDurationMs + 1); // -> DONE
    expect(state.trucks.find((t) => t.id === truck.id)).toBeUndefined();
    expect(state.sessionLog).toHaveLength(1);
    expect(state.sessionLog[0].totalFuelConsumed).toBeGreaterThan(0);
    expect(state.sessionLog[0].totalDistanceM).toBeGreaterThan(0);
    expect(state.sessionLog[0].normLPerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });
});

describe('аномалии', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('засевает IDLE_OVERRUN, если оба броска Math.random попадают в нужные диапазоны', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1) // < ANOMALY_SEED_PROBABILITY (0.25) -> аномалия есть
      .mockReturnValueOnce(0.2) // < 0.5 -> IDLE_OVERRUN
      .mockReturnValue(0.5); // остальные вызовы (например, randomInRange для нормальных таймингов) — нейтральные
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBe('IDLE_OVERRUN');
    expect(truck.actualBurnRatePerHour).toBe(truck.fuelBurnRatePerHour); // IDLE_OVERRUN не меняет ставку
  });

  it('засевает MECHANICAL_FAULT и повышает actualBurnRatePerHour относительно нормы', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1) // аномалия есть
      .mockReturnValueOnce(0.9) // >= 0.5 -> MECHANICAL_FAULT
      .mockReturnValue(0.5);
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBe('MECHANICAL_FAULT');
    expect(truck.actualBurnRatePerHour).toBeGreaterThan(truck.fuelBurnRatePerHour);
  });

  it('не засевает аномалию, если первый бросок выше порога', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const truck = createTruck(0);
    expect(truck.seededAnomaly).toBeNull();
    expect(truck.actualBurnRatePerHour).toBe(truck.fuelBurnRatePerHour);
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
      phaseDurationMs: 40000, // раздутая LOADING-фаза, как у настоящего IDLE_OVERRUN
      phaseAccountedMs: 0,
      seededAnomaly: 'IDLE_OVERRUN',
    };
    const state = { trucks: [truck], nextSpawnAt: 1e9, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    const result = simulationTick(state, 20000); // 20с — больше 12с (8000*1.5), но меньше 40с
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
    const state = { trucks: [truck], nextSpawnAt: 1e9, events: [], sessionLog: [], scripted: EMPTY_SCRIPTED };
    const result = simulationTick(state, 5000); // половина фазы
    const advanced = result.trucks.find((t) => t.id === truck.id);
    expect(advanced.phase).toBe('TO_LOAD');
    expect(advanced.anomalyType).toBe('MECHANICAL_FAULT');
    expect(advanced.anomalyRecommendation).toContain(`№${truck.number}`);
  });
});

describe('createTruck с нестандартной нормой', () => {
  it('использует переданную норму, а не FALLBACK, если она указана', () => {
    const truck = createTruck(0, 130);
    expect(truck.fuelBurnRatePerHour).toBe(130);
  });

  it('без явной нормы использует FALLBACK_FUEL_NORM_L_PER_HOUR (обратная совместимость)', () => {
    const truck = createTruck(0);
    expect(truck.fuelBurnRatePerHour).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });
});

describe('simulationTick — распространение fleetNormLPerHour на новые машины', () => {
  it('спавнит новые машины с нормой из state.fleetNormLPerHour', () => {
    const state = {
      trucks: [],
      nextSpawnAt: 0,
      events: [],
      sessionLog: [],
      scripted: EMPTY_SCRIPTED,
      fleetNormLPerHour: 130,
    };
    const result = simulationTick(state, 0);
    expect(result.trucks[0].fuelBurnRatePerHour).toBe(130);
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
