# Мурунтау MVP — Этап 7: полировка Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Финальный проход перед демо: машины визуально доворачиваются носом по ходу движения вместо статичной ориентации (найдено при визуальном ревью — делает сцену заметно "живее"), проверено покрытие `TODO`-комментариев о будущей интеграции реальных трекеров, устранён мелкий технический долг (задвоенный импорт), навигация между тремя страницами и пользовательский текст проверены финально.

**Architecture:** Направление движения — чистая, тестируемая геометрия (`pathDirectionAt(path, t)` в `src/simulation/constants.js`, рядом с уже существующими `buildRoutePoints`/`pathLength`), используемая императивно в `Truck.jsx`'s `useFrame` — сама постановка модели по курсу остаётся чисто визуальным, покадровым эффектом (как и вся анимация машин в этом проекте), не пишется в Zustand. Поворот применяется только в фазах реального движения (`TO_LOAD`/`EXITING`) — в остальных фазах `rotation.y` группы не трогается, поэтому машина сохраняет последний известный курс, а не дёргается к дефолтной ориентации во время погрузки/на въезде.

**Tech Stack:** Без новых зависимостей.

## Global Constraints

- Машины визуально поворачиваются носом (кабиной) по направлению движения, пока едут (`TO_LOAD`/`EXITING`); в остальных фазах ориентация не меняется.
- Комментарии `TODO: заменить на реальные данные трекеров в проде` должны быть на всех местах, где симулятор имитирует то, что в проде придёт с реальных GPS-трекеров.
- Финальная проверка навигации/стилей — все три маршрута (`/map`, `/fuel-report`, `/assistant`) доступны через шапку, без утечки внутренних терминов вида "этап N" в пользовательский текст.
- Область этого плана — только этап 7, последний по дизайн-спеке. После него — демо.

---

## Task 1: Машины доворачиваются по курсу движения

**Files:**
- Modify: `src/simulation/constants.js`
- Modify: `src/simulation/constants.test.js`
- Modify: `src/components/scene/Truck.jsx`

**Interfaces:**
- Produces (`constants.js`): `pathDirectionAt(path: Array<[number, number, number]>, t: number): [number, number] | null` — ненормализованное направление (dx, dz) в точке `t ∈ [0,1]` пути; `null`, если сегмент вырожден (нулевой длины).

- [ ] **Step 1: Написать падающий тест**

Добавить `pathDirectionAt` в импорт из `./constants` в `src/simulation/constants.test.js` и добавить в конец файла:

```js
describe('pathDirectionAt', () => {
  it('возвращает направление сегмента по x/z для t в середине пути', () => {
    const path = [[0, 0, 0], [10, 5, 0], [10, 5, 10]];
    // t=0.25 -> середина первого сегмента (0,0,0)->(10,5,0): направление вдоль +x
    const [dx, dz] = pathDirectionAt(path, 0.25);
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeCloseTo(0);
  });

  it('переключается на направление следующего сегмента после половины пути', () => {
    const path = [[0, 0, 0], [10, 5, 0], [10, 5, 10]];
    // t=0.75 -> середина второго сегмента (10,5,0)->(10,5,10): направление вдоль +z
    const [dx, dz] = pathDirectionAt(path, 0.75);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeGreaterThan(0);
  });

  it('зажимает t к [0,1]', () => {
    const path = [[0, 0, 0], [10, 0, 0]];
    expect(pathDirectionAt(path, -1)).toEqual(pathDirectionAt(path, 0));
    expect(pathDirectionAt(path, 2)).toEqual(pathDirectionAt(path, 1));
  });

  it('возвращает null для вырожденного (нулевой длины) сегмента', () => {
    const path = [[5, 0, 5], [5, 0, 5]];
    expect(pathDirectionAt(path, 0.5)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: FAIL — `pathDirectionAt is not a function`.

- [ ] **Step 3: Реализовать `pathDirectionAt`**

Добавить в конец `src/simulation/constants.js`:

```js
// Направление движения (ненормализованный вектор [dx, dz] по осям x/z) в
// точке t∈[0,1] пути — используется, чтобы довернуть модель машины носом по
// ходу движения (см. components/scene/Truck.jsx). Высота (y) не участвует —
// поворот модели только вокруг вертикальной оси. Возвращает null, если
// сегмент в этой точке вырожден (нулевой длины) — вызывающий код тогда
// сохраняет прежний курс, а не дёргает модель к (0,0).
export function pathDirectionAt(path, t) {
  const segCount = path.length - 1;
  const clampedT = Math.min(1, Math.max(0, t));
  const segT = clampedT * segCount;
  const segIndex = Math.min(segCount - 1, Math.floor(segT));
  const [ax, , az] = path[segIndex];
  const [bx, , bz] = path[segIndex + 1];
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return null;
  return [dx, dz];
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Подключить поворот модели в `Truck.jsx`**

Добавить импорт в начало `src/components/scene/Truck.jsx`:

```jsx
import { pathDirectionAt } from '../../simulation/constants';
```

В `useFrame`, сразу после строки `if (groupRef.current) groupRef.current.position.set(x, y, z);`, добавить доворот по курсу (только в фазах реального движения — TO_LOAD/EXITING; в остальных фазах rotation.y не трогается, машина сохраняет последний курс):

```jsx
  useFrame(() => {
    const now = performance.now();
    const [x, y, z] = interpolatedPosition(truck, now);
    if (groupRef.current) groupRef.current.position.set(x, y, z);

    if ((truck.phase === 'TO_LOAD' || truck.phase === 'EXITING') && groupRef.current) {
      const t = Math.min(1, Math.max(0, (now - truck.phaseStartedAt) / truck.phaseDurationMs));
      const dir = pathDirectionAt(truck.path, t);
      if (dir) {
        const [dx, dz] = dir;
        // Кабина смотрит вдоль локальной -X (см. геометрию ниже: кабина на
        // x=-1.5, кузов на x=+0.6) — доворачиваем группу вокруг Y так, чтобы
        // локальная -X совпала с мировым направлением движения (dx, dz).
        groupRef.current.rotation.y = Math.atan2(dz, -dx);
      }
    }

    const loading = truck.phase === 'LOADING';
```

(остальная часть `useFrame` — прогрессбар и пульсация кузова — не меняется).

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

Открыть `/map`, понаблюдать за несколькими машинами, едущими в разные точки погрузки по разным дугам карьера. Ожидается: кабина (тёмный выступ) каждой едущей машины направлена вперёд по ходу движения — не вбок и не назад; на поворотах маршрута (переход между сегментами `path`) машина плавно доворачивается; во время `LOADING`/`ENTERING`/после `DONE` ориентация не дёргается (машина держит тот курс, с которым остановилась). Сделать реальный скриншот headless-браузером (Playwright) с несколькими видимыми машинами на разных участках трассы и визуально сверить направление кабины с направлением движения по дороге под ней (светящаяся `RouteTube`). Если ориентация оказывается перевёрнутой или повёрнутой на 90° — поменять знак/добавить смещение в формуле `Math.atan2(dz, -dx)` в `Truck.jsx` (например, `Math.atan2(-dz, dx)` или `+ Math.PI`) и переснять скриншот, пока кабина визуально не совпадёт с направлением движения. Проверить консоль браузера на ошибки.

- [ ] **Step 8: Commit**

```bash
git add src/simulation/constants.js src/simulation/constants.test.js src/components/scene/Truck.jsx
git commit -m "feat: rotate truck models to face travel direction"
```

---

## Task 2: Аудит комментариев `TODO: заменить на реальные данные трекеров в проде`

**Files:**
- Read-only проверка: `src/simulation/constants.js`, `src/simulation/store.js`, весь `src/simulation/*.js`

**Interfaces:**
- Ничего не производит для последующих задач — это проверочная задача без гарантированных изменений кода.

- [ ] **Step 1: Найти все места, имитирующие данные, которые в проде придут с реальных трекеров**

```bash
grep -rn "TODO" src/simulation
```

Ожидаются как минимум:
- `src/simulation/constants.js:2` — комментарий над координатами `ENTRY_POINT`/`EXIT_POINT`/`LOAD_POINTS`.
- `src/simulation/store.js` — комментарий над `TICK_INTERVAL_MS` (частота тика диспетчера — в проде это интервал прихода реальных данных с трекеров).

- [ ] **Step 2: Проверить, что оба комментария точно на нужных строках и с нужной формулировкой**

Прочитать первые 5 строк `src/simulation/constants.js` — комментарий должен стоять прямо над блоком `ENTRY_POINT`/`EXIT_POINT`/`LOAD_POINTS`. Прочитать определение `TICK_INTERVAL_MS` в `src/simulation/store.js` — комментарий должен быть на той же строке, что и объявление константы.

Если оба на месте и не искажены случайными правками в этапах 2-6 — **никаких изменений не требуется**, это ожидаемый результат аудита (место, где реальный движок тика уже сейчас чётко помечен как временная имитация). Если один из них пропал или переехал — восстановить его дословно на прежнем месте:

```js
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
```

```js
export const TICK_INTERVAL_MS = 1500; // TODO: заменить на реальные данные трекеров в проде
```

- [ ] **Step 3: Убедиться, что других мест, имитирующих трекеры, без пометки, не осталось**

Прочитать `simulationTick` в `src/simulation/store.js` целиком ещё раз — единственный источник "прихода данных" в архитектуре этого проекта — вызов `simulationTick` из `setInterval` в `startSimulation()`, который уже помечен через `TICK_INTERVAL_MS`. Случайность в `anomaly.js` (`rollSeededAnomaly` и т.д.) и в `store.js` (`randomInRange` для таймингов фаз) — это не имитация реальных трекерных данных, а намеренная демо-логика (сценарии для защиты), помечать её тем же `TODO` не нужно — это осознанное решение, не пропуск.

- [ ] **Step 4: Ничего коммитить не нужно, если Step 2 не потребовал восстановления**

Если правка всё же понадобилась:

```bash
git add src/simulation/constants.js src/simulation/store.js
git commit -m "chore: restore tracker-data TODO comment"
```

---

## Task 3: Мелкая уборка и финальная проверка навигации

**Files:**
- Modify: `src/simulation/store.js`

**Interfaces:**
- Ничего не производит для последующих задач — последняя задача плана.

- [ ] **Step 1: Объединить задвоенный импорт из `./fuel` в `store.js`**

В `src/simulation/store.js` сейчас два отдельных `import { ... } from './fuel'` (один — из этапа 4/5, второй добавлен в этапе 6 для `parseFuelNormLPerHour`/`FUEL_NORM_RAG_PROMPT`). Заменить оба на один:

```js
import {
  accrueFuelAndDistance,
  deviationPercent,
  FALLBACK_FUEL_NORM_L_PER_HOUR,
  FUEL_TANK_CAPACITY_L,
  parseFuelNormLPerHour,
  FUEL_NORM_RAG_PROMPT,
} from './fuel';
```

(строка `import { parseFuelNormLPerHour, FUEL_NORM_RAG_PROMPT } from './fuel';` ниже — удалить).

- [ ] **Step 2: Прогнать тесты и сборку**

```bash
npx vitest run
npm run build
```

Expected: оба успешны (чисто рефакторинг импортов, поведение не меняется).

- [ ] **Step 3: Запустить dev-сервер и проверить навигацию/копирайт целиком**

```bash
npm run dev
```

Пройти по всем трём пунктам шапки (`Карта`, `Отчёт по топливу`, `ИИ-ассистент`) кликами (не прямыми переходами по URL — так проверяется именно клиентский роутинг `NavLink`, а не что каждый маршрут в принципе рендерится). На каждой странице проверить:
- активный пункт меню подсвечен;
- заголовок вкладки браузера (`Зийрак ИИ — Диспетчеризация Мурунтау`) не меняется между страницами;
- нигде в видимом тексте интерфейса нет слов "этап"/"stage"/номеров этапов — только пользовательские формулировки.

Сделать реальные скриншоты каждой из трёх страниц (headless-браузер, Playwright) для финальной визуальной фиксации состояния перед демо. Проверить консоль браузера на ошибки на каждой странице.

- [ ] **Step 4: Commit**

```bash
git add src/simulation/store.js
git commit -m "chore: merge duplicate fuel import and finalize navigation review"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 7)**: "финальная проверка навигации и стилей" — Task 3. "Комментарии `TODO: заменить на реальные данные трекеров в проде` на местах симулятора" — Task 2 (аудит, оба места уже на месте с этапа 1/2, задача подтверждает это явно, а не молча полагается на память). Пользовательская находка (машины не доворачиваются по курсу) — Task 1, с явным screenshot-циклом на случай ошибки знака в формуле поворота.
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом; Task 2 и часть Task 3 — по своей природе проверочные (могут не потребовать правок), это явно прописано как ожидаемый штатный исход, а не пропущенный шаг.
- **Согласованность типов/имён**: `pathDirectionAt(path, t)` определена в Task 1, используется только внутри `Truck.jsx` (никакая другая задача плана на неё не полагается — не требует сверки сигнатуры между задачами).
- **Риск, отдельно оговорённый**: точный знак в `Math.atan2(dz, -dx)` (Task 1) выведен вручную из локальной геометрии модели (кабина на x=-1.5) и стандартной матрицы поворота Y в three.js — теоретически может оказаться перевёрнутым на 180°/90° при реальном рендере из-за ошибки в выводе на бумаге; шаг 7 явно предписывает визуально сверить и поправить знак/добавить смещение по месту, а не считать вывод формулы гарантированно верным без скриншота.
