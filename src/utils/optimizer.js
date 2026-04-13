/**
 * Авто-оптимизатор смен — порт из cc_dashboard_v4.html
 * computeAutoShifts, analyzeGapsByDay, analyzeBestVariants, computeOptCoverage, getMergedUnboundedChanges
 */

import { DP, MD, APP_CONFIG, MN } from '../data/config.js';
import { OPT_CHANGES } from '../data/optChanges.js';
import { pT, hCov, sPat, matchName, parseVacHex, getDurH } from './shifts.js';
import { demH, demHByDept } from './coverage.js';

// ---------- HELPERS ----------

function getRealD(e, m, d) {
  if (!e.ms || !e.ms[m]) return null;
  if (d < 0) {
    if (m === 0) return 0;
    const pM = e.ms[m - 1];
    if (!pM) return 0;
    return getRealD(e, m - 1, pM.d.length + d);
  }
  const cM = e.ms[m].d;
  if (d >= cM.length) {
    if (m === 11) return 0;
    return getRealD(e, m + 1, d - cM.length);
  }
  return cM[d];
}

function getCycleState(e, m, d) {
  let v = getRealD(e, m, d);
  if (v === null) return false;
  if (typeof v === 'number') return v > 0;
  for (let c = 1; c <= 15; c++) {
    let vf = getRealD(e, m, d + c * 4);
    if (typeof vf === 'number') return vf > 0;
    let vb = getRealD(e, m, d - c * 4);
    if (typeof vb === 'number') return vb > 0;
  }
  return false;
}

function getDoy(m, d) {
  let doy = 0;
  for (let i = 0; i < m; i++) doy += MD[i];
  return doy + d;
}

// ---------- CORE OPTIMIZER ----------

// Cache for computed results
let _autoShiftsCache = null;
let _unboundedShiftsCache = null;

export function getEffectiveHours(e, m, dIdx, changes) {
  if (!e.ms[m]) return { h: 0, changed: false, ghost: false, note: '' };
  const v = e.ms[m].d[dIdx];
  if (typeof v === 'string') return { h: v, changed: false, ghost: false, note: 'Отпуск/Больничный' };
  const chg = changes.find(c => matchName(c.name, e.nm));

  let isOrigWorkDay = v > 0;
  let isNewWorkDay = isOrigWorkDay;

  if (chg && chg.newPattern === '2/2') {
    let phaseOffset = chg.phase !== undefined ? chg.phase : 0;
    isNewWorkDay = ((getDoy(m, dIdx) + phaseOffset) % 4) < 2;
  } else if (chg && chg.shiftDays) {
    isNewWorkDay = getCycleState(e, m, dIdx - chg.shiftDays);
  }

  let origH = v;
  if (isOrigWorkDay) {
    const dayWh = (e.whm && e.whm[m]) ? e.whm[m][dIdx] : e.wh;
    origH = getDurH(dayWh) || origH;
  }

  if (!isNewWorkDay && isOrigWorkDay && chg && (chg.shiftDays || chg.newPattern)) {
    return { h: 0, covArr: null, changed: false, ghost: true, oldH: origH, note: 'Был рабочий день (сдвинут)' };
  }
  if (!isNewWorkDay) return { h: 0, covArr: null, changed: false, ghost: false, note: '' };

  if (chg && chg.to) {
    return { h: getDurH(chg.to) || origH, covArr: hCov(chg.to), changed: true, isNewDay: !isOrigWorkDay, ghost: false, note: `Сдвиг: ${chg.to} (${chg.effect})` };
  }

  if (isNewWorkDay && !isOrigWorkDay) {
    const dayWh = (e.whm && e.whm[m]) ? e.whm[m][dIdx] : e.wh;
    return { h: origH, covArr: hCov(dayWh), changed: true, isNewDay: true, ghost: false, note: `Сдвиг дней: ${dayWh}` };
  }

  const dayWh = (e.whm && e.whm[m]) ? e.whm[m][dIdx] : e.wh;
  return { h: origH, covArr: hCov(dayWh), changed: false, ghost: false, note: '' };
}

export function resetOptimizerCache() {
  _autoShiftsCache = null;
  _unboundedShiftsCache = null;
}

export function computeAutoShifts(employees, isUnbounded = false, isForecast = false) {
  if (!isUnbounded && _autoShiftsCache) return _autoShiftsCache;
  if (isUnbounded && _unboundedShiftsCache) return _unboundedShiftsCache;

  const E = employees;
  const globGrid = {};
  DP.forEach(dp => {
    globGrid[dp] = Array(365).fill(0).map(() => Array(24).fill(null).map(() => ({ cov: 0, req: 0, v: 0 })));
  });

  const doyMap = [];
  let currentDoy = 0;
  for (let m = 0; m < 12; m++) {
    doyMap[m] = [];
    for (let d = 0; d < MD[m]; d++) { doyMap[m][d] = currentDoy++; }
  }

  // Build initial grid
  const allGaps = analyzeGapsByDay(E, 'current', isForecast);
  allGaps.forEach(g => {
    const doy = doyMap[g.m][g.d];
    for (const dp of DP) {
      if (!globGrid[dp]) continue;
      const demArr = demHByDept(g.m, dp, isForecast);
      for (let h = 0; h < 24; h++) {
        const cov = g.deptCov[dp] ? g.deptCov[dp][h] : 0;
        let req = Math.ceil(demArr[h] / APP_CONFIG.TARGET_LOAD_PER_HOUR);
        if (dp === 'VIP' && (h >= 21 || h <= 8)) req = Math.min(req, 1);
        globGrid[dp][doy][h] = { cov, req, v: cov - req };
      }
    }
  });

  // Average coverage per dept per hour
  const avgDeptCov = {};
  DP.forEach(dp => {
    avgDeptCov[dp] = Array(24).fill(0);
    for (let h = 0; h < 24; h++) {
      let total = 0;
      for (let doy = 0; doy < 365; doy++) total += globGrid[dp][doy][h].cov;
      avgDeptCov[dp][h] = total / 365;
    }
  });

  // Clone employees
  let candidates = E.map(e => ({
    ...e,
    ms: e.ms.map(m => ({ ...m, d: [...m.d] })),
    origPat: e.pat,
    origWh: e.wh,
  }));

  const baseManual = OPT_CHANGES['C'] || [];
  if (isUnbounded) {
    candidates.forEach(e => {
      if (!globGrid[e.dp]) return; // skip unknown departments
      const manual = baseManual.find(m => matchName(m.name, e.nm));
      if (manual && manual.newPattern) {
        applyPatternToGrid(e, manual.newPattern, manual.to, manual.phase, globGrid, doyMap, getCycleState);
      } else if (e.pat === '5/2' || e.pat === 'ранняя') {
        const weekendGaps = checkWeekendGaps(e.dp, globGrid, doyMap);
        if (weekendGaps > 50) {
          applyPatternToGrid(e, '2/2', e.wh, 0, globGrid, doyMap, getCycleState);
        }
      }
    });
  }

  // Score candidates
  candidates.forEach(e => {
    const dp = e.dp;
    if (!globGrid[dp]) { e.candScore = -999; return; }
    let currentImpact = 0;
    const t = pT(e.wh);
    if (!t) { e.candScore = -999; return; }
    let sH = t.s / 60, eH = t.e / 60 + (t.e < t.s ? 24 : 0);
    for (let m = 0; m < 12; m++) {
      for (let d = 0; d < MD[m]; d++) {
        if (!e.ms[m] || e.ms[m].d[d] <= 0) continue;
        const doy = doyMap[m][d];
        for (let h = Math.floor(sH); h < Math.ceil(eH); h++) {
          currentImpact += globGrid[dp][doy][h % 24].v;
        }
      }
    }
    e.candScore = currentImpact;
    e.parsedT = { sH: Math.floor(sH), eH: Math.ceil(eH), dur: Math.ceil(eH) - Math.floor(sH), exactS: t.s / 60, exactE: t.e / 60 };
  });

  candidates.sort((a, b) => b.candScore - a.candScore);
  let autoShifts = [];
  const deptShiftCount = {};
  const MAX_SHIFTS_PER_DEPT = isUnbounded ? 100 : 30;

  candidates.forEach(e => {
    if (!globGrid[e.dp]) return;
    if (!e.parsedT || e.parsedT.dur > 13 || e.parsedT.dur < 4) return;
    const deptCount = deptShiftCount[e.dp] || 0;
    if (deptCount >= MAX_SHIFTS_PER_DEPT) return;

    const pat = sPat(e.wh);
    const canShiftDays = pat !== '5/2' && pat !== 'ранняя';
    if (!canShiftDays) return;

    const dp = e.dp;
    let bestShiftDays = 0, bestShiftHours = 0, bestImp = 0;

    const employeeWorkDays = [];
    for (let m = 0; m < 12; m++) {
      for (let d = 0; d < MD[m]; d++) {
        if (e.ms[m] && e.ms[m].d[d] > 0) employeeWorkDays.push({ m, d, doy: doyMap[m][d] });
      }
    }

    const dayOpts = isUnbounded ? [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5] : [-3, -2, -1, 0, 1, 2, 3];
    // Limit hour shifts for overnight employees to ±1h to keep them in their slot
    const isNightWorker = e.parsedT.sH >= 19 || e.parsedT.sH <= 4;
    const hourOpts = isUnbounded
      ? (isNightWorker ? [-2, -1, 0, 1, 2] : Array.from({ length: 24 }, (_, i) => i - 12))
      : (isNightWorker ? [-1, 0, 1] : [-3, -2, -1, 0, 1, 2, 3]);

    const getP = (c, r, hr) => {
      let isNight = (hr >= 22 || hr <= 7);
      let isPeak = (hr >= 9 && hr <= 16);
      let minReq = isNight ? (APP_CONFIG.MIN_NIGHT_COVERAGE[dp] || 1) : 0;
      let nightHolePenalty = (isNight && c < minReq) ? (minReq - c) * 5000000 : 0;
      let variancePenalty = Math.pow(c - avgDeptCov[dp][hr], 2) * 5000;

      if (dp === 'VIP') {
        if (c < r) return nightHolePenalty + Math.pow(r - c, 2) * 5000 + variancePenalty;
        if (c === r) return nightHolePenalty + variancePenalty;
        let surplus = c - r;
        if (isNight) return Math.pow(surplus, 2) * 15000 + variancePenalty;
        if (isPeak) return Math.pow(surplus, 2) * 100 + variancePenalty;
        return Math.pow(surplus, 2) * 500 + variancePenalty;
      } else {
        if (c < r) return nightHolePenalty + Math.pow(r - c, 2) * 4000 + variancePenalty;
        if (c === r) return nightHolePenalty + variancePenalty;
        let surplus = c - r;
        if (isNight) {
          let strictSurplus = c - Math.max(r, minReq);
          return strictSurplus > 0 ? Math.pow(strictSurplus, 2) * 20000 + variancePenalty : variancePenalty;
        }
        if (isPeak) return Math.pow(surplus, 2) * 1500 + variancePenalty;
        return Math.pow(surplus, 2) * 3000 + variancePenalty;
      }
    };

    for (let dOff of dayOpts) {
      for (let hOff of hourOpts) {
        if (dOff === 0 && hOff === 0) continue;
        let imp = 0;

        employeeWorkDays.forEach(wd => {
          const doy = wd.doy;
          for (let h = 0; h < e.parsedT.dur; h++) {
            const hr = (e.parsedT.sH + h) % 24;
            const cell = globGrid[dp][doy][hr];
            imp += getP(cell.cov, cell.req, hr) - getP(cell.cov - 1, cell.req, hr);
          }
        });

        employeeWorkDays.forEach(wd => {
          const newDoy = wd.doy + dOff;
          if (newDoy >= 0 && newDoy < 365) {
            for (let h = 0; h < e.parsedT.dur; h++) {
              const hr = (e.parsedT.sH + hOff + h + 24) % 24;
              const cell = globGrid[dp][newDoy][hr];
              imp += getP(cell.cov + 1, cell.req, hr) - getP(cell.cov, cell.req, hr);
            }
          }
        });

        if ((-imp) > bestImp) {
          bestImp = -imp;
          bestShiftDays = dOff;
          bestShiftHours = hOff;
        }
      }
    }

    if (bestImp > 500) {
      let newTo = null;
      if (bestShiftHours !== 0) {
        let ns = (e.parsedT.exactS + bestShiftHours + 24) % 24;
        // Use dur (always positive, handles overnight) instead of exactE - exactS
        let ne = (ns + e.parsedT.dur) % 24;
        let formatHr = (dt) => {
          let mn = Math.round(dt * 60);
          let h = ((Math.floor(mn / 60) % 24) + 24) % 24;
          let m = ((mn % 60) + 60) % 60;
          return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        };
        newTo = `${formatHr(ns)}-${formatHr(ne)}`;
      } else { newTo = e.wh; }

      // Update grid
      employeeWorkDays.forEach(wd => {
        for (let h = 0; h < e.parsedT.dur; h++) {
          const hr = (e.parsedT.sH + h) % 24;
          globGrid[dp][wd.doy][hr].cov--;
        }
      });
      employeeWorkDays.forEach(wd => {
        const newDoy = wd.doy + bestShiftDays;
        if (newDoy >= 0 && newDoy < 365) {
          for (let h = 0; h < e.parsedT.dur; h++) {
            const hr = (e.parsedT.sH + bestShiftHours + h + 24) % 24;
            globGrid[dp][newDoy][hr].cov++;
          }
        }
      });

      autoShifts.push({
        name: e.nm, dept: e.dp, from: e.wh, to: newTo,
        shiftDays: bestShiftDays !== 0 ? bestShiftDays : undefined,
        effect: isUnbounded ? `Полная Авто-Перестройка (+${Math.round(bestImp)} эфф.)` : `Авто-Баланс (+${Math.round(bestImp)} эфф.)`,
      });
      deptShiftCount[e.dp] = (deptShiftCount[e.dp] || 0) + 1;
    }
  });

  if (isUnbounded) _unboundedShiftsCache = autoShifts;
  else _autoShiftsCache = autoShifts;
  return autoShifts;
}

function applyPatternToGrid(e, newPat, newWh, phase, grid, dMap) {
  const oldT = pT(e.origWh || e.wh);
  const newT = pT(newWh);
  if (!oldT || !newT) return;
  const osH = Math.floor(oldT.s / 60), oeH = Math.ceil(oldT.e / 60 + (oldT.e < oldT.s ? 24 : 0));
  const nsH = Math.floor(newT.s / 60), neH = Math.ceil(newT.e / 60 + (newT.e < newT.s ? 24 : 0));

  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      const doy = dMap[m][d];
      if (!e.ms[m]) continue;
      const wasWorking = e.ms[m].d[d] > 0;
      const isWorking = newPat === '2/2' ? ((doy + (phase || 0)) % 4 < 2) : getCycleState(e, m, d);

      if (wasWorking && grid[e.dp]) {
        for (let h = osH; h < oeH; h++) grid[e.dp][doy][h % 24].cov--, grid[e.dp][doy][h % 24].v--;
      }
      if (isWorking && grid[e.dp]) {
        for (let h = nsH; h < neH; h++) grid[e.dp][doy][h % 24].cov++, grid[e.dp][doy][h % 24].v++;
        e.ms[m].d[d] = 1;
      } else {
        e.ms[m].d[d] = 0;
      }
    }
  }
  e.wh = newWh;
  e.pat = newPat;
}

function checkWeekendGaps(dp, grid, dMap) {
  if (!grid[dp]) return 0;
  let gaps = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      const dow = new Date(2026, m, d + 1).getDay();
      if (dow === 0 || dow === 6) {
        const doy = dMap[m][d];
        if (!grid[dp][doy]) continue;
        for (let h = 10; h < 18; h++) if (grid[dp][doy][h].v < 0) gaps -= grid[dp][doy][h].v;
      }
    }
  }
  return gaps;
}

// ---------- ANALYZE GAPS BY DAY ----------

export function analyzeGapsByDay(employees, variant = 'current', isForecast = false) {
  const E = employees;
  let changes = getChangesForVariant(variant);

  let res = [];
  let currentDoy = 0;

  const getEffHours = (e, m, dIdx) => {
    if (!e.ms[m]) return { s: 0, e: 0 };
    const v = e.ms[m].d[dIdx];
    if (typeof v === 'string') return { s: 0, e: 0 };
    const chg = changes.find(c => matchName(c.name, e.nm));

    let isOrigWorkDay = v > 0;
    let isNewWorkDay = isOrigWorkDay;

    if (chg && chg.newPattern === '2/2') {
      let phaseOffset = chg.phase !== undefined ? chg.phase : 0;
      isNewWorkDay = ((getDoy(m, dIdx) + phaseOffset) % 4) < 2;
    } else if (chg && chg.shiftDays) {
      isNewWorkDay = getCycleState(e, m, dIdx - chg.shiftDays);
    }

    if (!isNewWorkDay) return { s: 0, e: 0 };

    let wh = e.wh;
    if (chg && chg.to) wh = chg.to;

    const t = pT(wh);
    if (!t) return { s: 0, e: 0 };
    let { s, e: eM } = t;
    if (eM <= s) eM += 1440;
    return { s, e: eM };
  };

  const DH = [];
  for (let m = 0; m < 12; m++) DH.push(demH(m, isForecast));

  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      const dow = (new Date(2026, m, d + 1)).getDay();
      const hourCov = Array(24).fill(0);
      const deptCov = {};
      DP.forEach(dp => deptCov[dp] = Array(24).fill(0));

      E.forEach(e => {
        const vacMask = parseVacHex(e.v);
        if (vacMask[currentDoy] === 1) return; // Ignore on vacation days

        const eff = getEffHours(e, m, d);
        if (eff.s === 0 && eff.e === 0) return;
        for (let minute = eff.s; minute < eff.e; minute += 60) {
          const hr = Math.floor((minute % 1440) / 60);
          if (e.dp !== 'Супервизия') hourCov[hr]++;
          if (deptCov[e.dp]) deptCov[e.dp][hr]++;
        }
      });

      let dayDeficit = 0, criticalHours = 0, worstGap = 0, worstH = -1;
      const req = DH[m].map(dh => Math.ceil(dh / APP_CONFIG.TARGET_LOAD_PER_HOUR));
      req.forEach((r, h) => {
        if (hourCov[h] < r) {
          let gap = r - hourCov[h];
          dayDeficit += gap;
          criticalHours++;
          if (gap > worstGap) { worstGap = gap; worstH = h; }
        }
      });

      res.push({ m, d, dow, hourCov, deptCov, dayDeficit, gapScore: dayDeficit, criticalHours, worstGap, worstH, doy: currentDoy });
      currentDoy++;
    }
  }
  return res;
}

// ---------- COVERAGE COMPUTATION ----------

export function computeOptCoverage(employees, variant) {
  const E = employees;
  let changes = getChangesForVariant(variant);

  const optMC = [];
  for (let m = 0; m < 12; m++) {
    const hT = Array(24).fill(0);
    for (let d = 0; d < MD[m]; d++) {
      const doy = getDoy(m, d);
      for (const e of E) {
        if (!e.ms[m]) continue;
        const v = e.ms[m].d[d];
        if (typeof v === 'string') continue;
        const vacMask = parseVacHex(e.v);
        if (vacMask[doy] === 1) continue; // Ignore vacation

        const chg = changes.find(c => matchName(c.name, e.nm));

        let isWorking = v > 0;
        if (chg && chg.newPattern === '2/2') {
          let phase = chg.phase !== undefined ? chg.phase : 0;
          isWorking = ((getDoy(m, d) + phase) % 4) < 2;
        } else if (chg && chg.shiftDays) {
          isWorking = getCycleState(e, m, d - chg.shiftDays);
        }

        if (!isWorking) continue;
        const cov = (chg && chg.to) ? hCov(chg.to) : e.cov;
        for (let h = 0; h < 24; h++) if (cov[h]) hT[h]++;
      }
    }
    optMC.push(hT.map(val => +(val / MD[m]).toFixed(1)));
  }
  return optMC;
}

// ---------- MERGED CHANGES ----------

export function getMergedUnboundedChanges(employees, isForecast) {
  const manual = OPT_CHANGES['C'] || [];
  const auto = _unboundedShiftsCache || computeAutoShifts(employees, true, isForecast);
  const map = new Map();
  manual.forEach(m => map.set(m.name, { ...m }));
  auto.forEach(a => {
    if (map.has(a.name)) {
      const m = map.get(a.name);
      if (a.to) m.to = a.to;
      if (a.shiftDays) m.shiftDays = a.shiftDays;
      m.effect = a.effect;
    } else {
      map.set(a.name, { ...a });
    }
  });
  return Array.from(map.values());
}

// ---------- BEST VARIANT RECOMMENDER ----------

export function analyzeBestVariants(employees, isForecast = false) {
  const autoShifts = computeAutoShifts(employees, false, isForecast);
  const unboundedShifts = computeAutoShifts(employees, true, isForecast);
  const E = employees;
  const variants = ['current', 'A', 'B', 'D', 'C'];
  const results = {};
  const recommendedChanges = {};

  DP.filter(dp => dp !== 'Супервизия').forEach(dp => {
    let bestVar = 'current', bestScore = -Infinity, bestPeak = 0, bestGaps = 0, bestReason = '';
    let curGaps = 0, curSmooth = 0;
    let bestChangesArray = [];

    variants.forEach(v => {
      let vChanges = [];
      let autoChanges = [];
      if (v === 'D') autoChanges = autoShifts;
      else if (v === 'C') { vChanges = OPT_CHANGES['C'] || []; autoChanges = unboundedShifts; }
      else if (v === 'A' || v === 'B') { vChanges = OPT_CHANGES[v] || []; }

      let totalPeak = 0, totalNightGaps = 0;
      const peakSamples = [];
      const nightHours = [21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
      const minReq = APP_CONFIG.MIN_NIGHT_COVERAGE[dp] || 1;

      let currentDoy = 0;
      for (let cm = 0; cm < 12; cm++) {
        for (let d = 0; d < MD[cm]; d++) {
          const doy = currentDoy + d;
          const dCov = Array(24).fill(0);
          for (const e of E) {
            if (e.dp !== dp) continue;
            const manual = vChanges.find(ch => matchName(ch.name, e.nm));
            const auto = autoChanges.find(ch => matchName(ch.name, e.nm));

            let pat = e.pat, wh = e.wh, phase = 0, sDays = 0;
            if (manual) {
              if (manual.newPattern) pat = manual.newPattern;
              if (manual.to) wh = manual.to;
              if (manual.phase !== undefined) phase = manual.phase;
            }
            if (auto) {
              if (auto.to) wh = auto.to;
              if (auto.shiftDays !== undefined) sDays = auto.shiftDays;
              if (auto.newPattern) pat = auto.newPattern;
            }

            let isWorking = false;
            if (pat === '2/2') {
              isWorking = ((doy + phase - sDays + 4000) % 4) < 2;
            } else {
              const vOrig = e.ms[cm].d[d];
              if (typeof vOrig === 'number' && sDays === 0) isWorking = vOrig > 0;
              else {
                const p = sPat(wh);
                if (p === '5/2' || p === 'ранняя') {
                  let dow = new Date(2026, cm, d + 1).getDay();
                  isWorking = (dow !== 0 && dow !== 6);
                } else isWorking = getCycleState({ pat: p, wh: wh, ms: e.ms }, cm, d - sDays);
              }
            }

            if (isWorking) {
              const covArr = hCov(wh);
              for (let h = 0; h < 24; h++) if (covArr[h]) dCov[h]++;
            }
          }
          totalPeak += dCov.slice(10, 14).reduce((a, b) => a + b, 0) / 4;
          peakSamples.push(dCov.slice(10, 14).reduce((a, b) => a + b, 0) / 4);
          nightHours.forEach(h => { if (dCov[h] < minReq) totalNightGaps += (minReq - dCov[h]); });
        }
        currentDoy += MD[cm];
      }

      const avgPeak = totalPeak / peakSamples.length;
      const variance = peakSamples.reduce((s, x) => s + Math.pow(x - avgPeak, 2), 0) / peakSamples.length;
      const smoothingIndex = 100 - Math.min(100, (Math.sqrt(variance) / (avgPeak || 1)) * 100);

      let score = -totalNightGaps * 100000;
      score += avgPeak * 1000;
      score += smoothingIndex * 10;
      if (v !== 'current') score += 5;

      if (v === 'current') { curGaps = totalNightGaps; curSmooth = smoothingIndex; }

      if (score > bestScore) {
        bestScore = score;
        bestVar = v;
        bestPeak = avgPeak;
        bestGaps = totalNightGaps;

        let improvements = [];
        if (v !== 'current') {
          if (totalNightGaps < curGaps) improvements.push(`📉 Ночь: +${(curGaps - totalNightGaps).toFixed(0)}ч`);
          else if (totalNightGaps === 0) improvements.push('✅ Ночь ОК');
          if (smoothingIndex > curSmooth) improvements.push(`✨ Сглаж: +${(smoothingIndex - curSmooth).toFixed(0)}%`);
        } else improvements.push('📌 Базовый вариант');
        bestReason = improvements.join(' • ');

        bestChangesArray = [];
        if (v === 'D') bestChangesArray = autoShifts.filter(a => E.find(emp => matchName(emp.nm, a.name) && emp.dp === dp));
        else if (v === 'C') {
          const manualC = (OPT_CHANGES['C'] || []).filter(m => m.dept === dp);
          const autoC = unboundedShifts.filter(a => E.find(emp => matchName(emp.nm, a.name) && emp.dp === dp));
          const map = new Map();
          manualC.forEach(m => map.set(m.name, { ...m }));
          autoC.forEach(a => { if (map.has(a.name)) { const m = map.get(a.name); if (a.to) m.to = a.to; if (a.shiftDays) m.shiftDays = a.shiftDays; m.effect = a.effect; } else map.set(a.name, { ...a }); });
          bestChangesArray = Array.from(map.values());
        } else if (v === 'A' || v === 'B') {
          bestChangesArray = (OPT_CHANGES[v] || []).filter(m => m.dept === dp);
        }
      }
    });

    results[dp] = { variant: bestVar, peak: bestPeak, gaps: bestGaps, reason: bestReason };
    recommendedChanges[dp] = bestChangesArray;
  });

  return { results, recommendedChanges };
}

// ---------- PATTERN ANALYSIS ----------

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

// ---------- HELPERS ----------

export function getChangesForVariant(variant) {
  if (variant === 'current') return [];
  if (variant === 'C') {
    const manual = OPT_CHANGES['C'] || [];
    const auto = _unboundedShiftsCache || [];
    const manualNames = new Set(manual.map(m => m.name));
    return [...manual, ...auto.filter(a => !manualNames.has(a.name))];
  }
  if (variant === 'D') return _autoShiftsCache || [];
  return OPT_CHANGES[variant] || [];
}

export function computePhaseGroups(employees, mIndex) {
  const groups = {};
  employees.forEach(e => {
    const pat = sPat(e.wh);
    if (pat === '2/2' || pat === 'сутки') {
      const days = e.ms[mIndex].d;
      let first = -1;
      for (let i = 0; i < 4; i++) { if (days && days[i] > 0) { first = i; break; } }
      if (first !== -1) {
        const phase = first % 4;
        const key = 'Phase' + phase;
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
      }
    }
  });
  return groups;
}

export { getCycleState, getDoy };
