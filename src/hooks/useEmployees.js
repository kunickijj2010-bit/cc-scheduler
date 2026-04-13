import { useState, useEffect } from 'react';
import { SHIFT_DATA } from '../data/shiftData.js';
import { REMAP, SB_URL, SB_KEY, SUPERV_NAMES, SKIP_DEPTS, HIDDEN_DEPTS, SKIP_NAMES, MD } from '../data/config.js';
import { hCov, sPat } from '../utils/shifts.js';

// ─── Cache Configuration ───
const CACHE_KEY = 'cc_scheduler_cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

function setCachedData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota exceeded — ignore */ }
}

// ─── Supabase Fetchers ───

const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

/** Fetch all employees from Supabase */
async function fetchEmployees() {
  const res = await fetch(
    `${SB_URL}/rest/v1/employees?select=id,name,department,location,work_hours,schedule_type&is_active=neq.false&order=id`,
    { headers: SB_HEADERS }
  );
  if (!res.ok) throw new Error(`employees fetch failed: ${res.status}`);
  return res.json();
}

/** Fetch all shifts for a year with Range-header pagination (1000 rows/page) */
async function fetchAllShifts(year, onProgress) {
  const allShifts = [];
  const PAGE_SIZE = 1000; // Supabase hard limit
  let from = 0;
  let total = Infinity;
  let pageNum = 0;

  while (from < total) {
    const to = from + PAGE_SIZE - 1;
    const url = `${SB_URL}/rest/v1/shifts?select=employee_id,shift_date,hours_worked,shift_type` +
      `&shift_date=gte.${year}-01-01&shift_date=lte.${year}-12-31` +
      `&order=employee_id,shift_date`;

    const res = await fetch(url, {
      headers: { ...SB_HEADERS, Range: `${from}-${to}`, Prefer: 'count=exact' },
    });

    if (!res.ok && res.status !== 206) throw new Error(`shifts fetch failed: ${res.status}`);

    // Parse total from content-range header: "0-999/48579"
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match) total = parseInt(match[1], 10);
    }

    const page = await res.json();
    allShifts.push(...page);
    pageNum++;
    from += PAGE_SIZE;

    if (onProgress) onProgress(pageNum, allShifts.length, total);

    // Safety: if we got fewer than PAGE_SIZE rows, we're done
    if (page.length < PAGE_SIZE) break;
  }

  return allShifts;
}

// ─── Data Transformation ───

/**
 * Build employee objects from Supabase employees + shifts data.
 * Output format matches what all components expect:
 * { nm, dp, wh, loc, v, ms: [{d: [...], t: number}], pat, cov, ... }
 */
function buildEmployeesFromSupabase(dbEmps, shifts) {
  // Group shifts by employee_id
  const shiftsByEmp = new Map();
  for (const s of shifts) {
    if (!shiftsByEmp.has(s.employee_id)) shiftsByEmp.set(s.employee_id, []);
    shiftsByEmp.get(s.employee_id).push(s);
  }

  const employees = [];

  for (const emp of dbEmps) {
    // Apply department filters
    const rawDept = emp.department || '';
    let dept = REMAP[rawDept] || rawDept;
    if (SKIP_DEPTS.includes(rawDept) || SKIP_DEPTS.includes(dept)) continue;
    if (SKIP_NAMES.some(sn => emp.name.includes(sn))) continue;
    if (SUPERV_NAMES.includes(emp.name)) dept = 'Супервизия';

    const empShifts = shiftsByEmp.get(emp.id) || [];

    // Index shifts by date for O(1) lookup
    const shiftIndex = new Map();
    for (const s of empShifts) shiftIndex.set(s.shift_date, s);

    // Build monthly matrices (12 months)
    const ms = [];
    // Also build vacation bitmask (366 bits for the year)
    const vacBits = new Array(366).fill(0);
    let dayOfYear = 0;

    for (let m = 0; m < 12; m++) {
      const daysInMonth = MD[m];
      const d = new Array(daysInMonth).fill(0);

      for (let di = 0; di < daysInMonth; di++) {
        const dateStr = `2026-${String(m + 1).padStart(2, '0')}-${String(di + 1).padStart(2, '0')}`;
        const shift = shiftIndex.get(dateStr);

        if (shift) {
          const st = (shift.shift_type || '').toUpperCase();
          if (st === 'ОТП') {
            d[di] = 'ОТП';
            vacBits[dayOfYear + di] = 1;
          } else if (st === 'БЛ') {
            d[di] = 'БЛ'; // Keep string marker for sick leave
          } else if (st === 'БС') {
            d[di] = 'БС'; // Keep string marker for unpaid leave
          } else {
            d[di] = shift.hours_worked || 0;
          }
        }
      }

      const t = d.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
      ms.push({ d, t: Math.round(t > 500 ? 0 : t) });
      dayOfYear += daysInMonth;
    }

    // Skip employees with zero total hours across all months
    const totalH = ms.reduce((s, m) => s + m.t, 0);
    if (totalH <= 0) continue;

    // Generate vacation hex mask for compatibility
    const v = generateVacHex(vacBits);

    const wh = emp.work_hours || '09:00-18:00';
    const whm = Array.from({ length: 12 }, (_, m) => Array(MD[m]).fill(wh));
    const pat = sPat(wh, ms);
    const cov = hCov(wh);

    employees.push({
      nm: emp.name,
      dp: dept,
      wh: wh,
      whm: whm,
      loc: emp.location || '',
      v: v,
      ms: ms,
      pat: pat,
      cov: cov,
      _original: null,
      _modified: false,
      _changes: [],
      _empId: emp.id, // Keep Supabase ID for future reference
    });
  }

  return employees;
}

/** Convert vacation bit array to hex string (compatible with parseVacHex) */
function generateVacHex(bits) {
  // Pad to multiple of 4
  while (bits.length % 4 !== 0) bits.push(0);
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  // Keep full hex string — 366 days needs ~92 chars, don't truncate!
  return hex;
}

// ─── Legacy Fallback ───

/** Load employees from embedded SHIFT_DATA (offline fallback) */
function loadFromEmbedded() {
  return SHIFT_DATA.filter(e => !SKIP_DEPTS.includes(e.p) && !SKIP_NAMES.some(sn => e.n.includes(sn))).map(e => {
    let dept = REMAP[e.p] || e.p;
    if (SUPERV_NAMES.includes(e.n)) dept = 'Супервизия';
    const pat = sPat(e.h, e.m[2] || e.m[0]);
    return {
      nm: e.n,
      dp: dept,
      wh: e.h,
      loc: e.l,
      v: e.v,
      ms: e.m.map(m => ({ d: m.d, t: Math.round(m.t > 500 ? 0 : m.t) })),
      pat: pat,
      cov: hCov(e.h),
      _original: null,
      _modified: false,
      _changes: [],
    };
  }).filter(e => {
    const totalH = e.ms.reduce((s, m) => s + m.t, 0);
    return totalH > 0;
  });
}

// ─── Main Hook ───

/** Custom hook: loads & normalizes employee data from Supabase with cache and fallback */
export function useEmployees() {
  const [employees, setEmployees] = useState([]);
  const [dataSource, setDataSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let data = null;

      // 1. Try localStorage cache first
      const cached = getCachedData();
      if (cached) {
        data = cached;
        if (!cancelled) {
          setDataSource(`⚡ Кэш (${data.length} чел., обновится через ≤30 мин)`);
          setEmployees(data);
          setLoading(false);
        }
        // Still refresh in background after cache is shown
        refreshFromSupabase(cancelled, setDataSource, setEmployees);
        return;
      }

      // 2. Try Supabase live
      try {
        if (!cancelled) setLoadProgress('Загрузка сотрудников...');
        const dbEmps = await fetchEmployees();
        if (!cancelled) setLoadProgress(`Загрузка смен (0 строк)...`);

        const shifts = await fetchAllShifts(2026, (page, loaded, total) => {
          if (!cancelled) setLoadProgress(`Загрузка смен (${loaded.toLocaleString()} из ${total.toLocaleString()}, стр. ${page})...`);
        });

        if (!cancelled) setLoadProgress('Обработка данных...');
        data = buildEmployeesFromSupabase(dbEmps, shifts);

        // Apply dedup and hidden dept filter
        data = deduplicateAndFilter(data);

        // Cache for next time
        setCachedData(data);

        if (!cancelled) {
          setDataSource(`🌐 Live Supabase (${data.length} чел., ${shifts.length.toLocaleString()} смен)`);
          setLoadProgress('');
        }
      } catch (err) {
        console.error('Supabase load error:', err);
        if (!cancelled) setLoadProgress('');
      }

      // 3. Fallback to embedded if Supabase failed
      if (!data || data.length === 0) {
        data = loadFromEmbedded();
        data = deduplicateAndFilter(data);
        if (!cancelled) setDataSource(`💾 Оффлайн-кэш (${data.length} чел.)`);
      }

      if (!cancelled) {
        setEmployees(data);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const forceSync = async () => {
    setLoading(true);
    setLoadProgress('Принудительная загрузка...');
    localStorage.removeItem(CACHE_KEY);
    try {
      const dbEmps = await fetchEmployees();
      const shifts = await fetchAllShifts(2026, (page, loaded, total) => {
        setLoadProgress(`Загрузка смен (${loaded.toLocaleString()} из ${total.toLocaleString()})...`);
      });
      setLoadProgress('Обработка данных...');
      let data = buildEmployeesFromSupabase(dbEmps, shifts);
      data = deduplicateAndFilter(data);
      setCachedData(data);
      setEmployees(data);
      setDataSource(`🌐 Live Supabase (${data.length} чел., загружено вручную)`);
    } catch (err) {
      console.error(err);
      alert('Ошибка принудительной синхронизации: ' + err.message);
    }
    setLoadProgress('');
    setLoading(false);
  };

  return { employees, setEmployees, dataSource, loading, loadProgress, forceSync };
}

/** Background refresh: silently re-fetch from Supabase and update state + cache */
async function refreshFromSupabase(cancelled, setDataSource, setEmployees) {
  try {
    const dbEmps = await fetchEmployees();
    const shifts = await fetchAllShifts(2026);
    let data = buildEmployeesFromSupabase(dbEmps, shifts);
    data = deduplicateAndFilter(data);
    setCachedData(data);
    if (!cancelled) {
      setEmployees(data);
      setDataSource(`🌐 Live Supabase (${data.length} чел., обновлено)`);
    }
  } catch {
    // Silent fail — we already have cached data showing
  }
}

/** Deduplicate by name and filter hidden departments */
function deduplicateAndFilter(data) {
  const unique = [];
  const names = new Set();
  data.forEach(e => {
    if (!names.has(e.nm) && !HIDDEN_DEPTS.includes(e.dp)) {
      names.add(e.nm);
      unique.push(e);
    }
  });
  return unique;
}
