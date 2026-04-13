import { useState, useMemo } from 'react';
import { validateEmployee, validateCoverage, validatePeakCoverage } from '../utils/validation.js';

/**
 * Validation panel — displays errors and warnings.
 * Fix #4: Now has an expandable toggle to show all warnings.
 */
export default function ValidationPanel({ employees, metrics, curMonth }) {
  const [expanded, setExpanded] = useState(false);

  const results = useMemo(() => {
    const allWarnings = [];
    const allErrors = [];

    for (const emp of employees) {
      const { errors, warnings } = validateEmployee(emp);
      allErrors.push(...errors);
      allWarnings.push(...warnings);
    }

    const nightW = validateCoverage(employees, curMonth);
    allWarnings.push(...nightW.slice(0, 10));

    if (metrics) {
      const peakW = validatePeakCoverage(metrics, curMonth);
      allWarnings.push(...peakW);
    }

    return { errors: allErrors, warnings: allWarnings };
  }, [employees, metrics, curMonth]);

  const totalIssues = results.errors.length + results.warnings.length;
  if (totalIssues === 0) return null;

  const visibleWarnings = expanded ? results.warnings : results.warnings.slice(0, 8);
  const hiddenCount = results.warnings.length - 8;

  return (
    <div className="validation-panel">
      <div className="val-header" onClick={() => setExpanded(e => !e)} style={{ cursor: 'pointer' }}>
        {results.errors.length > 0 && <span className="val-count val-err">❌ {results.errors.length} ошибок</span>}
        <span className="val-count val-warn">⚠️ {results.warnings.length} предупреждений</span>
        <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: 'var(--t3)', transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : '' }}>▼</span>
      </div>
      <div className="val-list" style={{
        maxHeight: expanded ? '60vh' : '280px',
        overflow: expanded ? 'auto' : 'hidden',
        transition: 'max-height 0.3s ease',
      }}>
        {results.errors.map((e, i) => (
          <div key={`e${i}`} className="val-item val-item-err">❌ {e.msg}</div>
        ))}
        {visibleWarnings.map((w, i) => (
          <div key={`w${i}`} className="val-item val-item-warn">⚠️ {w.msg}</div>
        ))}
        {!expanded && hiddenCount > 0 && (
          <div
            className="val-item val-expand"
            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
            style={{ cursor: 'pointer', color: 'var(--ac)', fontWeight: 600, textAlign: 'center', padding: '10px', borderTop: '1px solid var(--brd)' }}
          >
            ▼ Показать ещё {hiddenCount} предупреждений
          </div>
        )}
        {expanded && hiddenCount > 0 && (
          <div
            className="val-item val-expand"
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            style={{ cursor: 'pointer', color: 'var(--t3)', fontWeight: 600, textAlign: 'center', padding: '10px', borderTop: '1px solid var(--brd)' }}
          >
            ▲ Свернуть
          </div>
        )}
      </div>
    </div>
  );
}
