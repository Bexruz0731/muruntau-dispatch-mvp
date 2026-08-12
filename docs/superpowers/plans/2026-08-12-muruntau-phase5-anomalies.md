# Мурунтау MVP — Этап 5: аномалии/неисправности Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При спавне часть машин (~25%) получает засеянную аномалию — `IDLE_OVERRUN` (аномально долгий простой на погрузке) или `MECHANICAL_FAULT` (повышенный фактический расход топлива при штатных таймингах). Каждый тик детект (чистая функция, без LLM) помечает такие машины `anomalyType`/`anomalyRecommendation`; панель диспетчера показывает предупреждающий значок и разворачиваемую рекомендацию по клику.

**Architecture:** Вся логика — чистые функции в новом `src/simulation/anomaly.js` (ТЗ, раздел 6). Ключевая правка в `src/simulation/fuel.js`: топливо теперь расходуется по **`truck.actualBurnRatePerHour`** (новое поле — фактическая физика конкретной машины), а не по `truck.fuelBurnRatePerHour` (норма автопарка, с которой сравнивается факт) — раньше оба совпадали, поэтому `deviationPercent` был архитектурно всегда ~0%; разделение полей и даёт реальное, ненулевое отклонение для `MECHANICAL_FAULT`. Для `IDLE_OVERRUN` отклонение по формуле "факт/норма" не меняется от одной лишь длительности простоя (числитель и знаменатель растут пропорционально) — поэтому детект простоя не гейтится через `deviationPercent`, а проверяется отдельным условием первым: если машина в `LOADING` дольше `normalLoadingDurationMs * 1.5`. Это осознанное уточнение буквальной формулировки ТЗ ("если deviationPercent > 15%: если LOADING и время превышено...") — два триггера проверяются как независимые "или"-условия, а не вложенно, потому что при вложенной проверке `IDLE_OVERRUN` никогда бы не сработал ни при какой длительности простоя; цель ТЗ (гарантированно показать обе причины с понятной рекомендацией) при этом достигается точно так же.

**Tech Stack:** Без новых зависимостей.

## Global Constraints

- Засев аномалии — при спавне машины (`createTruck`), вероятность ~25% (`ANOMALY_SEED_PROBABILITY = 0.25`), 50/50 между двумя типами.
- `IDLE_OVERRUN`: `phaseDurationMs` фазы `LOADING` умножается на случайный множитель из диапазона `[3, 5]` относительно обычных 5-8 сек; остальная логика диспетчеризации не меняется.
- `MECHANICAL_FAULT`: персональный фактический расход (`actualBurnRatePerHour`) выше нормы автопарка (`fuelBurnRatePerHour`) в `[1.3, 1.6]` раза; тайминги фаз обычные.
- Детект применяется КО ВСЕМ машинам каждый тик, не только к засеянным — общее правило, не спецкейс (ТЗ, раздел 6).
- Пороговые значения: красная зона отклонения `|deviationPercent| > 15%` (`FUEL_DEVIATION_YELLOW_MAX` из `fuel.js`, этап 4); порог простоя — фактическая длительность `LOADING` больше `normalLoadingDurationMs * 1.5`, где `normalLoadingDurationMs` — верхняя граница обычного диапазона (`LOADING_DURATION_RANGE[1]` = 8000 мс из `store.js`).
- Тексты рекомендаций — дословно по шаблонам из ТЗ раздела 6 (с подстановкой номера машины/времени/процента).
- UI: значок ⚠ и рекомендация в списке машин панели диспетчера, разворачивается по клику, цвет — красный (как у отклонения в красной зоне).
- Кнопка "Объяснить причину" — **не в этом плане**, это четвёртый LLM-сценарий из этапа 6.
- Область этого плана — только этап 5. Кнопка "Объяснить причину" и остальная интеграция AnythingLLM — отдельный план после ревью этого результата.

---

## Task 1: `fuel.js` — разделить норму и фактический расход

**Files:**
- Modify: `src/simulation/fuel.js`
- Modify: `src/simulation/fuel.test.js`

**Interfaces:**
- Produces: `accrueFuelAndDistance(truck, now)` теперь читает ставку расхода из **`truck.actualBurnRatePerHour`** (новое обязательное поле truck) вместо `truck.fuelBurnRatePerHour`. `truck.fuelBurnRatePerHour` остаётся нормой, с которой сравнивает `deviationPercent` — сигнатуры и имена остальных функций (`actualLPerHour`, `deviationPercent`, `statusColorForDeviation`) не меняются.

- [ ] **Step 1: Написать падающий тест на расхождение факта и нормы**

Заменить `makeTruck` в `src/simulation/fuel.test.js`, добавив поле `actualBurnRatePerHour` (по умолчанию равно норме — для всех существующих тестов ничего не меняется):

```js
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
    actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    ...overrides,
  };
}
```

Добавить новый блок тестов в конец файла:

```js
describe('actualBurnRatePerHour vs fuelBurnRatePerHour', () => {
  it('расход считается по actualBurnRatePerHour, а не по норме, если они различаются', () => {
    const truck = makeTruck({ actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5 });
    const result = accrueFuelAndDistance(truck, 5000);
    expect(result.fuelConsumedThisShift).toBeCloseTo(FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5 * (5000 / 3600000));
  });

  it('повышенный actualBurnRatePerHour даёт положительное отклонение от нормы', () => {
    let truck = makeTruck({ actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5 });
    truck = accrueFuelAndDistance(truck, 3600000); // час движения
    expect(deviationPercent(truck)).toBeCloseTo(50); // +50%
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: FAIL — старая `accrueFuelAndDistance` считает по `fuelBurnRatePerHour`, поэтому `fuelConsumedThisShift`/`deviationPercent` не совпадут с ожиданием из новых тестов.

- [ ] **Step 3: Поменять ставку расхода в `accrueFuelAndDistance`**

В `src/simulation/fuel.js` заменить строку `const deltaFuel = truck.fuelBurnRatePerHour * (deltaMs / 3600000);` на:

```js
      const deltaFuel = truck.actualBurnRatePerHour * (deltaMs / 3600000);
```

И обновить комментарий над функцией (заменить существующий блок комментариев перед `export function accrueFuelAndDistance`):

```js
// Начисляет расход топлива и пробег за время, фактически прошедшее в
// ТЕКУЩЕЙ фазе с последнего учёта (truck.phaseAccountedMs) — считает по
// реальной разнице времени, а не по предположению о фиксированном шаге
// тика, поэтому корректно работает и при произвольном вызове из тестов, и
// при дрейфе реального setInterval. Топливо расходуется в TO_LOAD и
// LOADING; пробег — в TO_LOAD и EXITING (ТЗ, раздел 5).
//
// Ставка расхода — truck.actualBurnRatePerHour (реальная физика КОНКРЕТНОЙ
// машины), а не truck.fuelBurnRatePerHour (норма автопарка, с которой этот
// факт сравнивается в deviationPercent). У обычных машин они совпадают; у
// машин с засеянной аномалией MECHANICAL_FAULT (см. simulation/anomaly.js)
// actualBurnRatePerHour выше нормы — именно так возникает ненулевое
// отклонение, без изменения самой нормы.
export function accrueFuelAndDistance(truck, now) {
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: PASS, все тесты зелёные (старые и новые).

- [ ] **Step 5: Commit**

```bash
git add src/simulation/fuel.js src/simulation/fuel.test.js
git commit -m "feat: separate actual burn rate from fleet norm in fuel accrual"
```

---

## Task 2: `src/simulation/anomaly.js` — засев и детект (чистые функции)

**Files:**
- Create: `src/simulation/anomaly.js`
- Create: `src/simulation/anomaly.test.js`

**Interfaces:**
- Consumes: `deviationPercent`, `FUEL_DEVIATION_YELLOW_MAX` из `src/simulation/fuel.js` (Task 1).
- Produces: `ANOMALY_SEED_PROBABILITY`, `IDLE_OVERRUN_MULTIPLIER_RANGE`, `MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE`, `IDLE_OVERRUN_TIME_MULTIPLIER` — константы; `rollSeededAnomaly(random = Math.random): null | 'IDLE_OVERRUN' | 'MECHANICAL_FAULT'`; `loadingDurationForSeed(baseDurationMs: number, seededAnomaly, random = Math.random): number`; `actualBurnRateForSeed(normLPerHour: number, seededAnomaly, random = Math.random): number`; `detectAnomaly(truck, normalLoadingDurationMs: number): { anomalyType: null|'IDLE_OVERRUN'|'MECHANICAL_FAULT', anomalyRecommendation: null|string }`.

- [ ] **Step 1: Написать падающие тесты**

```js
// src/simulation/anomaly.test.js
import { describe, it, expect } from 'vitest';
import {
  rollSeededAnomaly,
  loadingDurationForSeed,
  actualBurnRateForSeed,
  detectAnomaly,
  ANOMALY_SEED_PROBABILITY,
  IDLE_OVERRUN_MULTIPLIER_RANGE,
  MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE,
} from './anomaly';
import { FALLBACK_FUEL_NORM_L_PER_HOUR } from './fuel';

// Детерминированная последовательность значений вместо Math.random — по
// одному значению на каждый вызов random() внутри тестируемой функции.
function fakeRandomSequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function makeTruck(overrides = {}) {
  return {
    number: '42',
    phase: 'TO_LOAD',
    phaseAccountedMs: 0,
    movingMs: 0,
    fuelConsumedThisShift: 0,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    ...overrides,
  };
}

describe('rollSeededAnomaly', () => {
  it('возвращает null, если первый бросок выше порога вероятности', () => {
    const random = fakeRandomSequence([ANOMALY_SEED_PROBABILITY + 0.01]);
    expect(rollSeededAnomaly(random)).toBeNull();
  });

  it('возвращает IDLE_OVERRUN, если аномалия есть и второй бросок < 0.5', () => {
    const random = fakeRandomSequence([0.01, 0.2]);
    expect(rollSeededAnomaly(random)).toBe('IDLE_OVERRUN');
  });

  it('возвращает MECHANICAL_FAULT, если аномалия есть и второй бросок >= 0.5', () => {
    const random = fakeRandomSequence([0.01, 0.8]);
    expect(rollSeededAnomaly(random)).toBe('MECHANICAL_FAULT');
  });
});

describe('loadingDurationForSeed', () => {
  it('не меняет длительность без засеянной аномалии', () => {
    expect(loadingDurationForSeed(6000, null)).toBe(6000);
    expect(loadingDurationForSeed(6000, 'MECHANICAL_FAULT')).toBe(6000);
  });

  it('раздувает длительность в диапазоне IDLE_OVERRUN_MULTIPLIER_RANGE для IDLE_OVERRUN', () => {
    const random = fakeRandomSequence([0]); // множитель = нижняя граница диапазона
    const result = loadingDurationForSeed(6000, 'IDLE_OVERRUN', random);
    expect(result).toBeCloseTo(6000 * IDLE_OVERRUN_MULTIPLIER_RANGE[0]);
  });
});

describe('actualBurnRateForSeed', () => {
  it('не меняет ставку без засеянной аномалии', () => {
    expect(actualBurnRateForSeed(110, null)).toBe(110);
    expect(actualBurnRateForSeed(110, 'IDLE_OVERRUN')).toBe(110);
  });

  it('повышает ставку в диапазоне MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE для MECHANICAL_FAULT', () => {
    const random = fakeRandomSequence([1]); // множитель = верхняя граница диапазона
    const result = actualBurnRateForSeed(110, 'MECHANICAL_FAULT', random);
    expect(result).toBeCloseTo(110 * MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE[1]);
  });
});

describe('detectAnomaly', () => {
  it('не находит аномалию у машины без перерасхода и без затянувшегося простоя', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 4000 });
    expect(detectAnomaly(truck, 8000)).toEqual({ anomalyType: null, anomalyRecommendation: null });
  });

  it('находит IDLE_OVERRUN у машины в LOADING дольше normalLoadingDurationMs * 1.5', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 13000 });
    const result = detectAnomaly(truck, 8000); // порог 12000
    expect(result.anomalyType).toBe('IDLE_OVERRUN');
    expect(result.anomalyRecommendation).toContain('№42');
    expect(result.anomalyRecommendation).toContain('технический осмотр');
  });

  it('не находит IDLE_OVERRUN ровно на границе (не больше, а равно)', () => {
    const truck = makeTruck({ phase: 'LOADING', phaseAccountedMs: 12000 });
    expect(detectAnomaly(truck, 8000).anomalyType).toBeNull();
  });

  it('находит MECHANICAL_FAULT у машины с перерасходом > 15% вне LOADING', () => {
    const truck = makeTruck({
      phase: 'TO_LOAD',
      movingMs: 3600000,
      fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.3, // +30%
    });
    const result = detectAnomaly(truck, 8000);
    expect(result.anomalyType).toBe('MECHANICAL_FAULT');
    expect(result.anomalyRecommendation).toContain('№42');
    expect(result.anomalyRecommendation).toContain('технический осмотр');
  });

  it('не находит аномалию при отклонении ровно 15% (порог строгий)', () => {
    const truck = makeTruck({
      phase: 'TO_LOAD',
      movingMs: 3600000,
      fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.15,
    });
    expect(detectAnomaly(truck, 8000).anomalyType).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/anomaly.test.js
```

Expected: FAIL — `Cannot find module './anomaly'`.

- [ ] **Step 3: Реализовать `anomaly.js`**

```js
// src/simulation/anomaly.js
import { deviationPercent, FUEL_DEVIATION_YELLOW_MAX } from './fuel';

// Вероятность, с которой новая машина при спавне получает засеянную
// аномалию, и множители, которыми эта аномалия меняет её тайминги/расход
// (ТЗ, раздел 6). Обычная логика диспетчеризации не меняется — машина едет
// по тем же правилам, просто с другими числами.
export const ANOMALY_SEED_PROBABILITY = 0.25;
export const IDLE_OVERRUN_MULTIPLIER_RANGE = [3, 5];
export const MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE = [1.3, 1.6];

// Порог детекта простоя: фаза LOADING считается затянувшейся, если реально
// прошедшее в ней время превысило обычную длительность больше чем в 1.5 раза.
export const IDLE_OVERRUN_TIME_MULTIPLIER = 1.5;

function randomInRange([min, max], random) {
  return min + random() * (max - min);
}

// При спавне: ~25% машин получают аномалию, поровну между двумя типами.
export function rollSeededAnomaly(random = Math.random) {
  if (random() >= ANOMALY_SEED_PROBABILITY) return null;
  return random() < 0.5 ? 'IDLE_OVERRUN' : 'MECHANICAL_FAULT';
}

// IDLE_OVERRUN: LOADING-фаза этой машины длится в 3-5 раз дольше обычного —
// перерасход в литрах возникает естественно (машина реально дольше стоит и
// жжёт топливо на холостом ходу), без отдельного расчёта.
export function loadingDurationForSeed(baseDurationMs, seededAnomaly, random = Math.random) {
  if (seededAnomaly !== 'IDLE_OVERRUN') return baseDurationMs;
  return baseDurationMs * randomInRange(IDLE_OVERRUN_MULTIPLIER_RANGE, random);
}

// MECHANICAL_FAULT: персональная фактическая ставка расхода (см.
// simulation/fuel.js — truck.actualBurnRatePerHour) в 1.3-1.6 раза выше
// нормы автопарка; сама норма (truck.fuelBurnRatePerHour) не меняется —
// иначе не с чем было бы сравнивать, и отклонение всегда было бы 0%.
export function actualBurnRateForSeed(normLPerHour, seededAnomaly, random = Math.random) {
  if (seededAnomaly !== 'MECHANICAL_FAULT') return normLPerHour;
  return normLPerHour * randomInRange(MECHANICAL_FAULT_RATE_MULTIPLIER_RANGE, random);
}

function idleOverrunRecommendation(truck, normalLoadingDurationMs) {
  const elapsedS = Math.round(truck.phaseAccountedMs / 1000);
  const normS = Math.round(normalLoadingDurationMs / 1000);
  return `Машина №${truck.number} превысила нормативное время стоянки на точке погрузки (${elapsedS} с вместо ~${normS} с) — перерасход на холостом ходу. Рекомендация: проверить причину простоя, при повторении — направить на технический осмотр.`;
}

function mechanicalFaultRecommendation(truck, dev) {
  const devStr = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`;
  return `Машина №${truck.number} показывает стабильный перерасход топлива (${devStr}) при штатном режиме движения, простой не выявлен. Рекомендация: направить машину на внеплановый технический осмотр.`;
}

// Детект (тик диспетчера, ТЗ раздел 6) — применяется КО ВСЕМ машинам, не
// только к засеянным при спавне: это общее правило, а не спецкейс.
//
// Простой на LOADING проверяется первым и НЕ через deviationPercent — при
// равномерном учёте топлива/пробега соотношение факт/норма не зависит от
// одной лишь длительности простоя (числитель и знаменатель растут
// пропорционально), поэтому долгий простой сам по себе и есть сигнал.
// Красная зона отклонения расхода (см. simulation/fuel.js) детектит
// оставшийся случай — штатные тайминги, но повышенный фактический расход.
export function detectAnomaly(truck, normalLoadingDurationMs) {
  if (truck.phase === 'LOADING' && truck.phaseAccountedMs > normalLoadingDurationMs * IDLE_OVERRUN_TIME_MULTIPLIER) {
    return {
      anomalyType: 'IDLE_OVERRUN',
      anomalyRecommendation: idleOverrunRecommendation(truck, normalLoadingDurationMs),
    };
  }

  const dev = deviationPercent(truck);
  if (Math.abs(dev) > FUEL_DEVIATION_YELLOW_MAX) {
    return {
      anomalyType: 'MECHANICAL_FAULT',
      anomalyRecommendation: mechanicalFaultRecommendation(truck, dev),
    };
  }

  return { anomalyType: null, anomalyRecommendation: null };
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/anomaly.test.js
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
git add src/simulation/anomaly.js src/simulation/anomaly.test.js
git commit -m "feat: add anomaly seeding and detection as pure, LLM-free functions"
```

---

## Task 3: Интеграция в стор — засев при спавне, детект каждый тик

**Files:**
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js`

**Interfaces:**
- Consumes: `rollSeededAnomaly`, `loadingDurationForSeed`, `actualBurnRateForSeed`, `detectAnomaly` из `src/simulation/anomaly.js` (Task 2).
- Produces: `createTruck(now)` — машина теперь содержит `seededAnomaly` (внутреннее поле, не из модели данных ТЗ — как и `phaseAccountedMs` из этапа 4, нужно только реализации), `actualBurnRatePerHour`, `anomalyType`, `anomalyRecommendation`. `simulationTick` пересчитывает `anomalyType`/`anomalyRecommendation` на каждой машине каждый тик.

- [ ] **Step 1: Написать падающий тест**

Добавить импорты в начало `src/simulation/store.test.js` (дополнить существующие строки импорта):

```js
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
```

и

```js
import { FALLBACK_FUEL_NORM_L_PER_HOUR, FUEL_TANK_CAPACITY_L } from './fuel';
```

остаётся как есть — новый импорт не нужен, `anomaly.js` в тесте стора не импортируется напрямую (тестируется через поведение `createTruck`/`simulationTick`).

Добавить новый блок тестов в конец файла (после `describe('учёт топлива и пробега', ...)`):

```js
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
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — `createTruck` не задаёт `seededAnomaly`/`actualBurnRatePerHour`/`anomalyType`, `simulationTick` их не пересчитывает.

- [ ] **Step 3: Переписать `store.js`**

Заменить импорт из `fuel.js` на:

```js
import {
  accrueFuelAndDistance,
  deviationPercent,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
} from './fuel';
import { rollSeededAnomaly, loadingDurationForSeed, actualBurnRateForSeed, detectAnomaly } from './anomaly';
```

Заменить `createTruck` на версию с засевом аномалии:

```js
// Новая машина появляется на въезде БЕЗ цели (её назначит диспетчерский
// алгоритм — см. decideTarget), с полным баком и нормой расхода автопарка.
// ~25% машин получают засеянную аномалию (см. simulation/anomaly.js) — это
// меняет только actualBurnRatePerHour (MECHANICAL_FAULT) или длительность
// будущей LOADING-фазы через seededAnomaly (IDLE_OVERRUN, применяется в
// advanceTargetedTruck при переходе TO_LOAD -> LOADING).
export function createTruck(now) {
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
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    actualBurnRatePerHour: actualBurnRateForSeed(FALLBACK_FUEL_NORM_L_PER_HOUR, seededAnomaly),
    seededAnomaly,
    anomalyType: null,
    anomalyRecommendation: null,
  };
}
```

В `advanceTargetedTruck`, в case `'TO_LOAD'`, заменить строку `phaseDurationMs: randomInRange(LOADING_DURATION_RANGE),` на:

```js
        phaseDurationMs: loadingDurationForSeed(randomInRange(LOADING_DURATION_RANGE), truck.seededAnomaly),
```

(весь остальной код `advanceTargetedTruck` не меняется).

Переписать основной цикл `simulationTick`, чтобы детект аномалии пересчитывался на каждой машине сразу после начисления топлива/пробега (до проверки, завершилась ли фаза):

```js
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
git commit -m "feat: seed and detect truck anomalies each tick"
```

---

## Task 4: Значок и рекомендация в панели диспетчера

**Files:**
- Modify: `src/components/DispatcherPanel.jsx`

**Interfaces:**
- Consumes: `truck.anomalyType`, `truck.anomalyRecommendation` из стора (Task 3).

- [ ] **Step 1: Вынести строку машины в отдельный компонент с локальным состоянием "развёрнуто"**

Заменить содержимое `src/components/DispatcherPanel.jsx` целиком:

```jsx
import { useState } from 'react';
import { statusColorForQueue } from '../simulation/dispatch';
import { deviationPercent, statusColorForDeviation } from '../simulation/fuel';

const PHASE_LABELS = {
  ENTERING: 'на въезде',
  TO_LOAD: 'едет к точке',
  LOADING: 'грузится',
  EXITING: 'выезжает',
};

function TruckRow({ truck }) {
  const [expanded, setExpanded] = useState(false);
  const dev = deviationPercent(truck);
  const hasAnomaly = Boolean(truck.anomalyType);

  return (
    <li className="text-slate-300">
      <div className="flex justify-between items-center">
        <span className="flex items-center gap-1">
          №{truck.number}
          {hasAnomaly && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-red-400 leading-none"
              title="Обнаружена аномалия — нажмите для подробностей"
            >
              ⚠
            </button>
          )}
        </span>
        <span className="text-slate-400">{PHASE_LABELS[truck.phase] ?? truck.phase}</span>
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>{Math.round(truck.fuelLevel)} л · норма {truck.fuelBurnRatePerHour} л/ч</span>
        <span style={{ color: statusColorForDeviation(dev) }}>
          {dev >= 0 ? '+' : ''}
          {dev.toFixed(1)}%
        </span>
      </div>
      {hasAnomaly && expanded && (
        <div className="mt-1 text-[11px] text-red-300 bg-red-950/40 border border-red-900 rounded px-2 py-1">
          {truck.anomalyRecommendation}
        </div>
      )}
    </li>
  );
}

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
        <ul className="space-y-1.5 text-xs">
          {trucks.map((t) => (
            <TruckRow key={t.id} truck={t} />
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

- [ ] **Step 2: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 3: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`, подождать 30-90 секунд (аномалия — вероятностная, ~25% на спавн; за это время должно появиться хотя бы 1-2 машины со значком ⚠). Ожидается:
- у аномальных машин в списке — красный значок ⚠ рядом с номером;
- клик по значку — разворачивает/сворачивает блок с рекомендацией (красный фон, читаемый текст, содержит номер машины и фразу про технический осмотр);
- у остальных машин — без изменений (без значка, отклонение по-прежнему около 0%, если только у них тоже не проявился MECHANICAL_FAULT).

Сделать реальный скриншот headless-браузером (Playwright, см. существующие скрипты в scratchpad) до и после клика по значку — не полагаться на предположение, что рендер верный. Проверить консоль браузера на ошибки.

- [ ] **Step 4: Commit**

```bash
git add src/components/DispatcherPanel.jsx
git commit -m "feat: show anomaly warning icon and recommendation in dispatcher panel"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 6 дизайн-документа = этап 5 сборки)**: засев ~25%/50-50 — Task 3 (`rollSeededAnomaly`, вызывается из `createTruck`). Множители IDLE_OVERRUN (3-5x LOADING) и MECHANICAL_FAULT (1.3-1.6x ставки) — Task 2 (`loadingDurationForSeed`, `actualBurnRateForSeed`), применены в Task 3 (`advanceTargetedTruck`, `createTruck`). Детект каждый тик, для всех машин — Task 3 (`simulationTick` вызывает `detectAnomaly` на каждой машине). Тексты рекомендаций — дословно по шаблонам ТЗ — Task 2. Значок + разворачиваемая рекомендация, красный цвет — Task 4. Кнопка "Объяснить причину" сознательно не входит — это этап 6.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `detectAnomaly(truck, normalLoadingDurationMs)` определена в Task 2, вызывается в Task 3 с `LOADING_DURATION_RANGE[1]` (существующая константа `store.js`, не дублируется). Поля `actualBurnRatePerHour`, `seededAnomaly`, `anomalyType`, `anomalyRecommendation` вводятся в Task 1/3, потребляются без переименований в Task 4 (`truck.anomalyType`, `truck.anomalyRecommendation`). `fuel.js` (Task 1) не знает про `anomaly.js` — зависимость только в одну сторону (`anomaly.js` → `fuel.js` → `store.js`), циклов нет.
- **Архитектурное отступление от буквальной формулировки ТЗ**, зафиксированное явно (см. Architecture): два триггера детекта (простой / перерасход) проверяются как независимые условия, а не как вложенное "если deviationPercent>15%, то один из двух типов" — потому что при вложенной проверке IDLE_OVERRUN был бы недостижим (соотношение факт/норма не меняется от одной лишь длительности простоя при равномерном учёте топлива и пробега). Итоговое поведение — то же самое, что и в ТЗ по существу: обе причины гарантированно проявляются на демо с понятной рекомендацией.
