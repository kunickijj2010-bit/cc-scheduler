import { useMemo } from 'react';
import { MD, MN, DOWL, APP_CONFIG } from '../data/config.js';
import { demHByDept } from '../utils/coverage.js';
import { parseVacHex, hCov } from '../utils/shifts.js';
import { getChangesForVariant, getEffectiveHours } from '../utils/optimizer.js';

/**
 * Coverage heatmap — shows hourly coverage for each day of the selected month.
 * Fix #1: Accounts for vacation bitmask.
 * Fix #8: Uses dept-specific demand when filtered.
 */
export default function Heatmap({ employees, metrics, curMonth, curDept, isForecast, deptOptVars }) {
  const daysInMonth = MD[curMonth];
  const targetLoad = APP_CONFIG.TARGET_LOAD_PER_HOUR;

  const getOptFor = (emp) => {
    if (!deptOptVars) return 'current';
    return deptOptVars[emp.dp] || 'current';
  };

  const isAnyOpt = useMemo(() => {
    if (!deptOptVars) return false;
    return Object.values(deptOptVars).some(v => v !== 'current');
  }, [deptOptVars]);

  // Compute dept-specific demand when filtered
  const demand = useMemo(() => {
    if (!metrics) return null;
    if (curDept && curDept !== 'all') {
      return demHByDept(curMonth, curDept, isForecast);
    }
    return metrics.DH[curMonth];
  }, [metrics, curMonth, curDept, isForecast]);

  // Build per-day, per-hour coverage matrix — vacation-aware
  const matrix = useMemo(() => {
    if (!employees.length) return null;
    // Pre-compute vacation masks
    const vacMasks = employees.map(e => parseVacHex(e.v));
    let doyOffset = 0;
    for (let i = 0; i < curMonth; i++) doyOffset += MD[i];

    const mat = [];
    for (let d = 0; d < daysInMonth; d++) {
      const hourCounts = Array(24).fill(0);
      const doy = doyOffset + d;
      for (let ei = 0; ei < employees.length; ei++) {
        const e = employees[ei];
        if (vacMasks[ei][doy] === 1) continue;  // vacation bitmask
        if (!e.ms[curMonth]) continue;
        const val = e.ms[curMonth].d[d];
        if (typeof val === 'string') continue;  // vacation/sick text marker

        const v = getOptFor(e);
        if (v === 'current') {
          if (!val || val <= 0) continue;
          const dayCov = (e.whm && e.whm[curMonth]) ? hCov(e.whm[curMonth][d]) : e.cov;
          for (let h = 0; h < 24; h++) {
            if (dayCov[h]) hourCounts[h]++;
          }
        } else {
          const vChanges = getChangesForVariant(v);
          const eff = getEffectiveHours(e, curMonth, d, vChanges);
          if (eff.h > 0 && typeof eff.h === 'number' && !eff.ghost) {
            let covArr = eff.covArr || (e.whm ? hCov(e.whm[curMonth][d]) : e.cov);
            for (let h = 0; h < 24; h++) {
              if (covArr[h]) hourCounts[h]++;
            }
          }
        }
      }
      mat.push(hourCounts);
    }
    return mat;
  }, [employees, curMonth, daysInMonth, deptOptVars]);

  if (!matrix) return null;

  const allVals = matrix.flat();
  const maxVal = Math.max(...allVals, 1);

  const dow1 = new Date(2026, curMonth, 1).getDay();

  function cellColor(coverage, hour) {
    if (!demand) {
      const t = coverage / maxVal;
      return `rgba(16, 192, 144, ${0.1 + t * 0.6})`;
    }
    const needed = demand[hour] / targetLoad;
    const ratio = needed > 0 ? coverage / needed : (coverage > 0 ? 2 : 0);

    if (ratio >= 1.3) return 'rgba(16, 192, 144, 0.55)';
    if (ratio >= 1.0) return 'rgba(16, 192, 144, 0.3)';
    if (ratio >= 0.7) return 'rgba(240, 192, 64, 0.35)';
    if (ratio >= 0.4) return 'rgba(239, 96, 80, 0.35)';
    return 'rgba(239, 96, 80, 0.55)';
  }

  return (
    <div className="cd">
      <h3>📅 {MN[curMonth]} 2026{isAnyOpt ? ' (Анализ вариантов)' : ''}</h3>
      <div className="sub">Строки = дни месяца, столбцы = часы (0–23). Цвет: 🟢 профицит → 🟡 баланс → 🔴 дефицит</div>
      <div className="scroll-x" style={{ maxHeight: '60vh' }}>
        <table className="heatmap-table">
          <thead>
            <tr>
              <th style={{ minWidth: 45 }}>День</th>
              <th style={{ minWidth: 30 }}>ДН</th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className={`hm-hour ${h >= 21 || h < 8 ? 'night' : h >= 10 && h <= 17 ? 'peak' : ''}`}>
                  {String(h).padStart(2, '0')}
                </th>
              ))}
              <th style={{ minWidth: 35 }}>Ср.</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((hours, d) => {
              const dayDow = (dow1 + d) % 7;
              const isWe = dayDow === 0 || dayDow === 6;
              const avg = (hours.reduce((a, b) => a + b, 0) / 24).toFixed(1);

              // Count employees on shift (vacation-aware)
              let doyOffset = 0;
              for (let i = 0; i < curMonth; i++) doyOffset += MD[i];
              const doy = doyOffset + d;
              const onShift = employees.filter((e) => {
                const val = e.ms[curMonth].d[d];
                if (!val || val <= 0 || typeof val === 'string') return false;
                const mask = parseVacHex(e.v);
                return mask[doy] !== 1;
              }).length;

              return (
                <tr key={d}>
                  <td className={`hm-day ${isWe ? 'weekend' : ''}`}>
                    {d + 1} <span className="hm-dow">{DOWL[dayDow]}</span>
                  </td>
                  <td className="hm-count">{onShift}</td>
                  {hours.map((cov, h) => (
                    <td
                      key={h}
                      className="hm-cell"
                      style={{ background: cellColor(cov, h) }}
                      title={`${d + 1} ${MN[curMonth]}, ${h}:00 — ${cov} чел.${demand ? ` (нужно ${(demand[h] / targetLoad).toFixed(1)})` : ''}`}
                    >
                      {cov > 0 ? cov : ''}
                    </td>
                  ))}
                  <td className="hm-avg">{avg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
