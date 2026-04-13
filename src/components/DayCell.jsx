import { memo } from 'react';
import { MN } from '../data/config.js';

/** Single day cell in the schedule table */
const DayCell = memo(function DayCell({ value, empName, month, dayIndex, onContextMenu, isChanged, isGhost }) {
  const isVac = typeof value === 'string';
  const isWork = !isVac && value > 0;

  let bg = 'transparent';
  let color = 'var(--t3)';
  let content = '·';

  if (isVac) {
    bg = 'rgba(255,249,196,0.15)';
    color = 'var(--w)';
    content = '🏖';
  } else if (isWork) {
    if (isChanged) {
      // Optimization-changed cell — use accent purple/blue
      bg = 'rgba(138, 92, 246, 0.35)';
      color = '#e0d4ff';
    } else if (isGhost) {
      // Ghost shift (added by optimization)
      bg = 'rgba(59, 130, 246, 0.25)';
      color = '#93c5fd';
    } else {
      const intensity = Math.min(value / 12, 1);
      bg = `rgba(16,192,144,${0.15 + intensity * 0.35})`;
      color = 'rgba(255,255,255,0.8)';
    }
    content = value;
  } else if (isChanged) {
    // Was working, now off due to optimization
    bg = 'rgba(239, 68, 68, 0.15)';
    color = 'var(--t3)';
    content = '−';
  }

  const title = `${empName.split(' ')[0]} — ${dayIndex + 1} ${MN[month]}: ${isVac ? 'отпуск' : isWork ? value + 'ч' : 'выходной'}${isChanged ? ' (оптимизирован)' : ''}`;

  return (
    <td
      style={{
        background: bg,
        fontSize: '.6rem',
        padding: '3px 1px',
        color,
        minWidth: 26,
        textAlign: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background .15s',
        borderBottom: isChanged ? '2px solid rgba(138, 92, 246, 0.6)' : undefined,
      }}
      title={title}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, month, dayIndex, value);
      }}
    >
      {content}
    </td>
  );
});

export default DayCell;
