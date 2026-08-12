# Мурунтау MVP — Этап 6: интеграция AnythingLLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить локальный AnythingLLM через единую функцию `chatWithWorkspace`, использовать её в четырёх сценариях (объяснение решения диспетчера, разовый RAG-запрос нормы топлива, сводка по отчёту, объяснение причины аномалии) и на странице чата-ассистента — везде с graceful fallback, чтобы недоступность сервера никогда не ломала приложение.

**Architecture:** Вся сетевая логика — в одном модуле `src/lib/anythingllm.js`: `chatWithWorkspace(slug, message, options)` — единственная точка входа, оборачивает `fetch` в `AbortController`-таймаут и перехватывает любую ошибку/не-200 ответ, возвращая `{ ok, error, text, sources }` и НИКОГДА не выбрасывая исключение — вызывающему коду достаточно проверить `result.ok`. `fetchImpl` — внедряемая зависимость (по умолчанию — глобальный `fetch`), это и делает функцию тестируемой без реальной сети. Норма топлива теперь хранится в сторе (`fleetNormLPerHour`, изначально = fallback) и один раз запрашивается через RAG при старте приложения; `createTruck` принимает норму параметром вместо жёсткой ссылки на константу — обратная совместимость сохраняется через значение по умолчанию. Три кнопочных сценария (объяснение решения, сводка отчёта, объяснение аномалии) переиспользуют один UI-компонент `ExplainButton` (idle → loading → результат/ошибка), чтобы не дублировать состояние загрузки/ошибки в трёх местах. Как и в предыдущих этапах, чистая логика (парсинг нормы, сборка промптов, агрегаты отчёта) — в `simulation/*.js` с юнит-тестами; UI-обвязка (кнопки, страница чата) проверяется вручную через dev-сервер и реальные скриншоты headless-браузера, как все предыдущие React-компоненты в этом проекте (автотестов уровня компонентов в проекте нет — только логика).

**Tech Stack:** Без новых зависимостей — нативные `fetch`/`AbortController` (доступны и в браузере, и в Node 18+, на котором выполняется vitest).

## Global Constraints

- Единая функция `chatWithWorkspace(slug, message)` → `POST http://localhost:3001/api/v1/workspace/{slug}/chat`, заголовки `Authorization: Bearer ${VITE_ANYTHINGLLM_API_KEY}`, `Content-Type: application/json`, тело `{ message, mode: "chat" }`.
- Env-переменные: `VITE_ANYTHINGLLM_API_KEY`, `VITE_ANYTHINGLLM_WORKSPACE_DOCS`, `VITE_ANYTHINGLLM_WORKSPACE_DISPATCH`; если задан только один slug — используется для всех сценариев.
- Четыре сценария, все через `chatWithWorkspace` с разными промптами: (1) объяснение решения диспетчера, (2) разовый RAG-запрос нормы топлива при загрузке страницы карты, (3) текстовая сводка по топливному отчёту, (4) "Объяснить причину" для аномалии.
- Обработка сбоя: сетевая ошибка, таймаут (8 сек), не-200 ответ — перехватываются, в UI заглушка ("ИИ-сервис недоступен, попробуйте позже" — чат, панель диспетчера, отчёт); для нормы топлива — **тихий** fallback на `FALLBACK_FUEL_NORM_L_PER_HOUR` без сообщения об ошибке. Приложение не падает ни в одном сценарии.
- Страница `/assistant`: поле ввода, история сообщений (роли user/assistant), индикатор "печатает…" во время ожидания, источники под ответом ассистента при наличии.
- Область этого плана — только этап 6. Дальше — этап 7 (полировка, финальная проверка `TODO`-комментариев и навигации), отдельный план после ревью этого результата.

---

## Task 1: `src/lib/anythingllm.js` — единая точка входа в AnythingLLM API

**Files:**
- Create: `src/lib/anythingllm.js`
- Create: `src/lib/anythingllm.test.js`
- Create: `.env.example`

**Interfaces:**
- Produces: `ANYTHINGLLM_BASE_URL`, `DEFAULT_TIMEOUT_MS`, `WORKSPACE_DOCS_SLUG`, `WORKSPACE_DISPATCH_SLUG` — константы; `resolveWorkspaceSlug(preferred, fallback): string|null`; `chatWithWorkspace(slug, message, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}): Promise<{ ok: boolean, error: string|null, text: string|null, sources: Array }>`.

- [ ] **Step 1: Написать падающие тесты**

```js
// src/lib/anythingllm.test.js
import { describe, it, expect, vi } from 'vitest';
import { chatWithWorkspace, resolveWorkspaceSlug, ANYTHINGLLM_BASE_URL } from './anythingllm';

function makeFetchResponse({ ok, status = 200, json }) {
  return { ok, status, json: async () => json };
}

describe('resolveWorkspaceSlug', () => {
  it('предпочитает переданный конкретный slug', () => {
    expect(resolveWorkspaceSlug('a', 'b')).toBe('a');
  });

  it('использует запасной slug, если конкретный не задан', () => {
    expect(resolveWorkspaceSlug(null, 'b')).toBe('b');
    expect(resolveWorkspaceSlug('', 'b')).toBe('b');
  });

  it('возвращает null, если оба не заданы', () => {
    expect(resolveWorkspaceSlug(null, undefined)).toBeNull();
  });
});

describe('chatWithWorkspace', () => {
  it('немедленно возвращает ok:false без сетевого запроса, если slug не задан', async () => {
    const fetchImpl = vi.fn();
    const result = await chatWithWorkspace(null, 'привет', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no-workspace-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('отправляет POST на верный URL с телом и заголовками, возвращает текст и источники при успехе', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeFetchResponse({ ok: true, json: { textResponse: 'Ответ', sources: [{ title: 'doc.pdf' }] } }),
    );
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });

    expect(result).toEqual({ ok: true, error: null, text: 'Ответ', sources: [{ title: 'doc.pdf' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/my-slug/chat`);
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual({ message: 'вопрос', mode: 'chat' });
  });

  it('возвращает ok:false с кодом статуса при не-200 ответе', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeFetchResponse({ ok: false, status: 500, json: {} }));
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http-500');
  });

  it('возвращает ok:false при сетевой ошибке, не выбрасывая исключение', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await chatWithWorkspace('my-slug', 'вопрос', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network');
  });

  it('возвращает ok:false с error "timeout", если ответ не пришёл за timeoutMs, и не падает', async () => {
    vi.useFakeTimers();
    const fetchImpl = (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
    const promise = chatWithWorkspace('my-slug', 'вопрос', { fetchImpl, timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/lib/anythingllm.test.js
```

Expected: FAIL — `Cannot find module './anythingllm'`.

- [ ] **Step 3: Реализовать `anythingllm.js`**

```js
// src/lib/anythingllm.js
// Единая точка входа в локальный AnythingLLM API — используется во всех
// четырёх LLM-сценариях (объяснение решения диспетчера, RAG-запрос нормы
// топлива, сводка по отчёту, объяснение причины аномалии) и на странице
// чата-ассистента. Любая сетевая ошибка/таймаут/не-200 ответ перехватываются
// внутри и НИКОГДА не выбрасываются наружу — вызывающему коду достаточно
// проверить result.ok, try/catch не нужен (ТЗ, раздел "Интеграция AnythingLLM").
export const ANYTHINGLLM_BASE_URL = 'http://localhost:3001';
export const DEFAULT_TIMEOUT_MS = 8000;

export const WORKSPACE_DOCS_SLUG = import.meta.env.VITE_ANYTHINGLLM_WORKSPACE_DOCS || null;
export const WORKSPACE_DISPATCH_SLUG = import.meta.env.VITE_ANYTHINGLLM_WORKSPACE_DISPATCH || null;
const API_KEY = import.meta.env.VITE_ANYTHINGLLM_API_KEY || '';

// Если задан только один из двух workspace slug — он используется для всех
// сценариев (ТЗ). preferred — обычно нужный по смыслу workspace,
// fallback — второй, на случай если сконфигурирован только он.
export function resolveWorkspaceSlug(preferred, fallback) {
  return preferred || fallback || null;
}

// POST /api/v1/workspace/{slug}/chat. fetchImpl — точка внедрения для
// тестов (по умолчанию — глобальный fetch, доступный и в браузере, и в
// Node 18+, на котором реально выполняется vitest).
export async function chatWithWorkspace(slug, message, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!slug) {
    return { ok: false, error: 'no-workspace-configured', text: null, sources: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${ANYTHINGLLM_BASE_URL}/api/v1/workspace/${slug}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, mode: 'chat' }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `http-${res.status}`, text: null, sources: [] };
    }

    const data = await res.json();
    return {
      ok: true,
      error: null,
      text: data.textResponse ?? data.text ?? '',
      sources: data.sources ?? data.citations ?? [],
    };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return { ok: false, error: isTimeout ? 'timeout' : 'network', text: null, sources: [] };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Создать `.env.example`**

```
# Скопируйте в .env и заполните реальными значениями локального AnythingLLM.
# Если задан только один из двух workspace-slug, он используется для всех
# LLM-сценариев (объяснение решений, норма топлива, сводка, ассистент).
VITE_ANYTHINGLLM_API_KEY=
VITE_ANYTHINGLLM_WORKSPACE_DOCS=
VITE_ANYTHINGLLM_WORKSPACE_DISPATCH=
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/lib/anythingllm.test.js
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
git add src/lib/anythingllm.js src/lib/anythingllm.test.js .env.example
git commit -m "feat: add anythingllm client with graceful fallback"
```

---

## Task 2: RAG-запрос нормы топлива при старте приложения

**Files:**
- Modify: `src/simulation/fuel.js`
- Modify: `src/simulation/fuel.test.js`
- Modify: `src/simulation/store.js`
- Modify: `src/simulation/store.test.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `chatWithWorkspace`, `resolveWorkspaceSlug`, `WORKSPACE_DISPATCH_SLUG`, `WORKSPACE_DOCS_SLUG` из `src/lib/anythingllm.js` (Task 1).
- Produces (`fuel.js`): `FUEL_NORM_RAG_PROMPT` — константа; `parseFuelNormLPerHour(text): number|null`.
- Produces (`store.js`): `createTruck(now, normLPerHour = FALLBACK_FUEL_NORM_L_PER_HOUR)` — новый второй параметр (обратная совместимость через значение по умолчанию); стор получает `fleetNormLPerHour` (изначально `FALLBACK_FUEL_NORM_L_PER_HOUR`) и действие `fetchFleetNorm(): Promise<void>`.

- [ ] **Step 1: Написать падающий тест для `parseFuelNormLPerHour`**

Добавить `parseFuelNormLPerHour` в импорт из `./fuel` в `src/simulation/fuel.test.js` и добавить в конец файла:

```js
describe('parseFuelNormLPerHour', () => {
  it('распознаёт целое число перед "л/ч"', () => {
    expect(parseFuelNormLPerHour('Нормативный расход — 115 л/ч.')).toBe(115);
  });

  it('распознаёт число с десятичной запятой', () => {
    expect(parseFuelNormLPerHour('около 112,5 л/ч')).toBeCloseTo(112.5);
  });

  it('возвращает null, если в тексте нет распознаваемого числа с "л/ч"', () => {
    expect(parseFuelNormLPerHour('Точный расход не указан в документации.')).toBeNull();
  });

  it('возвращает null для пустого/отсутствующего текста', () => {
    expect(parseFuelNormLPerHour('')).toBeNull();
    expect(parseFuelNormLPerHour(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: FAIL — `parseFuelNormLPerHour is not a function`.

- [ ] **Step 3: Реализовать `parseFuelNormLPerHour` в `fuel.js`**

Добавить в конец `src/simulation/fuel.js`:

```js
// Промпт разового RAG-запроса нормы расхода при загрузке страницы карты
// (ТЗ, раздел "Топливо") — вынесен сюда, а не в store.js, чтобы вся
// топливная терминология жила в одном модуле.
export const FUEL_NORM_RAG_PROMPT = 'Какой нормативный расход топлива в час у БелАЗ-75131?';

// Простой regex-парсинг ответа LLM на число перед "л/ч" (с пробелами/без,
// с точкой или запятой как разделителем дробной части). Возвращает null,
// если распознать не удалось — вызывающий код тогда тихо остаётся на
// FALLBACK_FUEL_NORM_L_PER_HOUR (ТЗ: "если парсинг не удался... — fallback").
export function parseFuelNormLPerHour(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*л\s*\/?\s*ч/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/fuel.test.js
```

Expected: PASS.

- [ ] **Step 5: Написать падающие тесты для `store.js`**

Добавить `useSimulationStore` в существующий импорт из `./store` в `src/simulation/store.test.js` (строка `import { createTruck, simulationTick, resetCounters, getQueueCounts, MAX_ACTIVE_TRUCKS, SCRIPTED_CONGESTION_TRUCKS } from './store';` → добавить `useSimulationStore` в список). Добавить мок модуля перед остальными импортами (в самое начало файла):

```js
import { vi } from 'vitest';

vi.mock('../lib/anythingllm', () => ({
  chatWithWorkspace: vi.fn(),
  resolveWorkspaceSlug: (preferred, fallback) => preferred || fallback || null,
  WORKSPACE_DOCS_SLUG: null,
  WORKSPACE_DISPATCH_SLUG: null,
}));
```

(`vi` уже импортируется из `'vitest'` в этом файле с этапа 5 — просто убедиться, что импорт `vi` есть; отдельный `import { vi } from 'vitest';` не дублировать, если он уже есть в существующей строке импорта.)

Добавить `import { chatWithWorkspace } from '../lib/anythingllm';` и `import { FUEL_NORM_RAG_PROMPT } from './fuel';` (дополнить существующий импорт из `'./fuel'`, где уже есть `FALLBACK_FUEL_NORM_L_PER_HOUR, FUEL_TANK_CAPACITY_L`).

Добавить в конец файла:

```js
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
    expect(chatWithWorkspace).toHaveBeenCalledWith(null, FUEL_NORM_RAG_PROMPT, undefined);
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

- [ ] **Step 6: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — `createTruck(0, 130)` игнорирует второй аргумент, `state.fleetNormLPerHour` не используется, `fetchFleetNorm` не существует.

- [ ] **Step 7: Переписать `store.js`**

Добавить импорт (после существующего импорта из `./anomaly`):

```js
import { parseFuelNormLPerHour, FUEL_NORM_RAG_PROMPT } from './fuel';
import { chatWithWorkspace, resolveWorkspaceSlug, WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG } from '../lib/anythingllm';
```

Заменить сигнатуру и тело `createTruck`, чтобы норма приходила параметром:

```js
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
    fuelBurnRatePerHour: normLPerHour,
    actualBurnRatePerHour: actualBurnRateForSeed(normLPerHour, seededAnomaly),
    seededAnomaly,
    anomalyType: null,
    anomalyRecommendation: null,
  };
}
```

В `simulationTick`, заменить строку `trucks.push(createTruck(now));` на:

```js
    trucks.push(createTruck(now, state.fleetNormLPerHour));
```

В определении `useSimulationStore`, добавить `fleetNormLPerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,` в начальное состояние (рядом с `sessionLog: []`), передать норму при создании начальных машин в `startSimulation`, и добавить действие `fetchFleetNorm`:

```js
export const useSimulationStore = create((set, get) => ({
  trucks: [],
  nextSpawnAt: 0,
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
    for (let i = 0; i < MIN_ACTIVE_TRUCKS; i++) {
      initial.push(createTruck(now - i * 400, norm));
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

- [ ] **Step 8: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 9: Подключить в `App.jsx`**

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
  const fetchFleetNorm = useSimulationStore((s) => s.fetchFleetNorm);

  useEffect(() => {
    startSimulation();
    fetchFleetNorm();
  }, [startSimulation, fetchFleetNorm]);

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

- [ ] **Step 10: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 11: Запустить dev-сервер и проверить, что без запущенного AnythingLLM симуляция стартует как обычно**

```bash
npm run dev
```

Открыть `/map` (AnythingLLM не запущен на этой машине). Ожидается: симуляция стартует как раньше, машины появляются и едут, никакой ошибки в UI не показывается (RAG-запрос падает тихо в фоне). Проверить консоль браузера — ожидается лог сетевой ошибки `fetch` (нормально, AnythingLLM не запущен), но НЕ необработанное исключение React/ошибку рендера.

- [ ] **Step 12: Commit**

```bash
git add src/simulation/fuel.js src/simulation/fuel.test.js src/simulation/store.js src/simulation/store.test.js src/App.jsx
git commit -m "feat: fetch fleet fuel norm from AnythingLLM with silent fallback"
```

---

## Task 3: `ExplainButton` — переиспользуемый компонент для трёх кнопочных сценариев

**Files:**
- Create: `src/components/ExplainButton.jsx`

**Interfaces:**
- Consumes: `chatWithWorkspace` из `src/lib/anythingllm.js` (Task 1).
- Produces: `<ExplainButton workspaceSlug={string|null} buildPrompt={() => string} label={string} variant={'dark'|'light'} />` — компонент без пропа результата наружу (управляет своим состоянием сам); используется в Task 4/5 (`DispatcherPanel.jsx`) и Task 6 (`FuelReportPage.jsx`).

- [ ] **Step 1: Реализовать компонент**

```jsx
// src/components/ExplainButton.jsx
import { useState } from 'react';
import { chatWithWorkspace } from '../lib/anythingllm';

const VARIANTS = {
  dark: {
    button: 'text-blue-400 hover:text-blue-300 disabled:text-slate-500',
    result: 'text-slate-300 bg-slate-800/60 border border-slate-700',
    error: 'text-red-400',
  },
  light: {
    button: 'text-blue-600 hover:text-blue-700 disabled:text-slate-400',
    result: 'text-slate-700 bg-slate-50 border border-slate-200',
    error: 'text-red-600',
  },
};

// Кнопка одного из трёх LLM-сценариев (объяснение решения, сводка отчёта,
// объяснение причины аномалии) — idle -> loading -> результат/ошибка.
// buildPrompt вызывается лениво, только по клику (не на каждый рендер),
// чтобы не пересчитывать промпт впустую, пока кнопку не нажали.
export default function ExplainButton({ workspaceSlug, buildPrompt, label = 'Объяснить', variant = 'dark' }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [text, setText] = useState('');
  const styles = VARIANTS[variant];

  async function handleClick() {
    setState('loading');
    const result = await chatWithWorkspace(workspaceSlug, buildPrompt());
    if (result.ok) {
      setText(result.text);
      setState('done');
    } else {
      setState('error');
    }
  }

  if (state === 'done') {
    return <div className={`mt-1 text-[11px] rounded px-2 py-1 ${styles.result}`}>{text}</div>;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`mt-1 text-[11px] font-medium ${state === 'error' ? styles.error : styles.button}`}
    >
      {state === 'loading' ? 'Спрашиваю ИИ…' : state === 'error' ? 'ИИ-сервис недоступен — повторить' : label}
    </button>
  );
}
```

- [ ] **Step 2: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок (компонент пока нигде не подключён — сборка проверяет только синтаксис/импорты).

- [ ] **Step 3: Commit**

```bash
git add src/components/ExplainButton.jsx
git commit -m "feat: add reusable ExplainButton for LLM explain scenarios"
```

---

## Task 4: Сценарий 1 — "Объяснить решение" в панели диспетчера

**Files:**
- Modify: `src/simulation/dispatch.js`
- Modify: `src/simulation/dispatch.test.js`
- Modify: `src/components/DispatcherPanel.jsx`

**Interfaces:**
- Consumes: `ExplainButton` (Task 3); `resolveWorkspaceSlug`, `WORKSPACE_DISPATCH_SLUG`, `WORKSPACE_DOCS_SLUG` из `src/lib/anythingllm.js` (Task 1).
- Produces (`dispatch.js`): `buildDispatchExplainPrompt(event, loadPoints): string`.

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `src/simulation/dispatch.test.js`:

```js
describe('buildDispatchExplainPrompt', () => {
  it('строит промпт с номером машины, названием точки и причиной решения', () => {
    const event = {
      truckNumber: '42',
      fromLabel: 'Въезд',
      toLoadPointId: 'lp-a',
      reason: 'Точка A — ближайшая свободная точка (120 м, очередь 0)',
    };
    const loadPoints = [{ id: 'lp-a', name: 'Точка A' }, { id: 'lp-b', name: 'Точка B' }];
    const prompt = buildDispatchExplainPrompt(event, loadPoints);

    expect(prompt).toContain('42');
    expect(prompt).toContain('Точка A');
    expect(prompt).toContain('Въезд');
    expect(prompt).toContain('ближайшая свободная точка');
  });

  it('не падает, если точка погрузки не найдена в списке (использует id как запасной текст)', () => {
    const event = { truckNumber: '42', fromLabel: 'Въезд', toLoadPointId: 'lp-x', reason: 'причина' };
    const prompt = buildDispatchExplainPrompt(event, []);
    expect(prompt).toContain('lp-x');
  });
});
```

Добавить `buildDispatchExplainPrompt` в импорт из `./dispatch` в начале файла.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/dispatch.test.js
```

Expected: FAIL — `buildDispatchExplainPrompt is not a function`.

- [ ] **Step 3: Реализовать `buildDispatchExplainPrompt`**

Добавить в конец `src/simulation/dispatch.js`:

```js
// Промпт для сценария "Объяснить решение" (ТЗ, "Интеграция AnythingLLM",
// сценарий 1) — строится из уже накопленных полей события ленты диспетчера,
// включая человекочитаемую причину (reason), которую уже сформировал
// chooseLoadPoint/сценарий с затором.
export function buildDispatchExplainPrompt(event, loadPoints) {
  const point = loadPoints.find((lp) => lp.id === event.toLoadPointId);
  const pointName = point ? point.name : event.toLoadPointId;
  return `Объясни диспетчерское решение простым языком для диспетчера карьера: машина №${event.truckNumber} выехала из точки «${event.fromLabel}» и направлена в точку «${pointName}». Причина решения алгоритма: ${event.reason}.`;
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/dispatch.test.js
```

Expected: PASS.

- [ ] **Step 5: Подключить кнопку к первому (самому свежему) событию в панели**

В `src/components/DispatcherPanel.jsx` добавить импорты в начало файла:

```jsx
import ExplainButton from './ExplainButton';
import { buildDispatchExplainPrompt } from '../simulation/dispatch';
import { resolveWorkspaceSlug, WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG } from '../lib/anythingllm';
```

Добавить константу сразу после импортов (вычисляется один раз на модуль — сценарии 1 и 4 используют одно и то же техническое рабочее пространство, ТЗ):

```jsx
const DISPATCH_WORKSPACE_SLUG = resolveWorkspaceSlug(WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG);
```

В блоке "Лента событий" заменить `{events.map((e) => (` на `{events.map((e, i) => (` и добавить кнопку внутрь `<li>`, только для первого элемента (`i === 0`):

```jsx
<ul className="space-y-2 text-xs">
  {events.map((e, i) => (
    <li key={e.id} className="text-slate-300 border-l-2 border-slate-700 pl-2">
      <div className="font-medium">№{e.truckNumber}: {e.fromLabel} → точка погрузки</div>
      <div className="text-slate-400">{e.reason}</div>
      {i === 0 && (
        <ExplainButton
          workspaceSlug={DISPATCH_WORKSPACE_SLUG}
          variant="dark"
          label="Объяснить решение"
          buildPrompt={() => buildDispatchExplainPrompt(e, loadPoints)}
        />
      )}
    </li>
  ))}
  {events.length === 0 && <li className="text-slate-500">Пока нет решений диспетчера</li>}
</ul>
```

- [ ] **Step 6: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 7: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`, дождаться хотя бы одного события в ленте. Ожидается: у самого верхнего (свежего) события — кнопка "Объяснить решение"; клик → "Спрашиваю ИИ…" → (AnythingLLM не запущен локально) → "ИИ-сервис недоступен — повторить", приложение не падает. Сделать реальный скриншот headless-браузером (Playwright) до и после клика. Проверить консоль браузера — только ожидаемая сетевая ошибка, без необработанного исключения React.

- [ ] **Step 8: Commit**

```bash
git add src/simulation/dispatch.js src/simulation/dispatch.test.js src/components/DispatcherPanel.jsx
git commit -m "feat: add explain-decision button to dispatcher event feed"
```

---

## Task 5: Сценарий 4 — "Объяснить причину" для аномалий

**Files:**
- Modify: `src/simulation/anomaly.js`
- Modify: `src/simulation/anomaly.test.js`
- Modify: `src/components/DispatcherPanel.jsx`

**Interfaces:**
- Consumes: `ExplainButton` (Task 3); `DISPATCH_WORKSPACE_SLUG` (Task 4, уже вычислен в `DispatcherPanel.jsx`); `LOADING_DURATION_RANGE` из `src/simulation/store.js`.
- Produces (`anomaly.js`): `buildAnomalyExplainPrompt(truck, normalLoadingDurationMs): string`.

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `src/simulation/anomaly.test.js`:

```js
describe('buildAnomalyExplainPrompt', () => {
  it('строит промпт по шаблону ТЗ для IDLE_OVERRUN', () => {
    const truck = makeTruck({
      phase: 'LOADING',
      phaseAccountedMs: 13000,
      anomalyType: 'IDLE_OVERRUN',
      movingMs: 0,
      fuelConsumedThisShift: 0,
    });
    const prompt = buildAnomalyExplainPrompt(truck, 8000);
    expect(prompt).toContain('42');
    expect(prompt).toContain('IDLE_OVERRUN');
    expect(prompt).toContain('LOADING');
    expect(prompt).toContain('13 сек');
    expect(prompt).toContain('8 сек');
  });

  it('строит промпт по шаблону ТЗ для MECHANICAL_FAULT с процентом отклонения', () => {
    const truck = makeTruck({
      phase: 'TO_LOAD',
      anomalyType: 'MECHANICAL_FAULT',
      movingMs: 3600000,
      fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.3,
    });
    const prompt = buildAnomalyExplainPrompt(truck, 8000);
    expect(prompt).toContain('42');
    expect(prompt).toContain('MECHANICAL_FAULT');
    expect(prompt).toContain('+30.0%');
  });
});
```

Добавить `buildAnomalyExplainPrompt` в импорт из `./anomaly` в начале файла.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/anomaly.test.js
```

Expected: FAIL — `buildAnomalyExplainPrompt is not a function`.

- [ ] **Step 3: Реализовать `buildAnomalyExplainPrompt`**

Добавить в конец `src/simulation/anomaly.js`:

```js
// Промпт для сценария "Объяснить причину" (ТЗ, "Интеграция AnythingLLM",
// сценарий 4) — дословно по шаблону из раздела "Аномалии".
export function buildAnomalyExplainPrompt(truck, normalLoadingDurationMs) {
  const dev = deviationPercent(truck);
  const devStr = `${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%`;
  const normS = Math.round(normalLoadingDurationMs / 1000);
  const elapsedS = Math.round(truck.phaseAccountedMs / 1000);
  return `Объясни диспетчеру простым языком, почему машину ${truck.number} рекомендовано направить на технический осмотр. Причина: ${truck.anomalyType}. Отклонение расхода топлива: ${devStr}, текущая фаза: ${truck.phase}, время в фазе: ${elapsedS} сек (норма ~${normS} сек).`;
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/anomaly.test.js
```

Expected: PASS.

- [ ] **Step 5: Подключить кнопку под рекомендацией в `TruckRow`**

В `src/components/DispatcherPanel.jsx` добавить в импорты:

```jsx
import { buildAnomalyExplainPrompt } from '../simulation/anomaly';
import { LOADING_DURATION_RANGE } from '../simulation/store';
```

`TruckRow` — компонент без доступа к модульной константе `DISPATCH_WORKSPACE_SLUG`, объявленной вне него — она видна как обычная переменная модуля, дополнительный проп не нужен. Заменить блок разворачиваемой рекомендации:

```jsx
{hasAnomaly && expanded && (
  <div className="mt-1 text-[11px] text-red-300 bg-red-950/40 border border-red-900 rounded px-2 py-1">
    {truck.anomalyRecommendation}
    <ExplainButton
      workspaceSlug={DISPATCH_WORKSPACE_SLUG}
      variant="dark"
      label="Объяснить причину"
      buildPrompt={() => buildAnomalyExplainPrompt(truck, LOADING_DURATION_RANGE[1])}
    />
  </div>
)}
```

- [ ] **Step 6: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 7: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`, подождать 30-90 секунд, пока не появится машина со значком ⚠ (см. этап 5). Кликнуть по значку → рекомендация разворачивается → под ней кнопка "Объяснить причину" → клик → "Спрашиваю ИИ…" → "ИИ-сервис недоступен — повторить" (AnythingLLM не запущен локально). Сделать реальный скриншот. Проверить консоль браузера на необработанные исключения.

- [ ] **Step 8: Commit**

```bash
git add src/simulation/anomaly.js src/simulation/anomaly.test.js src/components/DispatcherPanel.jsx
git commit -m "feat: add explain-cause button to anomaly recommendations"
```

---

## Task 6: Сценарий 3 — "Сформировать сводку" на странице отчёта

**Files:**
- Create: `src/simulation/fuelReportSummary.js`
- Create: `src/simulation/fuelReportSummary.test.js`
- Modify: `src/pages/FuelReportPage.jsx`

**Interfaces:**
- Consumes: `deviationPercent` из `src/simulation/fuel.js`; `ExplainButton` (Task 3); `resolveWorkspaceSlug`, `WORKSPACE_DISPATCH_SLUG`, `WORKSPACE_DOCS_SLUG` из `src/lib/anythingllm.js` (Task 1).
- Produces: `buildFuelReportRows(trucks, sessionLog): Array<{ truckNumber, distanceKm, fuelConsumed, normLPerHour, deviation, status }>` (заменяет прежнюю локальную `buildRows` в `FuelReportPage.jsx` — та же форма строки, чтобы не менять остальной код страницы); `buildFuelSummaryPrompt(trucks, sessionLog): string`.

- [ ] **Step 1: Написать падающие тесты**

```js
// src/simulation/fuelReportSummary.test.js
import { describe, it, expect } from 'vitest';
import { buildFuelReportRows, buildFuelSummaryPrompt } from './fuelReportSummary';
import { FALLBACK_FUEL_NORM_L_PER_HOUR } from './fuel';

function makeActiveTruck(overrides = {}) {
  return {
    number: '42',
    distanceThisShift: 5000,
    fuelConsumedThisShift: 100,
    fuelBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR,
    movingMs: 3600000,
    ...overrides,
  };
}

describe('buildFuelReportRows', () => {
  it('объединяет активные и уехавшие машины в единый список строк', () => {
    const trucks = [makeActiveTruck()];
    const sessionLog = [
      { truckNumber: '17', totalDistanceM: 8000, totalFuelConsumed: 150, normLPerHour: 110, deviationPercent: 10, status: 'завершила смену' },
    ];
    const rows = buildFuelReportRows(trucks, sessionLog);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ truckNumber: '42', distanceKm: 5, status: 'активна' });
    expect(rows[1]).toMatchObject({ truckNumber: '17', distanceKm: 8, status: 'завершила смену' });
  });
});

describe('buildFuelSummaryPrompt', () => {
  it('возвращает заглушку-промпт, если данных ещё нет', () => {
    const prompt = buildFuelSummaryPrompt([], []);
    expect(prompt).toContain('данных');
  });

  it('включает агрегаты и худших по отклонению машин в промпт', () => {
    const trucks = [
      makeActiveTruck({ number: '01', fuelConsumedThisShift: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5, actualBurnRatePerHour: FALLBACK_FUEL_NORM_L_PER_HOUR * 1.5 }),
      makeActiveTruck({ number: '02' }),
    ];
    const prompt = buildFuelSummaryPrompt(trucks, []);
    expect(prompt).toContain('2');
    expect(prompt).toContain('№01');
    expect(prompt).toMatch(/\+50\.0%/);
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/fuelReportSummary.test.js
```

Expected: FAIL — `Cannot find module './fuelReportSummary'`.

- [ ] **Step 3: Реализовать `fuelReportSummary.js`**

```js
// src/simulation/fuelReportSummary.js
import { deviationPercent } from './fuel';

// Общая форма строки отчёта — используется и таблицей (FuelReportPage), и
// текстовой сводкой для LLM (buildFuelSummaryPrompt), чтобы не дублировать
// правила сборки активных/уехавших машин в двух местах.
export function buildFuelReportRows(trucks, sessionLog) {
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

// Текстовый пакет-агрегат для сценария "Сформировать сводку" (ТЗ,
// "Интеграция AnythingLLM", сценарий 3): суммарные показатели + топ-3
// машины по величине отклонения (перерасход или экономия).
export function buildFuelSummaryPrompt(trucks, sessionLog) {
  const rows = buildFuelReportRows(trucks, sessionLog);
  if (rows.length === 0) {
    return 'Опиши одним абзацем для руководства: данных по сменам пока нет, симуляция ещё не сформировала ни одной записи.';
  }

  const totalDistanceKm = rows.reduce((sum, r) => sum + r.distanceKm, 0);
  const totalFuelL = rows.reduce((sum, r) => sum + r.fuelConsumed, 0);
  const avgDeviation = rows.reduce((sum, r) => sum + r.deviation, 0) / rows.length;

  const worst = [...rows].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)).slice(0, 3);
  const worstText = worst
    .map((r) => `№${r.truckNumber} (${r.deviation >= 0 ? '+' : ''}${r.deviation.toFixed(1)}%)`)
    .join(', ');

  return `Опиши одним абзацем для руководства сводку по топливному отчёту карьера: всего машин за смену — ${rows.length}, суммарный пробег — ${totalDistanceKm.toFixed(1)} км, суммарный расход — ${totalFuelL.toFixed(0)} л, среднее отклонение от нормы — ${avgDeviation >= 0 ? '+' : ''}${avgDeviation.toFixed(1)}%. Машины с наибольшим отклонением: ${worstText}.`;
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/fuelReportSummary.test.js
```

Expected: PASS.

- [ ] **Step 5: Подключить в `FuelReportPage.jsx`**

Заменить весь файл `src/pages/FuelReportPage.jsx` (переиспользует `buildFuelReportRows` вместо локальной `buildRows`, добавляет кнопку сводки):

```jsx
// src/pages/FuelReportPage.jsx
import { useMemo, useState } from 'react';
import { useSimulationStore } from '../simulation/store';
import { statusColorForDeviation } from '../simulation/fuel';
import { buildFuelReportRows, buildFuelSummaryPrompt } from '../simulation/fuelReportSummary';
import ExplainButton from '../components/ExplainButton';
import { resolveWorkspaceSlug, WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG } from '../lib/anythingllm';

const SUMMARY_WORKSPACE_SLUG = resolveWorkspaceSlug(WORKSPACE_DISPATCH_SLUG, WORKSPACE_DOCS_SLUG);

const COLUMNS = [
  { key: 'truckNumber', label: '№' },
  { key: 'distanceKm', label: 'Пробег, км' },
  { key: 'fuelConsumed', label: 'Расход, л' },
  { key: 'normLPerHour', label: 'Норма, л/ч' },
  { key: 'deviation', label: 'Откл., %' },
  { key: 'status', label: 'Статус' },
];

export default function FuelReportPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const sessionLog = useSimulationStore((s) => s.sessionLog);
  const [sortKey, setSortKey] = useState('truckNumber');
  const [sortDir, setSortDir] = useState('asc');

  const rows = useMemo(() => {
    const all = buildFuelReportRows(trucks, sessionLog);
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Полный отчёт по топливу</h1>
        <ExplainButton
          workspaceSlug={SUMMARY_WORKSPACE_SLUG}
          variant="light"
          label="Сформировать сводку"
          buildPrompt={() => buildFuelSummaryPrompt(trucks, sessionLog)}
        />
      </div>
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

- [ ] **Step 6: Прогнать всю тестовую папку и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны.

- [ ] **Step 7: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`, подождать 20-30 секунд, перейти на `/fuel-report`. Ожидается: таблица работает как раньше (сортировка кликом по заголовку), рядом с заголовком — кнопка "Сформировать сводку"; клик → "Спрашиваю ИИ…" → "ИИ-сервис недоступен — повторить" (AnythingLLM не запущен локально), таблица остаётся полностью рабочей. Сделать реальный скриншот. Проверить консоль браузера.

- [ ] **Step 8: Commit**

```bash
git add src/simulation/fuelReportSummary.js src/simulation/fuelReportSummary.test.js src/pages/FuelReportPage.jsx
git commit -m "feat: add fuel report AI summary button"
```

---

## Task 7: Страница "ИИ-ассистент по документации"

**Files:**
- Modify: `src/pages/AssistantPage.jsx`

**Interfaces:**
- Consumes: `chatWithWorkspace`, `resolveWorkspaceSlug`, `WORKSPACE_DOCS_SLUG`, `WORKSPACE_DISPATCH_SLUG` из `src/lib/anythingllm.js` (Task 1).

- [ ] **Step 1: Написать чат-страницу**

```jsx
// src/pages/AssistantPage.jsx
import { useState } from 'react';
import { chatWithWorkspace, resolveWorkspaceSlug, WORKSPACE_DOCS_SLUG, WORKSPACE_DISPATCH_SLUG } from '../lib/anythingllm';

const DOCS_WORKSPACE_SLUG = resolveWorkspaceSlug(WORKSPACE_DOCS_SLUG, WORKSPACE_DISPATCH_SLUG);

export default function AssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;

    setMessages((m) => [...m, { role: 'user', text, sources: [] }]);
    setInput('');
    setPending(true);

    const result = await chatWithWorkspace(DOCS_WORKSPACE_SLUG, text);
    setMessages((m) => [
      ...m,
      result.ok
        ? { role: 'assistant', text: result.text, sources: result.sources }
        : { role: 'assistant', text: 'ИИ-сервис недоступен, попробуйте позже.', sources: [] },
    ]);
    setPending(false);
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col p-4 max-w-3xl mx-auto">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && !pending && (
          <div className="text-sm text-slate-400">Задайте вопрос по технической документации.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'
              }`}
            >
              <div>{m.text}</div>
              {m.sources.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-400">
                  Источники: {m.sources.map((s) => s.title ?? s.name ?? 'документ').join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="text-sm text-slate-400">ИИ печатает…</div>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Введите вопрос…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:bg-slate-300"
        >
          Отправить
        </button>
      </form>
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

Открыть `/assistant`. Ожидается: пустое состояние с подсказкой, поле ввода снизу. Ввести любой вопрос и отправить (Enter или кнопка) → сообщение пользователя появляется справа (синее) → "ИИ печатает…" → (AnythingLLM не запущен локально) ответ ассистента слева с текстом "ИИ-сервис недоступен, попробуйте позже." Поле ввода снова доступно. Сделать реальные скриншоты (пустое состояние + после отправки сообщения). Проверить консоль браузера на необработанные исключения.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AssistantPage.jsx
git commit -m "feat: implement AI documentation assistant chat page"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 6)**: единая функция `chatWithWorkspace` с указанным URL/заголовками/телом — Task 1. Env-переменные и правило "один slug — для всех сценариев" — Task 1 (`resolveWorkspaceSlug`) + `.env.example`. Сценарий 1 (объяснение решения) — Task 4. Сценарий 2 (RAG-запрос нормы) — Task 2. Сценарий 3 (сводка отчёта) — Task 6. Сценарий 4 (объяснение аномалии) — Task 5. Обработка сбоя (сеть/таймаут/не-200 → заглушка в UI; норма топлива → тихий fallback) — Task 1 (базовый механизм) + Task 2 (тихий fallback нормы) + Task 3 (заглушка "ИИ-сервис недоступен — повторить" в `ExplainButton`, переиспользуется в Task 4/5/6) + Task 7 (заглушка в чате). Страница ассистента (поле ввода, история, "печатает…", источники) — Task 7.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `chatWithWorkspace(slug, message, options)` определена в Task 1 с сигнатурой `{ ok, error, text, sources }`, используется без изменений в Task 2 (`fetchFleetNorm`), Task 3 (`ExplainButton`), Task 7 (`AssistantPage`). `resolveWorkspaceSlug(preferred, fallback)` из Task 1 используется одинаково в Task 2, 4, 6, 7. `createTruck(now, normLPerHour = FALLBACK_FUEL_NORM_L_PER_HOUR)` — новый параметр Task 2, обратно совместим с вызовами без него из этапов 4/5 (`store.test.js` их не меняет). `buildFuelReportRows` (Task 6) — та же форма строки (`truckNumber, distanceKm, fuelConsumed, normLPerHour, deviation, status`), что и прежняя локальная `buildRows` в `FuelReportPage.jsx` (этап 4) — замена 1:1, остальной код страницы (сортировка, рендер таблицы) не меняется.
- **Архитектурное уточнение спеки**: промпт сценария 1 ("объяснение решения диспетчера") в ТЗ описан как "по шаблону из ТЗ (номер машины, точки A/B, очереди, расстояния)" без буквального текста шаблона нигде в проекте; `buildDispatchExplainPrompt` (Task 4) использует то, что реально доступно на объекте события ленты диспетчера — включая уже человекочитаемый `reason`, в котором `chooseLoadPoint`/сценарий с затором уже упоминают расстояния и очереди текстом. Результат достигает той же цели (понятное объяснение решения простым языком), не выдумывая несуществующий формат.
- **Тестирование UI-компонентов**: в проекте нет `@testing-library/react`/`jsdom`-окружения для тестов уровня компонентов (Tech Stack — "без новых зависимостей", как и в этапах 4/5) — поэтому `ExplainButton`, кнопки в `DispatcherPanel`/`FuelReportPage` и страница `AssistantPage` проверяются вручную через dev-сервер и реальные скриншоты headless-браузера, тем же способом, что и вся остальная React-часть проекта до этого этапа. Вся логика, которую практично и осмысленно тестировать автоматически (сетевой клиент, парсинг нормы, сборка промптов, агрегаты отчёта), покрыта юнит-тестами в Task 1/2/4/5/6.
