import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownUp, CalendarDays, ChevronDown, Heart, Shuffle, SlidersHorizontal } from 'lucide-react';
import { HISTORY_SORT_LABELS, type HistoryBrowseOrder, type HistoryBrowseQuery, type HistorySort } from '../services/historyBrowse';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { createUuid } from '../services/id';
import { ToolbarButton, ToolbarSelect } from './DesignSystem';
import { MobileBottomSheet } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { AnchoredToolbarPopover, TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import './historyToolbar.css';

interface Props {
  query: HistoryBrowseQuery;
  options: Omit<HistoryBrowseOrder, 'ids'>;
  mobile: boolean;
  onApply: (query: HistoryBrowseQuery) => void;
}
type Panel = 'date' | 'more' | null;
const isCompactToolbar = (width: number) => width < 43.75 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
const dateValue = (value?: number) => {
  if (value === undefined) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateBounds = (dates: { from: string; to: string }) => ({
  from: dates.from ? new Date(`${dates.from}T00:00:00`).getTime() : undefined,
  to: dates.to ? new Date(`${dates.to}T23:59:59.999`).getTime() : undefined,
});
const recentDates = (days: number) => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { from: dateValue(start.getTime()), to: dateValue(end.getTime()) };
};
const getDateLabel = (query: HistoryBrowseQuery) => {
  const from = dateValue(query.from), to = dateValue(query.to);
  const short = (value: string) => value.startsWith(`${new Date().getFullYear()}-`) ? value.slice(5).replace('-', '/') : value.replaceAll('-', '/');
  if (!from && !to) return '全部时间';
  if (from === to) return short(from);
  return `${from ? short(from) : '不限'}–${to ? short(to) : '至今'}`;
};

/** 范围在前、浏览方式在后；只有窄工作区才把日期收回更多筛选。 */
export const HistoryBrowseControls: React.FC<Props> = ({ query, options, mobile, onApply }) => {
  const [panel, setPanel] = useState<Panel>(null);
  const [compact, setCompact] = useState(() => isCompactToolbar(window.innerWidth));
  const [draft, setDraft] = useState({ search: query.search || '', model: query.model || '', operation: query.operation || '', source: query.source || '' });
  const [dates, setDates] = useState({ from: '', to: '' });
  const [error, setError] = useState('');
  const controls = useRef<HTMLDivElement>(null);
  const dateAnchor = useRef<HTMLDivElement>(null);
  const moreAnchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = controls.current?.closest('.history-toolbar-shell') || controls.current;
    if (!shell) return;
    let previousCompact: boolean | undefined;
    let measuredWidth = shell.getBoundingClientRect().width || window.innerWidth;
    const update = (width: number) => {
      measuredWidth = width;
      const next = isCompactToolbar(width);
      setCompact(previous => previous === next ? previous : next);
      // 收纳形态变化时取消未应用草稿，避免隐藏日期后悄悄丢弃或应用它。
      if (previousCompact !== undefined && previousCompact !== next) setPanel(null);
      previousCompact = next;
    };
    const measure = () => update(shell.getBoundingClientRect().width || window.innerWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
      update(entries[0]?.contentRect.width || shell.getBoundingClientRect().width || window.innerWidth);
    });
    observer?.observe(shell);
    const themeObserver = new MutationObserver(() => update(shell.getBoundingClientRect().width || measuredWidth));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-scale', 'data-density', 'style'] });
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); themeObserver.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const start = (next: Exclude<Panel, null>) => {
    setDraft({ search: query.search || '', model: query.model || '', operation: query.operation || '', source: query.source || '' });
    setDates({ from: dateValue(query.from), to: dateValue(query.to) });
    setError(''); setPanel(previous => previous === next ? null : next);
  };
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if ((panel === 'date' || compact) && dates.from && dates.to && dates.from > dates.to) {
      setError('开始日期不能晚于结束日期'); return;
    }
    // 只合并本面板负责的条件，保留当前排序、随机种子、收藏及其他范围。
    onApply({ ...query, ...(panel === 'more' ? draft : {}), ...(panel === 'date' || compact ? dateBounds(dates) : {}) });
    setPanel(null);
  };
  const quickDate = (next: { from: string; to: string }) => {
    setDates(next); setError('');
    if (panel === 'date') { onApply({ ...query, ...dateBounds(next) }); setPanel(null); }
  };
  const dateFields = <div className="space-y-3">
    <div className="flex gap-2">
      <ToolbarButton type="button" onClick={() => quickDate(recentDates(1))}>今天</ToolbarButton>
      <ToolbarButton type="button" onClick={() => quickDate(recentDates(7))}>近 7 天</ToolbarButton>
      <ToolbarButton type="button" onClick={() => quickDate({ from: '', to: '' })}>不限日期</ToolbarButton>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs font-semibold">开始日期<input type="date" aria-label="开始日期" className={TOOLBAR_FIELD_CLASS} value={dates.from} onChange={event => setDates(value => ({ ...value, from: event.target.value }))} /></label>
      <label className="text-xs font-semibold">结束日期<input type="date" aria-label="结束日期" className={TOOLBAR_FIELD_CLASS} value={dates.to} onChange={event => setDates(value => ({ ...value, to: event.target.value }))} /></label>
    </div>
  </div>;
  const moreCount = Number(Boolean(query.search?.trim())) + Number(Boolean(query.model)) + Number(Boolean(query.operation)) + Number(Boolean(query.source)) + Number(compact && (query.from !== undefined || query.to !== undefined));
  const form = <form onSubmit={apply} className="space-y-4">
    {panel === 'date' ? dateFields : <>
      {compact && <fieldset className="space-y-2"><legend className="mb-2 text-xs font-semibold">时间范围 · {getDateLabel(query)}</legend>{dateFields}</fieldset>}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold">模型<select aria-label="历史模型" className={TOOLBAR_FIELD_CLASS} value={draft.model} onChange={event => setDraft(value => ({ ...value, model: event.target.value }))}><option value="">全部模型</option>{options.models.map(model => <option key={model} value={model}>{getNaiModelDisplayLabel(model)}</option>)}</select></label>
        <label className="text-xs font-semibold">生成方式<select aria-label="历史生成方式" className={TOOLBAR_FIELD_CLASS} value={draft.operation} onChange={event => setDraft(value => ({ ...value, operation: event.target.value }))}>{[['', '全部方式'], ['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label className="block text-xs font-semibold">来源<select aria-label="历史来源" className={TOOLBAR_FIELD_CLASS} value={draft.source} onChange={event => setDraft(value => ({ ...value, source: event.target.value }))}><option value="">全部来源</option>{options.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="block text-xs font-semibold">提示词包含<input className={TOOLBAR_FIELD_CLASS} value={draft.search} onChange={event => setDraft(value => ({ ...value, search: event.target.value }))} placeholder="可选关键词…" maxLength={500} /></label>
    </>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <div className="flex items-center justify-between gap-2">
      {panel === 'more' ? <button type="button" className="min-h-10 text-xs font-semibold text-gray-500 dark:text-gray-400" onClick={() => {
        setDraft({ search: '', model: '', operation: '', source: '' });
        if (compact) setDates({ from: '', to: '' });
        setError('');
      }}>重置更多筛选</button> : <span />}
      <ToolbarButton type="submit" tone="primary">{panel === 'date' ? '应用日期' : '应用筛选'}</ToolbarButton>
    </div>
  </form>;
  const title = panel === 'date' ? '时间范围' : '更多筛选';
  const chronologicalSort = query.sort === 'favorite' && !query.favoriteOnly ? 'newest' : query.sort || 'newest';
  return <div ref={controls} className="history-browse-controls">
    {!compact && <div ref={dateAnchor} className="history-date-anchor">
      <ToolbarButton aria-label={`时间范围：${getDateLabel(query)}`} aria-expanded={panel === 'date'} aria-haspopup="dialog" title={[dateValue(query.from), dateValue(query.to)].filter(Boolean).join(' 至 ') || '全部时间'} onClick={() => start('date')} className="history-date-button">
        <CalendarDays /><span className="truncate">{getDateLabel(query)}</span><ChevronDown />
      </ToolbarButton>
    </div>}
    <ToolbarButton aria-label="只看收藏" aria-pressed={Boolean(query.favoriteOnly)} tone={query.favoriteOnly ? 'favorite' : 'neutral'} title="只看收藏" className="history-icon-compact" onClick={() => {
      const favoriteOnly = !query.favoriteOnly;
      onApply({ ...query, favoriteOnly, sort: !favoriteOnly && query.sort === 'favorite' ? 'newest' : query.sort });
    }}><Heart className={query.favoriteOnly ? 'fill-current' : ''} /><span className="history-button-label">只看收藏</span></ToolbarButton>
    <div ref={moreAnchor}>
      <ToolbarButton aria-label={`更多筛选${moreCount ? ` ${moreCount}` : ''}`} aria-expanded={panel === 'more'} aria-haspopup="dialog" title={`更多筛选${compact ? ` · ${getDateLabel(query)}` : ''}`} onClick={() => start('more')} active={moreCount > 0} className="history-more-button">
        <SlidersHorizontal /><span className="history-more-label">更多筛选</span>{moreCount > 0 && <span className="history-more-count text-xs tabular-nums">{moreCount}</span>}<ChevronDown className="history-more-chevron" />
      </ToolbarButton>
    </div>
    <span aria-hidden="true" className="history-toolbar-divider" />
    <ToolbarSelect label="历史排序" icon={<ArrowDownUp />} value={chronologicalSort} containerClassName="history-sort-control" onChange={event => onApply({ ...query, sort: event.target.value as HistorySort, seed: undefined })}>
      <option value="newest">{HISTORY_SORT_LABELS.newest}</option><option value="oldest">{HISTORY_SORT_LABELS.oldest}</option>
      {query.favoriteOnly && <option value="favorite">{HISTORY_SORT_LABELS.favorite}</option>}
      {query.sort === 'random' && <option value="random" disabled>随机顺序</option>}
    </ToolbarSelect>
    <ToolbarButton aria-label={query.sort === 'random' ? '重新洗牌' : '随机浏览'} title={query.sort === 'random' ? '重新洗牌' : '随机浏览'} className="history-icon-compact history-random-button" onClick={() => onApply({ ...query, sort: 'random', seed: createUuid() })}><Shuffle /><span className="history-button-label">{query.sort === 'random' ? '重新洗牌' : '随机浏览'}</span></ToolbarButton>
    {panel && !mobile && <AnchoredToolbarPopover anchorRef={panel === 'date' ? dateAnchor : moreAnchor} title={title} width={380} onClose={() => setPanel(null)}>{form}</AnchoredToolbarPopover>}
    {mobile && <ImagePreviewPortal><MobileBottomSheet open={panel !== null} title={title} onClose={() => setPanel(null)}>{form}</MobileBottomSheet></ImagePreviewPortal>}
  </div>;
};
