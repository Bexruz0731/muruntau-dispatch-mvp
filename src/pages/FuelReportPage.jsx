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
