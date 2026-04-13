import { useEffect, useRef } from 'react';
import { MN, DOWL } from '../data/config.js';
import { pT } from '../utils/shifts.js';

/**
 * Context menu for right-clicking on a day cell.
 * Shows day info + actions (work/off/vacation/sick).
 */
export default function ContextMenu({ x, y, empName, empWh, month, day, value, coverage, onAction, onClose }) {
  const ref = useRef();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleEsc(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const dow = new Date(2026, month, day + 1).getDay();
  const dowName = DOWL[dow];
  const isVac = typeof value === 'string';
  const isWork = !isVac && value > 0;

  // Calculate work hours from shift string
  const t = pT(empWh);
  let durH = 11;
  if (t) {
    let { s, e } = t;
    if (e <= s) e += 1440;
    durH = Math.round((e - s) / 60);
  }

  // Clamp position to viewport
  const menuW = 220, menuH = 300;
  const adjX = Math.min(x, window.innerWidth - menuW - 10);
  const adjY = Math.min(y, window.innerHeight - menuH - 10);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: adjX, top: adjY }}
    >
      <div className="ctx-header">
        📅 {day + 1} {MN[month]} ({dowName})
      </div>
      <div className="ctx-emp">{empName}</div>
      <div className="ctx-sep" />

      <button
        className={`ctx-btn ${isWork ? 'active' : ''}`}
        onClick={() => { onAction(durH); onClose(); }}
      >
        ✅ Рабочий день ({durH}ч)
      </button>
      <button
        className={`ctx-btn ${!isVac && !isWork ? 'active' : ''}`}
        onClick={() => { onAction(0); onClose(); }}
      >
        ❌ Выходной
      </button>
      <button
        className={`ctx-btn ${isVac ? 'active' : ''}`}
        onClick={() => { onAction('ОТП'); onClose(); }}
      >
        🏖️ Отпуск
      </button>
      <button
        className="ctx-btn"
        onClick={() => { onAction('Б'); onClose(); }}
      >
        🤒 Больничный
      </button>

      <div className="ctx-sep" />

      {coverage != null && (
        <div className="ctx-info">
          📊 Покрытие: <b>{coverage}</b> чел.
        </div>
      )}

      <div className="ctx-info" style={{ fontSize: '.65rem', color: 'var(--t3)' }}>
        Текущее: {isVac ? value : isWork ? `${value}ч работа` : 'выходной'}
      </div>
    </div>
  );
}
