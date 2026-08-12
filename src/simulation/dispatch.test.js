import { describe, it, expect } from 'vitest';
import { chooseLoadPoint, statusColorForQueue, buildDispatchExplainPrompt, OVERLOAD_THRESHOLD } from './dispatch';
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
