import { SB_URL, SB_KEY } from './src/data/config.js';

async function checkShifts() {
  // 1. Check total shifts count
  const countRes = await fetch(`${SB_URL}/rest/v1/shifts?select=id&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  const countHeader = countRes.headers.get('content-range');
  console.log('Total shifts (content-range):', countHeader);

  // 2. Get Safronova's employee_id
  const empRes = await fetch(`${SB_URL}/rest/v1/employees?name=like.*Сафронова*&select=id,name`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const emps = await empRes.json();
  console.log('Safronova employee record:', emps);

  if (emps.length > 0) {
    const empId = emps[0].id;
    // 3. Check her shifts for April 2026
    const shiftsRes = await fetch(`${SB_URL}/rest/v1/shifts?employee_id=eq.${empId}&shift_date=gte.2026-04-01&shift_date=lte.2026-04-30&select=*&order=shift_date`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const shifts = await shiftsRes.json();
    console.log(`Safronova April 2026 shifts (${shifts.length}):`, JSON.stringify(shifts, null, 2));
  }

  // 4. Sample a few shifts from shifts table to understand the data format
  const sampleRes = await fetch(`${SB_URL}/rest/v1/shifts?select=*&limit=10&order=shift_date.desc`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const sample = await sampleRes.json();
  console.log('\nRecent 10 shifts sample:', JSON.stringify(sample, null, 2));

  // 5. Count unique employees with shifts
  const uniqueRes = await fetch(`${SB_URL}/rest/v1/shifts?select=employee_id&limit=1000`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const uniqueData = await uniqueRes.json();
  const uniqueIds = new Set(uniqueData.map(s => s.employee_id));
  console.log(`\nUnique employees with shifts: ${uniqueIds.size}`);
  
  // 6. Date range of shifts
  const minRes = await fetch(`${SB_URL}/rest/v1/shifts?select=shift_date&order=shift_date.asc&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const minData = await minRes.json();
  const maxRes = await fetch(`${SB_URL}/rest/v1/shifts?select=shift_date&order=shift_date.desc&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const maxData = await maxRes.json();
  console.log(`Shift date range: ${minData[0]?.shift_date} — ${maxData[0]?.shift_date}`);
}

checkShifts().catch(console.error);
