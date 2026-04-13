import { SB_URL, SB_KEY } from './src/data/config.js';

async function deepProbe() {
  // 1. Total shifts count via HEAD
  const countRes = await fetch(`${SB_URL}/rest/v1/shifts?select=id`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  console.log('Total shifts:', countRes.headers.get('content-range'));

  // 2. Shifts for year 2026 only
  const count2026 = await fetch(`${SB_URL}/rest/v1/shifts?select=id&shift_date=gte.2026-01-01&shift_date=lte.2026-12-31`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  console.log('2026 shifts:', count2026.headers.get('content-range'));

  // 3. Total employees
  const empCount = await fetch(`${SB_URL}/rest/v1/employees?select=id`, {
    method: 'HEAD',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  console.log('Total employees:', empCount.headers.get('content-range'));

  // 4. Check if shift_type or shift_note contain vacation markers
  const vacRes = await fetch(`${SB_URL}/rest/v1/shifts?select=shift_date,hours_worked,shift_type,shift_note&shift_note=neq.&limit=20`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const vacData = await vacRes.json();
  console.log('\nShifts with non-empty shift_note:', JSON.stringify(vacData, null, 2));

  // 5. Check shift_type values
  const typeRes = await fetch(`${SB_URL}/rest/v1/shifts?select=shift_type,shift_note&shift_type=neq.&limit=20`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const typeData = await typeRes.json();
  console.log('\nShifts with non-empty shift_type:', JSON.stringify(typeData, null, 2));

  // 6. Fetch one full employee's April shifts by joining  
  const empRes = await fetch(`${SB_URL}/rest/v1/employees?select=id,name,department,work_hours,schedule_type&department=eq.GDS&limit=5`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const emps = await empRes.json();
  console.log('\nSample GDS employees:', emps.map(e => `${e.id}: ${e.name} (${e.work_hours})`));

  // 7. Test pagination: fetch 1000 shifts at offset 0, then 1000 at offset 1000
  const page1 = await fetch(`${SB_URL}/rest/v1/shifts?select=employee_id&shift_date=gte.2026-03-01&shift_date=lte.2026-03-31&limit=5000`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const p1 = await page1.json();
  const uniq = new Set(p1.map(s => s.employee_id));
  console.log(`\nMarch 2026: ${p1.length} shift rows, ${uniq.size} unique employees`);
}

deepProbe().catch(console.error);
