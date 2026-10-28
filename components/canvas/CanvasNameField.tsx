import React, { useEffect, useState } from 'react';

/** 一次重命名只提交一次，避免每个输入字符各产生一条撤销记录。 */
export function CanvasNameField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">{label}<input aria-label={label} value={draft} onChange={e => setDraft(e.currentTarget.value)} onBlur={() => { if (draft !== value) onCommit(draft); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(value); }} className="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm text-gray-800 dark:border-gray-700 dark:text-gray-100" /></label>;
}
