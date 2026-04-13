import { useState, useMemo, useEffect } from 'react';
import { useEmployees } from './hooks/useEmployees.js';
import { usePlanner } from './hooks/usePlanner.js';
import { recalcAll } from './utils/coverage.js';
import { MN, DP, UI_DP, MD } from './data/config.js';
import EmployeeTable from './components/EmployeeTable.jsx';
import Heatmap from './components/Heatmap.jsx';
import CoverageChart from './components/CoverageChart.jsx';
import ValidationPanel from './components/ValidationPanel.jsx';
import { exportToExcel, exportToCsv, exportHourlyHeatmapToExcel } from './utils/exportUtils.js';
import { computeAutoShifts, getChangesForVariant, getEffectiveHours } from './utils/optimizer.js';
import OptimizationTab from './components/OptimizationTab.jsx';
import FullCalendarTab from './components/FullCalendarTab.jsx';
import './index.css';

const TABS = [
  { id: 'planner', label: 'Планировщик', icon: '📋' },
  { id: 'opt', label: 'Оптимизация', icon: '⚡' },
];

const VARIANT_LABELS = {
  current: 'Текущий (База)',
  D: 'Авто-Баланс (D)',
  A: 'Микро-сдвиги (A)',
  B: 'Ярусная (Б)',
  C: 'Без границ (В)',
};

export default function App() {
  const { employees: rawEmployees, dataSource, loading, loadProgress, forceSync } = useEmployees();
  const planner = usePlanner([]);
  const [curTab, setCurTab] = useState('planner');
  const [plannerView, setPlannerView] = useState('grid'); // 'grid' or 'cal'
  const [deptOptVars, setDeptOptVars] = useState({ NDC: 'current', GDS: 'current', VIP: 'current', all: 'current' });
  // Baked variants: stored separately so 'Текущий (База)' can clear them
  const [bakedVars, setBakedVars] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cc_baked_vars')) || {}; } catch { return {}; }
  });
  const [isTabTransitioning, setIsTabTransitioning] = useState(false);
  const [curMonth, setCurMonth] = useState(new Date().getMonth());
  const [curDept, setCurDept] = useState('all');
  const [isForecast, setIsForecast] = useState(false);

  // Persist bakedVars
  useEffect(() => {
    try { localStorage.setItem('cc_baked_vars', JSON.stringify(bakedVars)); } catch {}
  }, [bakedVars]);

  // Effective optimization variants: live selection > baked > current
  const effectiveVars = useMemo(() => {
    const ev = { all: 'current' };
    for (const d of DP) {
      if (deptOptVars['all'] !== 'current') ev[d] = deptOptVars['all'];
      else if (deptOptVars[d] !== 'current') ev[d] = deptOptVars[d];
      else if (bakedVars[d]) ev[d] = bakedVars[d];
      else ev[d] = 'current';
    }
    // Also set 'all' if ALL departments share the same non-current variant  
    ev.all = deptOptVars['all'];
    return ev;
  }, [deptOptVars, bakedVars]);

  // Initialize planner when raw data loads or refreshes
  useEffect(() => {
    if (rawEmployees.length > 0) {
      planner.initEmployees(rawEmployees);
    }
  }, [rawEmployees]);

  const employees = planner.employees;

  const metrics = useMemo(() => {
    if (!employees.length) return null;
    return recalcAll(employees, isForecast);
  }, [employees, isForecast]);

  const filteredEmps = useMemo(() => {
    if (curDept === 'all') return employees;
    return employees.filter(e => e.dp === curDept);
  }, [employees, curDept]);

  const modifiedCount = useMemo(() => filteredEmps.filter(e => e._modified).length, [filteredEmps]);

  const bakeOptimization = () => {
    // Determine which variant to bake for which departments
    const globalOpt = deptOptVars['all'];
    const getsAll = globalOpt !== 'current';
    
    const newBaked = { ...bakedVars };
    let bakedCount = 0;
    
    if (curDept === 'all') {
      if (getsAll) {
        DP.forEach(d => { newBaked[d] = globalOpt; bakedCount++; });
      } else {
        DP.forEach(d => {
          if (deptOptVars[d] !== 'current') { newBaked[d] = deptOptVars[d]; bakedCount++; }
        });
      }
    } else {
      const v = getsAll ? globalOpt : deptOptVars[curDept];
      if (v !== 'current') { newBaked[curDept] = v; bakedCount++; }
    }

    if (bakedCount > 0) {
      if (!confirm(`Закрепить оптимизацию для ${bakedCount} отд.?\nНажмите «Текущий (База)» чтобы вернуть исходные значения.`)) return;
      setBakedVars(newBaked);
      // Reset live selection back to current
      const reset = { all: 'current' };
      DP.forEach(d => reset[d] = 'current');
      setDeptOptVars(reset);
    } else {
      alert('Нет выбранных оптимизаций для закрепления.');
    }
  };

  // Count optimization-affected employees across effective variants
  const optChangedCount = useMemo(() => {
    let count = 0;
    const dm = MD[curMonth];
    
    for (const e of filteredEmps) {
      const v = effectiveVars[e.dp] || 'current';
      if (v === 'current') continue;
      
      const vChanges = getChangesForVariant(v);
      for (let d = 0; d < dm; d++) {
        const eff = getEffectiveHours(e, curMonth, d, vChanges);
        if (eff.changed) { count++; break; }
      }
    }
    return count;
  }, [filteredEmps, effectiveVars, curMonth]);

  // Ensure auto-shifts are computed for any department that needs them (D or C)
  useMemo(() => {
    const activeVariants = [...Object.values(deptOptVars), ...Object.values(bakedVars)];
    if (employees.length > 0 && activeVariants.some(v => v === 'D' || v === 'C')) {
      computeAutoShifts(employees, false, isForecast);
      if (activeVariants.some(v => v === 'C')) computeAutoShifts(employees, true, isForecast);
    }
  }, [employees, deptOptVars, bakedVars, isForecast]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); planner.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); planner.redo(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [planner.undo, planner.redo]);

  // Tab switching with UI unblocker for heavy optimization tabs
  const handleTabChange = (tId) => {
    if (tId === curTab) return;
    if (tId === 'opt') {
      setIsTabTransitioning(true);
      requestAnimationFrame(() => {
        setTimeout(() => {
          setCurTab(tId);
          setIsTabTransitioning(false);
        }, 30); // Yield to browser paint
      });
    } else {
      setCurTab(tId);
    }
  };

  if (loading) {
    return (
      <div className="loader-overlay" style={{ display: 'flex' }}>
        <div className="spinner"></div>
        <div className="loader-text">Синхронизация с базой данных...</div>
        <div className="loader-sub">{loadProgress || 'Загрузка графиков операторов'}</div>
      </div>
    );
  }

  return (
    <>
      {/* Top Bar */}
      <div className="top">
        <h1>📊 КЦ — Планировщик графиков</h1>
        <div className="nav">
          {TABS.map(t => (
            <button key={t.id} className={curTab === t.id && !isTabTransitioning ? 'on' : ''} onClick={() => handleTabChange(t.id)}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Undo / Redo */}
        <div className="undo-group">
          <button
            className="btn-icon"
            disabled={!planner.canUndo}
            onClick={planner.undo}
            title="Отменить (Ctrl+Z)"
          >↩️</button>
          <button
            className="btn-icon"
            disabled={!planner.canRedo}
            onClick={planner.redo}
            title="Повторить (Ctrl+Y)"
          >↪️</button>
          {planner.hasCache && (
            <button
              className="btn-icon"
              onClick={() => { if (confirm('Сбросить ВСЕ изменения (ручные + оптимизации) и вернуться к исходным данным?')) planner.clearCache(); }}
              style={{ color: 'var(--r)' }}
              title="Сброс всех локальных изменений"
            >🔄</button>
          )}
          {planner.hasCache && (
            <span style={{ fontSize: '10px', color: 'var(--g)', alignSelf: 'center', marginLeft: '5px' }} title="Изменения сохранены">💾 Локально</span>
          )}
        </div>

        <button
          className="forecast-toggle"
          style={{
            background: isForecast ? 'var(--ac)' : 'var(--s2)',
            color: isForecast ? '#fff' : 'var(--t)',
          }}
          onClick={() => setIsForecast(f => !f)}
        >
          {isForecast ? '🚀 2026 (+30%)' : '📅 Базовая история'}
        </button>

        {/* Export */}
        <div className="undo-group">
          <button
            type="button"
            className="btn-icon"
            onClick={() => exportHourlyHeatmapToExcel(employees, effectiveVars)}
            title="Годовая почасовая статистика"
            style={{ marginRight: '8px' }}
          >📈</button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => exportToExcel(employees, metrics, curMonth, effectiveVars)}
            title="Экспорт в Excel"
          >📊</button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => exportToCsv(employees, curMonth)}
            title="Экспорт в CSV"
          >📄</button>
        </div>
      </div>

      {/* Data Source Badge */}
      <div className="source-badge">
        {dataSource}
        <button className="btn-icon" style={{ marginLeft: 8, padding: 2, fontSize: '0.8rem' }} onClick={forceSync} title="Принудительная загрузка с БД">🔄</button>
      </div>

      {/* Content */}
      <div className="page on">
        {/* Global Filters */}
        <div style={{ padding: '0 20px', marginBottom: 12 }}>
          {/* Month Filter */}
          <div className="flt" style={{ marginBottom: 16 }}>
            {MN.map((name, i) => (
              <button key={i} className={`fb ${curMonth === i ? 'on' : ''}`} onClick={() => setCurMonth(i)}>
                {name}
              </button>
            ))}
          </div>

          {/* Dept Filter */}
          <div className="flt">
            <button className={`fb ${curDept === 'all' ? 'on' : ''}`} onClick={() => setCurDept('all')}>Все отделы</button>
            {UI_DP.map(d => (
              <button key={d} className={`fb ${curDept === d ? 'on' : ''}`} onClick={() => setCurDept(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {isTabTransitioning ? (
          <div className="tab-loading-skeleton" style={{ padding: '80px 20px', textAlign: 'center', opacity: 0.8 }}>
            <div className="spinner" style={{ margin: '0 auto 20px', width: 40, height: 40 }}></div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Выполнение расчётов...</h3>
            <div className="sub">Анализ миллионов комбинаций покрытия и балансировка алгоритмом</div>
          </div>
        ) : (
          <>
            {curTab === 'planner' && (
              <>

            {/* KPI row */}
            <div className="row">
              <div className="kpi">
                <div className="v">{employees.length}</div>
                <div className="l">всего операторов</div>
              </div>
              <div className="kpi">
                <div className="v">{filteredEmps.length}</div>
                <div className="l">{curDept === 'all' ? 'активных' : curDept}</div>
              </div>
              {metrics && (
                <>
                  <div className="kpi">
                    <div className="v">{Math.round(metrics.MC[curMonth].reduce((a, b) => a + b, 0) / 24)}</div>
                    <div className="l">ср. покрытие/час</div>
                  </div>
                  <div className="kpi">
                    <div className="v">{Math.round(metrics.DH[curMonth].reduce((a, b) => a + b, 0) / 24)}</div>
                    <div className="l">ср. спрос/час</div>
                  </div>
                </>
              )}
              <div className="kpi" title={`Ручных: ${modifiedCount}, Оптимизаций: ${optChangedCount}`}>
                <div className="v" style={{ color: (modifiedCount + optChangedCount) > 0 ? 'var(--g)' : 'var(--t3)' }}>
                  {modifiedCount}{optChangedCount > 0 ? `+${optChangedCount}` : ''}
                </div>
                <div className="l">изменено</div>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flt" style={{ marginTop: 20, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: '.75rem', color: 'var(--t2)', marginRight: 8 }}>Оптимизация:</span>
                {Object.entries(VARIANT_LABELS).map(([v, label]) => {
                  // Button is 'active' if it's the live selection, or if it's 'current' and matches baked state
                  const curDeptKey = curDept === 'all' ? 'all' : curDept;
                  const liveV = deptOptVars[curDeptKey];
                  const bakedV = curDept === 'all' ? null : bakedVars[curDept];
                  const isActive = liveV === v || (liveV === 'current' && v === 'current' && !bakedV);
                  const isBaked = v === 'current' && bakedV && liveV === 'current';
                  
                  return (
                    <button 
                      key={v} 
                      className={`fb ${isActive ? 'on' : ''} ${isBaked ? '' : ''}`}
                      style={isBaked ? { borderColor: 'var(--ac)', opacity: 0.7 } : (bakedV === v && liveV === 'current' ? { borderColor: 'var(--g)', background: 'rgba(0,200,100,0.15)' } : {})}
                      onClick={() => {
                        if (v === 'current') {
                          // Clear live selection AND baked for this dept
                          setDeptOptVars(prev => ({ ...prev, [curDeptKey]: 'current', all: 'current' }));
                          if (curDept === 'all') {
                            setBakedVars({});
                          } else {
                            setBakedVars(prev => { const n = { ...prev }; delete n[curDept]; return n; });
                          }
                        } else {
                          setDeptOptVars(prev => ({ ...prev, [curDeptKey]: v }));
                        }
                      }}
                    >
                      {label}{bakedV === v && liveV === 'current' ? ' ✅' : ''}
                    </button>
                  );
                })}
                {deptOptVars[curDept === 'all' ? 'all' : curDept] !== 'current' && (
                  <button className="btn btn-primary" style={{ marginLeft: 8, padding: '2px 8px', fontSize: '.8rem' }} onClick={bakeOptimization}>
                    ✅ Закрепить
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <span style={{ fontSize: '.75rem', color: 'var(--t2)', alignSelf: 'center', marginRight: 8 }}>Вид:</span>
                <button className={`fb ${plannerView === 'grid' ? 'on' : ''}`} onClick={() => setPlannerView('grid')}>📊 Тепловая карта</button>
                <button className={`fb ${plannerView === 'cal' ? 'on' : ''}`} onClick={() => setPlannerView('cal')}>📆 Полный календарь</button>
              </div>
            </div>

            {plannerView === 'grid' ? (
              <>
                {/* Employee Table */}
                <div className="cd">
                  <h3>
                    📋 Графики операторов — {MN[curMonth]} 2026
                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--t3)', fontWeight: 400 }}>
                      💡 Двойной клик по строке → редактор | ПКМ по дню → контекстное меню
                    </span>
                  </h3>
                  <EmployeeTable
                    employees={filteredEmps}
                    curMonth={curMonth}
                    onSetDay={planner.setDay}
                    onChangePattern={planner.changePattern}
                    onChangeTime={planner.changeTime}
                    onRevert={planner.revert}
                    metrics={metrics}
                    deptOptVars={effectiveVars}
                  />
                </div>

                {/* Coverage Chart */}
                <CoverageChart metrics={metrics} curMonth={curMonth} curDept={curDept} />

                {/* Heatmap */}
                <Heatmap employees={filteredEmps} metrics={metrics} curMonth={curMonth} curDept={curDept} isForecast={isForecast} deptOptVars={effectiveVars} />

                {/* Validation */}
                <ValidationPanel employees={filteredEmps} metrics={metrics} curMonth={curMonth} />
              </>
            ) : (
              <div className="cd">
                <FullCalendarTab
                  employees={filteredEmps}
                  curMonth={curMonth}
                  isForecast={isForecast}
                  deptOptVars={effectiveVars}
                />
              </div>
            )}
          </>
        )}

        {curTab === 'opt' && (
          <OptimizationTab
            employees={employees}
            metrics={metrics}
            curMonth={curMonth}
            isForecast={isForecast}
          />
        )}
          </>
        )}
      </div>
    </>
  );
}
