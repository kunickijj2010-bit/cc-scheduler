import ExcelJS from 'exceljs';
import { MN, MD, DP, APP_CONFIG } from '../data/config.js';
import { hCov } from './shifts.js';
import { getChangesForVariant, getEffectiveHours } from './optimizer.js';
import { matchName } from './shifts.js';

/**
 * Export schedule to Excel (.xlsx) with multiple sheets.
 */
export async function exportToExcel(employees, metrics, curMonth, appliedOpts = { all: 'current' }) {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CC Scheduler';
    wb.created = new Date();

    // Helper for colors
    const argbColor = (hex) => hex.replace('#', 'FF');
    const COLOR_GREEN = argbColor('#10c090');
    const COLOR_RED = argbColor('#ef6050');
    const COLOR_GRAY = argbColor('#282d42');

    const fillSolid = (color) => ({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: color }
    });

    // Sheet 1: Summary
    const summarySheet = wb.addWorksheet('Сводка');
    const manualCount = employees.filter(e => e._modified).length;
    
    // Count optimization-affected employees from applied variants (bakedVars)
    const optAffected = new Set();
    for (const dp of DP) {
      const v = appliedOpts[dp] || 'current';
      if (v === 'current') continue;
      const vChanges = getChangesForVariant(v);
      for (const e of employees.filter(emp => emp.dp === dp)) {
        const dm = MD[0];
        for (let d = 0; d < dm; d++) {
          const eff = getEffectiveHours(e, 0, d, vChanges);
          if (eff.changed) { optAffected.add(e.nm); break; }
        }
      }
    }
    const optCount = optAffected.size;
    const totalChanged = new Set([
      ...employees.filter(e => e._modified).map(e => e.nm),
      ...optAffected
    ]).size;

    summarySheet.addRows([
      ['КЦ — Планировщик графиков', '', '', '', new Date().toLocaleDateString('ru')],
      [],
      ['Метрика', 'Значение'],
      ['Всего операторов', employees.length],
      ['Всего изменено (итог)', totalChanged],
      ['  - Ручные правки (ФИО)', manualCount],
      ['  - Авто-оптимизации (ФИО)', optCount],
      [],
      ['Отдел', 'Всего чел.', 'Ср. часов/мес', 'Изменено'],
    ]);

    for (const dp of DP) {
      const deptEmps = employees.filter(e => e.dp === dp);
      const mCount = deptEmps.filter(e => e._modified).length;
      const v = appliedOpts[dp] || 'current';
      let oCount = 0;
      if (v !== 'current') {
        const vChanges = getChangesForVariant(v);
        for (const e of deptEmps) {
          const dm = MD[0];
          for (let d = 0; d < dm; d++) {
            const eff = getEffectiveHours(e, 0, d, vChanges);
            if (eff.changed) { oCount++; break; }
          }
        }
      }
      const modCount = new Set([
        ...deptEmps.filter(e => e._modified).map(e => e.nm),
        ...(v !== 'current' ? deptEmps.filter(e => optAffected.has(e.nm)).map(e => e.nm) : [])
      ]).size;
      
      const avgHours = deptEmps.length > 0
        ? Math.round(deptEmps.reduce((s, e) => s + (e.ms[curMonth]?.t || 0), 0) / deptEmps.length)
        : 0;
      summarySheet.addRow([dp, deptEmps.length, avgHours, `${modCount} (Р:${mCount}, О:${oCount})`]);
    }

    // 12 Sheets: Schedules for each month (Full Year Heatmap)
    for (let m = 0; m < 12; m++) {
      const schedSheet = wb.addWorksheet(`Графики ${MN[m]}`);
      
      const schedHeader = ['#', 'ФИО', 'Отдел', 'Смена', 'Паттерн'];
      for (let d = 1; d <= MD[m]; d++) schedHeader.push(d);
      schedHeader.push('Часы');
      
      const headerRow = schedSheet.addRow(schedHeader);
      headerRow.font = { bold: true };
      
      // Set column widths
      schedSheet.getColumn(2).width = 25; // ФИО
      schedSheet.getColumn(3).width = 10; // Отдел
      schedSheet.getColumn(4).width = 15; // Смена
      for (let d = 1; d <= MD[m]; d++) schedSheet.getColumn(5 + d).width = 4;
      schedSheet.getColumn(5 + MD[m] + 1).width = 8; // Часы

      employees.forEach((e, i) => {
        const v = appliedOpts[e.dp] || 'current';
        const vChanges = v !== 'current' ? getChangesForVariant(v) : [];
        const origEmp = e._original || e;
        
        const curMonthShift = e.whm ? e.whm[m][0] : e.wh;
        const rowData = [i + 1, e.nm, e.dp, curMonthShift, e.pat];
        
        // Find if work hours changed via variant
        const chg = vChanges.find(c => matchName(c.name, e.nm));
        if (chg && chg.to && chg.to !== curMonthShift) {
            rowData[3] = chg.to; // Update shift name in export if variant changes it
        }

        for (let d = 0; d < MD[m]; d++) {
          const eff = getEffectiveHours(e, m, d, vChanges);
          const cv = eff.h;
          rowData.push(typeof cv === 'string' ? cv : (cv > 0 ? cv : ''));
        }
        
        // Total hours for the month in export (including variant changes)
        let totalVal = 0;
        for (let d = 0; d < MD[m]; d++) {
           const eff = getEffectiveHours(e, m, d, vChanges);
           if (typeof eff.h === 'number') totalVal += eff.h;
        }
        rowData.push(totalVal);
        
        const row = schedSheet.addRow(rowData);
        
        // Apply Heatmap highlighting and alignment
        for (let d = 0; d < MD[m]; d++) {
          const eff = getEffectiveHours(e, m, d, vChanges);
          const cv = eff.h;
          const ov = (origEmp.ms && origEmp.ms[m]) ? origEmp.ms[m].d[d] : 0;
          
          const cell = row.getCell(6 + d);
          cell.alignment = { horizontal: 'center' };

          // If global 'wh' or 'whm' changed compared to original, highlight
          let isChanged = eff.changed; 
          if (!isChanged && origEmp !== e) {
             // Check if current value (baked) differs from original baseline
             if (String(cv) !== String(ov)) {
               isChanged = true;
             }
             // Also check explicit hour map if it's a workday
             if (!isChanged && e.whm && origEmp.whm && typeof cv === 'number' && cv > 0) {
               if (e.whm[m][d] !== origEmp.whm[m][d]) isChanged = true;
             }
          }

          if (isChanged) {
            const cvNum = typeof cv === 'number' ? cv : 0;
            const ovNum = typeof ov === 'number' ? ov : 0;
            const diff = cvNum - ovNum;
            
            if (diff > 0 || (ovNum === 0 && cvNum > 0)) {
              cell.fill = fillSolid(COLOR_GREEN);
              cell.font = { color: { argb: 'FFFFFFFF' } };
            } else if (diff < 0 || (ovNum > 0 && cvNum === 0)) {
              cell.fill = fillSolid(COLOR_RED);
              cell.font = { color: { argb: 'FFFFFFFF' } };
            }
          }
        }
      });
    }

    // Changes log
    const changedEmps = employees.filter(e => e._modified && e._changes?.length > 0);
    if (changedEmps.length > 0) {
      const chgSheet = wb.addWorksheet('Журнал изменений');
      chgSheet.addRow(['ФИО', 'Отдел', 'Время', 'Поле', 'Было', 'Стало', 'Причина']).font = { bold: true };
      chgSheet.getColumn(1).width = 25;
      chgSheet.getColumn(3).width = 20;
      chgSheet.getColumn(7).width = 30;

      for (const e of changedEmps) {
        for (const c of e._changes) {
          chgSheet.addRow([e.nm, e.dp, c.ts, c.field, c.from, c.to, c.reason || '']);
        }
      }
    }

    // Full year summary
    const yearSheet = wb.addWorksheet('Сводка за год');
    const yearHeader = ['ФИО', 'Отдел', 'Смена'];
    for (let m = 0; m < 12; m++) yearHeader.push(`${MN[m]} дней`, `${MN[m]} часы`);
    yearHeader.push('Год часы');
    yearSheet.addRow(yearHeader).font = { bold: true };
    yearSheet.getColumn(1).width = 25;

    for (const e of employees) {
      const row = [e.nm, e.dp, e.wh];
      let yearH = 0;
      for (let m = 0; m < 12; m++) {
        if (!e.ms[m]) { row.push(0, 0); continue; }
        const workDays = e.ms[m].d.filter(v => typeof v === 'number' && v > 0).length;
        row.push(workDays, e.ms[m].t);
        yearH += e.ms[m].t;
      }
      row.push(yearH);
      yearSheet.addRow(row);
    }

    // Generate blob and download
    console.log('[Export] Excel generation complete, triggering download...');
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const safeMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][curMonth];
    const fileName = `KC_Planner_FullYear_2026.xlsx`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log('[Export] Download triggered successfully: ' + fileName);
  } catch (err) {
    console.error('[Export] Error in exportToExcel:', err);
    alert('Ошибка экспорта Excel: ' + (err.message || err.toString()));
  }
}

/**
 * Export to CSV (simple flat table for the selected month).
 */
export function exportToCsv(employees, curMonth) {
  try {
    const header = ['ФИО', 'Отдел', 'Смена', 'Паттерн'];
  for (let d = 1; d <= MD[curMonth]; d++) header.push(`День ${d}`);
  header.push('Часы');

  const rows = [header.join(';')];
  employees.forEach(e => {
    const row = [e.nm, e.dp, e.wh, e.pat];
    for (let d = 0; d < MD[curMonth]; d++) {
      const v = e.ms[curMonth].d[d];
      row.push(typeof v === 'string' ? v : (v > 0 ? v : ''));
    }
    row.push(e.ms[curMonth].t);
    rows.push(row.join(';'));
  });

  const csv = '\uFEFF' + rows.join('\n'); // BOM for Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const safeMonth = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][curMonth];
  const fileName = `KC_Schedule_${safeMonth}_2026.csv`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  console.log('[Export] CSV download triggered successfully: ' + fileName);
  } catch (err) {
    console.error('[Export] Error in exportToCsv:', err);
    alert('Ошибка экспорта CSV: ' + (err.message || err.toString()));
  }
}

/**
 * Export hourly heatmap (24 hours x 31 days) for all 12 months.
 */
export async function exportHourlyHeatmapToExcel(employees, appliedOpts = { all: 'current' }) {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CC Scheduler';
    wb.created = new Date();

    const argbColor = (hex) => hex.replace('#', 'FF');
    const COLOR_GREEN = argbColor('#10c090');
    const COLOR_RED = argbColor('#ef6050');
    const fillSolid = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: color } });

    for (let m = 0; m < 12; m++) {
      const sheet = wb.addWorksheet(`Почасовка ${MN[m]}`);
      sheet.getColumn(1).width = 15;
      for (let d = 1; d <= MD[m]; d++) sheet.getColumn(d + 1).width = 4;

      const header = ['Час'];
      for (let d = 1; d <= MD[m]; d++) header.push(d);

      const depts = [...new Set(employees.map(e => e.dp))].sort();
      const allGroups = [...depts, 'Суммарно по КЦ'];

      let isFirstGroup = true;

      for (const dept of allGroups) {
        if (!isFirstGroup) {
          sheet.addRow([]);
          sheet.addRow([]);
        }
        isFirstGroup = false;

        const titleRow = sheet.addRow([dept === 'Суммарно по КЦ' ? 'ИТОГО: Суммарно по КЦ' : `Отдел: ${dept}`]);
        titleRow.font = { bold: true, size: 12, color: { argb: dept === 'Суммарно по КЦ' ? 'FF000000' : 'FF444444' } };
        sheet.mergeCells(`A${titleRow.number}:${sheet.getColumn(MD[m]+1).letter}${titleRow.number}`);

        const headerRow = sheet.addRow(header);
        headerRow.font = { bold: true };
        headerRow.alignment = { horizontal: 'center' };

        const grid = Array.from({length: 24}, () => Array(MD[m]).fill(0));
        const origGrid = Array.from({length: 24}, () => Array(MD[m]).fill(0));

        employees.forEach(e => {
          if (dept !== 'Суммарно по КЦ' && e.dp !== dept) return;

          const v = appliedOpts[e.dp] || 'current';
          const vChanges = v !== 'current' ? getChangesForVariant(v) : [];
          const origEmp = e._original || e;

          for (let d = 0; d < MD[m]; d++) {
            const eff = getEffectiveHours(e, m, d, vChanges);
            if (typeof eff.h === 'number' && eff.h > 0) {
              const dayCov = eff.covArr || (e.whm ? hCov(e.whm[m][d]) : e.cov);
              for (let h = 0; h < 24; h++) if (dayCov && dayCov[h]) grid[h][d]++;
            }
            
            // Baseline coverage (before any changes in session)
            if (origEmp.ms && origEmp.ms[m] && typeof origEmp.ms[m].d[d] === 'number' && origEmp.ms[m].d[d] > 0) {
              const oDayCov = origEmp.whm ? hCov(origEmp.whm[m][d]) : origEmp.cov;
              for (let h = 0; h < 24; h++) if (oDayCov && oDayCov[h]) origGrid[h][d]++;
            }
          }
        });

        for (let h = 0; h < 24; h++) {
          const rowData = [`${String(h).padStart(2, '0')}:00`];
          for (let d = 0; d < MD[m]; d++) rowData.push(grid[h][d] > 0 ? grid[h][d] : '');
          const row = sheet.addRow(rowData);
          
          for (let d = 0; d < MD[m]; d++) {
            const cell = row.getCell(d + 2);
            cell.alignment = { horizontal: 'center' };
            const cDiff = grid[h][d] - origGrid[h][d];
            if (cDiff > 0) { 
              cell.fill = fillSolid(COLOR_GREEN); 
              cell.font = { color: { argb: 'FFFFFFFF' } }; 
            }
            else if (cDiff < 0) { 
              cell.fill = fillSolid(COLOR_RED); 
              cell.font = { color: { argb: 'FFFFFFFF' } }; 
            }
          }
        }
      }
    }
    
    console.log('[Export] Hourly generation complete, triggering download...');
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileName = `KC_Hourly_Heatmap_2026.xlsx`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log('[Export] Hourly download triggered successfully: ' + fileName);
  } catch(e) {
    console.error('Hourly Export Error:', e);
    alert('Ошибка выгрузки: ' + (e.message || e.toString()));
  }
}
