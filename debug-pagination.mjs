import { SB_URL, SB_KEY } from './src/data/config.js';

const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

async function debug() {
  // 1. Check how many shifts come back with limit=5000
  const res1 = await fetch(`${SB_URL}/rest/v1/shifts?select=id&shift_date=gte.2026-01-01&shift_date=lte.2026-12-31&limit=5000&offset=0`, {
    headers: SB_HEADERS
  });
  const d1 = await res1.json();
  console.log('limit=5000, got:', d1.length, 'rows');

  // 2. Check with Range header
  const res2 = await fetch(`${SB_URL}/rest/v1/shifts?select=id&shift_date=gte.2026-01-01&shift_date=lte.2026-12-31&order=id`, {
    headers: { ...SB_HEADERS, Range: '0-4999', Prefer: 'count=exact' }
  });
  const d2 = await res2.json();
  console.log('Range 0-4999, got:', d2.length, 'rows, content-range:', res2.headers.get('content-range'));

  // 3. Check employees and their departments
  const empRes = await fetch(`${SB_URL}/rest/v1/employees?select=id,name,department&limit=200`, {
    headers: SB_HEADERS
  });
  const emps = await empRes.json();
  const deptCount = {};
  emps.forEach(e => { deptCount[e.department] = (deptCount[e.department] || 0) + 1; });
  console.log('\nEmployee departments:', deptCount);
  console.log('Total employees:', emps.length);
  
  // 4. Check which employee IDs exist in shifts but NOT in employees 
  const shiftEmpRes = await fetch(`${SB_URL}/rest/v1/shifts?select=employee_id&shift_date=eq.2026-04-01`, {
    headers: SB_HEADERS
  });
  const shiftEmps = await shiftEmpRes.json();
  const shiftEmpIds = new Set(shiftEmps.map(s => s.employee_id));
  const empIds = new Set(emps.map(e => e.id));
  
  console.log(`\nShift employee IDs for Apr 1: ${shiftEmpIds.size}`);
  const missing = [...shiftEmpIds].filter(id => !empIds.has(id));
  console.log(`Employee IDs in shifts but NOT in employees table: ${missing.length}`);
  if (missing.length > 0) console.log('Sample missing IDs:', missing.slice(0, 10));
  
  // 5. Check what IDs the known employees have
  const knownNames = ['Горбачева', 'Васина', 'Сафронова', 'Мошкина'];
  for (const name of knownNames) {
    const r = await fetch(`${SB_URL}/rest/v1/employees?select=id,name,department&name=like.*${name}*`, {
      headers: SB_HEADERS
    });
    const d = await r.json();
    console.log(`${name}:`, d.map(e => `id=${e.id}, dept=${e.department}`).join('; ') || 'NOT FOUND');
  }
}

debug().catch(console.error);
