import { useRef, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
import { MN, APP_CONFIG } from '../data/config.js';
import { demHByDept } from '../utils/coverage.js';

Chart.register(...registerables);

/**
 * Chart.js line chart: coverage vs demand for 24 hours.
 * Fix #2: When dept is selected, demand is dept-specific (not total).
 * Fix #3: GAP line is visible by default with color fill.
 */
export default function CoverageChart({ metrics, curMonth, curDept, isForecast }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!metrics || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    const targetLoad = APP_CONFIG.TARGET_LOAD_PER_HOUR;

    // Coverage data (dept-specific or total)
    const coverage = curDept === 'all'
      ? metrics.MC[curMonth]
      : (metrics.MCD[curDept]?.[curMonth] || Array(24).fill(0));

    // Demand data — use dept-specific when filtered!
    let rawDemand;
    if (curDept !== 'all') {
      rawDemand = demHByDept(curMonth, curDept, isForecast);
    } else {
      rawDemand = metrics.DH[curMonth];
    }
    const demand = rawDemand.map(d => +(d / targetLoad).toFixed(1));

    // Gap (coverage - needed staff)
    const gap = coverage.map((c, i) => +(c - demand[i]).toFixed(1));

    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`),
        datasets: [
          {
            label: 'Покрытие (чел.)',
            data: coverage,
            borderColor: '#10c090',
            backgroundColor: 'rgba(16, 192, 144, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
            borderWidth: 2,
          },
          {
            label: 'Необх. операторов',
            data: demand,
            borderColor: '#f0c040',
            backgroundColor: 'rgba(240, 192, 64, 0.05)',
            fill: true,
            tension: 0.3,
            borderDash: [6, 3],
            pointRadius: 2,
            borderWidth: 2,
          },
          {
            label: 'Gap (профицит/дефицит)',
            data: gap,
            borderColor: gap.map(g => g >= 0 ? 'rgba(16,192,144,0.8)' : 'rgba(239,96,80,0.8)'),
            segment: {
              borderColor: ctx2 => {
                const val = gap[ctx2.p0DataIndex];
                return val >= 0 ? 'rgba(16,192,144,0.8)' : 'rgba(239,96,80,0.8)';
              },
              backgroundColor: ctx2 => {
                const val = gap[ctx2.p0DataIndex];
                return val >= 0 ? 'rgba(16,192,144,0.08)' : 'rgba(239,96,80,0.12)';
              },
            },
            backgroundColor: 'transparent',
            fill: 'origin',
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 1.5,
            hidden: false,  // Fix #3: GAP visible by default
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            labels: { color: '#7884a0', font: { size: 11, family: 'Inter' }, usePointStyle: true, padding: 16 },
          },
          tooltip: {
            backgroundColor: '#1e2234',
            borderColor: '#282d42',
            borderWidth: 1,
            titleColor: '#dde',
            bodyColor: '#7884a0',
            titleFont: { size: 12, family: 'Inter' },
            bodyFont: { size: 11, family: 'Inter' },
            callbacks: {
              afterBody: (items) => {
                const idx = items[0]?.dataIndex;
                if (idx != null) {
                  const g = gap[idx];
                  return g >= 0 ? `✅ Профицит: +${g} чел.` : `⚠️ Дефицит: ${g} чел.`;
                }
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#4a5270', font: { size: 10, family: 'Inter' } },
            grid: { color: 'rgba(40, 45, 66, 0.4)' },
          },
          y: {
            ticks: { color: '#4a5270', font: { size: 10, family: 'Inter' } },
            grid: { color: 'rgba(40, 45, 66, 0.4)' },
          },
        },
      },
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [metrics, curMonth, curDept, isForecast]);

  return (
    <div className="cd">
      <h3>📈 Покрытие vs Спрос — {MN[curMonth]} 2026 {curDept !== 'all' && `(${curDept})`}</h3>
      <div className="sub">Зелёная = покрытие, жёлтая = потребность, красная/зелёная линия = gap (профицит/дефицит)</div>
      <div style={{ height: 320 }}>
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
}
