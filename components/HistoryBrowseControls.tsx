import React, { useRef, useState } from 'react';
import { Shuffle, SlidersHorizontal } from 'lucide-react';
import { HISTORY_SORT_LABELS, type HistoryBrowseOrder, type HistoryBrowseQuery, type HistorySort } from '../services/historyBrowse';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { createUuid } from '../services/id';
import { IconButton, ToolbarButton } from './DesignSystem';
import { MobileBottomSheet } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { AnchoredToolbarPopover } from './ToolbarPopover';

interface Props {
  query: HistoryBrowseQuery;
  options: Omit<HistoryBrowseOrder, 'ids'>;
  mobile: boolean;
  onApply: (query: HistoryBrowseQuery) => void;
}
const inputClass = 'mobile-touch mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800';
const dateValue = (value?: number) => {
  if (!value) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const HistoryBrowseControls: React.FC<Props> = ({ query, options, mobile, onApply }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(query);
  const [dates, setDates] = useState({ from: '', to: '' });
  const [error, setError] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const active = Boolean(query.from || query.to || query.search || query.model || query.operation || query.source);
  const start = () => {
    setDraft({ ...query }); setDates({ from: dateValue(query.from), to: dateValue(query.to) }); setError(''); setOpen(value => !value);
  };
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (dates.from && dates.to && dates.from > dates.to) { setError('开始日期不能晚于结束日期'); return; }
    const next = {
      ...draft,
      from: dates.from ? new Date(`${dates.from}T00:00:00`).getTime() : undefined,
      to: dates.to ? new Date(`${dates.to}T23:59:59.999`).getTime() : undefined,
      sort: draft.sort === 'favorite' && !draft.favoriteOnly ? 'newest' as const : draft.sort,
      seed: draft.sort === 'random' ? draft.seed || createUuid() : undefined,
    };
    onApply(next); setOpen(false);
  };
  const form = <form onSubmit={apply} className="space-y-4 p-1">
    <label className="block text-xs font-semibold">搜索提示词或来源名称<input autoFocus className={inputClass} value={draft.search || ''} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="输入关键词…" maxLength={500} /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs font-semibold">排序<select aria-label="历史排序" className={inputClass} value={draft.sort || 'newest'} onChange={event => setDraft(value => ({ ...value, sort: event.target.value as HistorySort }))}>{Object.entries(HISTORY_SORT_LABELS).filter(([key]) => key !== 'favorite' || draft.favoriteOnly).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">模型<select aria-label="历史模型" className={inputClass} value={draft.model || ''} onChange={event => setDraft(value => ({ ...value, model: event.target.value }))}><option value="">全部模型</option>{options.models.map(model => <option key={model} value={model}>{getNaiModelDisplayLabel(model)}</option>)}</select></label>
      <label className="text-xs font-semibold">生成方式<select aria-label="历史生成方式" className={inputClass} value={draft.operation || ''} onChange={event => setDraft(value => ({ ...value, operation: event.target.value }))}>{[['', '全部方式'], ['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">来源<select aria-label="历史来源" className={inputClass} value={draft.source || ''} onChange={event => setDraft(value => ({ ...value, source: event.target.value }))}><option value="">全部来源</option>{options.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="text-xs font-semibold">开始日期<input type="date" aria-label="开始日期" className={inputClass} value={dates.from} onChange={event => setDates(value => ({ ...value, from: event.target.value }))} /></label>
      <label className="text-xs font-semibold">结束日期<input type="date" aria-label="结束日期" className={inputClass} value={dates.to} onChange={event => setDates(value => ({ ...value, to: event.target.value }))} /></label>
    </div>
    <div className="flex gap-2"><ToolbarButton type="button" onClick={() => { const now = Date.now(); setDates({ from: dateValue(now), to: dateValue(now) }); }}>今天</ToolbarButton><ToolbarButton type="button" onClick={() => { const now = Date.now(); setDates({ from: dateValue(now - 6 * 86400000), to: dateValue(now) }); }}>近 7 天</ToolbarButton><ToolbarButton type="button" onClick={() => setDates({ from: '', to: '' })}>不限日期</ToolbarButton></div>
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.favoriteOnly)} onChange={event => setDraft(value => ({ ...value, favoriteOnly: event.target.checked, sort: !event.target.checked && value.sort === 'favorite' ? 'newest' : value.sort }))} />只看收藏</label>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <div className="flex justify-between gap-2"><ToolbarButton type="button" onClick={() => { setDraft({ sort: 'newest' }); setDates({ from: '', to: '' }); }}>重置条件</ToolbarButton><ToolbarButton type="submit" tone="primary">应用筛选</ToolbarButton></div>
  </form>;
  return <>
    <div ref={anchor} className="relative min-w-0">
      <ToolbarButton onClick={start} aria-expanded={open} aria-haspopup="dialog" className="max-w-full !min-w-0" title={[HISTORY_SORT_LABELS[query.sort || 'newest'], query.search, query.model && getNaiModelDisplayLabel(query.model), query.from && `从 ${dateValue(query.from)}`, query.to && `至 ${dateValue(query.to)}`].filter(Boolean).join(' · ')}><SlidersHorizontal /><span className="truncate">{HISTORY_SORT_LABELS[query.sort || 'newest']}{active ? ' · 已筛选' : ''}</span></ToolbarButton>
      {open && !mobile && <AnchoredToolbarPopover anchorRef={anchor} title="筛选与排序" width={380} onClose={() => setOpen(false)}>{form}</AnchoredToolbarPopover>}
    </div>
    {query.sort === 'random' && <IconButton label="重新洗牌" onClick={() => onApply({ ...query, seed: createUuid() })}><Shuffle /></IconButton>}
    {mobile && <ImagePreviewPortal><MobileBottomSheet open={open} title="筛选与排序" onClose={() => setOpen(false)}>{form}</MobileBottomSheet></ImagePreviewPortal>}
  </>;
};
