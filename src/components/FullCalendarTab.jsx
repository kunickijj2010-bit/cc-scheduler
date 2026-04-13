import { useMemo } from 'react';
import { MD, MN, MNF, DOWL } from '../data/config.js';
import { matchName, hCov } from '../utils/shifts.js';
import { computeAutoShifts, getChangesForVariant, getEffectiveHours } from '../utils/optimizer.js';

const VARIANT_LABELS = {
  current: '📊 Текущий',
  D: '✨ D: Авто-Баланс',
  A: '🟢 А: Микро-сдвиги',
  B: '🟡 Б: Ярусная',
  C: '🔴 В: Полная без границ',
};

function parseVacHex(hex) {
  if (!hex) return Array(366).fill(0);
  let bin = '';
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, '0');
  }
  return bin.split('').map(b => parseInt(b)).concat(Array(366).fill(0)).slice(0, 366);
}

export default function FullCalendarTab({ employees, curMonth, isForecast, deptOptVars }) {
  const E = employees;
  const m = curMonth;
  const days = MD[m];
  const filtE = employees;

  const getOptFor = (e) => {
    if (!deptOptVars) return 'current';
    return deptOptVars[e.dp] || 'current';
  };

  // Check if any employee has manual modifications
  const hasManualEdits = useMemo(() => filtE.some(e => e._modified), [filtE]);

  // Compute auto-shifts if any dept needs D or C
  useMemo(() => {
    const activeVariants = deptOptVars ? Object.values(deptOptVars) : [];
    if (E.length > 0 && activeVariants.some(v => v === 'D' || v === 'C')) {
      computeAutoShifts(E, false, isForecast);
      if (activeVariants.some(v => v === 'C')) computeAutoShifts(E, true, isForecast);
    }
  }, [E, deptOptVars, isForecast]);

  // Summary stats
  const { totalHours, changedCount, manualChangedCount, curCounts, optCounts } = useMemo(() => {
    let totalOnShift = 0, totalHours = 0, changedCount = 0;
    let manualChangedCount = 0;
    const curCounts = Array(days).fill(0);
    const optCounts = Array(days).fill(0);

    filtE.forEach(e => {
      let eChg = false;
      const v = getOptFor(e);
      const isPreview = v !== 'current';
      const vChanges = isPreview ? getChangesForVariant(v) : [];

      for (let d = 0; d < days; d++) {
        // For "Было" — use original data if manually modified, otherwise current
        const origMs = e._original ? e._original.ms : e.ms;
        const origV = origMs[m] ? origMs[m].d[d] : 0;
        if (origV > 0 && typeof origV === 'number') curCounts[d]++;

        if (isPreview) {
          const eff = getEffectiveHours(e, m, d, vChanges);
          if (eff.h > 0 && typeof eff.h === 'number') { totalOnShift++; totalHours += eff.h; optCounts[d]++; }
          if (eff.changed) eChg = true;
        } else {
          // Current variant — use actual (possibly edited) data
          const curV = e.ms[m] ? e.ms[m].d[d] : 0;
          if (curV > 0 && typeof curV === 'number') { totalOnShift++; totalHours += curV; optCounts[d]++; }
        }
      }
      if (eChg) changedCount++;
      if (e._modified) manualChangedCount++;
    });

    return { totalOnShift, totalHours, changedCount, manualChangedCount, curCounts, optCounts };
  }, [filtE, m, days, deptOptVars]);

  const isAnyOpt = useMemo(() => {
    if (!deptOptVars) return false;
    return Object.values(deptOptVars).some(v => v !== 'current');
  }, [deptOptVars]);

  const showDelta = isAnyOpt || hasManualEdits;

  const displayChangedCount = isAnyOpt ? changedCount : manualChangedCount;

  // Hourly matrix: "base" = original (pre-edit) data, "opt" = current effective data
  const { curMatrix, optMatrix } = useMemo(() => {
    const curMatrix = Array.from({ length: 24 }, () => Array(days).fill(0));
    const optMatrix = Array.from({ length: 24 }, () => Array(days).fill(0));

    filtE.forEach(e => {
      const v = getOptFor(e);
      const isPreview = v !== 'current';
      const vChanges = isPreview ? getChangesForVariant(v) : [];
      
      const vacMask = parseVacHex(e.v);
      let dayOffset = 0;
      for (let i = 0; i < m; i++) dayOffset += MD[i];

      // Get original coverage array for "Было" baseline
      const origMs = e._original ? e._original.ms : e.ms;
      const origCov = e._original ? e._original.cov : e.cov;

      for (let d = 0; d < days; d++) {
        const isVac = vacMask[dayOffset + d] === 1;
        if (isVac) continue;

        // "Было" (base) — always from original data
        const baseV = origMs[m] ? origMs[m].d[d] : 0;
        if (baseV > 0 && typeof baseV === 'number') {
          const origDayCov = (e._original && e._original.whm && e._original.whm[m]) 
            ? hCov(e._original.whm[m][d]) 
            : origCov;
          for (let h = 0; h < 24; h++) {
            if (origDayCov[h]) curMatrix[h][d]++;
          }
        }

        // "Стало" (effective) — from optimization or manual edit
        if (isPreview) {
          const eff = getEffectiveHours(e, m, d, vChanges);
          if (eff.h > 0 && typeof eff.h === 'number' && !eff.ghost) {
            let covArr = eff.covArr || (e.whm ? hCov(e.whm[m][d]) : e.cov);
            for (let h = 0; h < 24; h++) {
              if (covArr[h]) optMatrix[h][d]++;
            }
          }
        } else {
          // Current variant — use actual edited data
          const curV = e.ms[m] ? e.ms[m].d[d] : 0;
          if (curV > 0 && typeof curV === 'number') {
            const dayCov = (e.whm && e.whm[m]) ? hCov(e.whm[m][d]) : e.cov;
            for (let h = 0; h < 24; h++) {
              if (dayCov[h]) optMatrix[h][d]++;
            }
          }
        }
      }
    });

    return { curMatrix, optMatrix };
  }, [filtE, m, days, deptOptVars]);

  return (
    <>
      <div className="hi">📆 <strong>Полный календарь сотрудников</strong> — Визуализация графика каждого сотрудника по дням. Цвет = часы на смене.</div>

      {/* KPIs */}
      <div className="row">
        <div className="kpi"><div className="v">{filtE.length}</div><div className="l">сотрудников</div></div>
        <div className="kpi"><div className="v">{Math.round(totalHours)}</div><div className="l">часов за {MNF[m]}</div></div>
        <div className="kpi">
          <div className="v" style={{ color: displayChangedCount > 0 ? 'var(--g)' : 'var(--t3)' }}>{displayChangedCount}</div>
          <div className="l">{isAnyOpt ? 'оптимизировано' : 'изменено'}</div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="cd">
        <h3>📅 {MNF[m]} 2026{isAnyOpt ? ' (Анализ вариантов)' : ''}</h3>
        <div className="scroll-x">
          <table style={{ fontSize: '.65rem' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 140, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 2 }}>Сотрудник</th>
                <th style={{ position: 'sticky', left: 140, background: 'var(--bg)', zIndex: 2 }}>Отд.</th>
                {Array.from({ length: days }, (_, d) => {
                  const dow = new Date(2026, m, d + 1).getDay();
                  const isWE = dow === 0 || dow === 6;
                  return (
                    <th key={d} style={{ minWidth: 24, background: isWE ? 'rgba(239,96,80,.1)' : '' }}>
                      {d + 1}<br /><span style={{ fontSize: '.5rem', color: 'var(--t3)' }}>{DOWL[dow]}</span>
                    </th>
                  );
                })}
                <th>Σч</th>
              </tr>
            </thead>
            <tbody>
              {/* Headcount row */}
              {showDelta ? (
                <>
                  <tr style={{ background: 'rgba(255,255,255,0.05)', fontWeight: 'bold' }}>
                    <td colSpan={2} style={{ textAlign: 'right', paddingRight: 8, color: 'rgba(255,255,255,0.6)' }}>Было:</td>
                    {Array.from({ length: days }, (_, d) => <td key={d} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>{curCounts[d]}</td>)}
                    <td></td>
                  </tr>
                  <tr style={{ background: 'rgba(16,192,144,0.1)', fontWeight: 'bold' }}>
                    <td colSpan={2} style={{ textAlign: 'right', paddingRight: 8 }}><strong>Стало:</strong></td>
                    {Array.from({ length: days }, (_, d) => {
                      const diff = optCounts[d] - curCounts[d];
                      return <td key={d} style={{ textAlign: 'center', color: diff > 0 ? 'var(--g)' : diff < 0 ? 'var(--d)' : '' }}>{optCounts[d]}</td>;
                    })}
                    <td></td>
                  </tr>
                </>
              ) : (
                <tr style={{ background: 'rgba(255,255,255,0.05)', fontWeight: 'bold' }}>
                  <td colSpan={2} style={{ textAlign: 'right', paddingRight: 8 }}>На смене:</td>
                  {Array.from({ length: days }, (_, d) => <td key={d} style={{ textAlign: 'center' }}>{curCounts[d]}</td>)}
                  <td></td>
                </tr>
              )}

              {/* Employee rows */}
              {filtE.map((e, idx) => {
                const v = getOptFor(e);
                const isPreview = v !== 'current';
                const vChanges = isPreview ? getChangesForVariant(v) : [];
                const chg = vChanges.find(c => matchName(c.name, e.nm));
                const isOptChanged = !!chg;
                const isManualChanged = !!e._modified;
                const isChangedRow = isOptChanged || isManualChanged;
                const vacMask = parseVacHex(e.v);
                let dayOffset = 0;
                for (let i = 0; i < m; i++) dayOffset += MD[i];

                let eTotalHs = 0;
                const cells = [];
                for (let d = 0; d < days; d++) {
                  const eff = getEffectiveHours(e, m, d, vChanges);
                  let v = eff.h;
                  const isVac = vacMask[dayOffset + d] === 1;
                  if (typeof v === 'number') eTotalHs += v;

                  // Check if this specific day was manually changed
                  const origMs = e._original ? e._original.ms : null;
                  const origDayVal = origMs && origMs[m] ? origMs[m].d[d] : null;
                  const curDayVal = e.ms[m] ? e.ms[m].d[d] : 0;
                  const isManualDayChanged = isManualChanged && origDayVal !== null && origDayVal !== curDayVal;

                  const getColor = (v) => v === 0 ? 'var(--s1)' : v >= 11 ? 'rgba(124,108,240,.7)' : v >= 8 ? 'rgba(0,212,200,.6)' : v >= 4 ? 'rgba(240,192,64,.5)' : 'rgba(16,192,144,.4)';

                  if (isVac) {
                    cells.push(<td key={d} style={{ background: 'var(--s2)', textAlign: 'center', fontSize: '.55rem' }}>🏖️</td>);
                  } else if (eff.ghost) {
                    cells.push(
                      <td key={d} style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(239,96,80,.05) 3px, rgba(239,96,80,.05) 6px)', border: '1px dashed rgba(239,96,80,.3)', textAlign: 'center' }} title={eff.note}>
                        <span style={{ opacity: 0.3 }}>{eff.oldH}</span>
                      </td>
                    );
                  } else {
                    let style = { background: getColor(v), padding: 2, textAlign: 'center' };
                    const isDayChanged = (eff.changed && v > 0) || isManualDayChanged;
                    if (isDayChanged) {
                      style.outline = '2px solid var(--g)';
                      style.outlineOffset = -1;
                      if (eff.isNewDay) { style.fontWeight = 'bold'; style.color = 'var(--b)'; }
                    }
                    const dayNote = isManualDayChanged 
                      ? `Было: ${origDayVal}ч → Стало: ${curDayVal}ч (ручное изменение)` 
                      : eff.note;
                    cells.push(<td key={d} style={style} title={dayNote}>{v > 0 ? v : ''}</td>);
                  }
                }

                return (
                  <tr key={idx}>
                    <td style={{ textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1, color: isChangedRow ? 'var(--g)' : '', fontWeight: isChangedRow ? 'bold' : '' }}>
                      {e.nm.split(' ').slice(0, 2).join(' ')}{isChangedRow ? ' *' : ''}
                    </td>
                    <td style={{ position: 'sticky', left: 140, background: 'var(--bg)', zIndex: 1 }}><span className="bd bb" style={{ fontSize: '.55rem' }}>{e.dp}</span></td>
                    {cells}
                    <td style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)' }}>
                      <strong>{eTotalHs > 500 ? '—' : eTotalHs}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="leg">
        <span><div className="sq" style={{ background: 'var(--s1)' }}></div>Выходной</span>
        <span><div className="sq" style={{ background: 'rgba(16,192,144,.4)' }}></div>1-3ч</span>
        <span><div className="sq" style={{ background: 'rgba(240,192,64,.5)' }}></div>4-7ч</span>
        <span><div className="sq" style={{ background: 'rgba(0,212,200,.6)' }}></div>8-10ч</span>
        <span><div className="sq" style={{ background: 'rgba(124,108,240,.7)' }}></div>11+ч</span>
        {showDelta && <span><div className="sq" style={{ background: 'rgba(16,192,144,.3)', outline: '2px solid var(--g)' }}></div>Изменено</span>}
      </div>

      {/* Hourly Matrix */}
      <div className="cd" style={{ marginTop: 20 }}>
        <h3>🕒 Почасовая статистика (чел. на линии) — {MN[m]}</h3>
        <div className="sub">Плотность смен в каждом часе на каждый день.</div>
        <div className="scroll-x">
          <table className="heatmap-table" style={{ fontSize: '.65rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.05)' }}>
                <th style={{ minWidth: 40 }}>Час</th>
                {Array.from({ length: days }, (_, d) => <th key={d} style={{ width: 24 }}>{d + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <td style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}><strong>{String(h).padStart(2, '0')}:00</strong></td>
                  {Array.from({ length: days }, (_, d) => {
                    const cv = curMatrix[h][d]; // "Было" (original)
                    const ov = optMatrix[h][d]; // "Стало" (current/optimized)
                    if (!showDelta) {
                      return <td key={d} style={{ background: cv > 0 ? `rgba(124,108,240,${0.1 + (cv / 20)})` : 'transparent', border: '1px solid rgba(255,255,255,0.05)' }}>{cv > 0 ? cv : ''}</td>;
                    } else {
                      const diff = ov - cv;
                      let bg = 'transparent';
                      if (ov > 0 || cv > 0) {
                        if (diff > 0) bg = `rgba(16,192,144,${0.1 + Math.min(diff / 5, 0.8)})`;
                        else if (diff < 0) bg = `rgba(239,96,80,${0.1 + Math.min(-diff / 5, 0.8)})`;
                        else bg = `rgba(124,108,240,${0.1 + (ov / 20)})`;
                      }
                      const col = diff > 0 ? 'var(--g)' : (diff < 0 ? 'var(--r)' : '');
                      return <td key={d} style={{ background: bg, border: '1px solid rgba(255,255,255,0.05)', color: col }} title={`Было: ${cv}, Стало: ${ov}`}>{ov > 0 ? ov : (cv > 0 && diff < 0 ? cv : '')}</td>;
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
