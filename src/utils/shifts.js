import { MD } from '../data/config.js';

/** Parse time range string "HH:MM-HH:MM" → {s: minutes, e: minutes} */
export function pT(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[:.]?(\d{2})?\s*[-–—]\s*(\d{1,2})[:.]?(\d{2})?/);
  return m ? { s: +m[1] * 60 + (+m[2] || 0), e: +m[3] * 60 + (+m[4] || 0) } : null;
}

/** Calculate duration in hours, subtracting rest time */
export function getDurH(wh) {
  const t = pT(wh);
  if (!t) return 0;
  let { s, e } = t;
  if (e <= s) e += 1440;
  let dur = Math.round((e - s) / 60);
  if (dur >= 24) dur -= 2;
  else if (dur >= 8) dur -= 1;
  return dur;
}

/** Generate 24-element coverage array from work hours string */
export function hCov(wh) {
  const t = pT(wh);
  if (!t) return Array(24).fill(0);
  let { s, e } = t;
  if (e <= s) e += 1440;
  const c = Array(24).fill(0);
  for (let m = s; m < e; m += 60) c[Math.floor((m % 1440) / 60)] = 1;
  return c;
}

/** Detect shift pattern from work hours and optional monthly data */
export function sPat(wh, fullMsArray = null) {
  if (!wh) return '5/2';
  const t = pT(wh);
  if (!t) return '5/2';
  let s = t.s, e = t.e;
  if (e <= s) e += 1440;
  const d = (e - s) / 60;
  if (d >= 20) return 'сутки';
  if (s >= 1140 || e > 1440) return 'ночь';
  if (s < 420) return 'ранняя';
  if (d <= 9) return '5/2';

  if (Array.isArray(fullMsArray) && fullMsArray.length === 12) {
    let streaks = [];
    let currentStreak = 0;
    // Iterate over all 12 months sequentially to get seamless cross-month streaks?
    // Let's just flatmap the days.
    for (let m = 0; m < 12; m++) {
      if (!fullMsArray[m]?.d) continue;
      for (let v of fullMsArray[m].d) {
        if (typeof v === 'number' && v > 0) {
          currentStreak++;
        } else {
          if (currentStreak > 0) streaks.push(currentStreak);
          currentStreak = 0;
        }
      }
    }
    if (currentStreak > 0) streaks.push(currentStreak);
    
    // Count how many 3-day work streaks vs 2-day work streaks in the whole year
    const threes = streaks.filter(s => s === 3).length;
    const twos = streaks.filter(s => s === 2).length;
    
    // If the person has more than 10 3-day streaks in a year, and it is a meaningful ratio to 2-day streaks
    if (threes >= 5 && threes >= twos * 0.25) return '2/2/3';
  } else if (fullMsArray && fullMsArray.d) {
    // Fallback for single month
    let streaks = [];
    let currentStreak = 0;
    for (let v of fullMsArray.d) {
      if (typeof v === 'number' && v > 0) currentStreak++;
      else {
        if (currentStreak > 0) streaks.push(currentStreak);
        currentStreak = 0;
      }
    }
    if (currentStreak > 0) streaks.push(currentStreak);
    const threes = streaks.filter(s => s === 3).length;
    const twos = streaks.filter(s => s === 2).length;
    if (threes >= 3 && threes >= twos * 0.4) return '2/2/3';
  }
  return '2/2';
}

/** Detect real work/off pattern from actual data analysis */
export function detectRealPattern(emp) {
  let workRuns = [], offRuns = [], curW = 0, curO = 0, totalWork = 0, totalOff = 0, totalDays = 0;
  for (let m = 0; m < 12; m++) {
    if (emp.ms[m].t < 40) continue;
    for (let d = 0; d < emp.ms[m].d.length; d++) {
      totalDays++;
      if (emp.ms[m].d[d] > 0) { totalWork++; curW++; if (curO > 0) { offRuns.push(curO); curO = 0; } }
      else { totalOff++; curO++; if (curW > 0) { workRuns.push(curW); curW = 0; } }
    }
  }
  if (curW > 0) workRuns.push(curW);
  if (curO > 0) offRuns.push(curO);

  const shortOff = offRuns.filter(r => r <= 5);
  const shortWork = workRuns.filter(r => r <= 7);
  const avgWork = shortWork.length ? +(shortWork.reduce((a, b) => a + b, 0) / shortWork.length).toFixed(1) : 0;
  const avgOff = shortOff.length ? +(shortOff.reduce((a, b) => a + b, 0) / shortOff.length).toFixed(1) : 0;
  const ratio = totalDays > 0 ? +(totalWork / totalDays * 100).toFixed(0) : 0;

  let pattern = 'irregular';
  if (avgWork >= 3.8 && avgWork <= 5.5 && avgOff >= 1.5 && avgOff <= 2.5) pattern = '5/2';
  else if (avgWork >= 1.8 && avgWork <= 2.5 && avgOff >= 1.8 && avgOff <= 2.5) pattern = '2/2';
  else if (avgWork >= 2.5 && avgWork <= 3.5 && avgOff >= 2.5 && avgOff <= 3.5) pattern = '3/3';
  else if (avgWork >= 1 && avgWork <= 1.3 && avgOff >= 2.5 && avgOff <= 3.5) pattern = '1/3 (сутки)';
  else if (avgWork >= 2.5 && avgWork <= 3.5 && avgOff >= 1.5 && avgOff <= 2.5) pattern = '2/2-3/2';

  let drifting = false;
  if (pattern === '2/2') {
    const workLens = shortWork.filter(r => r <= 3);
    const variance = workLens.length > 3 ? workLens.reduce((s, v) => s + Math.pow(v - avgWork, 2), 0) / workLens.length : 0;
    if (variance > 0.4) drifting = true;
  }
  return { pattern, avgWork, avgOff, ratio, totalWork, totalOff, totalDays, drifting, workRuns: shortWork, offRuns: shortOff };
}

/** Parse vacation hex bitmask */
export function parseVacHex(hex) {
  if (!hex) return Array(366).fill(0);
  let bin = '';
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, '0');
  }
  return bin.split('').map(b => parseInt(b)).concat(Array(366).fill(0)).slice(0, 366);
}

/** Match names accounting for different writings */
export function matchName(n1, n2) {
  if (!n1 || !n2) return false;
  const clean = n => n.toLowerCase().replace(/\(.*\)/g, '').replace(/[^а-я0-9a-z\s]/g, '').split(/\s+/).filter(x => x.length > 1);
  const p1 = clean(n1), p2 = clean(n2);
  if (p1.length < 2 || p2.length < 2) return n1.trim().toLowerCase() === n2.trim().toLowerCase();
  return (p1[0] === p2[0] && p1[1] === p2[1]) || (p1[0] === p2[1] && p1[1] === p2[0]);
}

/** Create a dummy employee when missing from SHIFT_DATA */
export function createDummyEmp(name, dept, shift) {
  const pattern = (shift === '09:00-09:00' || shift === '21:00-09:00' || shift === '19:00-07:00') ? '1/3' : '2/2';
  const h = hCov(shift);
  const ms = [];
  for (let m = 0; m < 12; m++) {
    const days = [];
    const mDays = MD[m];
    for (let d = 0; d < mDays; d++) {
      let doy = 0;
      for (let i = 0; i < m; i++) doy += MD[i];
      doy += d;
      const isWork = pattern === '2/2' ? (doy % 4) < 2 : (doy % 4) === 0;
      days.push(isWork ? 12 : 0);
    }
    ms.push({ d: days, t: days.reduce((a, b) => a + b, 0) });
  }
  return { nm: name, dp: dept, wh: shift, pat: pattern, ms, cov: h, loc: '', v: '' };
}
