# Мурунтау MVP — Этап 3: диспетчеризация, очереди, панель Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить случайный выбор точки погрузки настоящим диспетчерским алгоритмом (обычный код, без LLM), добавить цветовую индикацию загрузки точек, заскриптованный сценарий с гарантированным затором для демонстрации, и панель диспетчера сбоку от сцены с списком машин, точек и лентой событий.

**Architecture:** Алгоритм диспетчеризации — чистая функция `chooseLoadPoint(fromXZ, queueCounts)` в новом модуле `src/simulation/dispatch.js`, не знающая ни о Zustand, ни о времени. Стор (`src/simulation/store.js`) вызывает её в момент, когда машина освобождается на въезде (переход `ENTERING -> TO_LOAD`), передавая актуальные очереди, посчитанные из текущего списка машин; каждое решение — и алгоритма, и заскриптованного сценария — пишется в массив `events`. Заскриптованный сценарий — тот же путь принятия решения, но с одной проверкой раньше: если он активен и подошло его время, решение подменяется на принудительное (та же точка N раз подряд), после чего сценарий "истощается" и алгоритм снова работает как обычно — что и создаёт наглядный "затор → машина видит перегрузку → уходит в другую точку".

**Tech Stack:** Без новых зависимостей — та же связка Zustand + Vitest, что и в этапе 2.

## Global Constraints

- Алгоритм диспетчеризации — обычный код, БЕЗ обращения к LLM (ТЗ, раздел 4). LLM появится только в этапе 6 (кнопка "Объяснить решение").
- Правило алгоритма (дословно из ТЗ): расстояние до каждой точки → исключить точки с очередью ≥2 машин → ближайшая среди оставшихся → если все перегружены — с минимальной очередью.
- Каждое решение логируется в массив событий (машина, откуда, куда, почему) — ТЗ, раздел 4 и design spec (`DispatchEvent { id, ts, truckNumber, fromLabel, toLoadPointId, reason }`).
- Два режима: случайный (по умолчанию) и заскриптованный сценарий с гарантированным затором на 10-15 секунде работы (2-3 машины подряд в одну точку), переключатель — в UI.
- Точка с очередью подсвечивается красным/жёлтым в зависимости от загрузки — и в 3D-сцене (маркер), и в панели.
- Кнопка "Объяснить решение" в панели — **не в этом плане**, она приходит в этапе 6 вместе с интеграцией AnythingLLM (design spec, "Поэтапная сборка", п.6).
- Область этого плана — только этап 3 из дизайн-спеки. Топливо, аномалии, LLM — отдельные планы после ревью этого результата.

---

## Task 1: Алгоритм диспетчеризации — чистая функция выбора точки

**Files:**
- Create: `src/simulation/dispatch.js`
- Test: `src/simulation/dispatch.test.js`

**Interfaces:**
- Consumes: `LOAD_POINTS` из `src/simulation/constants.js`.
- Produces: `chooseLoadPoint(fromXZ: [number, number], queueCounts: Record<string, number>): { targetLoadPointId: string, reason: string }`, `statusColorForQueue(queue: number): string`, `OVERLOAD_THRESHOLD: number` — именованные экспорты из `src/simulation/dispatch.js`.

- [ ] **Step 1: Написать падающие тесты**

```js
// src/simulation/dispatch.test.js
import { describe, it, expect } from 'vitest';
import { chooseLoadPoint, statusColorForQueue, OVERLOAD_THRESHOLD } from './dispatch';
import { LOAD_POINTS, ENTRY_POINT } from './constants';

function distanceTo(lp) {
  return Math.hypot(
    lp.position[0] - ENTRY_POINT.position[0],
    lp.position[1] - ENTRY_POINT.position[1],
  );
}

describe('chooseLoadPoint', () => {
  it('выбирает ближайшую точку, когда очередей нет', () => {
    const { targetLoadPointId } = chooseLoadPoint(ENTRY_POINT.position, {});
    const nearest = [...LOAD_POINTS].sort((a, b) => distanceTo(a) - distanceTo(b))[0];
    expect(targetLoadPointId).toBe(nearest.id);
  });

  it('исключает перегруженные точки (очередь >= порога) в пользу следующей ближайшей', () => {
    const sorted = [...LOAD_POINTS].sort((a, b) => distanceTo(a) - distanceTo(b));
    const nearestId = sorted[0].id;
    const queueCounts = { [nearestId]: OVERLOAD_THRESHOLD };
    const { targetLoadPointId, reason } = chooseLoadPoint(ENTRY_POINT.position, queueCounts);
    expect(targetLoadPointId).not.toBe(nearestId);
    expect(reason).toContain(LOAD_POINTS.find((lp) => lp.id === targetLoadPointId).name);
  });

  it('если все точки перегружены — выбирает точку с минимальной очередью', () => {
    const queueCounts = {};
    LOAD_POINTS.forEach((lp, i) => {
      queueCounts[lp.id] = OVERLOAD_THRESHOLD + (i === 0 ? 0 : 5);
    });
    const { targetLoadPointId, reason } = chooseLoadPoint(ENTRY_POINT.position, queueCounts);
    expect(targetLoadPointId).toBe(LOAD_POINTS[0].id);
    expect(reason).toContain('перегруж');
  });
});

describe('statusColorForQueue', () => {
  it('зелёный при свободной очереди, жёлтый на пороге, красный при перегрузке', () => {
    expect(statusColorForQueue(0)).toBe('#22c55e');
    expect(statusColorForQueue(OVERLOAD_THRESHOLD - 1)).toBe('#22c55e');
    expect(statusColorForQueue(OVERLOAD_THRESHOLD)).toBe('#eab308');
    expect(statusColorForQueue(OVERLOAD_THRESHOLD + 1)).toBe('#ef4444');
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/dispatch.test.js
```

Expected: FAIL — `Cannot find module './dispatch'`.

- [ ] **Step 3: Реализовать `dispatch.js`**

```js
// src/simulation/dispatch.js
import { LOAD_POINTS } from './constants';

// Очередь >= этого числа считается перегруженной ("занято") — ТЗ, раздел 4.
export const OVERLOAD_THRESHOLD = 2;

function distance([x1, z1], [x2, z2]) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Обычный код, без LLM (ТЗ, раздел 4): для машины, готовой ехать от `fromXZ`,
// выбирает точку погрузки — ближайшую среди незагруженных
// (очередь < OVERLOAD_THRESHOLD); если все перегружены — с минимальной
// очередью (при равенстве — ближайшую из них). Возвращает решение и
// человекочитаемую причину для ленты событий.
export function chooseLoadPoint(fromXZ, queueCounts) {
  const candidates = LOAD_POINTS.map((lp) => ({
    lp,
    distance: distance(fromXZ, lp.position),
    queue: queueCounts[lp.id] || 0,
  }));

  const free = candidates.filter((c) => c.queue < OVERLOAD_THRESHOLD);
  const pool = free.length > 0 ? free : candidates;
  const compare = free.length > 0
    ? (a, b) => a.distance - b.distance
    : (a, b) => (a.queue - b.queue) || (a.distance - b.distance);
  const best = [...pool].sort(compare)[0];

  const reason = free.length > 0
    ? `${best.lp.name} — ближайшая свободная точка (${Math.round(best.distance)} м, очередь ${best.queue})`
    : `все точки перегружены (очередь ≥ ${OVERLOAD_THRESHOLD}), выбрана ${best.lp.name} с минимальной очередью (${best.queue})`;

  return { targetLoadPointId: best.lp.id, reason };
}

// Цвет индикатора загрузки точки: зелёный — свободна, жёлтый — на грани
// (очередь == OVERLOAD_THRESHOLD), красный — перегружена.
export function statusColorForQueue(queue) {
  if (queue >= OVERLOAD_THRESHOLD + 1) return '#ef4444';
  if (queue >= OVERLOAD_THRESHOLD) return '#eab308';
  return '#22c55e';
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/dispatch.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/dispatch.js src/simulation/dispatch.test.js
git commit -m "feat: add dispatch algorithm as a pure, LLM-free function"
```

---

## Task 2: Интеграция алгоритма в стор — очереди и лента событий

**Files:**
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js`

**Interfaces:**
- Consumes: `chooseLoadPoint` из `src/simulation/dispatch.js` (Task 1).
- Produces (новое/изменённое в `store.js`): `getQueueCounts(trucks: Truck[]): Record<string, number>`, `MAX_EVENTS: number`. `createTruck(now)` теперь создаёт машину с `targetLoadPointId: null` (цель назначается при выходе из ENTERING, не при спавне). Состояние стора получает поле `events: DispatchEvent[]`.

- [ ] **Step 1: Написать падающие тесты (добавить в `store.test.js`)**

Заменить существующий тест `'проходит весь цикл ENTERING -> TO_LOAD -> LOADING -> EXITING -> DONE'` (он вызывал одиночный `advanceTruck`, который в этом таске перестаёт существовать как отдельный экспорт для ENTERING — выбор цели теперь требует контекста очередей и живёт в `simulationTick`) на:

```js
// заменить импорт в начале файла:
import {
  createTruck,
  simulationTick,
  resetCounters,
  getQueueCounts,
  MAX_ACTIVE_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';
```

```js
// заменить блок describe('advanceTruck', ...) целиком на:
describe('createTruck', () => {
  it('создаёт машину в фазе ENTERING БЕЗ цели — её назначит диспетчер', () => {
    const truck = createTruck(1000);
    expect(truck.phase).toBe('ENTERING');
    expect(truck.targetLoadPointId).toBeNull();
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
```

Оставить без изменений блоки `describe('simulationTick', ...)` с тестами "никогда не превышает MAX_ACTIVE_TRUCKS..." и "убирает машины, завершившие маршрут (DONE)" — но передавать в них состояние с добавленными полями `events: []` и `scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 }`, иначе `simulationTick` из этого таска обратится к `state.events`/`state.scripted` и упадёт на `undefined`. Обновить их так:

```js
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
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — `getQueueCounts is not a function` (и/или несостыковки по `targetLoadPointId`/`events`).

- [ ] **Step 3: Переписать `store.js`**

Полностью заменить содержимое `src/simulation/store.js`:

```js
// src/simulation/store.js
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

// Решает, куда направить освободившуюся машину. В этом таске — всегда
// через обычный диспетчерский алгоритм; заскриптованный сценарий
// добавляется в Task 3 как проверка перед этим вызовом.
function decideTarget(queueCounts) {
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

// Живой Zustand-стор: тонкая обёртка над чистыми функциями выше,
// владеющая единственным setInterval на всю симуляцию.
export const useSimulationStore = create((set, get) => ({
  trucks: [],
  nextSpawnAt: 0,
  intervalId: null,
  events: [],
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
    set({ trucks: initial, nextSpawnAt: now + randomInRange(SPAWN_PAUSE_RANGE), intervalId: id });
  },

  stopSimulation() {
    const id = get().intervalId;
    if (id) clearInterval(id);
    set({ intervalId: null });
  },
}));
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/store.js src/simulation/store.test.js
git commit -m "feat: dispatch new trucks with the real algorithm and log events"
```

---

## Task 3: Заскриптованный сценарий с гарантированным затором

**Files:**
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js`

**Interfaces:**
- Produces (добавляется в `store.js`): `SCRIPTED_CONGESTION_DELAY_MS`, `SCRIPTED_CONGESTION_TRUCKS` — константы; `useSimulationStore` получает поля `mode: 'random' | 'scripted'` и метод `setMode(mode): void`.

- [ ] **Step 1: Написать падающий тест**

Добавить в `src/simulation/store.test.js`:

```js
// добавить в импорт из './store':
import {
  createTruck,
  simulationTick,
  resetCounters,
  getQueueCounts,
  MAX_ACTIVE_TRUCKS,
  SCRIPTED_CONGESTION_TRUCKS,
} from './store';
```

```js
describe('заскриптованный сценарий с затором', () => {
  it('направляет SCRIPTED_CONGESTION_TRUCKS машин подряд в одну точку, затем сценарий исчерпывается и алгоритм возвращается к обычной логике', () => {
    let state = {
      trucks: [],
      nextSpawnAt: 1e9,
      events: [],
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — `SCRIPTED_CONGESTION_TRUCKS is not exported` (сценарий ещё не реализован; поле `scripted` из Task 2 игнорируется).

- [ ] **Step 3: Добавить сценарий в `store.js`**

Добавить константы сразу после `MAX_EVENTS`:

```js
export const SCRIPTED_CONGESTION_DELAY_MS = 12000; // "гарантированно на 10-15 секунде" (ТЗ)
export const SCRIPTED_CONGESTION_TRUCKS = 3;
```

Заменить функцию `decideTarget` на версию, учитывающую сценарий:

```js
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
```

Заменить строку вызова в `simulationTick` (внутри блока `if (truck.phase === 'ENTERING')`) с `decideTarget(queueCounts)` на `decideTarget(queueCounts, now, scripted)` — она уже вызывается с тремя аргументами в коде из Task 2, менять нечего, просто убедиться, что сигнатура функции выше теперь их использует.

Добавить в конец файла (перед `useSimulationStore`) вспомогательную функцию:

```js
function initialScriptedState(now, mode) {
  if (mode !== 'scripted') return { active: false, remaining: 0, targetId: null, triggerAt: 0 };
  return {
    active: true,
    remaining: SCRIPTED_CONGESTION_TRUCKS,
    targetId: null,
    triggerAt: now + SCRIPTED_CONGESTION_DELAY_MS,
  };
}
```

Обновить `useSimulationStore`: добавить поле `mode: 'random'`, метод `setMode`, и инициализировать `scripted` через `initialScriptedState` в `startSimulation`:

```js
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
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/store.js src/simulation/store.test.js
git commit -m "feat: add scripted congestion scenario and mode switch"
```

---

## Task 4: Панель диспетчера и цветовая индикация точек

**Files:**
- Create: `src/components/DispatcherPanel.jsx`
- Modify: `src/components/scene/LoadPointMarker.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `statusColorForQueue` из `src/simulation/dispatch.js` (Task 1); `getQueueCounts`, `useSimulationStore` (поля `trucks`, `events`, `mode`, метод `setMode`) из `src/simulation/store.js` (Task 2-3).
- Produces: `DispatcherPanel` — default export из `src/components/DispatcherPanel.jsx`, пропсы `{ trucks, loadPoints, events, mode, onModeChange }`, где `loadPoints` — массив `LOAD_POINTS`, дополненный полем `queueCount`. `LoadPointMarker` (изменён) — принимает тот же пропс `queueCount`, что и раньше, но теперь красит кольцо у основания по `statusColorForQueue(queueCount)` вместо постоянного цвета точки.

- [ ] **Step 1: Добавить цветовую индикацию очереди в `LoadPointMarker.jsx`**

```jsx
// src/components/scene/LoadPointMarker.jsx
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { groundPosition } from '../../simulation/constants';
import { statusColorForQueue } from '../../simulation/dispatch';

const POLE_HEIGHT = 4.2;
const CAP_SIZE = 0.55;

export default function LoadPointMarker({ name, position, color, queueCount = 0 }) {
  const [x, y, z] = groundPosition(position);
  const ringColor = statusColorForQueue(queueCount);

  return (
    <group position={[x, y, z]}>
      {/* landing pad ring — цвет отражает загрузку точки (зелёный/жёлтый/красный) */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.8, 32]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* thin pole */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, POLE_HEIGHT, 8]} />
        <meshStandardMaterial color="#8fa3c0" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* vertical beacon beam */}
      <mesh position={[0, POLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.16, 0.16, POLE_HEIGHT, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* beacon cap — цвет identity точки, не меняется от загрузки */}
      <mesh position={[0, POLE_HEIGHT, 0]}>
        <octahedronGeometry args={[CAP_SIZE, 0]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} roughness={0.3} />
      </mesh>

      <Html position={[0, POLE_HEIGHT + CAP_SIZE + 0.6, 0]} center>
        <div className="px-2 py-0.5 rounded bg-black/70 text-white text-xs whitespace-nowrap">
          {name} ({queueCount})
        </div>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Написать `DispatcherPanel.jsx`**

```jsx
// src/components/DispatcherPanel.jsx
import { statusColorForQueue } from '../simulation/dispatch';

const PHASE_LABELS = {
  ENTERING: 'на въезде',
  TO_LOAD: 'едет к точке',
  LOADING: 'грузится',
  EXITING: 'выезжает',
};

export default function DispatcherPanel({ trucks, loadPoints, events, mode, onModeChange }) {
  return (
    <aside className="w-80 shrink-0 bg-slate-950 text-slate-200 border-l border-slate-800 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-slate-800">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Режим симулятора</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onModeChange('random')}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
              mode === 'random' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Случайный
          </button>
          <button
            type="button"
            onClick={() => onModeChange('scripted')}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
              mode === 'scripted' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Сценарий с затором
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-slate-800 overflow-y-auto max-h-48">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Машины ({trucks.length})</div>
        <ul className="space-y-1 text-xs">
          {trucks.map((t) => (
            <li key={t.id} className="flex justify-between text-slate-300">
              <span>№{t.number}</span>
              <span className="text-slate-400">{PHASE_LABELS[t.phase] ?? t.phase}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-3 border-b border-slate-800">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Точки погрузки</div>
        <ul className="space-y-1 text-xs">
          {loadPoints.map((lp) => (
            <li key={lp.id} className="flex items-center justify-between">
              <span className="text-slate-300">{lp.name}</span>
              <span
                className="px-1.5 py-0.5 rounded font-mono min-w-[1.5rem] text-center"
                style={{ backgroundColor: statusColorForQueue(lp.queueCount), color: '#0a0f1a' }}
              >
                {lp.queueCount}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="p-3 flex-1 overflow-y-auto min-h-0">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Лента событий</div>
        <ul className="space-y-2 text-xs">
          {events.map((e) => (
            <li key={e.id} className="text-slate-300 border-l-2 border-slate-700 pl-2">
              <div className="font-medium">№{e.truckNumber}: {e.fromLabel} → точка погрузки</div>
              <div className="text-slate-400">{e.reason}</div>
            </li>
          ))}
          {events.length === 0 && <li className="text-slate-500">Пока нет решений диспетчера</li>}
        </ul>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Подключить панель в `MapPage.jsx`**

```jsx
// src/pages/MapPage.jsx
import { useEffect } from 'react';
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Truck from '../components/scene/Truck';
import RouteTube from '../components/scene/RouteTube';
import DispatcherPanel from '../components/DispatcherPanel';
import { LOAD_POINTS } from '../simulation/constants';
import { useSimulationStore, getQueueCounts } from '../simulation/store';

const MOVING_PHASES = new Set(['TO_LOAD', 'EXITING']);

export default function MapPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const events = useSimulationStore((s) => s.events);
  const mode = useSimulationStore((s) => s.mode);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const stopSimulation = useSimulationStore((s) => s.stopSimulation);
  const setMode = useSimulationStore((s) => s.setMode);

  useEffect(() => {
    startSimulation();
    return () => stopSimulation();
  }, [startSimulation, stopSimulation]);

  const queueCounts = getQueueCounts(trucks);
  const loadPointsWithQueue = LOAD_POINTS.map((lp) => ({ ...lp, queueCount: queueCounts[lp.id] || 0 }));

  return (
    <div className="w-full h-[calc(100vh-4rem)] flex">
      <div className="flex-1 min-w-0">
        <CareerScene>
          <PitTerrain />
          {loadPointsWithQueue.map((lp) => (
            <LoadPointMarker
              key={lp.id}
              name={lp.name}
              position={lp.position}
              color={lp.color}
              queueCount={lp.queueCount}
            />
          ))}
          {trucks
            .filter((t) => MOVING_PHASES.has(t.phase))
            .map((truck) => (
              <RouteTube key={`route-${truck.id}-${truck.phase}`} path={truck.path} />
            ))}
          {trucks.map((truck) => (
            <Truck key={truck.id} truck={truck} />
          ))}
        </CareerScene>
      </div>
      <DispatcherPanel
        trucks={trucks}
        loadPoints={loadPointsWithQueue}
        events={events}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}
```

- [ ] **Step 4: Проверить сборку и тесты**

```bash
npm run build
npx vitest run
```

Expected: оба успешны.

- [ ] **Step 5: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается: справа тёмная панель с переключателем режима, списком машин со статусами, списком точек погрузки с цветными счётчиками очереди, лентой событий (новые сверху). В 3D-сцене кольца у основания маячков должны быть зелёными при малой очереди. Переключить на "Сценарий с затором", подождать 12 секунд — 3 события подряд должны вести в одну и ту же точку (в панели и в ленте событий видна фраза "заскриптованный сценарий"), её кольцо должно стать жёлтым/красным; следующее решение — уже в другую точку. Проверить консоль браузера на ошибки.

- [ ] **Step 6: Commit**

```bash
git add src/components/DispatcherPanel.jsx src/components/scene/LoadPointMarker.jsx src/pages/MapPage.jsx
git commit -m "feat: add dispatcher panel and queue-based marker colouring"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 3)**: алгоритм по правилу "расстояние → исключить перегруженные → ближайшая → иначе минимальная очередь" — Task 1 (`chooseLoadPoint`), проверено тремя тестами на каждую ветку. Логирование решений (машина/откуда/куда/почему) — Task 2 (`makeEvent`, `DispatchEvent`-подобная форма с `fromLabel`/`toLoadPointId`/`reason`). Два режима с переключателем в UI — Task 3 (`mode`, `setMode`) + Task 4 (кнопки в панели). Заскриптованный сценарий с гарантированным затором 2-3 машины подряд на 10-15 секунде — Task 3 (`SCRIPTED_CONGESTION_DELAY_MS=12000`, `SCRIPTED_CONGESTION_TRUCKS=3`), визуально заметен через цвет кольца — Task 4. Панель диспетчера (машины/точки/лента событий) — Task 4. Кнопка "Объяснить решение" сознательно не входит — это этап 6 по дизайн-спеке.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `chooseLoadPoint(fromXZ, queueCounts)` и `statusColorForQueue(queue)` определены в Task 1, используются с теми же именами в Task 2 (`decideTarget`) и Task 4 (`LoadPointMarker`, `DispatcherPanel`). `getQueueCounts(trucks)` определена в Task 2, используется в Task 4 (`MapPage.jsx`). Поля `events`/`scripted`/`mode` стора вводятся в Task 2-3 и потребляются в Task 4 без переименований. `DispatchEvent`-подобный объект (`id, ts, truckNumber, fromLabel, toLoadPointId, reason`) из `makeEvent` (Task 2) совпадает с полями, которые читает `DispatcherPanel` (Task 4: `e.truckNumber`, `e.fromLabel`, `e.reason`).
- **Расхождение с design spec**: панель диспетчера в этом плане оформлена в тёмной палитре (в цвет 3D-сцены), а не в светлой Tailwind-теме остального интерфейса (шапка/навигация) — так решено, потому что светлый сайдбар рядом с тёмной сценой выглядел бы разрозненно; шапка и общая навигация остаются светлыми, как согласовано ранее. Если не понравится по результату — поправить в `DispatcherPanel.jsx` тривиально (это только классы Tailwind).
