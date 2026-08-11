# Мурунтау MVP — Этап 1: каркас проекта + статичная 3D-сцена Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poднять рабочий каркас Vite+React-проекта с навигацией по трём страницам и статичной 3D-сценой карьера (ступенчатый рельеф, точки погрузки, самосвалы) в реалистично-индустриальном стиле — первый демонстрируемый результат для пользователя.

**Architecture:** Vite + React (JS, без TS) с React Router (три маршрута под общим Layout), Tailwind CSS v4 для UI-обвязки, @react-three/fiber + @react-three/drei для 3D-сцены. Вся геометрическая логика (координаты точек, форма рельефа) вынесена в чистый модуль `src/simulation/constants.js`, покрытый Vitest-тестами — это единственный код в этом этапе, который поддаётся автоматическому тестированию; сама 3D-сцена верифицируется визуально через `npm run dev`, как и зафиксировано в разделе "Тестирование/проверка" дизайн-спеки. Подписи в 3D-сцене (номера машин, названия точек) сделаны через `@react-three/drei` `Html` (обычный DOM, стилизованный Tailwind-классами), а не через `Text`/`Environment`-пресеты — это сознательное отступление от обсуждённого дизайна ради офлайн-надёжности демо: `Text` и `Environment` по умолчанию подгружают шрифт/HDRI с внешнего CDN, что рискованно, если на защите подведёт wi-fi. Вместо `Environment` используется процедурное небо `Sky` (шейдер three.js, без сетевых запросов) + ручной свет — визуально столь же атмосферно, без сетевой зависимости.

**Tech Stack:** Vite, React 18, React Router 6, Tailwind CSS v4 (`@tailwindcss/vite`), three.js, @react-three/fiber, @react-three/drei, Vitest.

## Global Constraints

- Один локальный React-проект (JavaScript, без TypeScript), запускается `npm run dev` — из спеки "Стек".
- Три маршрута: `/map`, `/fuel-report`, `/assistant`, под общим Layout с логотипом (`ziyrak_ai_logo.svg` как favicon и в шапке) — из спеки "Стек" и "Структура файлов".
- 3D-сцена — реалистично-индустриальный стиль: ступенчатый рельеф-воронка (не гладкий конус), маркеры-маяки на точках погрузки, собранные из примитивов модели самосвалов (не единый box) — из спеки "Визуальный стиль сцены".
- 5-8 точек погрузки на разных уступах — из спеки "Стек"/ТЗ.
- Комментарий `// TODO: заменить на реальные данные трекеров в проде` обязателен везде, где в дальнейших этапах появится симулятор GPS (в этом этапе — там, где сейчас лежат статичные демо-данные машин, которые в этапе 2 станут живым стором).
- **Область этого плана**: только Этап 1 из дизайн-спеки (`docs/superpowers/specs/2026-08-11-muruntau-dispatch-mvp-design.md`) — каркас + статичная сцена. Этапы 2-7 (движение, диспетчеризация, топливо, аномалии, AnythingLLM, полировка) получат отдельные планы после ревью результата этого этапа — так и было согласовано с пользователем (пошаговая демонстрация).

---

## Task 1: Скелет проекта — Vite + React + Tailwind

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/main.jsx`
- Create: `src/App.jsx`
- Create: `src/index.css`
- Create: `public/logo.svg` (копия существующего `ziyrak_ai_logo.svg`)

**Interfaces:**
- Produces: `App` — default export React-компонент из `src/App.jsx`, рендерится в `main.jsx`. В этой задаче — временная заглушка (заменится в Task 2).

- [ ] **Step 1: Инициализировать git-репозиторий и `.gitignore`**

Репозиторий ещё не инициализирован. Сначала `.gitignore`, чтобы `node_modules` не попал в первый коммит.

```bash
git init
```

Файл `.gitignore`:
```
node_modules
dist
.env
.env.local
*.local
```

- [ ] **Step 2: Написать `package.json`**

```json
{
  "name": "muruntau-dispatch-mvp",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "three": "^0.169.0",
    "@react-three/fiber": "^8.17.10",
    "@react-three/drei": "^9.114.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.2",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 3: Написать `vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Написать `index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Зийрак ИИ — Диспетчеризация Мурунтау</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Скопировать логотип в `public/`**

```bash
cp "ziyrak_ai_logo.svg" "public/logo.svg"
```

- [ ] **Step 6: Написать `src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Написать временный `src/App.jsx`**

```jsx
export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white text-xl">
      Vite + React + Tailwind OK
    </div>
  );
}
```

- [ ] **Step 8: Написать `src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Установить зависимости**

```bash
npm install
```

Expected: завершается без ошибок, создаётся `node_modules` и `package-lock.json`.

- [ ] **Step 10: Проверить сборку**

```bash
npm run build
```

Expected: `vite build` завершается успешно (`dist/` создан), без ошибок компиляции.

- [ ] **Step 11: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть показанный URL в браузере. Ожидается: тёмный экран с текстом "Vite + React + Tailwind OK" по центру, стилизованным Tailwind-классами (значит и Tailwind, и React работают). Остановить сервер (Ctrl+C) после проверки.

- [ ] **Step 12: Commit**

```bash
git add .gitignore package.json package-lock.json vite.config.js index.html src public
git commit -m "chore: scaffold Vite + React + Tailwind project"
```

---

## Task 2: Навигация — React Router, Layout, три страницы-заглушки

**Files:**
- Create: `src/components/layout/Layout.jsx`
- Create: `src/pages/MapPage.jsx`
- Create: `src/pages/FuelReportPage.jsx`
- Create: `src/pages/AssistantPage.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: ничего (первая задача, вводящая роутинг).
- Produces: `Layout` — default export из `src/components/layout/Layout.jsx`, компонент без пропсов, рендерит шапку с навигацией и `<Outlet />` для дочерних маршрутов. `MapPage`, `FuelReportPage`, `AssistantPage` — default export компоненты без пропсов из `src/pages/*.jsx`. `App` (обновлён) — default export, оборачивает всё в `BrowserRouter`.

- [ ] **Step 1: Написать `Layout.jsx`**

```jsx
// src/components/layout/Layout.jsx
import { NavLink, Outlet } from 'react-router-dom';

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <header className="h-16 flex items-center gap-4 px-4 bg-slate-900 text-white shrink-0">
        <img src="/logo.svg" alt="Зийрак ИИ" className="h-8 w-8" />
        <span className="font-semibold text-lg">Зийрак ИИ — Мурунтау</span>
        <nav className="ml-auto flex gap-2">
          <NavLink to="/map" className={linkClass}>Карта</NavLink>
          <NavLink to="/fuel-report" className={linkClass}>Отчёт по топливу</NavLink>
          <NavLink to="/assistant" className={linkClass}>ИИ-ассистент</NavLink>
        </nav>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Написать страницы-заглушки для отчёта и ассистента**

```jsx
// src/pages/FuelReportPage.jsx
export default function FuelReportPage() {
  return (
    <div className="p-6 text-slate-600">
      Раздел «Полный отчёт по топливу» будет добавлен на этапе 4.
    </div>
  );
}
```

```jsx
// src/pages/AssistantPage.jsx
export default function AssistantPage() {
  return (
    <div className="p-6 text-slate-600">
      Раздел «ИИ-ассистент по документации» будет добавлен на этапе 6.
    </div>
  );
}
```

- [ ] **Step 3: Написать временный `MapPage.jsx` (заменится в Task 6-7)**

```jsx
// src/pages/MapPage.jsx
export default function MapPage() {
  return (
    <div className="p-6 text-slate-600">
      3D-сцена карьера появится в следующих задачах этого этапа.
    </div>
  );
}
```

- [ ] **Step 4: Переписать `App.jsx` на роутинг**

```jsx
// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import MapPage from './pages/MapPage';
import FuelReportPage from './pages/FuelReportPage';
import AssistantPage from './pages/AssistantPage';

export default function App() {
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

- [ ] **Step 5: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 6: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/` — ожидается редирект на `/map` с текстом-заглушкой. Кликнуть по всем трём пунктам навигации в шапке — каждый должен показывать свою заглушку, активный пункт подсвечен. Остановить сервер.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: add routing, layout and three placeholder pages"
```

---

## Task 3: Модуль данных карьера — точки, координаты, геометрия рельефа

**Files:**
- Create: `src/simulation/constants.js`
- Test: `src/simulation/constants.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces (все — именованные экспорты из `src/simulation/constants.js`):
  - `ENTRY_POINT: { id, name, position: [x, z] }`
  - `EXIT_POINT: { id, name, position: [x, z] }`
  - `LOAD_POINTS: Array<{ id, name, position: [x, z], color }>` (6 штук)
  - `PIT_RINGS: number`, `PIT_TOP_RADIUS: number`, `PIT_BOTTOM_RADIUS: number`, `PIT_DEPTH: number`
  - `terrainHeightAt(radius: number): number` — высота (y, ≤ 0) ступенчатого рельефа на данном расстоянии от центра
  - `groundPosition([x, z]: [number, number]): [number, number, number]` — переводит плоскую точку в 3D-координату на поверхности рельефа

- [ ] **Step 1: Написать падающий тест**

```js
// src/simulation/constants.test.js
import { describe, it, expect } from 'vitest';
import {
  ENTRY_POINT,
  EXIT_POINT,
  LOAD_POINTS,
  PIT_RINGS,
  PIT_TOP_RADIUS,
  PIT_BOTTOM_RADIUS,
  PIT_DEPTH,
  terrainHeightAt,
  groundPosition,
} from './constants';

describe('LOAD_POINTS', () => {
  it('содержит от 5 до 8 точек с уникальными id и 2D-координатами', () => {
    expect(LOAD_POINTS.length).toBeGreaterThanOrEqual(5);
    expect(LOAD_POINTS.length).toBeLessThanOrEqual(8);
    const ids = LOAD_POINTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const point of LOAD_POINTS) {
      expect(point.position).toHaveLength(2);
      expect(typeof point.color).toBe('string');
      expect(typeof point.name).toBe('string');
    }
  });
});

describe('ENTRY_POINT / EXIT_POINT', () => {
  it('заданы в разных точках', () => {
    expect(ENTRY_POINT.position).not.toEqual(EXIT_POINT.position);
  });
});

describe('terrainHeightAt', () => {
  it('возвращает 0 у верхнего края и -PIT_DEPTH на дне', () => {
    expect(terrainHeightAt(PIT_TOP_RADIUS)).toBe(0);
    expect(terrainHeightAt(PIT_BOTTOM_RADIUS)).toBe(-PIT_DEPTH);
  });

  it('квантует высоту не более чем в PIT_RINGS+1 уровней', () => {
    const heights = new Set();
    for (let r = PIT_BOTTOM_RADIUS; r <= PIT_TOP_RADIUS; r += 1) {
      heights.add(terrainHeightAt(r));
    }
    expect(heights.size).toBeLessThanOrEqual(PIT_RINGS + 1);
  });

  it('не уходит глубже -PIT_DEPTH и не выше 0 за пределами диапазона радиусов', () => {
    expect(terrainHeightAt(0)).toBe(-PIT_DEPTH);
    expect(terrainHeightAt(PIT_TOP_RADIUS + 50)).toBe(0);
  });
});

describe('groundPosition', () => {
  it('переводит [x, z] в [x, y, z] на поверхности рельефа', () => {
    const [x, y, z] = groundPosition([0, PIT_TOP_RADIUS]);
    expect(x).toBe(0);
    expect(z).toBe(PIT_TOP_RADIUS);
    expect(y).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: FAIL — `Cannot find module './constants'` (файла ещё нет).

- [ ] **Step 3: Написать `constants.js`**

```js
// src/simulation/constants.js

// Фиксированные точки въезда/выезда и точки погрузки на карьере.
// TODO: заменить на реальные данные трекеров в проде — в этом этапе координаты
// используются только для статичного размещения объектов на сцене.

export const ENTRY_POINT = { id: 'entry', name: 'Въезд', position: [0, 26] };
export const EXIT_POINT = { id: 'exit', name: 'Выезд', position: [3, 26] };

export const LOAD_POINTS = [
  { id: 'lp-a', name: 'Точка A', position: [6, 3], color: '#f97316' },
  { id: 'lp-b', name: 'Точка B', position: [-10, 6], color: '#38bdf8' },
  { id: 'lp-c', name: 'Точка C', position: [13, -7], color: '#a78bfa' },
  { id: 'lp-d', name: 'Точка D', position: [-16, 5], color: '#f472b6' },
  { id: 'lp-e', name: 'Точка E', position: [4, -20], color: '#4ade80' },
  { id: 'lp-f', name: 'Точка F', position: [-20, -8], color: '#facc15' },
];

// Геометрия ступенчатой воронки карьера.
export const PIT_RINGS = 6; // число уступов
export const PIT_TOP_RADIUS = 30; // радиус верхнего края
export const PIT_BOTTOM_RADIUS = 4; // радиус дна
export const PIT_DEPTH = 18; // общая глубина воронки

// Высота (y <= 0) ступенчатого рельефа на заданном расстоянии от центра.
// Квантуется в PIT_RINGS дискретных уровней, чтобы получились уступы, а не гладкий конус.
export function terrainHeightAt(radius) {
  const clamped = Math.min(Math.max(radius, PIT_BOTTOM_RADIUS), PIT_TOP_RADIUS);
  const t = 1 - (clamped - PIT_BOTTOM_RADIUS) / (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS);
  const step = Math.floor(t * PIT_RINGS) / PIT_RINGS;
  // -step * PIT_DEPTH produces -0 when step is 0; normalize to +0.
  const height = -step * PIT_DEPTH;
  return height === 0 ? 0 : height;
}

// Переводит плоскую точку [x, z] в 3D-координату, лежащую на поверхности рельефа.
export function groundPosition([x, z]) {
  const radius = Math.hypot(x, z);
  return [x, terrainHeightAt(radius), z];
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
npx vitest run src/simulation/constants.test.js
```

Expected: PASS, все тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add src/simulation
git commit -m "feat: add pit terrain geometry and load point constants with tests"
```

---

## Task 4: 3D-сцена — камера, свет, небо, тени (без объектов карьера)

**Files:**
- Create: `src/components/scene/CareerScene.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: ничего из `simulation/constants.js` (сцена — обвязка, не геометрия).
- Produces: `CareerScene` — default export из `src/components/scene/CareerScene.jsx`, принимает `{ children }` и рендерит их внутри `<Canvas>` с готовым светом/небом/тенями/управлением камерой.

- [ ] **Step 1: Написать `CareerScene.jsx`**

```jsx
// src/components/scene/CareerScene.jsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, ContactShadows } from '@react-three/drei';

export default function CareerScene({ children }) {
  return (
    <Canvas shadows camera={{ position: [0, 32, 42], fov: 45 }} className="w-full h-full">
      <fog attach="fog" args={['#dce8f2', 45, 120]} />
      <hemisphereLight args={['#cfe3f2', '#8a6b3e', 0.6]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[25, 40, 15]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <Sky
        distance={450}
        sunPosition={[25, 40, 15]}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.01}
        mieDirectionalG={0.85}
      />
      {children}
      <ContactShadows position={[0, -18.2, 0]} opacity={0.5} scale={80} blur={2.5} far={20} />
      <OrbitControls
        target={[0, -8, 0]}
        minDistance={20}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2 - 0.05}
      />
    </Canvas>
  );
}
```

- [ ] **Step 2: Подключить сцену на страницу карты**

```jsx
// src/pages/MapPage.jsx
import CareerScene from '../components/scene/CareerScene';

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene />
    </div>
  );
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 4: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается: голубоватое небо с эффектом заката (`Sky`), пустая сцена без ошибок в консоли браузера, при перетаскивании мышью камера вращается вокруг центра (`OrbitControls`), скролл — приближение/отдаление в заданных пределах. Остановить сервер.

- [ ] **Step 5: Commit**

```bash
git add src/components/scene/CareerScene.jsx src/pages/MapPage.jsx
git commit -m "feat: add CareerScene with lighting, sky and camera controls"
```

---

## Task 5: Рельеф карьера — ступенчатая воронка

**Files:**
- Create: `src/components/scene/PitTerrain.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `PIT_RINGS`, `PIT_TOP_RADIUS`, `PIT_BOTTOM_RADIUS`, `PIT_DEPTH` из `src/simulation/constants.js` (Task 3).
- Produces: `PitTerrain` — default export из `src/components/scene/PitTerrain.jsx`, компонент без пропсов, рендерит группу мешей рельефа.

- [ ] **Step 1: Написать `PitTerrain.jsx`**

```jsx
// src/components/scene/PitTerrain.jsx
import * as THREE from 'three';
import {
  PIT_RINGS,
  PIT_TOP_RADIUS,
  PIT_BOTTOM_RADIUS,
  PIT_DEPTH,
} from '../../simulation/constants';

const RING_SEGMENTS = 64;

function ringRadius(i) {
  const t = i / PIT_RINGS;
  return PIT_TOP_RADIUS - t * (PIT_TOP_RADIUS - PIT_BOTTOM_RADIUS);
}

function benchColor(i) {
  const t = i / PIT_RINGS;
  const light = { r: 0xc9, g: 0x9b, b: 0x5a };
  const dark = { r: 0x6b, g: 0x4a, b: 0x2c };
  const r = Math.round(light.r + (dark.r - light.r) * t);
  const g = Math.round(light.g + (dark.g - light.g) * t);
  const b = Math.round(light.b + (dark.b - light.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function PitTerrain() {
  const benches = [];
  const risers = [];

  for (let i = 0; i <= PIT_RINGS; i++) {
    const outer = i === 0 ? PIT_TOP_RADIUS + 6 : ringRadius(i - 1);
    const inner = ringRadius(i);
    const y = -(i / PIT_RINGS) * PIT_DEPTH;

    benches.push(
      <mesh key={`bench-${i}`} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[inner, outer, RING_SEGMENTS]} />
        <meshStandardMaterial color={benchColor(i)} roughness={0.95} metalness={0} />
      </mesh>,
    );

    if (i < PIT_RINGS) {
      const topY = y;
      const bottomY = -((i + 1) / PIT_RINGS) * PIT_DEPTH;
      const topRadius = ringRadius(i);
      const bottomRadius = ringRadius(i + 1);
      const riserHeight = topY - bottomY;

      risers.push(
        <mesh key={`riser-${i}`} position={[0, bottomY + riserHeight / 2, 0]} receiveShadow>
          <cylinderGeometry args={[topRadius, bottomRadius, riserHeight, RING_SEGMENTS, 1, true]} />
          <meshStandardMaterial color={benchColor(i + 0.5)} roughness={1} side={THREE.DoubleSide} />
        </mesh>,
      );
    }
  }

  benches.push(
    <mesh key="pit-floor" position={[0, -PIT_DEPTH, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[PIT_BOTTOM_RADIUS, RING_SEGMENTS]} />
      <meshStandardMaterial color={benchColor(PIT_RINGS)} roughness={0.95} />
    </mesh>,
  );

  return (
    <group>
      {benches}
      {risers}
    </group>
  );
}
```

- [ ] **Step 2: Подключить рельеф в сцену**

```jsx
// src/pages/MapPage.jsx
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
      </CareerScene>
    </div>
  );
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 4: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается: земляно-охристая ступенчатая воронка из 7 концентрических террас (от светлого у края до тёмного на дне), с вертикальными стенками-уступами между ними, отбрасывающая и принимающая тени. Вращение камерой должно ясно показывать ступенчатость (не гладкий конус). Остановить сервер.

- [ ] **Step 5: Commit**

```bash
git add src/components/scene/PitTerrain.jsx src/pages/MapPage.jsx
git commit -m "feat: add stepped pit terrain geometry"
```

---

## Task 6: Точки погрузки — маркеры-маяки

**Files:**
- Create: `src/components/scene/LoadPointMarker.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `groundPosition` и `LOAD_POINTS` из `src/simulation/constants.js` (Task 3).
- Produces: `LoadPointMarker` — default export из `src/components/scene/LoadPointMarker.jsx`, принимает пропсы `{ name: string, position: [number, number], color: string, queueCount?: number }`.

- [ ] **Step 1: Написать `LoadPointMarker.jsx`**

```jsx
// src/components/scene/LoadPointMarker.jsx
import { Html } from '@react-three/drei';
import { groundPosition } from '../../simulation/constants';

const BEACON_HEIGHT = 3;

export default function LoadPointMarker({ name, position, color, queueCount = 0 }) {
  const [x, y, z] = groundPosition(position);

  return (
    <group position={[x, y, z]}>
      <mesh position={[0, BEACON_HEIGHT / 2, 0]} castShadow>
        <coneGeometry args={[0.8, BEACON_HEIGHT, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1, 1.4, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          transparent
          opacity={0.85}
        />
      </mesh>
      <Html position={[0, BEACON_HEIGHT + 0.8, 0]} center>
        <div className="px-2 py-0.5 rounded bg-black/70 text-white text-xs whitespace-nowrap">
          {name} ({queueCount})
        </div>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Отрисовать все точки погрузки на сцене**

```jsx
// src/pages/MapPage.jsx
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import { LOAD_POINTS } from '../simulation/constants';

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => (
          <LoadPointMarker key={lp.id} name={lp.name} position={lp.position} color={lp.color} />
        ))}
      </CareerScene>
    </div>
  );
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build
```

Expected: успешно, без ошибок.

- [ ] **Step 4: Запустить dev-сервер и проверить визуально**

```bash
npm run dev
```

Открыть `/map`. Ожидается: 6 разноцветных маяков-конусов на разных уступах воронки, у каждого светящееся кольцо у основания и подпись с названием и числом "(0)" над ним, читаемая при приближении камеры. Остановить сервер.

- [ ] **Step 5: Commit**

```bash
git add src/components/scene/LoadPointMarker.jsx src/pages/MapPage.jsx
git commit -m "feat: add load point beacon markers"
```

---

## Task 7: Самосвалы — собранная модель, статичное размещение (финал этапа 1)

**Files:**
- Create: `src/components/scene/Truck.jsx`
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `groundPosition` из `src/simulation/constants.js` (Task 3).
- Produces: `Truck` — default export из `src/components/scene/Truck.jsx`, принимает пропсы `{ number: string, position: [number, number] }`.

- [ ] **Step 1: Написать `Truck.jsx`**

```jsx
// src/components/scene/Truck.jsx
import { Html } from '@react-three/drei';
import { groundPosition } from '../../simulation/constants';

const CHASSIS_COLOR = '#374151';
const CAB_COLOR = '#1f2937';
const BODY_COLOR = '#facc15';
const WHEEL_COLOR = '#111827';

const WHEEL_POSITIONS = [
  [-1.4, -0.4, 0.9],
  [-1.4, -0.4, -0.9],
  [0.2, -0.4, 0.9],
  [0.2, -0.4, -0.9],
  [1.1, -0.4, 0.9],
  [1.1, -0.4, -0.9],
];

export default function Truck({ number, position }) {
  const [x, y, z] = groundPosition(position);

  return (
    <group position={[x, y + 0.9, z]}>
      {/* шасси */}
      <mesh castShadow>
        <boxGeometry args={[2.6, 0.6, 1.6]} />
        <meshStandardMaterial color={CHASSIS_COLOR} roughness={0.6} metalness={0.2} />
      </mesh>
      {/* кабина */}
      <mesh position={[-1.5, 0.55, 0]} castShadow>
        <boxGeometry args={[0.9, 1.1, 1.5]} />
        <meshStandardMaterial color={CAB_COLOR} roughness={0.5} metalness={0.3} />
      </mesh>
      {/* кузов-самосвал */}
      <mesh position={[0.6, 0.75, 0]} rotation={[0, 0, -0.05]} castShadow>
        <boxGeometry args={[1.6, 0.9, 1.7]} />
        <meshStandardMaterial color={BODY_COLOR} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* колёса */}
      {WHEEL_POSITIONS.map(([wx, wy, wz], i) => (
        <mesh key={i} position={[wx, wy, wz]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 0.35, 16]} />
          <meshStandardMaterial color={WHEEL_COLOR} roughness={0.9} />
        </mesh>
      ))}
      <Html position={[0.6, 1.6, 0]} center>
        <div className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold whitespace-nowrap">
          №{number}
        </div>
      </Html>
    </group>
  );
}
```

- [ ] **Step 2: Отрисовать статичный набор машин на сцене**

```jsx
// src/pages/MapPage.jsx
import CareerScene from '../components/scene/CareerScene';
import PitTerrain from '../components/scene/PitTerrain';
import LoadPointMarker from '../components/scene/LoadPointMarker';
import Truck from '../components/scene/Truck';
import { LOAD_POINTS } from '../simulation/constants';

// Статичный список машин только для этапа 1 (визуальная демонстрация каркаса).
// TODO: заменить на реальные данные трекеров в проде — в этапе 2 этот список
// станет производным от живого симулятора (Zustand store), а не хардкодом.
const DEMO_TRUCKS = [
  { id: 1, number: '07', position: [1, 27] },
  { id: 2, number: '12', position: [6, 3] },
  { id: 3, number: '19', position: [-10, 6] },
  { id: 4, number: '23', position: [13, -7] },
  { id: 5, number: '31', position: [-9, 14] },
  { id: 6, number: '34', position: [16, 5] },
  { id: 7, number: '41', position: [-16, 5] },
  { id: 8, number: '45', position: [4, -20] },
];

export default function MapPage() {
  return (
    <div className="w-full h-[calc(100vh-4rem)]">
      <CareerScene>
        <PitTerrain />
        {LOAD_POINTS.map((lp) => (
          <LoadPointMarker key={lp.id} name={lp.name} position={lp.position} color={lp.color} />
        ))}
        {DEMO_TRUCKS.map((truck) => (
          <Truck key={truck.id} number={truck.number} position={truck.position} />
        ))}
      </CareerScene>
    </div>
  );
}
```

- [ ] **Step 3: Прогнать все тесты и сборку**

```bash
npm run test
npm run build
```

Expected: оба успешны — Vitest-тесты из Task 3 зелёные, сборка без ошибок.

- [ ] **Step 4: Запустить dev-сервер и итоговая визуальная проверка этапа 1**

```bash
npm run dev
```

Открыть `/map`. Ожидается полная картина: ступенчатая воронка карьера, 6 цветных маяков точек погрузки на разных уступах, 8 собранных из примитивов самосвалов (кабина/кузов/колёса, не кубики) с номерами над каждым, разбросанных у въезда, на маршрутах и на точках погрузки. Небо, тени, вращение камерой — без ошибок в консоли. Проверить также навигацию на `/fuel-report` и `/assistant` — заглушки на месте. Остановить сервер.

- [ ] **Step 5: Commit**

```bash
git add src/components/scene/Truck.jsx src/pages/MapPage.jsx
git commit -m "feat: add static truck models to complete phase 1 scene"
```

---

## Self-Review Notes

- **Покрытие спеки (Этап 1)**: каркас Vite+React+Router+Tailwind — Task 1-2; ступенчатый рельеф — Task 3, 5; точки погрузки маркерами — Task 3, 6; статичные самосвалы собранной моделью — Task 3, 7; реалистично-индустриальный стиль (свет/тени/небо) — Task 4. Все пункты Этапа 1 из дизайн-спеки покрыты.
- **Плейсхолдеры**: не найдено — каждый шаг содержит готовый код или точную команду с ожидаемым результатом.
- **Согласованность типов/имён**: `groundPosition`, `terrainHeightAt`, `LOAD_POINTS`, `ENTRY_POINT`, `EXIT_POINT`, `PIT_RINGS/PIT_TOP_RADIUS/PIT_BOTTOM_RADIUS/PIT_DEPTH` определены один раз в Task 3 и используются с одинаковыми именами и сигнатурами в Task 5-7. `CareerScene({ children })`, `LoadPointMarker({ name, position, color, queueCount })`, `Truck({ number, position })` — пропсы совпадают в месте определения (Task 4/6/7) и в месте использования (Task 7, финальный `MapPage.jsx`).
- **Отклонение от ранее обсуждённого дизайна**: `Environment`-пресет и drei `Text` заменены на процедурный `Sky` и DOM-подписи через `Html` — решение принято ради офлайн-надёжности демо (оба варианта по умолчанию тянут ассеты с внешнего CDN). Функционально и визуально результат эквивалентен; если на защите гарантирован интернет и приоритетнее максимальная фотореалистичность, `Environment` можно вернуть в Task 4 одной строкой.
