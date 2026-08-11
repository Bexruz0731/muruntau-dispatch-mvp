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
  buildRoutePoints,
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

  it('монотонно не возрастает с ростом радиуса (чем ближе к краю, тем выше)', () => {
    let prevHeight = terrainHeightAt(PIT_BOTTOM_RADIUS);
    for (let r = PIT_BOTTOM_RADIUS + 1; r <= PIT_TOP_RADIUS; r += 1) {
      const h = terrainHeightAt(r);
      expect(h).toBeGreaterThanOrEqual(prevHeight);
      prevHeight = h;
    }
  });
});

describe('groundPosition', () => {
  it('переводит [x, z] в [x, y, z] на поверхности рельефа', () => {
    const [x, y, z] = groundPosition([0, PIT_TOP_RADIUS]);
    expect(x).toBe(0);
    expect(z).toBe(PIT_TOP_RADIUS);
    expect(y).toBe(0);
  });

  it('высота groundPosition для LOAD_POINTS совпадает с terrainHeightAt на том же радиусе', () => {
    for (const point of LOAD_POINTS) {
      const [x, z] = point.position;
      const [, y] = groundPosition(point.position);
      const radius = Math.hypot(x, z);
      expect(y).toBe(terrainHeightAt(radius));
    }
  });
});

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
