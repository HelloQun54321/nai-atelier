import React, { useState } from 'react';
import { CopyPlus, Columns2, Pencil, Plus, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { LocalGenItem, PromptChain } from '../types';
import { IconButton } from './DesignSystem';
import { useConfirmDialog } from './ConfirmDialog';
import { ImageLightbox } from './ImageLightbox';
import { listGenerationSeriesSessions } from '../services/generationSeries';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

export function LabTrialNavigation({ trials, activeId, onSelect, onAdd, onRename, onRemove, results, notify }: {
  trials: PromptChain[]; activeId: string; onSelect: (id: string) => void; onAdd: (copy: boolean) => void;
  onRename: (id: string, name: string) => void; onRemove: (id: string) => void;
  results: Record<string, LocalGenItem>; notify: (message: string, type?: 'success' | 'error') => void;
}) {
  useLanguage();
  const confirm = useConfirmDialog();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [comparing, setComparing] = useState(false);
  const [pair, setPair] = useState<[string, string]>([activeId, trials.find(trial => trial.id !== activeId)?.id || activeId]);
  const [zoom, setZoom] = useState<LocalGenItem>();
  const dialogRef = useModalA11y<HTMLDivElement>(comparing);
  const closeComparison = useMobileHistoryLayer(comparing, () => setComparing(false), 'lab-trial-comparison');
  React.useEffect(() => {
    if (!comparing) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.preventDefault(); closeComparison(); } };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [comparing, closeComparison, dialogRef]);
  const current = trials.find(trial => trial.id === activeId)!;
  const remove = async () => {
    if (listGenerationSeriesSessions().some(({ scope }) => scope === activeId)) { notify('分区仍有生成任务，请完成或取消后再删除', 'error'); return; }
    if (await confirm({ title: t('删除试画分区'), message: t('删除分区“{0}”？已保存的生成历史仍会保留。', [current.name]), confirmLabel: t('删除'), tone: 'danger' })) onRemove(activeId);
  };
  const rename = () => { onRename(activeId, name); setRenaming(false); };
  return <>
    <div className="appearance-group flex min-w-0 shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-800" aria-label={t('实验室试画分区')}>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label={t('试画分区')}>
        {trials.map(trial => <button key={trial.id} role="tab" type="button" aria-selected={activeId === trial.id}
          onClick={() => { setRenaming(false); onSelect(trial.id); }}
          className={`mobile-touch shrink-0 rounded-lg px-3 py-1.5 text-sm ${activeId === trial.id ? 'bg-indigo-100 font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200' : 'text-gray-500'}`}>{trial.name}</button>)}
      </div>
      <IconButton label={t('新建试画分区')} onClick={() => onAdd(false)}><Plus /></IconButton>
      <IconButton label={t('复制当前试画分区')} onClick={() => onAdd(true)}><CopyPlus /></IconButton>
      <IconButton label={t('重命名试画分区')} onClick={() => { setName(current.name); setRenaming(true); }}><Pencil /></IconButton>
      <IconButton label={t('对比试画结果')} disabled={trials.length < 2} onClick={() => { setPair([activeId, trials.find(trial => trial.id !== activeId)!.id]); setComparing(true); }}><Columns2 /></IconButton>
      <IconButton label={t('删除试画分区')} disabled={trials.length < 2} onClick={() => void remove()}><X /></IconButton>
    </div>
    {renaming && <form className="appearance-group flex gap-2 px-3 py-2" onSubmit={event => { event.preventDefault(); rename(); }}>
      <input autoFocus aria-label={t('分区名称')} maxLength={80} value={name} onChange={event => setName(event.target.value)} className="min-w-0 flex-1 rounded border p-2 text-sm dark:bg-gray-900" />
      <button type="submit" disabled={!name.trim()}>{t('保存')}</button><button type="button" onClick={() => setRenaming(false)}>{t('取消')}</button>
    </form>}
    {comparing && <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('对比试画结果')} className="fixed inset-0 z-[180] flex flex-col bg-white p-3 dark:bg-gray-950">
      <header className="mb-2 flex items-center justify-between"><strong>{t('对比试画结果')}</strong><IconButton label={t('关闭')} onClick={() => closeComparison()}><X /></IconButton></header>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        {pair.map((id, side) => { const item = results[id]; return <section key={side} className="flex min-h-0 min-w-0 flex-col gap-2">
          <select aria-label={t(side ? '右侧试画分区' : '左侧试画分区')} value={id} onChange={event => setPair(previous => side ? [previous[0], event.target.value] : [event.target.value, previous[1]])} className="rounded border p-2 text-sm dark:bg-gray-900">
            {trials.map(trial => <option key={trial.id} value={trial.id}>{trial.name}</option>)}
          </select>
          {item ? <button type="button" className="flex min-h-0 flex-1 items-center justify-center overflow-hidden" aria-label={t('放大查看：{0}', [trials.find(trial => trial.id === id)?.name || ''])} onClick={() => setZoom(item)}><img data-safe-mode-work="true" src={item.imageUrl} alt={trials.find(trial => trial.id === id)?.name} className="max-h-full max-w-full object-contain" /></button>
            : <div className="flex flex-1 items-center justify-center text-sm text-gray-500">{t('此分区还没有本次试画结果')}</div>}
        </section>; })}
      </div>
    </div>}
    {zoom && <ImageLightbox src={zoom.imageUrl} alt={t('试画结果')} generationData={{ prompt: zoom.prompt, negativePrompt: zoom.negativePrompt, params: zoom.params }} onClose={() => setZoom(undefined)} />}
  </>;
}
