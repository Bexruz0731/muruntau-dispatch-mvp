# Конвейерная лента и бесконечный цикл машин Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить одноразовый маршрут машины (`ENTERING→TO_LOAD→LOADING→EXITING→DONE`) на бесконечный цикл через конвейерную ленту снаружи карьера (`...→EXITING→UNLOADING→RETURNING→ENTERING→...`), с реалистичными "сменными" цифрами в отчёте по топливу (каждые 5 рейсов) вместо крошечных разовых.

**Architecture:** `EXIT_POINT` заменяется на `BELT_POINT` (за пределами `PIT_TOP_RADIUS`, реальная 3D-конструкция `Belt.jsx`). `advanceTargetedTruck` в `store.js` возвращает `{ truck, sessionRecord }` вместо просто `truck` — `sessionRecord` не `null` только на рейсе, кратном `LAPS_PER_SHIFT`, тогда же счётчики смены обнуляются и бак дозаправляется. Спавн/деспавн полностью убирается — фиксированный парк `FLEET_SIZE`, машины никогда не покидают `trucks`. См. подробности в `docs/superpowers/specs/2026-08-12-conveyor-belt-loop-design.md`.

**Tech Stack:** Без новых зависимостей.

## Global Constraints

- Бесконечный цикл: ни одна машина никогда не достигает терминального состояния и не удаляется из `trucks`.
- `BELT_POINT` — за пределами `PIT_TOP_RADIUS=30` (плоская земля, `terrainHeightAt` уже отдаёт 0 без изменений).
- Топливо расходуется только в `TO_LOAD`/`LOADING` (без изменений); пробег — в `TO_LOAD`/`EXITING`/`RETURNING` (расширено).
- `LAPS_PER_SHIFT = 5`: рейс засчитывается по завершении `UNLOADING`; на каждом 5-м — запись в `sessionLog` с накопленными за смену цифрами, обнуление `distanceThisShift`/`fuelConsumedThisShift`/`movingMs`, дозаправка `fuelLevel` до `FUEL_TANK_CAPACITY_L`.
- Эта работа затрагивает уже существующие протестированные файлы очень существенно — `store.test.js` переписывается почти полностью (не просто дополняется), `fuel.test.js`/`constants.test.js` — точечно.
- Область — только это изменение. Реальное подключение локального AnythingLLM пользователя — отдельная, более простая задача после этого плана (конфигурация `.env`, не архитектура).

---

## Task 1: `constants.js` — `BELT_POINT` вместо `EXIT_POINT`

**Files:**
- Modify: `src/simulation/constants.js`
- Modify: `src/simulation/constants.test.js`

**Interfaces:**
- Produces: `BELT_POINT = { id: 'belt', name: 'Лента', position: [number, number] }` — заменяет `EXIT_POINT`, используется в Task 3 (`store.js`) и Task 5 (`Belt.jsx`).

- [ ] **Step 1: Обновить падающий тест**

В `src/simulation/constants.test.js` заменить импорт `EXIT_POINT` на `BELT_POINT` (строка 4) и заменить блок `describe('ENTRY_POINT / EXIT_POINT', ...)`:

```js
describe('ENTRY_POINT / BELT_POINT', () => {
  it('заданы в разных точках', () => {
    expect(ENTRY_POINT.position).not.toEqual(BELT_POINT.position);
  });

  it('BELT_POINT находится за пределами воронки (снаружи PIT_TOP_RADIUS)', () => {
    const [x, z] = BELT_POINT.position;
    expect(Math.hypot(x, z)).toBeGreaterThan(PIT_TOP_RADIUS);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: FAIL — `BELT_POINT` не экспортирован.

- [ ] **Step 3: Заменить `EXIT_POINT` на `BELT_POINT`**

В `src/simulation/constants.js` заменить строку:

```js
export const EXIT_POINT = { id: 'exit', name: 'Выезд', position: [3, 26] };
```

на:

```js
// За пределами воронки (радиус > PIT_TOP_RADIUS) — там стоит бункер и
// конвейерная лента (см. components/scene/Belt.jsx), машина едет туда
// после LOADING (EXITING), разгружается (UNLOADING) и возвращается в
// карьер (RETURNING) — бесконечный цикл, без терминального состояния.
export const BELT_POINT = { id: 'belt', name: 'Лента', position: [6, 38] };
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/constants.js src/simulation/constants.test.js
git commit -m "feat: replace EXIT_POINT with BELT_POINT outside the pit rim"
```

---

## Task 2: `fuel.js` — пробег накапливается и в `RETURNING`

**Files:**
- Modify: `src/simulation/fuel.js`
- Modify: `src/simulation/fuel.test.js`

**Interfaces:**
- Produces: `accrueFuelAndDistance` без изменений сигнатуры — только расширено множество фаз, дающих пробег.

- [ ] **Step 1: Добавить падающий тест**

В `src/simulation/fuel.test.js`, после теста `'в фазе EXITING начисляет пробег, но не топливо'`, добавить:

```js
  it('в фазе RETURNING тоже начисляет пробег, но не топливо', () => {
    const truck = makeTruck({ phase: 'RETURNING' });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.distanceThisShift).toBeCloseTo(50);
    expect(result.fuelConsumedThisShift).toBe(0);
  });
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: FAIL — `distanceThisShift` останется 0 (фаза `RETURNING` пока не входит в условие).

- [ ] **Step 3: Расширить условие пробега**

В `src/simulation/fuel.js` заменить строку:

```js
    if (truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') {
```

на:

```js
    if (truck.phase === 'TO_LOAD' || truck.phase === 'EXITING' || truck.phase === 'RETURNING') {
```

Обновить комментарий над функцией (заменить строку `// LOADING; пробег — в TO_LOAD и EXITING (ТЗ, раздел 5).` на):

```js
// LOADING; пробег — в TO_LOAD, EXITING и RETURNING (реальное движение).
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/fuel.js src/simulation/fuel.test.js
git commit -m "feat: accrue mileage during RETURNING phase too"
```

---

## Task 3: `store.js` — бесконечный цикл, `UNLOADING`/`RETURNING`, пересменка

**Files:**
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js` (переписывается почти полностью)

**Interfaces:**
- Consumes: `BELT_POINT` из `./constants` (Task 1).
- Produces: `FLEET_SIZE`, `UNLOADING_DURATION_RANGE`, `LAPS_PER_SHIFT` — константы. `getBeltQueueCount(trucks): number`. `createTruck(now, normLPerHour)` — добавлено поле `lapsCompletedThisShift: 0`. `simulationTick(state, now)` — состояние без `nextSpawnAt` (убрано), фазы `EXITING`/`UNLOADING`/`RETURNING`/`ENTERING` образуют бесконечный цикл, ни одна машина не удаляется.

- [ ] **Step 1: Переписать `store.test.js`**

Полностью заменить содержимое `src/simulation/store.test.js`:

```js
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
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — множество ошибок (`FLEET_SIZE`/`LAPS_PER_SHIFT`/`getBeltQueueCount` не экспортированы, `EXIT_POINT` всё ещё используется и т.д.).

- [ ] **Step 3: Переписать `store.js`**

Полностью заменить содержимое `src/simulation/store.js`:

```js
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

Expected: `npx vitest run` — почти наверняка ещё FAIL на этом шаге (`dispatch.test.js` не трогали, но `constants.test.js`/`fuel.test.js`/`store.test.js` должны быть зелёными; сборка может упасть из-за `MapPage.jsx`/`DispatcherPanel.jsx`/`Truck.jsx`, всё ещё использующих старые имена — это ожидаемо, чинится в Task 4-6). Убедиться, что падают только ещё не тронутые файлы, а не Task 1-3.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/store.js src/simulation/store.test.js
git commit -m "feat: infinite truck loop through the belt, shift-based fuel report"
```

---

## Task 4: `Truck.jsx` — наклон кузова на разгрузке, доворот и на `RETURNING`

**Files:**
- Modify: `src/components/scene/Truck.jsx`

**Interfaces:**
- Consumes: ничего нового (та же `pathDirectionAt`).

- [ ] **Step 1: Добавить `kuzovRef` и расширить логику `useFrame`**

В `src/components/scene/Truck.jsx` заменить объявление рефов:

```jsx
  const groupRef = useRef();
  const progressRef = useRef();
  const bodyMatRef = useRef();
```

на:

```jsx
  const groupRef = useRef();
  const progressRef = useRef();
  const bodyMatRef = useRef();
  const kuzovRef = useRef();
```

Заменить условие доворота по курсу:

```jsx
    if ((truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') && groupRef.current) {
```

на:

```jsx
    if ((truck.phase === 'TO_LOAD' || truck.phase === 'EXITING' || truck.phase === 'RETURNING') && groupRef.current) {
```

Заменить блок от `const loading = ...` до конца `useFrame` на:

```jsx
    const loading = truck.phase === 'LOADING';
    const unloading = truck.phase === 'UNLOADING';
    if (progressRef.current) {
      const progress = loading
        ? Math.min(1, (now - truck.phaseStartedAt) / truck.phaseDurationMs)
        : 0;
      progressRef.current.visible = loading;
      progressRef.current.scale.x = Math.max(0.001, progress);
    }
    if (bodyMatRef.current) {
      const active = loading || unloading;
      bodyMatRef.current.emissiveIntensity = active ? 0.4 + Math.sin(now * 0.006) * 0.3 : 0;
    }
    if (kuzovRef.current) {
      // Наклон кузова на разгрузке — приподнимается и опускается плавно
      // (синусоида по прогрессу фазы), имитируя высыпку груза в бункер ленты.
      const dumpProgress = unloading
        ? Math.min(1, (now - truck.phaseStartedAt) / truck.phaseDurationMs)
        : 0;
      const tilt = Math.sin(dumpProgress * Math.PI) * 0.5;
      kuzovRef.current.rotation.z = -0.05 - tilt;
    }
  });
```

- [ ] **Step 2: Подключить `kuzovRef` к мешу кузова**

Заменить строку:

```jsx
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]}>
```

на:

```jsx
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]} ref={kuzovRef}>
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build
```

Expected: успешно (сборка всё ещё может падать из-за `MapPage.jsx`/`DispatcherPanel.jsx` — если так, убедиться, что ошибки только там, не в `Truck.jsx`).

- [ ] **Step 4: Commit**

```bash
git add src/components/scene/Truck.jsx
git commit -m "feat: animate dump-bed tilt during UNLOADING, extend heading turn to RETURNING"
```

---

## Task 5: `Belt.jsx` — бункер и конвейер снаружи карьера

**Files:**
- Create: `src/components/scene/Belt.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `BELT_POINT` из `src/simulation/constants.js` (Task 1); `getBeltQueueCount` из `src/simulation/store.js` (Task 3).
- Produces: `<Belt queueCount={number} />` — статичная сцена-структура у `BELT_POINT`.

- [ ] **Step 1: Реализовать `Belt.jsx`**

```jsx
// src/components/scene/Belt.jsx
import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { groundPosition, BELT_POINT } from '../../simulation/constants';
import { statusColorForQueue } from '../../simulation/dispatch';

const HOPPER_COLOR = '#3a4356';
const RAMP_COLOR = '#232a38';
const GLOW_COLOR = '#8fc3ff';
const RAMP_LENGTH = 7;
const STRIPE_COUNT = 5;

// Бункер + наклонный конвейерный жёлоб снаружи карьера (BELT_POINT — за
// пределами PIT_TOP_RADIUS). Полоски на жёлобе непрерывно "едут" вдоль
// него через useFrame (не привязано к конкретной машине) — постоянная
// фоновая анимация, которая читается как "лента работает".
export default function Belt({ queueCount = 0 }) {
  const stripeRefs = useRef([]);
  const [x, y, z] = groundPosition(BELT_POINT.position);
  // Бункер (местный -X) смотрит на центр карьера — тот же способ вывода
  // угла, что и в Truck.jsx (доворот носом по курсу), только курс здесь —
  // направление от ленты к центру карьера (-x, -z).
  const rotationY = Math.atan2(-z, x);
  const ringColor = statusColorForQueue(queueCount);

  useFrame(() => {
    const t = performance.now() * 0.00015;
    stripeRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const localT = (t + i / STRIPE_COUNT) % 1;
      mesh.position.x = (localT - 0.5) * RAMP_LENGTH;
    });
  });

  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* бункер — приёмный короб у начала ленты */}
      <mesh position={[-2.4, 1.3, 0]}>
        <boxGeometry args={[2.6, 2.6, 3]} />
        <meshStandardMaterial color={HOPPER_COLOR} roughness={0.6} metalness={0.4} />
      </mesh>
      {/* светящаяся кромка сверху бункера — очередь у ленты */}
      <mesh position={[-2.4, 2.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.6, 24]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* наклонный жёлоб конвейера + бегущие полоски внутри одной группы,
          чтобы полоски автоматически следовали наклону жёлоба */}
      <group position={[1.8, 2.1, 0]} rotation={[0, 0, -0.35]}>
        <mesh>
          <boxGeometry args={[RAMP_LENGTH, 0.4, 1.6]} />
          <meshStandardMaterial color={RAMP_COLOR} roughness={0.6} metalness={0.4} />
        </mesh>
        {Array.from({ length: STRIPE_COUNT }).map((_, i) => (
          <mesh key={i} ref={(el) => { stripeRefs.current[i] = el; }} position={[0, 0.25, 0]}>
            <boxGeometry args={[0.3, 0.08, 1.4]} />
            <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* опоры */}
      {[-1, 1, 3].map((sx) => (
        <mesh key={sx} position={[sx, 1.1, 0.6]}>
          <boxGeometry args={[0.18, 2.2, 0.18]} />
          <meshStandardMaterial color={RAMP_COLOR} roughness={0.7} metalness={0.3} />
        </mesh>
      ))}

      <Html position={[-2.4, 3.4, 0]} center>
        <div className="px-2 py-0.5 rounded bg-black/70 text-white text-xs whitespace-nowrap">
          Лента ({queueCount})
        </div>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Подключить `<Belt/>` в `MapPage.jsx`**

Заменить весь файл `src/pages/MapPage.jsx`:

```jsx
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Belt from '../components/scene/Belt';
import Truck from '../components/scene/Truck';
import RouteTube from '../components/scene/RouteTube';
import DispatcherPanel from '../components/DispatcherPanel';
import { LOAD_POINTS } from '../simulation/constants';
import { useSimulationStore, getQueueCounts, getBeltQueueCount } from '../simulation/store';

const MOVING_PHASES = new Set(['TO_LOAD', 'EXITING', 'RETURNING']);

export default function MapPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const events = useSimulationStore((s) => s.events);
  const mode = useSimulationStore((s) => s.mode);
  const setMode = useSimulationStore((s) => s.setMode);

  const queueCounts = getQueueCounts(trucks);
  const loadPointsWithQueue = LOAD_POINTS.map((lp) => ({ ...lp, queueCount: queueCounts[lp.id] || 0 }));
  const beltQueueCount = getBeltQueueCount(trucks);

  return (
    <div className="w-full h-[calc(100vh-4rem)] flex">
      <div className="flex-1 min-w-0">
        <CareerScene>
          <PitTerrain />
          <Belt queueCount={beltQueueCount} />
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
        beltQueueCount={beltQueueCount}
        events={events}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build
```

Expected: успешно (может ещё падать на `DispatcherPanel.jsx`, если та ещё не принимает `beltQueueCount` — чинится в Task 6; если падает именно там, это ожидаемо на этом шаге).

- [ ] **Step 4: Commit**

```bash
git add src/components/scene/Belt.jsx src/pages/MapPage.jsx
git commit -m "feat: add conveyor belt structure outside the pit"
```

---

## Task 6: `DispatcherPanel.jsx` — подписи новых фаз и очередь ленты

**Files:**
- Modify: `src/components/DispatcherPanel.jsx`

**Interfaces:**
- Consumes: `beltQueueCount` prop (из Task 5, `MapPage.jsx` уже его передаёт).

- [ ] **Step 1: Обновить подписи фаз и добавить строку "Лента"**

Заменить блок `PHASE_LABELS`:

```jsx
const PHASE_LABELS = {
  ENTERING: 'на въезде',
  TO_LOAD: 'едет к точке',
  LOADING: 'грузится',
  EXITING: 'выезжает',
};
```

на:

```jsx
const PHASE_LABELS = {
  ENTERING: 'на въезде',
  TO_LOAD: 'едет к точке',
  LOADING: 'грузится',
  EXITING: 'едет на ленту',
  UNLOADING: 'разгружается',
  RETURNING: 'возвращается в карьер',
};
```

Заменить сигнатуру компонента и заголовок блока очередей:

```jsx
export default function DispatcherPanel({ trucks, loadPoints, events, mode, onModeChange }) {
```

на:

```jsx
export default function DispatcherPanel({ trucks, loadPoints, beltQueueCount, events, mode, onModeChange }) {
```

Заменить блок "Точки погрузки" целиком:

```jsx
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
```

на:

```jsx
      <div className="p-3 border-b border-slate-800">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Очереди</div>
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
          <li className="flex items-center justify-between">
            <span className="text-slate-300">Лента</span>
            <span
              className="px-1.5 py-0.5 rounded font-mono min-w-[1.5rem] text-center"
              style={{ backgroundColor: statusColorForQueue(beltQueueCount), color: '#0a0f1a' }}
            >
              {beltQueueCount}
            </span>
          </li>
        </ul>
      </div>
```

- [ ] **Step 2: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны — это первый момент, когда ВСЁ (тесты + сборка) снова полностью зелёное после начала переделки.

- [ ] **Step 3: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается:
- Снаружи воронки (за верхним краем) видна конструкция ленты — бункер со светящейся кромкой + наклонный жёлоб с непрерывно бегущими светящимися полосками.
- Машины едут по кругу: к точке погрузки → грузятся → едут к ленте → разгружаются (кузов заметно приподнимается и опускается) → возвращаются в карьер → снова к точке погрузки. Ни одна машина не исчезает.
- Кабина машины продолжает доворачиваться по курсу движения и на обратном пути (`RETURNING`).
- В панели диспетчера — блок "Очереди" со строкой "Лента" и счётчиком; статусы машин показывают новые фазы ("едет на ленту", "разгружается", "возвращается в карьер").
- Подождать достаточно (несколько кругов одной машины — при коротких тестовых длительностях фаз это может занять пару минут реального времени), перейти на `/fuel-report`: после первых 5 рейсов какой-то машины должна появиться строка "завершила смену" с некрошечными цифрами пробега/расхода (не 0.0x).

Сделать реальный скриншот headless-браузером (Playwright). Если ориентация ленты выглядит повёрнутой не в ту сторону (бункер отвёрнут от карьера) — поправить знак в `rotationY` в `Belt.jsx` (`Math.atan2(-z, x)` → `Math.atan2(z, -x)` или подобное) и переснять. Проверить консоль браузера на ошибки.

- [ ] **Step 4: Commit**

```bash
git add src/components/DispatcherPanel.jsx
git commit -m "feat: add belt queue row and new phase labels to dispatcher panel"
```

---

## Self-Review Notes

- **Покрытие спеки**: `BELT_POINT` вне воронки — Task 1. Расширение пробега на `RETURNING` — Task 2. Бесконечный цикл `EXITING→UNLOADING→RETURNING→ENTERING`, фиксированный парк без спавна/деспавна, пересменка каждые `LAPS_PER_SHIFT` с обнулением счётчиков и дозаправкой — Task 3. Наклон кузова на разгрузке + доворот на `RETURNING` — Task 4. 3D-конструкция ленты с анимацией — Task 5. Подписи фаз и очередь ленты в панели — Task 6.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код.
- **Согласованность типов**: `advanceTargetedTruck` теперь возвращает `{ truck, sessionRecord }` — единственный вызывающий код (`simulationTick`, Task 3) обновлён вместе с изменением сигнатуры в той же задаче, никаких внешних потребителей этой внутренней (не экспортируемой) функции нет. `BELT_POINT` (Task 1) используется без переименований в Task 3/5. `getBeltQueueCount` (Task 3) используется без изменений в Task 5 (`MapPage.jsx`) и Task 6 (`DispatcherPanel.jsx` — `beltQueueCount` prop).
- **Риск, сознательно принятый из-за дедлайна**: ориентация `Belt.jsx` (`rotationY`) выведена по аналогии с уже проверенной формулой из `Truck.jsx`, но НЕ подтверждена отдельным численным дебагом (как это было сделано для машины) — Task 6, Step 3 явно предписывает визуально проверить и поправить знак по скриншоту, если бункер смотрит не в ту сторону.
