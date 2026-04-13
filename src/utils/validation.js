import { APP_CONFIG, MD, DP } from '../data/config.js';

/**
 * Validate a single employee against business rules.
 * Returns { errors: [], warnings: [] }
 */
export function validateEmployee(emp) {
  const errors = [];
  const warnings = [];

  // Monthly hours
  for (let m = 0; m < 12; m++) {
    if (emp.ms[m].t > 200) {
      warnings.push({ type: 'hours', month: m, msg: `${emp.nm.split(' ')[0]} — ${emp.ms[m].t}ч в ${APP_CONFIG.MONTHS_NAMES_SHORT[m]} (лимит 200ч)` });
    }
  }

  // Yearly hours
  const yearTotal = emp.ms.reduce((s, m) => s + m.t, 0);
  if (yearTotal > 1973) {
    warnings.push({ type: 'year', msg: `${emp.nm.split(' ')[0]} — ${yearTotal}ч за год (норма 1973ч)` });
  }

  return { errors, warnings };
}

/**
 * Validate coverage against minimum night requirements.
 * Returns array of warnings.
 */
export function validateCoverage(employees, curMonth) {
  const warnings = [];
  const daysInMonth = MD[curMonth];
  const nightHours = [21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
  const minCov = APP_CONFIG.MIN_NIGHT_COVERAGE;

  for (let d = 0; d < daysInMonth; d++) {
    for (const dept of DP) {
      if (!minCov[dept] || minCov[dept] === 0) continue;

      for (const h of nightHours) {
        let count = 0;
        for (const e of employees) {
          if (e.dp !== dept) continue;
          const val = e.ms[curMonth].d[d];
          if (!val || val <= 0) continue;
          if (e.cov[h]) count++;
        }
        if (count < minCov[dept]) {
          warnings.push({
            type: 'night',
            dept,
            day: d,
            hour: h,
            count,
            needed: minCov[dept],
            msg: `${dept} ночь ${d + 1}.${String(curMonth + 1).padStart(2, '0')} ${h}:00 — ${count} оп. (мин. ${minCov[dept]})`,
          });
          break; // One warning per dept per day is enough
        }
      }
    }
  }

  return warnings;
}

/**
 * Check peak coverage deficit (10-17h).
 */
export function validatePeakCoverage(metrics, curMonth) {
  const warnings = [];
  if (!metrics) return warnings;

  const targetLoad = APP_CONFIG.TARGET_LOAD_PER_HOUR;

  for (let h = 10; h <= 17; h++) {
    const cov = metrics.MC[curMonth][h];
    const needed = metrics.DH[curMonth][h] / targetLoad;
    const ratio = needed > 0 ? cov / needed : 1;
    if (ratio < 0.6) {
      warnings.push({
        type: 'peak',
        hour: h,
        msg: `Пик ${h}:00 — покрытие ${cov.toFixed(1)} vs нужно ${needed.toFixed(1)} (${(ratio * 100).toFixed(0)}%)`,
      });
    }
  }

  return warnings;
}
