import { useState, useMemo, useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import { MN, MD, DP, UI_DP, APP_CONFIG } from '../data/config.js';
import { OPT_CHANGES } from '../data/optChanges.js';
import { computeAutoShifts, computeOptCoverage, analyzeBestVariants, resetOptimizerCache, getChangesForVariant } from '../utils/optimizer.js';
import { demH } from '../utils/coverage.js';

Chart.register(...registerables);

const VARIANT_LABELS = {
  current: '📊 Текущий',
  D: '✨ D: Авто-Баланс',
  A: '🟢 А: Микро-сдвиги',
  B: '🟡 Б: Ярусная',
  C: '🔴 В: Полная без границ',
};

export default function OptimizationTab({ employees, curMonth, isForecast }) {
  const [curOptVar, setCurOptVar] = useState('current');
  const slaTarget = APP_CONFIG.TARGET_LOAD_PER_HOUR;
  const yearChartRef = useRef(null);
  const hourChartRef = useRef(null);
  const yearChartObj = useRef(null);
  const hourChartObj = useRef(null);

  // Pre-compute auto shifts on first load
  useEffect(() => {
    if (employees.length > 0) {
      resetOptimizerCache();
      computeAutoShifts(employees, false, isForecast);
      computeAutoShifts(employees, true, isForecast);
    }
  }, [employees, isForecast, slaTarget]);

  const optMC = useMemo(() => computeOptCoverage(employees, curOptVar, isForecast), [employees, curOptVar, isForecast]);
  const curMC = useMemo(() => computeOptCoverage(employees, 'current', isForecast), [employees, isForecast]);

  const DH = useMemo(() => {
    const dh = [];
    for (let m = 0; m < 12; m++) dh.push(demH(m, isForecast));
    return dh;
  }, [isForecast]);

  const changes = useMemo(() => getChangesForVariant(curOptVar), [curOptVar]);

  const bestVariants = useMemo(() => {
    if (employees.length === 0) return null;
    return analyzeBestVariants(employees, isForecast);
  }, [employees, isForecast]);

  // KPIs
  const curPk = +(curMC.reduce((s, m) => s + m.slice(10, 14).reduce((a, b) => a + b, 0) / 4, 0) / 12).toFixed(1);
  const optPk = +(optMC.reduce((s, m) => s + m.slice(10, 14).reduce((a, b) => a + b, 0) / 4, 0) / 12).toFixed(1);
  const avgDemPk = +(DH.reduce((s, d) => s + d.slice(10, 14).reduce((a, b) => a + b, 0) / 4, 0) / 12).toFixed(0);
  const curLoad = curPk > 0 ? +(avgDemPk / curPk).toFixed(1) : 0;
  const optLoad = optPk > 0 ? +(avgDemPk / optPk).toFixed(1) : 0;

  const getSm = (mc) => {
    const samples = mc.map(mArr => mArr.slice(10, 14).reduce((a, b) => a + b, 0) / 4);
    const mean = samples.reduce((a, b) => a + b, 0) / 12;
    const variance = samples.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / 12;
    return 100 - Math.min(100, (Math.sqrt(variance) / (mean || 1)) * 100);
  };
  const curSm = getSm(curMC);
  const optSm = getSm(optMC);

  // Team composition
  const ALL_DP = [...new Set(employees.map(e => e.dp))].filter(dp => dp !== 'Супервизия');
  const teamComp = ALL_DP.map(dp => {
    const de = employees.filter(e => e.dp === dp);
    const p = {};
    de.forEach(e => p[e.pat] = (p[e.pat] || 0) + 1);
    let totalH = 0, cnt = 0;
    de.forEach(e => e.ms.forEach(m => { totalH += m.t; cnt++; }));
    return { dp, count: de.length, p, avgH: cnt > 0 ? Math.round(totalH / cnt) : 0 };
  });

  // Charts
  useEffect(() => {
    if (!yearChartRef.current || !hourChartRef.current) return;

    // Year chart
    const curY = curMC.map(m => +(m.slice(10, 14).reduce((a, b) => a + b, 0) / 4).toFixed(1));
    const optY = optMC.map(m => +(m.slice(10, 14).reduce((a, b) => a + b, 0) / 4).toFixed(1));
    const ndY = DH.map(d => Math.ceil(d.slice(10, 14).reduce((a, b) => a + b, 0) / 4 / slaTarget));

    const ds = [
      { label: 'Текущее покрытие', data: curY, borderColor: 'rgba(124,108,240,.6)', backgroundColor: 'rgba(124,108,240,.1)', fill: true, tension: .3, pointRadius: 4 },
    ];
    if (curOptVar !== 'current') ds.push({ label: `После оптимизации (${curOptVar})`, data: optY, borderColor: 'rgba(16,192,144,.8)', backgroundColor: 'rgba(16,192,144,.1)', fill: true, tension: .3, pointRadius: 4 });
    ds.push({ label: `Необходимо (${slaTarget} заяв/чел)`, data: ndY, borderColor: 'rgba(239,96,80,.6)', borderDash: [5, 3], borderWidth: 2, pointRadius: 2, fill: false });

    if (yearChartObj.current) yearChartObj.current.destroy();
    yearChartObj.current = new Chart(yearChartRef.current, {
      type: 'line', data: { labels: MN, datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8892a8', font: { size: 11, family: 'Inter' } } } }, scales: { x: { ticks: { color: '#4a5270' } }, y: { ticks: { color: '#4a5270' }, grid: { color: 'rgba(40,45,66,.5)' } } } },
    });

    // Hourly chart
    const cm = curMonth;
    const curH = curMC[cm];
    const optH = optMC[cm];
    const needH = DH[cm].map(d => Math.ceil(d / slaTarget));

    const dsH = [{ label: 'Текущее', data: curH, backgroundColor: 'rgba(124,108,240,.25)', borderRadius: 2, order: 2 }];
    if (curOptVar !== 'current') dsH.push({
      label: `После (${curOptVar})`, data: optH,
      backgroundColor: optH.map((v, i) => v >= needH[i] ? 'rgba(16,192,144,.6)' : 'rgba(240,192,64,.6)'),
      borderRadius: 3, order: 1,
    });
    dsH.push({ label: 'Необходимо', data: needH, type: 'line', borderColor: 'rgba(239,96,80,.6)', borderDash: [5, 3], borderWidth: 2, pointRadius: 0, fill: false, order: 0 });

    if (hourChartObj.current) hourChartObj.current.destroy();
    hourChartObj.current = new Chart(hourChartRef.current, {
      type: 'bar', data: { labels: Array.from({ length: 24 }, (_, i) => i + ':00'), datasets: dsH },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#8892a8' } } }, scales: { x: { ticks: { color: '#8892a8', font: { size: 9 } } }, y: { ticks: { color: '#8892a8' }, grid: { color: 'rgba(40,45,66,.5)' } } } },
    });

    return () => {
      if (yearChartObj.current) yearChartObj.current.destroy();
      if (hourChartObj.current) hourChartObj.current.destroy();
    };
  }, [curOptVar, curMC, optMC, DH, curMonth, slaTarget]);

  return (
    <>
      {/* Header */}
      <div className="cd" style={{ borderLeft: '3px solid var(--w)' }}>
        <h3>🏆 Автоматическая рекомендация (по отделам)</h3>
        <div className="sub">Алгоритм проанализировал все 5 вариантов и выбрал оптимальные.</div>
        {bestVariants && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 12 }}>
            {UI_DP.map(dp => {
              const r = bestVariants.results[dp];
              if (!r) return null;
              return (
                <div key={dp} style={{ background: 'rgba(20,24,38,.6)', border: `1px solid ${r.gaps > 0 ? 'var(--d)' : 'var(--g)'}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: '1.1rem', marginBottom: 12 }}><strong>{dp}</strong> ➜ {VARIANT_LABELS[r.variant] || r.variant}</div>
                  <div className="row" style={{ margin: 0 }}>
                    <div className="kpi"><div className="v">{r.peak.toFixed(1)}</div><div className="l">чел в пик (10-14)</div></div>
                    <div className="kpi"><div className="v" style={{ color: r.gaps > 0 ? 'var(--d)' : 'var(--g)' }}>{r.gaps > 0 ? `- ${r.gaps.toFixed(0)}` : 'ОК'}</div><div className="l">ночные просадки</div></div>
                  </div>
                  <div style={{ marginTop: 10, fontSize: '.72rem', color: 'var(--t2)', background: 'rgba(255,255,255,0.05)', padding: 6, borderRadius: 6, textAlign: 'center' }}>{r.reason}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Variant Toggles */}
      <div className="flt" style={{ marginTop: 12 }}>
        {Object.entries(VARIANT_LABELS).map(([v, label]) => (
          <button key={v} className={`fb ${curOptVar === v ? 'on' : ''}`} onClick={() => setCurOptVar(v)}>{label}</button>
        ))}
      </div>

      {/* KPIs */}
      <div className="row">
        <div className="kpi"><div className="v">{changes.length}</div><div className="l">изменённых оп.</div></div>
        <div className="kpi"><div className="v">{curPk} → <span style={{ color: 'var(--g)' }}>{optPk}</span></div><div className="l">ср. покр. пик 10-14</div></div>
        <div className="kpi"><div className="v">{curSm.toFixed(0)}% → <span style={{ color: 'var(--g)' }}>{optSm.toFixed(0)}%</span></div><div className="l">индекс сглаживания</div></div>
        <div className="kpi"><div className="v">{curLoad} → <span style={{ color: optLoad <= slaTarget ? 'var(--g)' : 'var(--w)' }}>{optLoad}</span></div><div className="l">нагрузка заяв/чел</div></div>
      </div>

      {/* Team Composition */}
      <div className="cd">
        <h3>👥 Состав команды по отделам</h3>
        <div className="scroll-x">
          <table style={{ fontSize: '.75rem' }}>
            <thead><tr><th>Отдел</th><th>Всего</th><th>2/2</th><th>2/2/3</th><th>5/2</th><th>Ночь</th><th>Ранняя</th><th>Сутки</th><th>Ср.ч/мес</th></tr></thead>
            <tbody>
              {teamComp.map(t => (
                <tr key={t.dp}>
                  <td style={{ textAlign: 'left' }}><strong>{t.dp}</strong></td>
                  <td>{t.count}</td>
                  <td>{t.p['2/2'] || 0}</td>
                  <td>{t.p['2/2/3'] || 0}</td>
                  <td>{t.p['5/2'] || 0}</td>
                  <td>{t.p['ночь'] || 0}</td>
                  <td>{t.p['ранняя'] || 0}</td>
                  <td>{t.p['сутки'] || 0}</td>
                  <td>{t.avgH}ч</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Changes Table */}
      {changes.length > 0 && (
        <div className="cd">
          <h3>👥 Изменения — Вариант {curOptVar}</h3>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Сотрудник</th><th>Отдел</th><th>Было</th><th></th><th>Стало</th><th>Эффект</th></tr></thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left' }}>{c.name.split(' ').slice(0, 2).join(' ')}</td>
                    <td><span className="bd bb">{c.dept}</span></td>
                    <td style={{ color: 'var(--t3)' }}>{c.from}</td>
                    <td style={{ color: 'var(--t3)' }}>→</td>
                    <td style={{ color: 'var(--g)', fontWeight: 600 }}>{c.to}</td>
                    <td style={{ fontSize: '.72rem' }}>{c.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Load Heatmap */}
      <div className="cd">
        <h3>🔥 Нагрузка по часам и месяцам{curOptVar !== 'current' ? ` — Вариант ${curOptVar}` : ' — Текущий'}</h3>
        <div className="sub">Значение = заявок на 1 оператора в час. <span style={{ color: 'var(--d)' }}>Красные</span> ≥ 3, <span style={{ color: 'var(--w)' }}>жёлтые</span> 2-3, <span style={{ color: 'var(--g)' }}>зелёные</span> ≤ 2.</div>
        <div className="scroll-x">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th>Месяц</th>
                {Array.from({ length: 24 }, (_, h) => <th key={h}>{h}:00</th>)}
                <th>⚠️ Крит.</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, m) => {
                let cr = 0;
                return (
                  <tr key={m}>
                    <td><strong>{MN[m]}</strong></td>
                    {Array.from({ length: 24 }, (_, h) => {
                      const ld = optMC[m][h] > 0 ? DH[m][h] / optMC[m][h] : 0;
                      const ldCur = curMC[m][h] > 0 ? DH[m][h] / curMC[m][h] : 0;
                      const cls = ld > 4 ? 'sr' : ld > 3 ? 'sy' : ld > 2 ? '' : 'sg';
                      if (ld > 3) cr++;
                      const improved = curOptVar !== 'current' && ldCur > 3 && ld <= 3;
                      return (
                        <td key={h} className={cls} style={improved ? { outline: '2px solid var(--g)' } : {}}
                          title={`${MN[m]} ${h}:00 — ${DH[m][h]} заяв / ${optMC[m][h]} чел = ${ld.toFixed(1)}`}>
                          {ld > 0 ? ld.toFixed(1) : '—'}
                        </td>
                      );
                    })}
                    <td><strong className={cr > 5 ? 'sr' : cr > 2 ? 'sy' : 'sg'}>{cr}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="cd"><h3>📈 Покрытие пика (10-14) по месяцам</h3><div style={{ height: 300 }}><canvas ref={yearChartRef}></canvas></div></div>
      <div className="cd"><h3>📊 Покрытие по часам — {MN[curMonth]}</h3><div style={{ height: 300 }}><canvas ref={hourChartRef}></canvas></div></div>
    </>
  );
}
