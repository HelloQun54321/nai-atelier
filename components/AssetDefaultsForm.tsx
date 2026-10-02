import React, { useState } from 'react';

interface Props {
  name: string;
  strength: number;
  fidelity?: number;
  min?: number;
  max?: number;
  onSave: (name: string, strength: number, fidelity?: number) => Promise<void>;
}

/** 资料默认值显式保存，与右侧即时生效的本次参考参数区分。 */
export const AssetDefaultsForm: React.FC<Props> = ({ name, strength, fidelity, min = 0, max = 1, onSave }) => {
  const [draft, setDraft] = useState({ name, strength: String(strength), fidelity: String(fidelity ?? 0.6) });
  const [saved, setSaved] = useState({ name, strength, fidelity });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const normalize = (value: string) => Math.max(min, Math.min(max, Number(value)));
  const valid = draft.name.trim() && draft.strength.trim() && Number.isFinite(Number(draft.strength)) &&
    (fidelity === undefined || (draft.fidelity.trim() && Number.isFinite(Number(draft.fidelity))));
  const dirty = draft.name.trim() !== saved.name || normalize(draft.strength) !== saved.strength ||
    (fidelity !== undefined && normalize(draft.fidelity) !== saved.fidelity);
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    if (!valid || !dirty || saving) return;
    setSaving(true); setMessage('');
    const next = { name: draft.name.trim(), strength: normalize(draft.strength), fidelity: fidelity === undefined ? undefined : normalize(draft.fidelity) };
    try {
      await onSave(next.name, next.strength, next.fidelity);
      setSaved(next); setDraft({ name: next.name, strength: String(next.strength), fidelity: String(next.fidelity ?? 0.6) });
      setMessage('资料默认值已保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }}>
    <p className="text-xs text-gray-500">以下默认值用于下次添加，不改变本次已选参数。</p>
    <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">名称</span><input value={draft.name} disabled={saving} onChange={event => setDraft({ ...draft, name: event.target.value })} className="h-9 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-800" /></label>
    <div className="grid grid-cols-2 gap-3">{(['strength', ...(fidelity === undefined ? [] : ['fidelity'])] as Array<'strength' | 'fidelity'>).map(field => <label key={field}><span className="mb-1 block text-xs font-bold text-gray-500">{field === 'strength' ? '默认强度' : '默认保真度'}</span><input type="number" min={min} max={max} step="0.01" value={draft[field]} disabled={saving} onChange={event => setDraft({ ...draft, [field]: event.target.value })} className="h-9 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-800" /></label>)}</div>
    <div className="flex items-center justify-between gap-2"><span role="status" className="text-xs text-gray-500">{message}</span><button type="submit" disabled={!valid || !dirty || saving} className="mobile-touch h-9 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-40">{saving ? '保存中…' : '保存资料'}</button></div>
  </form>;
};
