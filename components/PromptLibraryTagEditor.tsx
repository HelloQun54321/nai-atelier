import React, { useEffect, useRef, useState } from 'react';
import { t } from '../services/i18n';
import { parsePromptLibraryTags } from '../services/promptLibraryEntries';
import { CollectionTagInput } from './inspiration/CollectionControls';
import { ToolbarButton } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';

/** 保存成功才切换展示；按资料 ID 挂载，失败及切换资料均不串用草稿。 */
export const PromptLibraryTagEditor: React.FC<{
  tags: string[];
  suggestions: string[];
  onSave: (tags: string[]) => Promise<void>;
}> = ({ tags, suggestions, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ source: string; tags: string[] } | null>(null);
  const pending = useRef(false);
  const source = JSON.stringify(tags);
  useEffect(() => { setSaved(null); }, [source]);
  const confirmed = saved?.source === source ? saved.tags : tags;
  const save = async () => {
    if (pending.current) return;
    const next = parsePromptLibraryTags(draft);
    pending.current = true; setBusy(true); setError('');
    try { await onSave(next); setSaved({ source, tags: next }); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section className="mt-3" aria-label={t('自定义标签')}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-gray-500">{t('自定义标签')}</h3>
      {!editing && <ToolbarButton onClick={() => { setDraft(confirmed.join(', ')); setError(''); setEditing(true); }}>{t('编辑标签')}</ToolbarButton>}
    </div>
    {editing ? <div className="mt-2 space-y-2">
      <CollectionTagInput aria-label={t('编辑自定义标签')} value={draft} disabled={busy} className={TOOLBAR_FIELD_CLASS}
        suggestions={suggestions} inlineSuggestions onChange={event => setDraft(event.target.value)} onPick={setDraft} />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t('标签保存失败：{0}', [error])}</p>}
      <div className="flex flex-wrap justify-end gap-2"><ToolbarButton disabled={busy} onClick={() => { setEditing(false); setError(''); }}>{t('取消')}</ToolbarButton>
        <ToolbarButton tone="primary" disabled={busy} onClick={() => void save()}>{t(busy ? '保存中…' : '保存标签')}</ToolbarButton></div>
    </div> : <div className="mt-2 flex flex-wrap gap-1">{confirmed.length ? confirmed.map(tag => <span key={tag} className="appearance-group max-w-full break-words rounded px-2 py-1 text-xs">{tag}</span>) : <span className="text-xs text-gray-400">{t('暂无标签')}</span>}</div>}
  </section>;
};
