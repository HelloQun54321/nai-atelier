import React, { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { t } from '../services/i18n';
import { COLLECTED_PROMPT_CATEGORIES, prepareCollectedPrompt } from '../services/collectedPrompt';
import { IconButton, ToolbarButton } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

export function PromptCaptureDialog({ open, onClose, onSave, onSaved, initialText = '', initialName = '', initialCategory = '', initialTags = '', editing = false, categoryDisabled = false }: {
  open: boolean; onClose: () => void; onSave: (text: string, name: string, category: string, tags: string[]) => Promise<string | void>;
  onSaved?: (id?: string) => void;
  initialText?: string; initialName?: string; initialCategory?: string; initialTags?: string;
  editing?: boolean;
  categoryDisabled?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState(initialCategory);
  const [tags, setTags] = useState(initialTags);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saveCategory = categoryDisabled ? '' : category;
  const pending = useRef(false);
  const wasOpen = useRef(open);
  const lastInitial = useRef({ text: initialText, name: initialName, category: initialCategory, tags: initialTags });
  const dialog = useModalA11y<HTMLDivElement>(open);
  useMobileHistoryLayer(open, () => { if (pending.current) return false; onClose(); }, 'prompt-capture');
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const next = { text: initialText, name: initialName, category: initialCategory, tags: initialTags };
    if (Object.keys(next).some(key => next[key as keyof typeof next] !== lastInitial.current[key as keyof typeof next])) {
      setText(next.text); setName(next.name); setCategory(next.category); setTags(next.tags); setError('');
    }
    lastInitial.current = next;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector('textarea')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !pending.current && isTopmostModal(dialog.current)) { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose, dialog]);
  const save = async (keepOpen = false) => {
    if (pending.current) return;
    try { prepareCollectedPrompt(text, name, saveCategory); } catch (e) { setError(t((e as Error).message)); return; }
    pending.current = true; setBusy(true); setError('');
    let id: string | void;
    try {
      id = await onSave(text, name, saveCategory, [...new Set(tags.split(/[,，]/).map(value => value.trim()).filter(Boolean))]);
    }
    catch (e) { setError(t(editing ? '保存失败：{0}' : '收录失败：{0}', [(e as Error).message])); return; }
    finally { pending.current = false; setBusy(false); }
    onSaved?.(typeof id === 'string' ? id : undefined);
    setText(''); setName('');
    if (keepOpen) return;
    setCategory(''); setTags(''); onClose();
  };
  if (!open) return null;
  return <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('粘贴收录')}
      className="content-library appearance-panel flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex items-center gap-2"><ClipboardPaste className="h-5 w-5 text-indigo-500" /><h2 className="flex-1 font-semibold">{t(editing ? '编辑原文' : '粘贴收录')}</h2><IconButton label="关闭" disabled={busy} onClick={onClose}><X /></IconButton></header>
      <label className="block text-sm">{t('提示词原文')}<textarea aria-label={t('提示词原文')} className={`${TOOLBAR_FIELD_CLASS} mt-2 min-h-56 resize-y font-mono!`} value={text} disabled={busy}
        onChange={event => { setText(event.target.value); setError(''); }}
        onPaste={event => {
          // 整段粘贴保留 CRLF；textarea 的展示规范化不回写剪贴板原文。
          const input = event.currentTarget;
          if (!text || (input.selectionStart === 0 && input.selectionEnd === input.value.length)) {
            event.preventDefault(); setText(event.clipboardData.getData('text/plain')); setError('');
          }
        }} placeholder={t('在这里粘贴提示词，按原文保存')} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">{t('名称（可选）')}<input aria-label={t('名称（可选）')} className={`${TOOLBAR_FIELD_CLASS} mt-2`} value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label className="block text-sm">{t('分类')}<select aria-label={t('分类')} className={`${TOOLBAR_FIELD_CLASS} mt-2`} value={saveCategory} disabled={busy || categoryDisabled} onChange={event => setCategory(event.target.value)}>
          <option value="">{t('原文（不分类）')}</option>
          {COLLECTED_PROMPT_CATEGORIES.map(item => <option key={item.kind} value={item.kind}>{t(item.label)}</option>)}
        </select></label>
      </div>
      <label className="block text-sm">{t('标签（可选）')}<input aria-label={t('标签（可选）')} className={TOOLBAR_FIELD_CLASS} value={tags} disabled={busy} onChange={event => setTags(event.target.value)} placeholder={t('用逗号分隔')} /></label>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <footer className="flex flex-wrap justify-end gap-2"><ToolbarButton disabled={busy} onClick={onClose}>{t('取消')}</ToolbarButton>{!editing && <ToolbarButton disabled={busy || !text.trim()} onClick={() => void save(true)}>{t(busy ? '保存中…' : '保存并继续')}</ToolbarButton>}<ToolbarButton tone="primary" disabled={busy || !text.trim()} onClick={() => void save()}>{t(busy ? '保存中…' : editing ? (saveCategory ? '另存片段' : '保存修改') : (saveCategory ? '保存片段' : '保存原文'))}</ToolbarButton></footer>
    </div>
  </div>;
}
