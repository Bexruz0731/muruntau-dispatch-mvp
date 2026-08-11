import { create } from 'zustand';
import { ENTRY_POINT, EXIT_POINT, LOAD_POINTS, groundPosition, buildRoutePoints } from './constants';

export const TRUCK_HEIGHT_OFFSET = 0.9; // совпадает с зазором машины над землёй в Truck.jsx
export const MIN_ACTIVE_TRUCKS = 6;
export const MAX_ACTIVE_TRUCKS = 10;
export const TICK_INTERVAL_MS = 1500; // TODO: заменить на реальные данные трекеров в проде
export const LOADING_DURATION_RANGE = [5000, 8000];
export const TRAVEL_DURATION_RANGE = [6000, 10000];
export const SPAWN_PAUSE_RANGE = [1000, 4000];
export const ENTERING_DURATION_MS = 600;

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

// Случайный выбор точки погрузки — временно, до этапа 3 (диспетчерский
// алгоритм по загрузке точек). Изолирован в одну функцию специально, чтобы
// в следующем плане её было легко заменить, не трогая остальной автомат.
function pickTargetLoadPoint() {
  return LOAD_POINTS[Math.floor(Math.random() * LOAD_POINTS.length)];
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

// Сбрасывает счётчики id/номеров машин — нужно только в тестах, чтобы
// каждый тест начинался с чистого состояния.
export function resetCounters() {
  idCounter = 0;
  numberCounter = 0;
}

// Новая машина появляется на въезде уже с целью — случайной точкой
// погрузки (см. pickTargetLoadPoint). Фаза ENTERING длится один короткий
// тик, за это время путь ей не нужен (position фиксирован на въезде).
export function createTruck(now) {
  idCounter += 1;
  numberCounter += 1;
  const target = pickTargetLoadPoint();
  const entryGround = groundPosition(ENTRY_POINT.position);
  return {
    id: idCounter,
    number: String(10 + (numberCounter % 90)).padStart(2, '0'),
    phase: 'ENTERING',
    targetLoadPointId: target.id,
    position: entryGround,
    path: [entryGround, entryGround],
    phaseStartedAt: now,
    phaseDurationMs: ENTERING_DURATION_MS,
  };
}

// Продвигает одну машину по конечному автомату фаз, если время текущей
// фазы истекло; иначе возвращает тот же объект без изменений. Чистая
// функция — не знает о Zustand и не читает реальные часы сама.
export function advanceTruck(truck, now) {
  const elapsed = now - truck.phaseStartedAt;
  if (elapsed < truck.phaseDurationMs) return truck;

  switch (truck.phase) {
    case 'ENTERING': {
      const target = loadPointById(truck.targetLoadPointId);
      const path = pathTo(ENTRY_POINT.position, target.position);
      return {
        ...truck,
        phase: 'TO_LOAD',
        path,
        position: path[0],
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(TRAVEL_DURATION_RANGE),
      };
    }
    case 'TO_LOAD': {
      return {
        ...truck,
        phase: 'LOADING',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(LOADING_DURATION_RANGE),
      };
    }
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
    case 'EXITING': {
      return {
        ...truck,
        phase: 'DONE',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: 0,
      };
    }
    default:
      return truck;
  }
}

// Один тик симулятора: продвигает все машины, убирает завершившие маршрут
// (DONE), и при необходимости добавляет новую — поддерживая количество
// активных машин в диапазоне [MIN_ACTIVE_TRUCKS, MAX_ACTIVE_TRUCKS] с
// небольшой случайной паузой между новыми машинами (не строго по одной за
// тик, а с разбросом — см. design spec "новая машина... через небольшую
// случайную паузу").
export function simulationTick(state, now) {
  const trucks = state.trucks.map((t) => advanceTruck(t, now)).filter((t) => t.phase !== 'DONE');
  let nextSpawnAt = state.nextSpawnAt;

  const shouldSpawn = trucks.length < MIN_ACTIVE_TRUCKS
    || (trucks.length < MAX_ACTIVE_TRUCKS && now >= nextSpawnAt);

  if (shouldSpawn) {
    trucks.push(createTruck(now));
    nextSpawnAt = now + randomInRange(SPAWN_PAUSE_RANGE);
  }

  return { trucks, nextSpawnAt };
}

// Живой Zustand-стор: тонкая обёртка над чистыми функциями выше,
// владеющая единственным setInterval на всю симуляцию.
export const useSimulationStore = create((set, get) => ({
  trucks: [],
  nextSpawnAt: 0,
  intervalId: null,

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
    set({ trucks: initial, nextSpawnAt: now + randomInRange(SPAWN_PAUSE_RANGE), intervalId: id });
  },

  stopSimulation() {
    const id = get().intervalId;
    if (id) clearInterval(id);
    set({ intervalId: null });
  },
}));
