export interface UndoSnapshotEntry<T> {
  value: T;
  fingerprint: string;
  coalesceKey?: string;
  timestamp: number;
}

export interface LabUndoHistory<T> {
  past: UndoSnapshotEntry<T>[];
  present: UndoSnapshotEntry<T>;
  future: UndoSnapshotEntry<T>[];
  maxSteps: number;
}

export const createLabUndoHistory = <T>(
  initial: T,
  fingerprint: string,
  maxSteps = 50,
  now = Date.now(),
): LabUndoHistory<T> => ({
  past: [],
  present: { value: initial, fingerprint, timestamp: now },
  future: [],
  maxSteps,
});

export const recordLabUndoSnapshot = <T>(
  history: LabUndoHistory<T>,
  value: T,
  fingerprint: string,
  coalesceKey?: string,
  now = Date.now(),
): LabUndoHistory<T> => {
  if (fingerprint === history.present.fingerprint) return history;

  // 若外部组件（例如提示词框自身 Ctrl+Z）刚好回退到上一条或重做回下一条，同步指针，避免工作台栈来回打架。
  if (history.past.length > 0 && history.past[history.past.length - 1].fingerprint === fingerprint) {
    const previous = history.past[history.past.length - 1];
    return {
      ...history,
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, history.maxSteps),
    };
  }
  if (history.future.length > 0 && history.future[0].fingerprint === fingerprint) {
    const next = history.future[0];
    return {
      ...history,
      past: [...history.past, history.present].slice(-history.maxSteps),
      present: next,
      future: history.future.slice(1),
    };
  }

  const nextEntry: UndoSnapshotEntry<T> = { value, fingerprint, coalesceKey, timestamp: now };
  if (
    coalesceKey
    && history.present.coalesceKey === coalesceKey
    && now - history.present.timestamp < 600
    && history.past.length > 0
    && history.future.length === 0
  ) {
    return {
      ...history,
      present: nextEntry,
    };
  }

  const nextPast = [...history.past, history.present];
  if (nextPast.length > history.maxSteps) {
    nextPast.splice(0, nextPast.length - history.maxSteps);
  }
  return {
    ...history,
    past: nextPast,
    present: nextEntry,
    future: [],
  };
};

export const undoLabHistory = <T>(
  history: LabUndoHistory<T>,
): { history: LabUndoHistory<T>; restored: T | null } => {
  if (!history.past.length) return { history, restored: null };
  const previous = history.past[history.past.length - 1];
  return {
    history: {
      ...history,
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, history.maxSteps),
    },
    restored: previous.value,
  };
};

export const redoLabHistory = <T>(
  history: LabUndoHistory<T>,
): { history: LabUndoHistory<T>; restored: T | null } => {
  if (!history.future.length) return { history, restored: null };
  const next = history.future[0];
  return {
    history: {
      ...history,
      past: [...history.past, history.present].slice(-history.maxSteps),
      present: next,
      future: history.future.slice(1),
    },
    restored: next.value,
  };
};
