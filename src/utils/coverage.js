import { APP_CONFIG, MD, DP } from '../data/config.js';
import { RAW_REC, RAW_PROC } from '../data/demandData.js';
import { parseVacHex, hCov } from './shifts.js';

const DEPT_DEMAND_SHARE = APP_CONFIG.DEPT_DEMAND_SHARE;

/** Calculate "golden volume" — blended demand estimate for department+month */
export function getGoldenVolume(m, dept, isForecast = false, forecastMult = 1.30) {
  const sumR = (a) => a[m] || 0;
  const recTot = sumR(RAW_REC.h0_8) + sumR(RAW_REC.h8_10) + sumR(RAW_REC.h10_14) +
    sumR(RAW_REC.h14_17) + sumR(RAW_REC.h17_19) + sumR(RAW_REC.h19_20) + sumR(RAW_REC.h20_24);
  const pNDC = sumR(RAW_PROC.NDC), pGDS = sumR(RAW_PROC.GDS), pVIP = sumR(RAW_PROC.VIP), pL1 = sumR(RAW_PROC.L1);
  const pTargetTot = pNDC + pGDS + pVIP;
  const pAllTot = pTargetTot + pL1;

  const targetShare = (DEPT_DEMAND_SHARE && DEPT_DEMAND_SHARE[dept]) ? DEPT_DEMAND_SHARE[dept] : null;
  const actualDeptProc = RAW_PROC[dept] ? sumR(RAW_PROC[dept]) : (dept === 'all' ? pTargetTot : 0);
  const actualShare = (dept === 'all' || pTargetTot === 0) ? 1.0 : (actualDeptProc / pTargetTot);
  const share = (targetShare !== null && dept !== 'all') ? targetShare : actualShare;

  const modelA = actualDeptProc;
  const modelB = (recTot * (pTargetTot / (pAllTot || 1))) * share;
  const golden = (modelA + modelB) / 2;
  return golden * (isForecast ? forecastMult : 1.0);
}

/** Calculate hourly demand distribution for department+month → 24-element array */
export function demHByDept(m, dept, isForecast = false) {
  const vol = getGoldenVolume(m, dept, isForecast);
  const wd = MD[m];
  const dailyVol = vol / wd;

  const sumR = (a) => a[m] || 0;
  const recTot = sumR(RAW_REC.h0_8) + sumR(RAW_REC.h8_10) + sumR(RAW_REC.h10_14) +
    sumR(RAW_REC.h14_17) + sumR(RAW_REC.h17_19) + sumR(RAW_REC.h19_20) + sumR(RAW_REC.h20_24);

  const h = Array(24).fill(0);
  const assignH = (key, s, e) => {
    const blockVol = dailyVol * (sumR(RAW_REC[key]) / (recTot || 1));
    const hrVol = blockVol / (e - s);
    for (let i = s; i < e; i++) h[i] += hrVol;
  };
  assignH('h0_8', 0, 8);
  assignH('h8_10', 8, 10);
  assignH('h10_14', 10, 14);
  assignH('h14_17', 14, 17);
  assignH('h17_19', 17, 19);
  assignH('h19_20', 19, 20);
  assignH('h20_24', 20, 24);
  return h.map(v => Math.round(v));
}

/** Calculate total hourly demand across all departments */
export function demH(m, isForecast = false) {
  const h = Array(24).fill(0);
  for (const dp of DP) {
    const dh = demHByDept(m, dp, isForecast);
    for (let i = 0; i < 24; i++) h[i] += dh[i];
  }
  return h;
}

/** Check if employee is on vacation on a specific day-of-year */
function isOnVacation(emp, doy) {
  if (!emp._vacMask) {
    emp._vacMask = parseVacHex(emp.v);
  }
  return emp._vacMask[doy] === 1;
}

/** Get day-of-year from month and day index */
function getDoy(m, d) {
  let doy = 0;
  for (let i = 0; i < m; i++) doy += MD[i];
  return doy + d;
}

/**
 * Full recalculation of coverage metrics from employee data.
 * Returns { MC, MCD, DC, DH }
 * Now properly accounts for vacation bitmask — vacationing employees don't count.
 */
export function recalcAll(employees, isForecast = false) {
  const MC = [];       // MC[month][hour] — avg staff count per hour
  const MCD = {};      // MCD[dept][month][hour]
  for (const dp of DP) MCD[dp] = [];

  for (let m = 0; m < 12; m++) {
    const hT = Array(24).fill(0);
    const hD = {};
    for (const dp of DP) hD[dp] = Array(24).fill(0);

    for (let d = 0; d < MD[m]; d++) {
      const doy = getDoy(m, d);
      for (const e of employees) {
        if (!e.ms[m]) continue;
        const vv = e.ms[m].d[d];
        if (!vv || vv <= 0) continue;
        // Skip if on vacation
        if (typeof vv === 'string') continue;  // Already marked as vacation/sick
        if (isOnVacation(e, doy)) continue;    // Check vacation bitmask
        const dayCov = e.whm ? hCov(e.whm[m][d]) : e.cov;
        if (!dayCov) continue;
        for (let h = 0; h < 24; h++) {
          if (dayCov[h]) {
            hT[h]++;
            if (hD[e.dp]) hD[e.dp][h]++;
          }
        }
      }
    }
    MC.push(hT.map(v => +(v / MD[m]).toFixed(1)));
    for (const dp of DP) {
      MCD[dp].push(hD[dp].map(v => +(v / MD[m]).toFixed(1)));
    }
  }

  // Daily counts: how many employees work each day across the year
  const DC = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < MD[m]; d++) {
      const doy = getDoy(m, d);
      let c = 0;
      employees.forEach(e => {
        if (!e.ms[m]) return;
        if (e.ms[m].d[d] > 0 && typeof e.ms[m].d[d] === 'number' && !isOnVacation(e, doy)) c++;
      });
      DC.push(c);
    }
  }

  // Demand by hour per month
  const DH = [];
  for (let m = 0; m < 12; m++) DH.push(demH(m, isForecast));

  return { MC, MCD, DC, DH };
}
