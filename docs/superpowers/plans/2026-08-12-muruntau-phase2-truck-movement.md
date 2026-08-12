# Мурунтау MVP — Этап 2: движение и жизненный цикл машин Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить статичный список машин на живой симулятор: конечный автомат фаз (въезд → в пути → погрузка → выезд → завершение), плавная интерполяция позиции, спавн/деспавн с колебанием количества активных машин 6-10, случайный выбор точки погрузки (диспетчерский алгоритм — следующий этап).

**Architecture:** Zustand-стор (`src/simulation/store.js`) держит массив машин и продвигает их по конечному автомату раз в тик (`setInterval`, имитация прихода данных с трекеров). Позиция машины между двумя точками фазы вычисляется как чистая функция от времени и не пишется в стор каждый кадр — компонент `Truck` сам интерполирует её в `useFrame` через `ref`, читая из стора только редко меняющиеся поля (`phase`, `path`, `phaseStartedAt`, `phaseDurationMs`). Вся логика конечного автомата вынесена в чистые, тестируемые функции (`advanceTruck`, `simulationTick`), не зависящие от Zustand напрямую — сам стор лишь оборачивает их и владеет `setInterval`.

**Tech Stack:** Zustand (стор состояния), @react-three/fiber (`useFrame`), Vitest (тесты чистых функций симулятора).

## Global Constraints

- Один локальный React-проект, `npm run dev` — без изменений.
- Тик симулятора — 1000-2000 мс (берём 1500 мс), имитирует приход данных с трекеров; помечать `// TODO: заменить на реальные данные трекеров в проде` везде, где эмулируются "живые" данные.
- Фазы строго по ТЗ: `ENTERING` (въезд) → `TO_LOAD` (в пути к точке погрузки) → `LOADING` (погрузка, 5-8 сек) → `EXITING` (в пути к выезду) → `DONE` (завершение, машина исчезает).
- Активных машин одновременно: 6-10 (колеблется, не фиксировано).
- В этом этапе выбор точки погрузки для новой машины — **случайный** среди `LOAD_POINTS` (диспетчерский алгоритм по загрузке — этап 3, отдельный план).
- Покадровая интерполяция — через `useFrame` и локальные `ref`, не через запись в Zustand на каждый кадр (иначе лишние ре-рендеры всего дерева).
- Область этого плана — **только этап 2** из дизайн-спеки (`docs/superpowers/specs/2026-08-11-muruntau-dispatch-mvp-design.md`): движение и жизненный цикл. Алгоритм диспетчеризации, очереди, цветовая индикация, scripted-сценарий, панель диспетчера — этап 3, отдельный план после ревью результата этого этапа.

---

## Task 1: Zustand и построение маршрута между двумя точками

**Files:**
- Modify: `package.json` (добавить зависимость `zustand`)
- Modify: `src/simulation/constants.js`
- Test: `src/simulation/constants.test.js`

**Interfaces:**
- Consumes: `groundPosition`, `ENTRY_POINT`, `EXIT_POINT`, `LOAD_POINTS` (уже существуют в `constants.js`).
- Produces: `buildRoutePoints(fromXZ: [number, number], toXZ: [number, number], fromY: number, toY: number, steps?: number): Array<[number, number, number]>` — именованный экспорт из `src/simulation/constants.js`. Угол интерполируется по кратчайшей дуге, радиус и высота — линейно по `t`; результат — массив 3D-точек от `[fromXZ[0], fromY, fromXZ[1]]` до `[toXZ[0], toY, toXZ[1]]` включительно.

- [ ] **Step 1: Установить zustand**

```bash
npm install zustand@^4.5.2
```

- [ ] **Step 2: Написать падающий тест**

```js
// добавить в src/simulation/constants.test.js, после существующих describe-блоков
```

```js
describe('buildRoutePoints', () => {
  it('начинается и заканчивается в заданных точках с заданной высотой', () => {
    const points = buildRoutePoints([0, 26], [23.5, 0], 5, -3, 8);
    expect(points).toHaveLength(9);
    expect(points[0][0]).toBeCloseTo(0);
    expect(points[0][1]).toBeCloseTo(5);
    expect(points[0][2]).toBeCloseTo(26);
    expect(points[8][0]).toBeCloseTo(23.5);
    expect(points[8][1]).toBeCloseTo(-3);
    expect(points[8][2]).toBeCloseTo(0);
  });

  it('высота меняется монотонно от fromY к toY', () => {
    const points = buildRoutePoints([0, 26], [23.5, 0], 5, -3, 8);
    for (let i = 1; i < points.length; i++) {
      expect(points[i][1]).toBeLessThanOrEqual(points[i - 1][1] + 1e-9);
    }
  });

  it('по умолчанию возвращает 9 точек (steps=8)', () => {
    expect(buildRoutePoints([0, 10], [10, 0], 0, 0)).toHaveLength(9);
  });
});
```

Добавить импорт `buildRoutePoints` в существующую строку импорта из `./constants` в начале файла.

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: FAIL — `buildRoutePoints is not a function` (ещё не экспортирован).

- [ ] **Step 4: Реализовать `buildRoutePoints` в `constants.js`**

Добавить в конец `src/simulation/constants.js`:

```js
// Строит плавный путь (массив 3D-точек) от одной плоской точки к другой:
// угол интерполируется по кратчайшей дуге (не через 359° в обратную
// сторону), радиус и высота — линейно по t. Высота НЕ считывается со
// ступенчатой terrainHeightAt на каждом шаге — иначе путь дёргался бы на
// границах уступов; движение машины — отдельный, более плавный слой поверх
// рельефа. Используется для маршрутов машин между фазами (см. simulation/store.js).
export function buildRoutePoints(fromXZ, toXZ, fromY, toY, steps = 8) {
  const [fx, fz] = fromXZ;
  const [tx, tz] = toXZ;
  const rFrom = Math.hypot(fx, fz);
  const rTo = Math.hypot(tx, tz);
  const thFrom = Math.atan2(fz, fx);
  const thToRaw = Math.atan2(tz, tx);
  const twoPi = Math.PI * 2;
  let dTh = thToRaw - thFrom;
  while (dTh > Math.PI) dTh -= twoPi;
  while (dTh < -Math.PI) dTh += twoPi;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = thFrom + dTh * t;
    const r = rFrom + (rTo - rFrom) * t;
    const y = fromY + (toY - fromY) * t;
    points.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return points;
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: PASS, все тесты зелёные (11/11 — 8 старых + 3 новых).

- [ ] **Step 6: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/simulation/constants.js src/simulation/constants.test.js
git commit -m "feat: add zustand dependency and route-building helper"
```

---

## Task 2: Симулятор — конечный автомат фаз, спавн/деспавн

**Files:**
- Create: `src/simulation/store.js`
- Test: `src/simulation/store.test.js`

**Interfaces:**
- Consumes: `ENTRY_POINT`, `EXIT_POINT`, `LOAD_POINTS`, `groundPosition`, `buildRoutePoints` из `src/simulation/constants.js` (Task 1).
- Produces:
  - Чистые функции (тестируемые без реального таймера): `createTruck(now: number): Truck`, `advanceTruck(truck: Truck, now: number): Truck`, `simulationTick(state: {trucks: Truck[], nextSpawnAt: number}, now: number): {trucks: Truck[], nextSpawnAt: number}`, `resetCounters(): void` (сбрасывает счётчики id/номеров — нужно для изоляции тестов).
  - Константы: `MIN_ACTIVE_TRUCKS = 6`, `MAX_ACTIVE_TRUCKS = 10`, `TICK_INTERVAL_MS = 1500`.
  - Zustand-хук `useSimulationStore` с полями `trucks: Truck[]` и методами `startSimulation(): void`, `stopSimulation(): void`.
  - Тип `Truck` (JS-объект): `{ id, number, phase, targetLoadPointId, position: [x,y,z], path: Array<[x,y,z]>, phaseStartedAt: number, phaseDurationMs: number }`.

- [ ] **Step 1: Написать падающие тесты**

```js
// src/simulation/store.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTruck,
  advanceTruck,
  simulationTick,
  resetCounters,
  MAX_ACTIVE_TRUCKS,
} from './store';
import { LOAD_POINTS } from './constants';

beforeEach(() => {
  resetCounters();
});

describe('createTruck', () => {
  it('создаёт машину в фазе ENTERING с целью среди LOAD_POINTS', () => {
    const truck = createTruck(1000);
    expect(truck.phase).toBe('ENTERING');
    expect(LOAD_POINTS.some((lp) => lp.id === truck.targetLoadPointId)).toBe(true);
    expect(truck.phaseStartedAt).toBe(1000);
  });

  it('выдаёт уникальные id для каждой новой машины', () => {
    const a = createTruck(0);
    const b = createTruck(0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('advanceTruck', () => {
  it('не меняет машину, пока время текущей фазы не истекло', () => {
    const truck = createTruck(0);
    const result = advanceTruck(truck, truck.phaseDurationMs - 1);
    expect(result).toBe(truck);
  });

  it('проходит весь цикл ENTERING -> TO_LOAD -> LOADING -> EXITING -> DONE', () => {
    let truck = createTruck(0);

    truck = advanceTruck(truck, truck.phaseDurationMs);
    expect(truck.phase).toBe('TO_LOAD');
    expect(truck.path.length).toBeGreaterThan(1);

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('LOADING');

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('EXITING');
    expect(truck.path.length).toBeGreaterThan(1);

    truck = advanceTruck(truck, truck.phaseStartedAt + truck.phaseDurationMs);
    expect(truck.phase).toBe('DONE');
  });
});

describe('simulationTick', () => {
  it('никогда не превышает MAX_ACTIVE_TRUCKS и не пустеет после разгона', () => {
    let state = { trucks: [], nextSpawnAt: 0 };
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
    const state = simulationTick({ trucks: [truck], nextSpawnAt: 0 }, 200);
    expect(state.trucks.find((t) => t.id === truck.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Реализовать `store.js`**

```js
// src/simulation/store.js
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
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

```bash
npx vitest run src/simulation/store.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Прогнать всю тестовую папку разом**

```bash
npx vitest run
```

Expected: все тесты во всех файлах зелёные (constants.test.js + store.test.js).

- [ ] **Step 6: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/store.js src/simulation/store.test.js
git commit -m "feat: add truck lifecycle state machine and simulation store"
```

---

## Task 3: Живые машины на сцене — интерполяция и подключение к странице

**Files:**
- Modify: `src/components/scene/Truck.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `useSimulationStore` из `src/simulation/store.js` (Task 2) — поле `trucks`, методы `startSimulation`/`stopSimulation`.
- Produces: `Truck` (обновлён) — default export, принимает пропс `{ truck: Truck }` вместо прежних `{ number, position }`; сам вычисляет текущую 3D-позицию и прогресс погрузки в `useFrame`, ничего не пишет обратно в стор.

- [ ] **Step 1: Переписать `Truck.jsx` на покадровую интерполяцию по объекту машины**

```jsx
// src/components/scene/Truck.jsx
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

const CHASSIS_COLOR = '#3a4356';
const CAB_COLOR = '#232a38';
const BODY_COLOR = '#e8b44c';
const WHEEL_COLOR = '#12151c';
const ACCENT_COLOR = '#8fc3ff';

const WHEEL_POSITIONS = [
  [-1.4, -0.4, 0.9],
  [-1.4, -0.4, -0.9],
  [0.2, -0.4, 0.9],
  [0.2, -0.4, -0.9],
  [1.1, -0.4, 0.9],
  [1.1, -0.4, -0.9],
];

// Позиция машины в момент `now`: во время LOADING/ENTERING — фиксированная
// точка (truck.position), иначе — линейная интерполяция вдоль truck.path
// пропорционально доле пройденного времени текущей фазы.
function interpolatedPosition(truck, now) {
  if (truck.phase === 'LOADING' || truck.phase === 'ENTERING' || truck.phase === 'DONE') {
    return truck.position;
  }
  const t = Math.min(1, Math.max(0, (now - truck.phaseStartedAt) / truck.phaseDurationMs));
  const path = truck.path;
  const segCount = path.length - 1;
  const segT = t * segCount;
  const segIndex = Math.min(segCount - 1, Math.floor(segT));
  const localT = segT - segIndex;
  const a = path[segIndex];
  const b = path[segIndex + 1];
  return [
    a[0] + (b[0] - a[0]) * localT,
    a[1] + (b[1] - a[1]) * localT,
    a[2] + (b[2] - a[2]) * localT,
  ];
}

export default function Truck({ truck }) {
  const groupRef = useRef();
  const progressRef = useRef();
  const bodyMatRef = useRef();

  useFrame(() => {
    const now = performance.now();
    const [x, y, z] = interpolatedPosition(truck, now);
    if (groupRef.current) groupRef.current.position.set(x, y, z);

    const loading = truck.phase === 'LOADING';
    if (progressRef.current) {
      const progress = loading
        ? Math.min(1, (now - truck.phaseStartedAt) / truck.phaseDurationMs)
        : 0;
      progressRef.current.visible = loading;
      progressRef.current.scale.x = Math.max(0.001, progress);
    }
    if (bodyMatRef.current) {
      bodyMatRef.current.emissiveIntensity = loading ? 0.4 + Math.sin(now * 0.006) * 0.3 : 0;
    }
  });

  return (
    <group ref={groupRef}>
      {/* мягкое пятно контакта с землёй — сцена без теней, это замена */}
      <mesh position={[0, -0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 24]} />
        <meshBasicMaterial color="#000814" transparent opacity={0.45} depthWrite={false} />
      </mesh>

      <mesh>
        <boxGeometry args={[2.6, 0.6, 1.6]} />
        <meshStandardMaterial color={CHASSIS_COLOR} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[-1.5, 0.55, 0]}>
        <boxGeometry args={[0.9, 1.1, 1.5]} />
        <meshStandardMaterial color={CAB_COLOR} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[-1.96, 0.3, 0]}>
        <boxGeometry args={[0.06, 0.15, 1.2]} />
        <meshBasicMaterial color={ACCENT_COLOR} transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* кузов-самосвал — жёлтая пульсация emissive во время погрузки */}
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]}>
        <boxGeometry args={[1.6, 0.9, 1.7]} />
        <meshStandardMaterial
          ref={bodyMatRef}
          color={BODY_COLOR}
          emissive={BODY_COLOR}
          emissiveIntensity={0}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>
      {WHEEL_POSITIONS.map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 0.35, 16]} />
          <meshStandardMaterial color={WHEEL_COLOR} roughness={0.9} />
        </mesh>
      ))}

      {/* полоска прогресса погрузки — видна и растёт только в фазе LOADING */}
      <mesh position={[0.6, 1.35, 0]} ref={progressRef} scale={[0.001, 1, 1]} visible={false}>
        <boxGeometry args={[1.6, 0.12, 0.12]} />
        <meshBasicMaterial color="#8fc3ff" transparent opacity={0.9} blending={THREE.AdditiveBlending} />
      </mesh>

      <Html position={[0.6, 1.6, 0]} center>
        <div className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold whitespace-nowrap">
          №{truck.number}
        </div>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Подключить живой стор в `MapPage.jsx`, убрать статичный список машин**

```jsx
// src/pages/MapPage.jsx
import { useEffect } from 'react';
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Truck from '../components/scene/Truck';
import { LOAD_POINTS } from '../simulation/constants';
import { useSimulationStore } from '../simulation/store';

export default function MapPage() {
  const trucks = useSimulationStore((s) => s.trucks);
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const stopSimulation = useSimulationStore((s) => s.stopSimulation);

  useEffect(() => {
    startSimulation();
    return () => stopSimulation();
  }, [startSimulation, stopSimulation]);

  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => {
          const queueCount = trucks.filter(
            (t) => t.targetLoadPointId === lp.id && (t.phase === 'TO_LOAD' || t.phase === 'LOADING'),
          ).length;
          return (
            <LoadPointMarker
              key={lp.id}
              name={lp.name}
              position={lp.position}
              color={lp.color}
              queueCount={queueCount}
            />
          );
        })}
        {trucks.map((truck) => (
          <Truck key={truck.id} truck={truck} />
        ))}
      </CareerScene>
    </div>
  );
}
```

- [ ] **Step 3: Проверить сборку и тесты**

```bash
npm run build
npx vitest run
```

Expected: оба успешны.

- [ ] **Step 4: Запустить dev-сервер и проверить визуально, что машины действительно двигаются**

```bash
npm run dev
```

Открыть `/map`. Ожидается сразу: 6 машин на въезде/в пути, номера читаемы. Подождать ~20-30 секунд, не перезагружая страницу — часть машин должна доехать до точки, "погрузиться" (жёлтая пульсация кузова + растущая голубая полоска прогресса над машиной), затем поехать на выезд и исчезнуть; вместо уехавших через случайную паузу появляются новые. Общее число машин на сцене всё время в пределах 6-10. Проверить консоль браузера на ошибки.

- [ ] **Step 5: Commit**

```bash
git add src/components/scene/Truck.jsx src/pages/MapPage.jsx
git commit -m "feat: wire trucks to the live simulation store with frame interpolation"
```

---

## Self-Review Notes

- **Покрытие спеки (этап 2)**: конечный автомат из 5 фаз (a-e) — Task 2 (`advanceTruck`); плавная интерполяция, не мгновенный скачок — Task 3 (`interpolatedPosition` в `useFrame`); фиксированное время погрузки 5-8 сек — Task 2 (`LOADING_DURATION_RANGE`); индикатор процесса погрузки — Task 3 (полоска прогресса + жёлтая пульсация); спавн новой машины через случайную паузу с целью по случайному выбору — Task 2 (`SPAWN_PAUSE_RANGE`, `pickTargetLoadPoint`); количество активных машин колеблется 6-10 — Task 2 (`simulationTick`, тест "никогда не превышает MAX... не пустеет"); тик раз в 1-2 сек, помечен как место для реальных трекеров — Task 2 (`TICK_INTERVAL_MS` + TODO-комментарий); не пишет в Zustand каждый кадр — Task 3 (позиция вычисляется и применяется через `ref`, а не `set()`).
- **Плейсхолдеров нет** — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `Truck` объект с полями `id, number, phase, targetLoadPointId, position, path, phaseStartedAt, phaseDurationMs` определён в Task 2 (`createTruck`/`advanceTruck`) и используется с теми же именами в Task 3 (`interpolatedPosition`, `Truck` компонент). `buildRoutePoints(fromXZ, toXZ, fromY, toY, steps)` определена в Task 1 и вызывается с той же сигнатурой в Task 2 (`pathTo`). `useSimulationStore` с полями `trucks`/`startSimulation`/`stopSimulation` определён в Task 2, потребляется в Task 3 без расхождений.
- **Скоуп**: диспетчерский алгоритм (очереди, цвета загрузки), scripted-режим с затором и панель диспетчера сознательно не входят в этот план — это этап 3 дизайн-спеки, получит отдельный план после ревью этого результата.
