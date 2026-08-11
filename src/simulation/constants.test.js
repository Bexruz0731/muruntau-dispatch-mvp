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
