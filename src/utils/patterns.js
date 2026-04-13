import { SHIFT_PATTERNS, MD } from '../data/config.js';
import { hCov, getDurH } from './shifts.js';

/**
 * Generate day-by-day schedule for a given pattern, phase and work hours.
 * @param {string} patternKey - Key from SHIFT_PATTERNS
 * @param {number} phase - Phase offset (0-based)
 * @param {string} workHours - "HH:MM-HH:MM"
 * @param {number} startMonth - Month to start from (0-indexed), default 0
 * @param {number} startDay - Day within startMonth to start from (0-indexed), default 0
 * @param {Array} existingMs - Existing monthly data (to preserve before startDate)
 * @returns {Array} 12-element array of { d: [...], t: N }
 */
export function generateSchedule(patternKey, phase, workHours, startMonth = 0, startDay = 0, existingMs = null) {
  const pattern = SHIFT_PATTERNS[patternKey];
  if (!pattern) return existingMs || createEmptyMs();

  const cycle = pattern.cycle;
  let durH = getDurH(workHours) || pattern.typicalHours;

  // Calculate global day offset for the start of the year
  const ms = [];
  let globalDay = 0;
  
  let startGlobalDay = 0;
  for (let m = 0; m < startMonth; m++) startGlobalDay += MD[m];
  startGlobalDay += startDay;

  for (let m = 0; m < 12; m++) {
    const daysInMonth = MD[m];
    const days = [];

    for (let d = 0; d < daysInMonth; d++) {
      // If before startDate, keep existing data
      if (m < startMonth || (m === startMonth && d < startDay)) {
        if (existingMs && existingMs[m]) {
          days.push(existingMs[m].d[d] || 0);
        } else {
          days.push(0);
        }
      } else {
        // Check if existing data has a vacation/sick marker — preserve it
        const existingVal = existingMs && existingMs[m] ? existingMs[m].d[d] : null;
        if (typeof existingVal === 'string') {
          // 'ОТП', 'БЛ', etc. — preserve vacation/sick markers
          days.push(existingVal);
        } else {
          // Apply pattern cycle relative to the chosen start date so Phase 0 aligns precisely
          let daysPassed = globalDay - startGlobalDay;
          if (daysPassed < 0) daysPassed += 365 * 10; // Safety wrap if retroactively scheduling
          const cycleIndex = (daysPassed + phase) % cycle.length;
          days.push(cycle[cycleIndex] ? durH : 0);
        }
      }
      globalDay++;
    }

    ms.push({ d: days, t: days.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) });
  }

  return ms;
}

/** Create empty monthly data structure */
function createEmptyMs() {
  return Array.from({ length: 12 }, (_, m) => ({
    d: Array(MD[m]).fill(0),
    t: 0,
  }));
}

/**
 * Apply a pattern change to an employee.
 * Returns a new employee object (immutable).
 */
export function applyPatternChange(employee, newPattern, phase, workHours, startMonth = 0, startDay = 0, reason = '') {
  const newMs = generateSchedule(newPattern, phase, workHours, startMonth, startDay, employee.ms);
  const newCov = hCov(workHours);

  const newWhm = employee.whm ? employee.whm.map(m => [...m]) : Array.from({ length: 12 }, (_, m) => Array(MD[m]).fill(employee.wh));
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      if (m > startMonth || (m === startMonth && d >= startDay)) {
        newWhm[m][d] = workHours;
      }
    }
  }

  const original = employee._original || {
    wh: employee.wh,
    whm: employee.whm ? employee.whm.map(m => [...m]) : Array.from({ length: 12 }, (_, m) => Array(MD[m]).fill(employee.wh)),
    pat: employee.pat,
    ms: employee.ms.map(m => ({ d: [...m.d], t: m.t })),
    cov: [...employee.cov],
  };

  const change = {
    ts: new Date().toISOString(),
    field: 'pattern+time',
    from: `${employee.pat} ${employee.wh}`,
    to: `${newPattern} ${workHours}`,
    startDate: `${startMonth + 1}/${startDay + 1}`,
    reason,
  };

  return {
    ...employee,
    wh: workHours,
    whm: newWhm,
    pat: newPattern,
    cov: newCov,
    ms: newMs,
    _original: original,
    _modified: true,
    _changes: [...(employee._changes || []), change],
  };
}

/**
 * Apply only a time change (keep pattern/schedule, update hours per day).
 */
export function applyTimeChange(employee, newWorkHours, startMonth = 0, startDay = 0, reason = '') {
  const newCov = hCov(newWorkHours);
  let durH = getDurH(newWorkHours) || 11;

  const newWhm = employee.whm ? employee.whm.map(m => [...m]) : Array.from({ length: 12 }, (_, m) => Array(MD[m]).fill(employee.wh));
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      if (m > startMonth || (m === startMonth && d >= startDay)) {
        newWhm[m][d] = newWorkHours;
      }
    }
  }

  const original = employee._original || {
    wh: employee.wh,
    whm: employee.whm ? employee.whm.map(m => [...m]) : Array.from({ length: 12 }, (_, m) => Array(MD[m]).fill(employee.wh)),
    pat: employee.pat,
    ms: employee.ms.map(m => ({ d: [...m.d], t: m.t })),
    cov: [...employee.cov],
  };

  const newMs = employee.ms.map((m, mIdx) => {
    const d = m.d.map((v, dIdx) => {
      if (mIdx > startMonth || (mIdx === startMonth && dIdx >= startDay)) {
        return (typeof v === 'number' && v > 0) ? durH : v;
      }
      return v;
    });
    return { d, t: d.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) };
  });

  const change = {
    ts: new Date().toISOString(),
    field: 'wh',
    from: employee.wh,
    to: newWorkHours,
    startDate: `${startMonth + 1}/${startDay + 1}`,
    reason,
  };

  return {
    ...employee,
    wh: newWorkHours,
    whm: newWhm,
    cov: newCov,
    ms: newMs,
    _original: original,
    _modified: true,
    _changes: [...(employee._changes || []), change],
  };
}

/**
 * Set a single day value (work/off/vacation/sick).
 */
export function setDayValue(employee, month, day, value, reason = '') {
  const original = employee._original || {
    wh: employee.wh,
    whm: employee.whm ? employee.whm.map(m => [...m]) : Array.from({ length: 12 }, (_, idx) => Array(MD[idx]).fill(employee.wh)),
    pat: employee.pat,
    ms: employee.ms.map(m => ({ d: [...m.d], t: m.t })),
    cov: [...employee.cov],
  };

  const newMs = employee.ms.map((m, mi) => {
    if (mi !== month) return m;
    const d = [...m.d];
    d[day] = value;
    return { d, t: d.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) };
  });

  return {
    ...employee,
    ms: newMs,
    _original: original,
    _modified: true,
    _changes: [...(employee._changes || []), {
      ts: new Date().toISOString(),
      field: 'day',
      from: `${month + 1}/${day + 1}: ${employee.ms[month].d[day]}`,
      to: `${month + 1}/${day + 1}: ${value}`,
      reason,
    }],
  };
}

/** Revert employee to original state */
export function revertEmployee(employee) {
  if (!employee._original) return employee;
  return {
    ...employee,
    wh: employee._original.wh,
    pat: employee._original.pat,
    ms: employee._original.ms,
    cov: employee._original.cov,
    _original: null,
    _modified: false,
    _changes: [],
  };
}
