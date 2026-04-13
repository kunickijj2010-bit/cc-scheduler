import { useReducer, useCallback } from 'react';
import { applyPatternChange, applyTimeChange, setDayValue, revertEmployee } from '../utils/patterns.js';
import { matchName } from '../utils/shifts.js';

const MAX_UNDO = 50;

const ACTION = {
  INIT: 'INIT',
  CHANGE_PATTERN: 'CHANGE_PATTERN',
  CHANGE_TIME: 'CHANGE_TIME',
  SET_DAY: 'SET_DAY',
  REVERT: 'REVERT',
  UNDO: 'UNDO',
  REDO: 'REDO',
  CLEAR_CACHE: 'CLEAR_CACHE',
  BATCH_OPT: 'BATCH_OPT',
};

const CACHE_KEY = 'cc_scheduler_checkpoints';

function saveCache(employees) {
  try {
    const mods = employees.filter(e => e._modified).map(e => ({
      nm: e.nm,
      _modified: e._modified,
      _changes: e._changes,
      ms: e.ms,
      v: e.v,
      wh: e.wh,
      whm: e.whm,
      pat: e.pat,
      cov: e.cov
    }));
    if (mods.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mods));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch(e) {
    console.error('Failed to save checkpoints:', e);
  }
}

function reducer(state, action) {
  switch (action.type) {
    case ACTION.INIT: {
      let mergedEmps = action.employees;
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const mods = JSON.parse(cached);
          mergedEmps = mergedEmps.map(emp => {
            const mod = mods.find(m => m.nm === emp.nm);
            if (mod) return { ...emp, ...mod, _original: { ...emp } };
            return emp;
          });
        }
      } catch(e) {
        console.error('Failed to load checkpoints:', e);
      }
      return { employees: mergedEmps, undoStack: [], redoStack: [] };
    }
    case ACTION.CHANGE_PATTERN: {
      const { empName, pattern, phase, workHours, startMonth, startDay, reason } = action;
      const newEmps = state.employees.map(e =>
        e.nm === empName ? applyPatternChange(e, pattern, phase, workHours, startMonth, startDay, reason) : e
      );
      const stateNew = {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.CHANGE_TIME: {
      const { empName, workHours, startMonth, startDay, reason } = action;
      const newEmps = state.employees.map(e =>
        e.nm === empName ? applyTimeChange(e, workHours, startMonth, startDay, reason) : e
      );
      const stateNew = {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.SET_DAY: {
      const { empName, month, day, value, reason } = action;
      const newEmps = state.employees.map(e =>
        e.nm === empName ? setDayValue(e, month, day, value, reason) : e
      );
      const stateNew = {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.BATCH_OPT: {
      const { changes, reason } = action;
      let newEmps = [...state.employees];
      
      changes.forEach(chg => {
        // Try fuzzy match first, then strict equality as fallback
        let empIndex = newEmps.findIndex(e => matchName(e.nm, chg.name));
        if (empIndex === -1 && chg.nm) empIndex = newEmps.findIndex(e => matchName(e.nm, chg.nm));
        if (empIndex === -1) empIndex = newEmps.findIndex(e => e.nm === chg.name || e.nm === chg.nm);
        if (empIndex === -1) {
          console.warn(`[BATCH_OPT] Employee not found: "${chg.name || chg.nm}"`);
          return;
        }
        
        let e = newEmps[empIndex];
        const changeReason = chg.reason || reason;
        
        // Parse start date from effect field (only if it looks like MM/DD)
        let sm = 0, sd = 0;
        if (chg.effect && /^\d{1,2}\/\d{1,2}$/.test(chg.effect)) {
          const parts = chg.effect.split('/');
          sm = parseInt(parts[0], 10) - 1;
          sd = parseInt(parts[1], 10) - 1;
        }

        // Handle pattern change (e.g. суточная → 2/2)
        if (chg.newPattern && chg.to) {
          const phase = chg.phase !== undefined ? chg.phase : 0;
          e = applyPatternChange(e, chg.newPattern, phase, chg.to, sm, sd, changeReason);
        } else if (chg.to) {
          // Time-only change (e.g. 08:00-20:00 → 09:00-21:00)
          e = applyTimeChange(e, chg.to, sm, sd, changeReason);
        }
        // Note: shiftDays is a numeric cycle offset used for preview only,
        // not an array. Pattern/time changes above handle actual schedule updates.
        
        newEmps[empIndex] = e;
      });

      const stateNew = {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.REVERT: {
      const { empName } = action;
      const newEmps = state.employees.map(e =>
        e.nm === empName ? revertEmployee(e) : e
      );
      const stateNew = {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.UNDO: {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        employees: prev,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.employees].slice(-MAX_UNDO),
      };
    }

    case ACTION.REDO: {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      const stateNew = {
        employees: next,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: state.redoStack.slice(0, -1),
      };
      saveCache(stateNew.employees);
      return stateNew;
    }

    case ACTION.CLEAR_CACHE: {
      localStorage.removeItem(CACHE_KEY);
      // Revert all modified employees back to _original incrementally
      const newEmps = state.employees.map(e => e._modified ? revertEmployee(e) : e);
      return {
        employees: newEmps,
        undoStack: [...state.undoStack, state.employees].slice(-MAX_UNDO),
        redoStack: [],
      };
    }

    default:
      return state;
  }
}

export function usePlanner(initialEmployees) {
  const [state, dispatch] = useReducer(reducer, {
    employees: initialEmployees,
    undoStack: [],
    redoStack: [],
  });

  const initEmployees = useCallback((emps) => dispatch({ type: ACTION.INIT, employees: emps }), []);

  const changePattern = useCallback((empName, pattern, phase, workHours, startMonth = 0, startDay = 0, reason = '') =>
    dispatch({ type: ACTION.CHANGE_PATTERN, empName, pattern, phase, workHours, startMonth, startDay, reason }), []);

  const changeTime = useCallback((empName, workHours, startMonth = 0, startDay = 0, reason = '') =>
    dispatch({ type: ACTION.CHANGE_TIME, empName, workHours, startMonth, startDay, reason }), []);

  const setDay = useCallback((empName, month, day, value, reason = '') =>
    dispatch({ type: ACTION.SET_DAY, empName, month, day, value, reason }), []);

  const applyBatchOptimization = useCallback((changes, reason = 'Оптимизация') =>
    dispatch({ type: ACTION.BATCH_OPT, changes, reason }), []);

  const revert = useCallback((empName) =>
    dispatch({ type: ACTION.REVERT, empName }), []);

  const undo = useCallback(() => dispatch({ type: ACTION.UNDO }), []);
  const redo = useCallback(() => dispatch({ type: ACTION.REDO }), []);
  const clearCache = useCallback(() => dispatch({ type: ACTION.CLEAR_CACHE }), []);

  const hasCache = state.employees.some(e => e._modified);

  return {
    employees: state.employees,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    hasCache,
    initEmployees,
    changePattern,
    changeTime,
    setDay,
    applyBatchOptimization,
    revert,
    undo,
    redo,
    clearCache,
  };
}
