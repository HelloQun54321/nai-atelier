import React, { useEffect, useState } from 'react';

/** 数值在失焦或回车时应用，允许输入过程中暂时为空。 */
export function CanvasNumberField({ label, value, onCommit, min, integer = false, disabled = false }: { label: string; value: number; onCommit: (value: number) => void; min?: number; integer?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() && Number.isFinite(n) && (min === undefined || n >= min) && (!integer || Number.isInteger(n))) {
      if (n !== value) onCommit(n);
      else setDraft(String(value));
    } else setDraft(String(value));
  };
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">{label}<input aria-label={label} type="number" step={integer ? 1 : 'any'} min={min} value={draft} disabled={disabled} onChange={e => setDraft(e.currentTarget.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(String(value)); }} className="w-full min-w-0 rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100" /></label>;
}
