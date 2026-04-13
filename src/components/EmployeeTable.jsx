import { useState, useCallback, useMemo } from 'react';
import DayCell from './DayCell.jsx';
import ContextMenu from './ContextMenu.jsx';
import ShiftEditor from './ShiftEditor.jsx';
import { MN, MD } from '../data/config.js';
import { getChangesForVariant, getEffectiveHours } from '../utils/optimizer.js';
import { matchName } from '../utils/shifts.js';

export default function EmployeeTable({ employees, curMonth, onSetDay, onChangePattern, onChangeTime, onRevert, metrics, deptOptVars }) {
  const [ctxMenu, setCtxMenu] = useState(null);
  const [editEmp, setEditEmp] = useState(null);

  const daysInMonth = MD[curMonth];
  const dow1 = new Date(2026, curMonth, 1).getDay();

  const getOptFor = useCallback((emp) => {
    if (!deptOptVars) return 'current';
    return deptOptVars[emp.dp] || 'current';
  }, [deptOptVars]);

  const handleContextMenu = useCallback((e, emp) => (evt, month, day, value) => {
    let covForDay = null;
    if (metrics && metrics.DC) {
      let globalDay = 0;
      for (let m = 0; m < month; m++) globalDay += MD[m];
      globalDay += day;
      covForDay = metrics.DC[globalDay] || 0;
    }
    setCtxMenu({
      x: evt.clientX,
      y: evt.clientY,
      empName: emp.nm,
      empWh: emp.wh,
      month,
      day,
      value,
      coverage: covForDay,
    });
  }, [metrics]);

  const handleCtxAction = useCallback((value) => {
    if (ctxMenu) {
      onSetDay(ctxMenu.empName, ctxMenu.month, ctxMenu.day, value);
    }
  }, [ctxMenu, onSetDay]);

  // DOW header — highlight weekends
  const dayHeaders = useMemo(() => {
    const headers = [];
    for (let i = 0; i < daysInMonth; i++) {
      const dayDow = (dow1 + i) % 7;
      const isWe = dayDow === 0 || dayDow === 6;
      headers.push({ num: i + 1, isWe });
    }
    return headers;
  }, [daysInMonth, dow1]);

  // Pre-compute effective hours per employee based on their department's chosen variant
  const effData = useMemo(() => {
    return employees.map(emp => {
      const v = getOptFor(emp);
      if (v === 'current') return null;
      
      const vChanges = getChangesForVariant(v);
      const days = [];
      let totalH = 0;
      let hasChange = false;
      for (let d = 0; d < daysInMonth; d++) {
        const eff = getEffectiveHours(emp, curMonth, d, vChanges);
        days.push(eff);
        if (typeof eff.h === 'number' && eff.h > 0) totalH += eff.h;
        if (eff.changed) hasChange = true;
      }
      const chg = vChanges.find(c => matchName(c.name, emp.nm));
      const newWh = chg && chg.to && chg.to !== emp.wh ? chg.to : null;
      return { days, totalH, hasChange, newWh, effect: chg?.effect };
    });
  }, [employees, curMonth, daysInMonth, getOptFor]);

  return (
    <>
      <div className="scroll-x" style={{ maxHeight: '68vh' }}>
        <table>
          <thead>
            <tr>
              <th className="sticky-col col-num">#</th>
              <th className="sticky-col col-name">ФИО</th>
              <th className="sticky-col col-dept">Отдел</th>
              <th style={{ minWidth: 90 }}>Смена</th>
              <th style={{ minWidth: 45 }}>Патт.</th>
              {dayHeaders.map((d, i) => (
                <th key={i} className={`day-header ${d.isWe ? 'weekend' : ''}`}>
                  {d.num}
                </th>
              ))}
              <th style={{ minWidth: 45 }}>Часы</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp, idx) => {
              const empEff = effData ? effData[idx] : null;
              const v = getOptFor(emp);
              const isPreview = v !== 'current';
              const isPreviewChanged = empEff?.hasChange;
              return (
              <tr
                key={emp.nm}
                className={`${emp._modified ? 'row-modified' : ''} ${isPreviewChanged ? 'row-opt-changed' : ''}`}
                onDoubleClick={() => setEditEmp(emp)}
              >
                <td className="sticky-col col-num cell-num">{idx + 1}</td>
                <td className="sticky-col col-name cell-name" title={emp.nm}>
                  {emp.nm.split(' ').slice(0, 2).join(' ')}
                  {emp._modified && <span className="mod-dot">●</span>}
                  {isPreviewChanged && <span className="mod-dot" style={{ color: 'var(--ac)' }}>★</span>}
                </td>
                <td className="sticky-col col-dept">
                  <span className={`bd ${emp.dp === 'NDC' ? 'bb' : emp.dp === 'GDS' ? 'bg' : emp.dp === 'VIP' ? 'by' : 'br'}`}>
                    {emp.dp}
                  </span>
                </td>
                <td
                  className={`cell-shift ${empEff?.newWh ? 'cell-shift-changed' : ''} ${(!empEff?.newWh && emp._modified && emp._original?.wh !== emp.wh) ? 'cell-shift-manual' : ''}`}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditEmp(emp); }}
                  title={
                    empEff?.newWh ? `Оптимизация: ${emp.wh} → ${empEff.newWh}\n${empEff.effect || ''}` : 
                    (emp._modified && emp._original?.wh !== emp.wh) ? `Изменено: ${emp._original?.wh} → ${emp.wh}` : 
                    emp.wh
                  }
                >
                  {empEff?.newWh ? (<>
                    <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '0.8em' }}>{emp.wh}</span>
                    <br />
                    <span style={{ color: 'var(--ac)', fontWeight: 600 }}>{empEff.newWh}</span>
                  </>) : (
                    <>{emp.wh}{emp._modified && emp._original?.wh !== emp.wh && <span style={{ color: 'var(--g)', fontSize: '0.65em', display: 'block', opacity: 0.7 }}>★ {emp._original?.wh}</span>}</>
                  )}
                </td>
                <td className="cell-pat">{emp.pat}</td>
                {isPreview && empEff ? (
                  empEff.days.map((eff, di) => (
                    <DayCell
                      key={di}
                      value={eff.h}
                      empName={emp.nm}
                      month={curMonth}
                      dayIndex={di}
                      onContextMenu={handleContextMenu(null, emp)}
                      isChanged={eff.changed}
                      isGhost={eff.ghost}
                    />
                  ))
                ) : (
                  (emp.ms[curMonth] ? emp.ms[curMonth].d : []).map((val, di) => {
                    let isChanged = false;
                    if (emp._original) {
                      // Compare shift duration
                      if (emp._original.ms && emp._original.ms[curMonth]) {
                         if (String(emp._original.ms[curMonth].d[di]) !== String(val)) {
                           isChanged = true;
                         }
                      }
                      // Compare explicit day hours map (whm)
                      if (!isChanged && emp._original.whm && emp.whm) {
                         if (emp._original.whm[curMonth][di] !== emp.whm[curMonth][di]) {
                           // Only highlight if it's an actual workday
                           if (typeof val === 'number' && val > 0) isChanged = true;
                         }
                      }
                      // Fallback: If global 'wh' changed, and no 'whm' was saved (legacy), highlight all workdays
                      if (!isChanged && typeof val === 'number' && val > 0 && String(emp.wh) !== String(emp._original.wh)) {
                         isChanged = true;
                      }
                    }
                    return (
                      <DayCell
                        key={di}
                        value={val}
                        empName={emp.nm}
                        month={curMonth}
                        dayIndex={di}
                        onContextMenu={handleContextMenu(null, emp)}
                        isChanged={isChanged}
                      />
                    );
                  })
                )}
                <td className="cell-hours">
                  {isPreview && empEff ? empEff.totalH : (emp.ms[curMonth] ? emp.ms[curMonth].t : 0)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          empName={ctxMenu.empName}
          empWh={ctxMenu.empWh}
          month={ctxMenu.month}
          day={ctxMenu.day}
          value={ctxMenu.value}
          coverage={ctxMenu.coverage}
          onAction={handleCtxAction}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Shift Editor Modal */}
      {editEmp && (
        <ShiftEditor
          employee={editEmp}
          onApplyPattern={onChangePattern}
          onApplyTime={onChangeTime}
          onRevert={onRevert}
          onClose={() => setEditEmp(null)}
        />
      )}
    </>
  );
}
