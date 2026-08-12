import { create } from 'zustand';
import { ENTRY_POINT, BELT_POINT, LOAD_POINTS, groundPosition, buildRoutePoints } from './constants';
import { chooseLoadPoint } from './dispatch';
import {
  accrueFuelAndDistance,
  deviationPercent,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
  parseFuelNormLPerHour,
  FUEL_NORM_RAG_PROMPT,
} from './fuel';
import { rollSeededAnomaly, loadingDurationForSeed, actualBurnRateForSeed, detectAnomaly } from './anomaly';
import { chatWithWorkspace, resolveWorkspaceSlug, WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG } from '../lib/anythingllm';

export const TRUCK_HEIGHT_OFFSET = 0.9; // совпадает с зазором машины над землёй в Truck.jsx
export const FLEET_SIZE = 6; // фиксированный парк — машины больше не спавнятся/не исчезают
export const TICK_INTERVAL_MS = 1500; // TODO: заменить на реальные данные трекеров в проде
export const LOADING_DURATION_RANGE = [5000, 8000];
export const UNLOADING_DURATION_RANGE = [3000, 5000];
export const TRAVEL_DURATION_RANGE = [6000, 10000];
export const ENTERING_DURATION_MS = 600;
export const MAX_EVENTS = 30;
export const SCRIPTED_CONGESTION_DELAY_MS = 12000; // "гарантированно на 10-15 секунде" (ТЗ)
export const SCRIPTED_CONGESTION_TRUCKS = 3;
export const LAPS_PER_SHIFT = 5; // рейсов на "смену" — столько же строк-агрегатов в отчёте

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

function loadPointById(id) {
  return LOAD_POINTS.find((lp) => lp.id === id);
}

function pathTo(fromXZ, toXZ) {
  const [, fromY] = groundPosition(fromXZ);
  const [, toY] = groundPosition(toXZ);
  return buildRoutePoints(fromXZ, toXZ, fromY + TRUCK_HEIGHT_OFFSET, toY + TRUCK_HEIGHT_OFFSET);
}

let idCounter = 0;
let numberCounter = 0;
let eventIdCounter = 0;

// Сбрасывает счётчики id/номеров/событий — нужно только в тестах, чтобы
// каждый тест начинался с чистого состояния.
export function resetCounters() {
  idCounter = 0;
  numberCounter = 0;
  eventIdCounter = 0;
}

// Сколько машин сейчас едут к каждой точке погрузки или грузятся на ней —
// это и есть "очередь" для алгоритма диспетчеризации и для цветовой
// индикации в UI.
export function getQueueCounts(trucks) {
  const counts = {};
  for (const t of trucks) {
    if ((t.phase === 'TO_LOAD' || t.phase === 'LOADING') && t.targetLoadPointId) {
      counts[t.targetLoadPointId] = (counts[t.targetLoadPointId] || 0) + 1;
    }
  }
  return counts;
}

// Сколько машин сейчас едут на ленту или разгружаются на ней — та же логика
// "очереди", что и у точек погрузки, для симметрии в панели диспетчера.
export function getBeltQueueCount(trucks) {
  return trucks.filter((t) => t.phase === 'EXITING' || t.phase === 'UNLOADING').length;
}

// Новая машина появляется на въезде БЕЗ цели (её назначит диспетчерский
// алгоритм — см. decideTarget), с полным баком и нормой расхода автопарка.
// ~25% машин получают засеянную аномалию (см. simulation/anomaly.js) — это
// меняет только actualBurnRatePerHour (MECHANICAL_FAULT) или длительность
// будущей LOADING-фазы через seededAnomaly (IDLE_OVERRUN, применяется в
// advanceTargetedTruck при переходе TO_LOAD -> LOADING).
export function createTruck(now, normLPerHour = FALLBACK_FUEL_NORM_L_PER_HOUR) {
  idCounter += 1;
  numberCounter += 1;
  const entryGround = groundPosition(ENTRY_POINT.position);
  const seededAnomaly = rollSeededAnomaly();
  return {
    id: idCounter,
    number: String(10 + (numberCounter % 90)).padStart(2, '0'),
    phase: 'ENTERING',
    targetLoadPointId: null,
    position: entryGround,
    path: [entryGround, entryGround],
    phaseStartedAt: now,
    phaseDurationMs: ENTERING_DURATION_MS,
    phaseAccountedMs: 0,
    fuelLevel: FUEL_TANK_CAPACITY_L,
    fuelConsumedThisShift: 0,
    distanceThisShift: 0,
    movingMs: 0,
    lapsCompletedThisShift: 0,
    fuelBurnRatePerHour: normLPerHour,
    actualBurnRatePerHour: actualBurnRateForSeed(normLPerHour, seededAnomaly),
    seededAnomaly,
    anomalyType: null,
    anomalyRecommendation: null,
  };
}

// Решает, куда направить освободившуюся машину: если активен
// заскриптованный сценарий и подошло его время — принудительно к одной и
// той же точке (гарантированный затор для демонстрации на защите), иначе —
// обычным алгоритмом диспетчеризации. Возвращает решение и обновлённое
// состояние сценария (или null, если оно не изменилось).
function decideTarget(queueCounts, now, scriptedState) {
  if (scriptedState?.active && now >= scriptedState.triggerAt && scriptedState.remaining > 0) {
    const targetId = scriptedState.targetId ?? LOAD_POINTS[0].id;
    const lp = loadPointById(targetId);
    const remaining = scriptedState.remaining - 1;
    return {
      decision: {
        targetLoadPointId: targetId,
        reason: `заскриптованный сценарий: машина намеренно направлена в «${lp.name}» для демонстрации затора`,
      },
      scriptedUpdate: { ...scriptedState, targetId, remaining, active: remaining > 0 },
    };
  }
  return { decision: chooseLoadPoint(ENTRY_POINT.position, queueCounts), scriptedUpdate: null };
}

function makeEvent(truck, decision, now) {
  eventIdCounter += 1;
  return {
    id: eventIdCounter,
    ts: now,
    truckNumber: truck.number,
    fromLabel: ENTRY_POINT.name,
    toLoadPointId: decision.targetLoadPointId,
    reason: decision.reason,
  };
}

function toSessionRecord(truck) {
  return {
    truckNumber: truck.number,
    totalDistanceM: truck.distanceThisShift,
    totalFuelConsumed: truck.fuelConsumedThisShift,
    normLPerHour: truck.fuelBurnRatePerHour,
    deviationPercent: deviationPercent(truck),
    status: 'завершила смену',
  };
}

// Продвигает уже нацеленную машину по автомату — БЕСКОНЕЧНЫЙ цикл:
// TO_LOAD -> LOADING -> EXITING -> UNLOADING -> RETURNING -> ENTERING
// (снова, диспетчер выбирает новую точку). Возвращает { truck, sessionRecord }:
// sessionRecord не null только когда на этом переходе закрывается смена
// (каждый LAPS_PER_SHIFT завершённый рейс) — см. кейс UNLOADING.
function advanceTargetedTruck(truck, now) {
  switch (truck.phase) {
    case 'TO_LOAD':
      return {
        truck: {
          ...truck,
          phase: 'LOADING',
          position: truck.path[truck.path.length - 1],
          phaseStartedAt: now,
          phaseDurationMs: loadingDurationForSeed(randomInRange(LOADING_DURATION_RANGE), truck.seededAnomaly),
          phaseAccountedMs: 0,
        },
        sessionRecord: null,
      };
    case 'LOADING': {
      const target = loadPointById(truck.targetLoadPointId);
      const path = pathTo(target.position, BELT_POINT.position);
      return {
        truck: {
          ...truck,
          phase: 'EXITING',
          path,
          position: path[0],
          phaseStartedAt: now,
          phaseDurationMs: randomInRange(TRAVEL_DURATION_RANGE),
          phaseAccountedMs: 0,
        },
        sessionRecord: null,
      };
    }
    case 'EXITING':
      return {
        truck: {
          ...truck,
          phase: 'UNLOADING',
          position: truck.path[truck.path.length - 1],
          phaseStartedAt: now,
          phaseDurationMs: randomInRange(UNLOADING_DURATION_RANGE),
          phaseAccountedMs: 0,
        },
        sessionRecord: null,
      };
    case 'UNLOADING': {
      const path = pathTo(BELT_POINT.position, ENTRY_POINT.position);
      const lapsCompletedThisShift = truck.lapsCompletedThisShift + 1;
      const shiftComplete = lapsCompletedThisShift % LAPS_PER_SHIFT === 0;
      // sessionRecord считается ДО сброса счётчиков — фиксирует цифры за
      // только что завершённую смену (5 рейсов), не разовую поездку.
      const sessionRecord = shiftComplete ? toSessionRecord({ ...truck, lapsCompletedThisShift }) : null;
      return {
        truck: {
          ...truck,
          phase: 'RETURNING',
          path,
          position: path[0],
          phaseStartedAt: now,
          phaseDurationMs: randomInRange(TRAVEL_DURATION_RANGE),
          phaseAccountedMs: 0,
          lapsCompletedThisShift,
          // Пересменка: цифры зафиксированы в sessionRecord выше, счётчики
          // обнуляются, бак дозаправляется (имитация заправки при смене) —
          // машина при этом не останавливается и не покидает сцену.
          ...(shiftComplete
            ? { distanceThisShift: 0, fuelConsumedThisShift: 0, movingMs: 0, fuelLevel: FUEL_TANK_CAPACITY_L }
            : {}),
        },
        sessionRecord,
      };
    }
    case 'RETURNING':
      return {
        truck: {
          ...truck,
          phase: 'ENTERING',
          targetLoadPointId: null,
          position: truck.path[truck.path.length - 1],
          phaseStartedAt: now,
          phaseDurationMs: ENTERING_DURATION_MS,
          phaseAccountedMs: 0,
        },
        sessionRecord: null,
      };
    default:
      return { truck, sessionRecord: null };
  }
}

// Один тик симулятора: продвигает все машины (назначая цель машинам,
// освободившимся на въезде, через диспетчерский алгоритм), логирует
// решения в события и записи о завершённых сменах в sessionLog. Бесконечный
// цикл — ни одна машина никогда не покидает trucks, парк фиксирован
// (FLEET_SIZE), спавна/деспавна нет.
export function simulationTick(state, now) {
  let queueCounts = getQueueCounts(state.trucks);
  let scripted = state.scripted;
  const newEvents = [];
  const newSessionRecords = [];

  const advanced = [];
  for (const rawTruck of state.trucks) {
    let truck = accrueFuelAndDistance(rawTruck, now);
    const anomaly = detectAnomaly(truck, LOADING_DURATION_RANGE[1]);
    truck = { ...truck, anomalyType: anomaly.anomalyType, anomalyRecommendation: anomaly.anomalyRecommendation };

    const elapsed = now - truck.phaseStartedAt;
    if (elapsed < truck.phaseDurationMs) {
      advanced.push(truck);
      continue;
    }

    if (truck.phase === 'ENTERING') {
      const { decision, scriptedUpdate } = decideTarget(queueCounts, now, scripted);
      if (scriptedUpdate) scripted = scriptedUpdate;
      queueCounts = {
        ...queueCounts,
        [decision.targetLoadPointId]: (queueCounts[decision.targetLoadPointId] || 0) + 1,
      };
      newEvents.push(makeEvent(truck, decision, now));
      const target = loadPointById(decision.targetLoadPointId);
      const path = pathTo(ENTRY_POINT.position, target.position);
      advanced.push({
        ...truck,
        phase: 'TO_LOAD',
        path,
        position: path[0],
        targetLoadPointId: decision.targetLoadPointId,
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(TRAVEL_DURATION_RANGE),
        phaseAccountedMs: 0,
      });
      continue;
    }

    const { truck: targeted, sessionRecord } = advanceTargetedTruck(truck, now);
    if (sessionRecord) newSessionRecords.push(sessionRecord);
    advanced.push(targeted);
  }

  const events = newEvents.length > 0 ? [...newEvents, ...state.events].slice(0, MAX_EVENTS) : state.events;
  const sessionLog = newSessionRecords.length > 0 ? [...state.sessionLog, ...newSessionRecords] : state.sessionLog;

  return { trucks: advanced, events, scripted, sessionLog };
}

function initialScriptedState(now, mode) {
  if (mode !== 'scripted') return { active: false, remaining: 0, targetId: null, triggerAt: 0 };
  return {
    active: true,
    remaining: SCRIPTED_CONGESTION_TRUCKS,
    targetId: null,
    triggerAt: now + SCRIPTED_CONGESTION_DELAY_MS,
  };
}

// Живой Zustand-стор: тонкая обёртка над чистыми функциями выше,
// владеющая единственным setInterval на всю симуляцию.
export const useSimulationStore = create((set, get) => ({
  trucks: [],
  intervalId: null,
  events: [],
  sessionLog: [],
  mode: 'random',
  scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
  fleetNormLPerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,

  startSimulation() {
    if (get().intervalId) return;
    const now = performance.now();
    const norm = get().fleetNormLPerHour;
    const initial = [];
    for (let i = 0; i < FLEET_SIZE; i++) {
      initial.push(createTruck(now - i * 400, norm));
    }
    const id = setInterval(() => {
      set((state) => simulationTick(state, performance.now()));
    }, TICK_INTERVAL_MS);
    set({
      trucks: initial,
      intervalId: id,
      scripted: initialScriptedState(now, get().mode),
    });
  },

  stopSimulation() {
    const id = get().intervalId;
    if (id) clearInterval(id);
    set({ intervalId: null });
  },

  setMode(mode) {
    set({ mode, scripted: initialScriptedState(performance.now(), mode) });
  },

  // Разовый RAG-запрос нормы расхода при загрузке страницы (ТЗ, раздел
  // "Топливо"): не блокирует старт симуляции, при недоступности AnythingLLM
  // или нераспознаваемом ответе — тихо остаётся на fleetNormLPerHour, с
  // которым стор уже стартовал (FALLBACK_FUEL_NORM_L_PER_HOUR).
  async fetchFleetNorm() {
    const slug = resolveWorkspaceSlug(WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG);
    const result = await chatWithWorkspace(slug, FUEL_NORM_RAG_PROMPT);
    if (!result.ok) return;
    const parsed = parseFuelNormLPerHour(result.text);
    if (parsed) set({ fleetNormLPerHour: parsed });
  },
}));
