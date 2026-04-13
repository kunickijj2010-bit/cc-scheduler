import { useState, useEffect, useRef } from 'react';
import { SHIFT_PATTERNS, MN } from '../data/config.js';

/**
 * Shift editor modal — allows changing pattern, work hours, start date.
 */
export default function ShiftEditor({ employee, onApplyPattern, onApplyTime, onRevert, onClose }) {
  const ref = useRef();

  // Parse current work hours
  const whMatch = (employee.wh || '09:00-21:00').match(/(\d{2}):(\d{2})\s*[-–—]\s*(\d{2}):(\d{2})/);
  const [startH, setStartH] = useState(whMatch ? whMatch[1] : '09');
  const [startM, setStartM] = useState(whMatch ? whMatch[2] : '00');
  const [endH, setEndH] = useState(whMatch ? whMatch[3] : '21');
  const [endM, setEndM] = useState(whMatch ? whMatch[4] : '00');

  const [pattern, setPattern] = useState(employee.pat || '2/2');
  const [phase, setPhase] = useState(0);
  const [effectMonth, setEffectMonth] = useState(new Date().getMonth());
  const [effectDay, setEffectDay] = useState(0);
  const [reason, setReason] = useState('');

  // Close on Escape
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const workHours = `${startH}:${startM}-${endH}:${endM}`;
  const patConfig = SHIFT_PATTERNS[pattern];
  const maxPhases = patConfig ? patConfig.phases : 4;

  const handleApply = () => {
    onApplyPattern(employee.nm, pattern, phase, workHours, effectMonth, effectDay, reason);
    onClose();
  };

  const handleTimeOnly = () => {
    onApplyTime(employee.nm, workHours, effectMonth, effectDay, reason);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={ref}>
        <div className="modal-header">
          <span>✏️ Редактирование графика</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-emp">
          <strong>{employee.nm}</strong>
          <span className={`bd ${employee.dp === 'NDC' ? 'bb' : employee.dp === 'GDS' ? 'bg' : employee.dp === 'VIP' ? 'by' : 'br'}`}>
            {employee.dp}
          </span>
          {employee.loc && <span style={{ color: 'var(--t3)', fontSize: '.75rem' }}>{employee.loc}</span>}
        </div>

        {/* Work hours */}
        <div className="modal-section">
          <label>Рабочее время</label>
          <div className="time-row">
            <div className="time-group">
              <span className="time-label">Начало</span>
              <input type="text" value={startH} onChange={e => setStartH(e.target.value.replace(/\D/g, '').slice(0, 2))} maxLength={2} className="time-input" />
              <span>:</span>
              <input type="text" value={startM} onChange={e => setStartM(e.target.value.replace(/\D/g, '').slice(0, 2))} maxLength={2} className="time-input" />
            </div>
            <span style={{ color: 'var(--t3)', fontSize: '1.2rem' }}>—</span>
            <div className="time-group">
              <span className="time-label">Конец</span>
              <input type="text" value={endH} onChange={e => setEndH(e.target.value.replace(/\D/g, '').slice(0, 2))} maxLength={2} className="time-input" />
              <span>:</span>
              <input type="text" value={endM} onChange={e => setEndM(e.target.value.replace(/\D/g, '').slice(0, 2))} maxLength={2} className="time-input" />
            </div>
          </div>
          <div style={{ fontSize: '.7rem', color: 'var(--t3)', marginTop: 4 }}>
            Текущая смена: {employee.wh} → Новая: {workHours}
          </div>
        </div>

        {/* Pattern */}
        <div className="modal-section">
          <label>Паттерн смены</label>
          <div className="pattern-grid">
            {Object.entries(SHIFT_PATTERNS).map(([key, p]) => (
              <button
                key={key}
                className={`pattern-btn ${pattern === key ? 'active' : ''}`}
                onClick={() => { setPattern(key); setPhase(0); }}
              >
                <span className="pattern-name">{key}</span>
                <span className="pattern-desc">{p.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Phase */}
        <div className="modal-section">
          <label>Фаза (сдвиг цикла): {phase}</label>
          <input
            type="range"
            min={0}
            max={maxPhases - 1}
            value={phase}
            onChange={e => setPhase(+e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.6rem', color: 'var(--t3)' }}>
            <span>0</span><span>{maxPhases - 1}</span>
          </div>
        </div>

        {/* Start date */}
        <div className="modal-section">
          <label>Дата начала действия</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={effectMonth} onChange={e => setEffectMonth(+e.target.value)} className="select-input">
              {MN.map((name, i) => <option key={i} value={i}>{name}</option>)}
            </select>
            <input
              type="number"
              min={1}
              max={31}
              value={effectDay + 1}
              onChange={e => setEffectDay(Math.max(0, +e.target.value - 1))}
              className="select-input"
              style={{ width: 60 }}
            />
            <span style={{ fontSize: '.75rem', color: 'var(--t3)' }}>число</span>
          </div>
        </div>

        {/* Reason */}
        <div className="modal-section">
          <label>Причина изменения (опц.)</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Покрытие пика, балансировка фаз..."
            className="text-input"
          />
        </div>

        {/* Actions */}
        <div className="modal-actions">
          {employee._modified && (
            <button className="btn btn-warn" onClick={() => { onRevert(employee.nm); onClose(); }}>
              ↩️ Откатить
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleTimeOnly}>
            🕐 Только время
          </button>
          <button className="btn btn-primary" onClick={handleApply}>
            ✅ Применить
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ✖ Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
