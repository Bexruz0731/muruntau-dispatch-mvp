import { create } from 'zustand';
import { ENTRY_POINT, EXIT_POINT, LOAD_POINTS, groundPosition, buildRoutePoints } from './constants';
import { chooseLoadPoint } from './dispatch';

export const TRUCK_HEIGHT_OFFSET = 0.9; // совпадает с зазором машины над землёй в Truck.jsx
export const MIN_ACTIVE_TRUCKS = 6;
export const MAX_ACTIVE_TRUCKS = 10;
export const TICK_INTERVAL_MS = 1500; // TODO: заменить на реальные данные трекеров в проде
export const LOADING_DURATION_RANGE = [5000, 8000];
export const TRAVEL_DURATION_RANGE = [6000, 10000];
export const SPAWN_PAUSE_RANGE = [1000, 4000];
export const ENTERING_DURATION_MS = 600;
export const MAX_EVENTS = 30;
export const SCRIPTED_CONGESTION_DELAY_MS = 12000; // "гарантированно на 10-15 секунде" (ТЗ)
export const SCRIPTED_CONGESTION_TRUCKS = 3;

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

// Новая машина появляется на въезде БЕЗ цели — её назначит диспетчерский
// алгоритм при переходе ENTERING -> TO_LOAD (см. decideTarget), когда уже
// известна актуальная загрузка точек.
export function createTruck(now) {
  idCounter += 1;
  numberCounter += 1;
  const entryGround = groundPosition(ENTRY_POINT.position);
  return {
    id: idCounter,
    number: String(10 + (numberCounter % 90)).padStart(2, '0'),
    phase: 'ENTERING',
    targetLoadPointId: null,
    position: entryGround,
    path: [entryGround, entryGround],
    phaseStartedAt: now,
    phaseDurationMs: ENTERING_DURATION_MS,
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

// Продвигает уже нацеленную машину (TO_LOAD/LOADING/EXITING) по автомату —
// используется для всех фаз, кроме ENTERING, где ещё нужно выбрать цель.
function advanceTargetedTruck(truck, now) {
  switch (truck.phase) {
    case 'TO_LOAD':
      return {
        ...truck,
        phase: 'LOADING',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(LOADING_DURATION_RANGE),
      };
    case 'LOADING': {
      const target = loadPointById(truck.targetLoadPointId);
      const path = pathTo(target.position, EXIT_POINT.position);
      return {
        ...truck,
        phase: 'EXITING',
        path,
        position: path[0],
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(TRAVEL_DURATION_RANGE),
      };
    }
    case 'EXITING':
      return {
        ...truck,
        phase: 'DONE',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: 0,
      };
    default:
      return truck;
  }
}

// Один тик симулятора: продвигает все машины (назначая цель машинам,
// освободившимся на въезде, через диспетчерский алгоритм), убирает
// завершившие маршрут (DONE), логирует решения в события и при
// необходимости добавляет новую машину, поддерживая активных в диапазоне
// [MIN_ACTIVE_TRUCKS, MAX_ACTIVE_TRUCKS].
export function simulationTick(state, now) {
  let queueCounts = getQueueCounts(state.trucks);
  let scripted = state.scripted;
  const newEvents = [];

  const advanced = [];
  for (const truck of state.trucks) {
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
      });
      continue;
    }

    advanced.push(advanceTargetedTruck(truck, now));
  }

  const trucks = advanced.filter((t) => t.phase !== 'DONE');
  let nextSpawnAt = state.nextSpawnAt;
  const shouldSpawn = trucks.length < MIN_ACTIVE_TRUCKS
    || (trucks.length < MAX_ACTIVE_TRUCKS && now >= nextSpawnAt);
  if (shouldSpawn) {
    trucks.push(createTruck(now));
    nextSpawnAt = now + randomInRange(SPAWN_PAUSE_RANGE);
  }

  const events = newEvents.length > 0 ? [...newEvents, ...state.events].slice(0, MAX_EVENTS) : state.events;

  return { trucks, nextSpawnAt, events, scripted };
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
  nextSpawnAt: 0,
  intervalId: null,
  events: [],
  mode: 'random',
  scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },

  startSimulation() {
    if (get().intervalId) return;
    const now = performance.now();
    const initial = [];
    for (let i = 0; i < MIN_ACTIVE_TRUCKS; i++) {
      initial.push(createTruck(now - i * 400));
    }
    const id = setInterval(() => {
      set((state) => simulationTick(state, performance.now()));
    }, TICK_INTERVAL_MS);
    set({
      trucks: initial,
      nextSpawnAt: now + randomInRange(SPAWN_PAUSE_RANGE),
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
}));
