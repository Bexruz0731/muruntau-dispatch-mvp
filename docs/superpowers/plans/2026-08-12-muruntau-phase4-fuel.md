# Мурунтау MVP — Этап 4: топливо и отчёт Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Начислять расход топлива и пробег каждой машине по времени в соответствующих фазах, показывать текущий уровень/норму/отклонение в панели диспетчера, и вести отдельную страницу "Полный отчёт по топливу" — сортируемую таблицу по всем машинам за сессию, включая уже уехавшие.

**Architecture:** Вся арифметика — чистые функции в новом `src/simulation/fuel.js` (без LLM, ТЗ раздел 5): `accrueFuelAndDistance(truck, now)` считает, сколько времени фактически прошло в текущей фазе с последнего учёта (`truck.phaseAccountedMs`), и начисляет топливо/пробег пропорционально — это устойчиво к любому шагу тика, а не только к фиксированному `TICK_INTERVAL_MS`. Норма расхода в этом этапе — захардкоженный fallback (110 л/ч, как у БелАЗ-75131); RAG-запрос к AnythingLLM, который сможет её заменить, — это этап 6, и он не требует правок в `fuel.js`, только замены значения, с которым создаётся машина. Для отчёта по уехавшим машинам стор получает `sessionLog` — при переходе машины в `DONE` в него добавляется финальная запись; сама симуляция теперь стартует один раз на уровне `App.jsx`, а не при монтировании страницы карты, иначе при переходе на страницу отчёта она бы останавливалась и "смена" замирала.

**Tech Stack:** Без новых зависимостей.

## Global Constraints

- Топливо расходуется, пока машина в фазе `TO_LOAD` или `LOADING`; пробег накапливается в `TO_LOAD` и `EXITING` (дословно из ТЗ, раздел 5 — не во всех "движущихся" фазах сразу, обе величины считаются по-своему).
- Норма расхода — одно значение на весь автопарк, fallback 110 л/ч (середина диапазона 100-120 у БелАЗ-75131); реальный RAG-запрос — этап 6, не в этом плане.
- Отклонение = `((фактический - норма) / норма) * 100`; цвет: зелёный `|откл| ≤ 5%`, жёлтый `5-15%`, красный `> 15%`.
- Расчёт — обычный код, без обращения к LLM (ТЗ, раздел 5).
- Таблица отчёта — по всем машинам за сессию, активным и уехавшим, сортируемая кликом по заголовку столбца.
- Кнопка "Сформировать сводку" в отчёте — **не в этом плане**, она приходит в этапе 6 вместе с AnythingLLM.
- Область этого плана — только этап 4. Аномалии (IDLE_OVERRUN/MECHANICAL_FAULT) — этап 5, отдельный план после ревью этого результата.

---

## Task 1: Расчёт топлива — чистые функции

**Files:**
- Modify: `src/simulation/constants.js`
- Modify: `src/simulation/constants.test.js`
- Create: `src/simulation/fuel.js`
- Create: `src/simulation/fuel.test.js`

**Interfaces:**
- Produces (`constants.js`): `pathLength(path: Array<[number, number, number]>): number` — суммарная длина ломаной по осям x/z (без учёта высоты).
- Produces (`fuel.js`): `FALLBACK_FUEL_NORM_L_PER_HOUR`, `FUEL_TANK_CAPACITY_L`, `FUEL_DEVIATION_GREEN_MAX`, `FUEL_DEVIATION_YELLOW_MAX` — константы; `accrueFuelAndDistance(truck, now): Truck` (тот же объект + начисленные `fuelLevel`, `fuelConsumedThisShift`, `distanceThisShift`, `movingMs`, `phaseAccountedMs`), `actualLPerHour(truck): number`, `deviationPercent(truck): number`, `statusColorForDeviation(pct: number): string`.

- [ ] **Step 1: Написать падающий тест для `pathLength`**

Добавить в `src/simulation/constants.test.js` (и добавить `pathLength` в импорт из `./constants`):

```js
describe('pathLength', () => {
  it('считает суммарную длину ломаной по x/z, игнорируя y', () => {
    expect(pathLength([[0, 0, 0], [3, 5, 4]])).toBeCloseTo(5); // треугольник 3-4-5, y игнорируется
    expect(pathLength([[0, 0, 0], [3, 0, 4], [3, 0, 8]])).toBeCloseTo(9); // 5 + 4
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: FAIL — `pathLength is not a function`.

- [ ] **Step 3: Реализовать `pathLength` в `constants.js`**

Добавить в конец `src/simulation/constants.js`:

```js
// Суммарная длина ломаной по осям x/z (высота игнорируется — это дистанция
// по земле, не по фактической 3D-траектории). Используется для начисления
// пробега/топлива в simulation/fuel.js.
export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const [x1, , z1] = path[i - 1];
    const [x2, , z2] = path[i];
    total += Math.hypot(x2 - x1, z2 - z1);
  }
  return total;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: PASS.

- [ ] **Step 5: Написать падающие тесты для `fuel.js`**

```js
// src/simulation/fuel.test.js
import { describe, it, expect } from 'vitest';
import {
  accrueFuelAndDistance,
  actualLPerHour,
  deviationPercent,
  statusColorForDeviation,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
} from './fuel';

function makeTruck(overrides = {}) {
  return {
    phase: 'TO_LOAD',
    phaseStartedAt: 0,
    phaseDurationMs: 10000,
    phaseAccountedMs: 0,
    path: [[0, 0, 0], [100, 0, 0]], // 100 м
    fuelLevel: FUEL_TANK_CAPACITY_L,
    fuelConsumedThisShift: 0,
    distanceThisShift: 0,
    movingMs: 0,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    ...overrides,
  };
}

describe('accrueFuelAndDistance', () => {
  it('начисляет топливо и пробег пропорционально прошедшему времени в TO_LOAD', () => {
    const truck = makeTruck();
    const result = accrueFuelAndDistance(truck, 5000); // половина фазы (5000 из 10000 мс)

    expect(result.fuelConsumedThisShift).toBeCloseTo(FALLBACK_FUEL_NORM_L_PER_HOUR * (5000 / 3600000));
    expect(result.fuelLevel).toBeCloseTo(FUEL_TANK_CAPACITY_L - result.fuelConsumedThisShift);
    expect(result.distanceThisShift).toBeCloseTo(50); // половина от 100 м
    expect(result.movingMs).toBe(5000);
    expect(result.phaseAccountedMs).toBe(5000);
  });

  it('не начисляет дважды одно и то же время при повторном вызове с тем же now', () => {
    const truck = makeTruck();
    const once = accrueFuelAndDistance(truck, 5000);
    const twice = accrueFuelAndDistance(once, 5000);
    expect(twice.fuelConsumedThisShift).toBeCloseTo(once.fuelConsumedThisShift);
    expect(twice.distanceThisShift).toBeCloseTo(once.distanceThisShift);
  });

  it('в фазе LOADING начисляет расход, но не пробег', () => {
    const truck = makeTruck({ phase: 'LOADING' });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.distanceThisShift).toBe(0);
    expect(result.fuelConsumedThisShift).toBeGreaterThan(0);
  });

  it('в фазе EXITING начисляет пробег, но не топливо', () => {
    const truck = makeTruck({ phase: 'EXITING' });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.distanceThisShift).toBeCloseTo(50);
    expect(result.fuelConsumedThisShift).toBe(0);
  });

  it('не начисляет больше длительности фазы, даже если now намного больше', () => {
    const truck = makeTruck();
    const result = accrueFuelAndDistance(truck, 999999);
    expect(result.distanceThisShift).toBeCloseTo(100); // весь путь, не больше
    expect(result.phaseAccountedMs).toBe(10000);
  });
});

describe('deviationPercent / statusColorForDeviation', () => {
  it('при фактическом расходе равном норме отклонение — 0%, цвет зелёный', () => {
    const truck = makeTruck({ movingMs: 3600000, fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR });
    expect(deviationPercent(truck)).toBeCloseTo(0);
    expect(statusColorForDeviation(deviationPercent(truck))).toBe('#22c55e');
  });

  it('перерасход > 15% даёт красный цвет', () => {
    const truck = makeTruck({ movingMs: 3600000, fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.2 });
    expect(deviationPercent(truck)).toBeGreaterThan(15);
    expect(statusColorForDeviation(deviationPercent(truck))).toBe('#ef4444');
  });

  it('пока машина не двигалась, actualLPerHour равен норме (не делит на 0)', () => {
    const truck = makeTruck({ movingMs: 0 });
    expect(actualLPerHour(truck)).toBe(FALLBACK_FUEL_NORM_L_PER_HOUR);
  });
});
```

- [ ] **Step 6: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: FAIL — `Cannot find module './fuel'`.

- [ ] **Step 7: Реализовать `fuel.js`**

```js
// src/simulation/fuel.js
import { pathLength } from './constants';

// Норма расхода — общий fallback на весь автопарк (модель БелАЗ-75131,
// середина диапазона 100-120 л/ч). Этап 6 сможет заменить конкретное
// значение, с которым создаётся машина (RAG-запрос к AnythingLLM), не
// трогая расчёты здесь.
export const FALLBACK_FUEL_NORM_L_PER_HOUR = 110;
export const FUEL_TANK_CAPACITY_L = 1050;

export const FUEL_DEVIATION_GREEN_MAX = 5; // |откл| <= 5% — зелёный
export const FUEL_DEVIATION_YELLOW_MAX = 15; // 5-15% — жёлтый, > 15% — красный

// Начисляет расход топлива и пробег за время, фактически прошедшее в
// ТЕКУЩЕЙ фазе с последнего учёта (truck.phaseAccountedMs) — считает по
// реальной разнице времени, а не по предположению о фиксированном шаге
// тика, поэтому корректно работает и при произвольном вызове из тестов, и
// при дрейфе реального setInterval. Топливо расходуется в TO_LOAD и
// LOADING; пробег — в TO_LOAD и EXITING (ТЗ, раздел 5).
export function accrueFuelAndDistance(truck, now) {
  const cappedElapsed = Math.min(now - truck.phaseStartedAt, truck.phaseDurationMs);
  const deltaMs = Math.max(0, cappedElapsed - truck.phaseAccountedMs);

  let { fuelLevel, fuelConsumedThisShift, distanceThisShift, movingMs } = truck;

  if (deltaMs > 0) {
    if (truck.phase === 'TO_LOAD' || truck.phase === 'LOADING') {
      const deltaFuel = truck.fuelBurnRatePerHour * (deltaMs / 3600000);
      fuelConsumedThisShift += deltaFuel;
      fuelLevel = Math.max(0, fuelLevel - deltaFuel);
      movingMs += deltaMs;
    }
    if (truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') {
      const legLength = pathLength(truck.path);
      distanceThisShift += legLength * (deltaMs / truck.phaseDurationMs);
    }
  }

  return {
    ...truck,
    fuelLevel,
    fuelConsumedThisShift,
    distanceThisShift,
    movingMs,
    phaseAccountedMs: cappedElapsed,
  };
}

// Фактический часовой расход по итогам смены (л/ч). Пока машина ещё не
// двигалась — считается равным норме (нечего делить).
export function actualLPerHour(truck) {
  if (truck.movingMs <= 0) return truck.fuelBurnRatePerHour;
  return truck.fuelConsumedThisShift / (truck.movingMs / 3600000);
}

// Отклонение фактического расхода от нормы, % (положительное — перерасход).
export function deviationPercent(truck) {
  const norm = truck.fuelBurnRatePerHour;
  if (norm <= 0) return 0;
  return ((actualLPerHour(truck) - norm) / norm) * 100;
}

export function statusColorForDeviation(pct) {
  const abs = Math.abs(pct);
  if (abs > FUEL_DEVIATION_YELLOW_MAX) return '#ef4444';
  if (abs > FUEL_DEVIATION_GREEN_MAX) return '#eab308';
  return '#22c55e';
}
```

- [ ] **Step 8: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 9: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 10: Commit**

```bash
git add src/simulation/constants.js src/simulation/constants.test.js src/simulation/fuel.js src/simulation/fuel.test.js
git commit -m "feat: add fuel/mileage accrual as pure, LLM-free functions"
```

---

## Task 2: Интеграция в стор — начисление, sessionLog, симулятор на уровне приложения

**Files:**
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js`
- Modify: `src/App.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `accrueFuelAndDistance`, `FALLBACK_FUEL_NORM_L_PER_HOUR`, `FUEL_TANK_CAPACITY_L`, `deviationPercent` из `src/simulation/fuel.js` (Task 1).
- Produces: `createTruck(now)` (изменён) — машина теперь содержит поля `fuelLevel`, `fuelConsumedThisShift`, `distanceThisShift`, `movingMs`, `fuelBurnRatePerHour`, `phaseAccountedMs`. Состояние стора получает `sessionLog: TruckSessionRecord[]` (пополняется при переходе машины в `DONE`, никогда не обрезается и не сбрасывается тиком). `useSimulationStore.startSimulation()` теперь вызывается один раз в `App.jsx`, а не в `MapPage.jsx` — симуляция продолжает идти при переходе между страницами.

- [ ] **Step 1: Написать падающий тест**

Полностью заменить содержимое `src/simulation/store.test.js` (добавляются `sessionLog: []` во все существующие литералы состояния и новый блок про топливо):

```js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTruck,
  simulationTick,
  resetCounters,
  getQueueCounts,
  MAX_ACTIVE_TRUCKS,
  SCRIPTED_CONGESTION_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';
import { FALLBACK_FUEL_NORM_L_PER_HOUR, FUEL_TANK_CAPACITY_L } from './fuel';

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
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — старая `createTruck` не задаёт `fuelLevel`/`fuelBurnRatePerHour`, `simulationTick` не знает про `state.sessionLog`.

- [ ] **Step 3: Переписать `store.js`**

Добавить импорт из `fuel.js` (после существующего импорта `chooseLoadPoint`):

```js
import {
  accrueFuelAndDistance,
  deviationPercent,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
} from './fuel';
```

Заменить `createTruck` на версию с топливными полями:

```js
// Новая машина появляется на въезде БЕЗ цели (её назначит диспетчерский
// алгоритм — см. decideTarget), с полным баком и нормой расхода автопарка.
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
    phaseAccountedMs: 0,
    fuelLevel: FUEL_TANK_CAPACITY_L,
    fuelConsumedThisShift: 0,
    distanceThisShift: 0,
    movingMs: 0,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
  };
}
```

Добавить помощник для записи в `sessionLog` (рядом с `makeEvent`):

```js
function toSessionRecord(truck, status) {
  return {
    truckNumber: truck.number,
    totalDistanceM: truck.distanceThisShift,
    totalFuelConsumed: truck.fuelConsumedThisShift,
    normLPerHour: truck.fuelBurnRatePerHour,
    deviationPercent: deviationPercent(truck),
    status,
  };
}
```

Заменить функцию `advanceTargetedTruck`, добавив сброс `phaseAccountedMs` на каждом переходе:

```js
function advanceTargetedTruck(truck, now) {
  switch (truck.phase) {
    case 'TO_LOAD':
      return {
        ...truck,
        phase: 'LOADING',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: randomInRange(LOADING_DURATION_RANGE),
        phaseAccountedMs: 0,
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
        phaseAccountedMs: 0,
      };
    }
    case 'EXITING':
      return {
        ...truck,
        phase: 'DONE',
        position: truck.path[truck.path.length - 1],
        phaseStartedAt: now,
        phaseDurationMs: 0,
        phaseAccountedMs: 0,
      };
    default:
      return truck;
  }
}
```

Переписать `simulationTick`, начисляя топливо/пробег на КАЖДОЙ машине перед проверкой фазы, и собирая `sessionLog` для завершивших маршрут:

```js
export function simulationTick(state, now) {
  let queueCounts = getQueueCounts(state.trucks);
  let scripted = state.scripted;
  const newEvents = [];
  const newSessionRecords = [];

  const advanced = [];
  for (const rawTruck of state.trucks) {
    const truck = accrueFuelAndDistance(rawTruck, now);
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

    const targeted = advanceTargetedTruck(truck, now);
    if (targeted.phase === 'DONE') {
      newSessionRecords.push(toSessionRecord(targeted, 'завершила смену'));
    }
    advanced.push(targeted);
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
  const sessionLog = newSessionRecords.length > 0 ? [...state.sessionLog, ...newSessionRecords] : state.sessionLog;

  return { trucks, nextSpawnAt, events, scripted, sessionLog };
}
```

Добавить `sessionLog: []` в начальное состояние `useSimulationStore` (рядом с `events: []`):

```js
export const useSimulationStore = create((set, get) => ({
  trucks: [],
  nextSpawnAt: 0,
  intervalId: null,
  events: [],
  sessionLog: [],
  mode: 'random',
  scripted: { active: false, remaining: 0, targetId: null, triggerAt: 0 },
  // ...startSimulation/stopSimulation/setMode без изменений
```

- [ ] **Step 4: Перенести старт симуляции на уровень приложения**

Симуляция должна идти непрерывно, даже когда пользователь смотрит страницу отчёта или ассистента — иначе "смена" замирает при уходе со страницы карты. Прочитать текущий `src/App.jsx`, затем изменить его так:

```jsx
// src/App.jsx
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import MapPage from './pages/MapPage';
import FuelReportPage from './pages/FuelReportPage';
import AssistantPage from './pages/AssistantPage';
import { useSimulationStore } from './simulation/store';

export default function App() {
  const startSimulation = useSimulationStore((s) => s.startSimulation);

  useEffect(() => {
    startSimulation();
  }, [startSimulation]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/fuel-report" element={<FuelReportPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Убрать из `src/pages/MapPage.jsx` управление жизненным циклом симуляции — она теперь стартует один раз в `App.jsx`:

```jsx
// src/pages/MapPage.jsx
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
  const setMode = useSimulationStore((s) => s.setMode);

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

(`stopSimulation` остаётся экспортированной функцией стора — она просто больше не вызывается автоматически нигде в этом MVP; ручной вызов из консоли или будущего UI по-прежнему сработает.)

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 6: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/store.js src/simulation/store.test.js src/App.jsx src/pages/MapPage.jsx
git commit -m "feat: accrue fuel/mileage per truck and keep the sim running app-wide"
```

---

## Task 3: Топливные колонки в панели диспетчера

**Files:**
- Modify: `src/components/DispatcherPanel.jsx`

**Interfaces:**
- Consumes: `deviationPercent`, `statusColorForDeviation` из `src/simulation/fuel.js` (Task 1).

- [ ] **Step 1: Добавить топливные показатели в список машин**

Заменить блок машин в `DispatcherPanel.jsx` (добавить импорт вверху файла и заменить рендер `<li>` в списке машин):

```jsx
// добавить в начало файла:
import { deviationPercent, statusColorForDeviation } from '../simulation/fuel';
```

```jsx
// заменить содержимое <ul> в блоке "Машины":
<ul className="space-y-1.5 text-xs">
  {trucks.map((t) => {
    const dev = deviationPercent(t);
    return (
      <li key={t.id} className="text-slate-300">
        <div className="flex justify-between">
          <span>№{t.number}</span>
          <span className="text-slate-400">{PHASE_LABELS[t.phase] ?? t.phase}</span>
        </div>
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>{Math.round(t.fuelLevel)} л · норма {t.fuelBurnRatePerHour} л/ч</span>
          <span style={{ color: statusColorForDeviation(dev) }}>
            {dev >= 0 ? '+' : ''}
            {dev.toFixed(1)}%
          </span>
        </div>
      </li>
    );
  })}
</ul>
```

- [ ] **Step 2: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 3: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается: под статусом каждой машины — строка с текущим уровнем топлива, нормой и отклонением в процентах (цвет отклонения — зелёный, пока не введены аномалии в этапе 5, значение должно быть близко к 0%). Проверить консоль браузера на ошибки.

- [ ] **Step 4: Commit**

```bash
git add src/components/DispatcherPanel.jsx
git commit -m "feat: show fuel level, norm and deviation per truck in the panel"
```

---

## Task 4: Страница "Полный отчёт по топливу"

**Files:**
- Modify: `src/pages/FuelReportPage.jsx`

**Interfaces:**
- Consumes: `useSimulationStore` (поля `trucks`, `sessionLog`) из `src/simulation/store.js` (Task 2); `deviationPercent`, `statusColorForDeviation` из `src/simulation/fuel.js` (Task 1).

- [ ] **Step 1: Написать `FuelReportPage.jsx`**

```jsx
// src/pages/FuelReportPage.jsx
import { useMemo, useState } from 'react';
import { useSimulationStore } from '../simulation/store';
import { deviationPercent, statusColorForDeviation } from '../simulation/fuel';

const COLUMNS = [
  { key: 'truckNumber', label: '№' },
  { key: 'distanceKm', label: 'Пробег, км' },
  { key: 'fuelConsumed', label: 'Расход, л' },
  { key: 'normLPerHour', label: 'Норма, л/ч' },
  { key: 'deviation', label: 'Откл., %' },
  { key: 'status', label: 'Статус' },
];

function buildRows(trucks, sessionLog) {
  const activeRows = trucks.map((t) => ({
    truckNumber: t.number,
    distanceKm: t.distanceThisShift / 1000,
    fuelConsumed: t.fuelConsumedThisShift,
    normLPerHour: t.fuelBurnRatePerHour,
    deviation: deviationPercent(t),
    status: 'активна',
  }));
  const doneRows = sessionLog.map((r) => ({
    truckNumber: r.truckNumber,
    distanceKm: r.totalDistanceM / 1000,
    fuelConsumed: r.totalFuelConsumed,
    normLPerHour: r.normLPerHour,
    deviation: r.deviationPercent,
    status: r.status,
  }));
  return [...activeRows, ...doneRows];
}

export default function FuelReportPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const sessionLog = useSimulationStore((s) => s.sessionLog);
  const [sortKey, setSortKey] = useState('truckNumber');
  const [sortDir, setSortDir] = useState('asc');

  const rows = useMemo(() => {
    const all = buildRows(trucks, sessionLog);
    return [...all].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [trucks, sessionLog, sortKey, sortDir]);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4 text-slate-800">Полный отчёт по топливу</h1>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="px-3 py-2 text-left font-medium text-slate-600 cursor-pointer select-none whitespace-nowrap"
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.truckNumber}-${i}`} className="border-t border-slate-200">
                <td className="px-3 py-2">№{row.truckNumber}</td>
                <td className="px-3 py-2">{row.distanceKm.toFixed(2)}</td>
                <td className="px-3 py-2">{row.fuelConsumed.toFixed(1)}</td>
                <td className="px-3 py-2">{row.normLPerHour.toFixed(0)}</td>
                <td className="px-3 py-2 font-medium" style={{ color: statusColorForDeviation(row.deviation) }}>
                  {row.deviation >= 0 ? '+' : ''}
                  {row.deviation.toFixed(1)}%
                </td>
                <td className="px-3 py-2">{row.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-4 text-center text-slate-400">
                  Пока нет данных — откройте страницу «Карта», чтобы симулятор начал работать.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 3: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`, подождать 20-30 секунд (чтобы несколько машин успели закончить маршрут), затем перейти на `/fuel-report`. Ожидается: таблица со всеми активными машинами (статус "активна") и уехавшими ("завершила смена"), с ненулевыми пробегом/расходом. Кликнуть по заголовку столбца "Расход, л" — строки должны пересортироваться, повторный клик — поменять направление (стрелка ▲/▼ у заголовка). Вернуться на `/map` и убедиться, что симуляция не перезапустилась с нуля (номера машин продолжаются, а не начинаются заново с №10) — подтверждает, что стор пережил переход между страницами. Проверить консоль браузера на ошибки.

- [ ] **Step 4: Commit**

```bash
git add src/pages/FuelReportPage.jsx
git commit -m "feat: add sortable full fuel report page"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 4)**: топливо расходуется в TO_LOAD/LOADING, пробег — в TO_LOAD/EXITING — Task 1 (`accrueFuelAndDistance`), проверено раздельными тестами на каждую фазу. Норма — fallback 110 л/ч на весь автопарк — Task 1/2 (`FALLBACK_FUEL_NORM_L_PER_HOUR`). Отклонение по формуле `(факт-норма)/норма*100` с цветовыми порогами 5%/15% — Task 1 (`deviationPercent`, `statusColorForDeviation`). Колонки в панели диспетчера (уровень, расход, норма, отклонение с цветом) — Task 3. Таблица отчёта по всем машинам за сессию (активным и уехавшим), сортируемая по клику на заголовок — Task 4, с `sessionLog` для уехавших — Task 2. Кнопка "Сформировать сводку" сознательно не входит — это этап 6.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `accrueFuelAndDistance(truck, now)`, `deviationPercent(truck)`, `statusColorForDeviation(pct)` определены в Task 1, используются с теми же именами в Task 2 (`store.js`), Task 3 (`DispatcherPanel.jsx`) и Task 4 (`FuelReportPage.jsx`). Поля машины (`fuelLevel`, `fuelConsumedThisShift`, `distanceThisShift`, `movingMs`, `fuelBurnRatePerHour`, `phaseAccountedMs`) вводятся в Task 1/2 и потребляются без переименований в Task 3/4. `TruckSessionRecord`-подобный объект из `toSessionRecord` (Task 2: `truckNumber, totalDistanceM, totalFuelConsumed, normLPerHour, deviationPercent, status`) совпадает с полями, которые читает `FuelReportPage` (Task 4: `r.totalDistanceM`, `r.totalFuelConsumed`, `r.normLPerHour`, `r.deviationPercent`, `r.status`).
- **Архитектурное дополнение к дизайн-спеке**: `startSimulation()` перенесён из `MapPage.jsx` в `App.jsx` (Task 2) — без этого при уходе со страницы карты (например, на страницу отчёта) `stopSimulation()` останавливал бы тик, и "сессия" замирала бы вместо того, чтобы продолжать копить данные для отчёта. Это не меняет поведение страницы карты — симуляция стартует так же при первой загрузке приложения, просто теперь один раз на всё приложение, а не при каждом монтировании `MapPage`.
