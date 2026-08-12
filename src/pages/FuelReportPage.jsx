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
