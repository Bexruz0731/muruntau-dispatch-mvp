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
