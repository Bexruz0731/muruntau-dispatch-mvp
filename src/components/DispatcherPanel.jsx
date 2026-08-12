import { statusColorForQueue } from '../simulation/dispatch';
import { deviationPercent, statusColorForDeviation } from '../simulation/fuel';

const PHASE_LABELS = {
  ENTERING: 'на въезде',
  TO_LOAD: 'едет к точке',
  LOADING: 'грузится',
  EXITING: 'выезжает',
};

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
          {trucks.map((t) => {
            const dev = deviationPercent(t);
            return (
              <li key={t.id} className="text-slate-300">
                <div className="flex justify-between">
                  <span>№{t.number}</span>
                  <span className="text-slate-400">{PHASE_LABELS[t.phase] ?? t.phase}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>{Math.round(t.fuelLevel)} л · норма {t.fuelBurnRatePerHour} л/ч</span>
                  <span style={{ color: statusColorForDeviation(dev) }}>
                    {dev >= 0 ? '+' : ''}
                    {dev.toFixed(1)}%
                  </span>
                </div>
              </li>
            );
          })}
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
