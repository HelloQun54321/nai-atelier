import { t, useLanguage } from '../services/i18n';
import React, { useRef, useState } from 'react';
import { Filter, Heart, Shuffle } from 'lucide-react';
import { HISTORY_SORT_LABELS, type HistoryBrowseOrder, type HistoryBrowseQuery, type HistorySort } from '../services/historyBrowse';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { createUuid } from '../services/id';
import { ToolbarButton } from './DesignSystem';
import { MobileBottomSheet } from './MobileUI';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { AnchoredToolbarPopover, FilterPanelFooter, FilterToggleButton, TOOLBAR_FIELD_CLASS, TOOLBAR_LABEL_CLASS } from './ToolbarPopover';
import './historyToolbar.css';

interface Props {
  query: HistoryBrowseQuery;
  options: Omit<HistoryBrowseOrder, 'ids'>;
  mobile: boolean;
  onApply: (query: HistoryBrowseQuery) => void;
}
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
  if (!from && !to) return t('全部时间');
  if (from === to) return short(from);
  return `${from ? short(from) : t('不限')}–${to ? short(to) : t('至今')}`;
};

/** 历史顶栏只留一个「筛选」入口：时间、收藏、模型、方式、来源、排序和随机浏览都收进同一层。 */
export const HistoryBrowseControls: React.FC<Props> = ({ query, options, mobile, onApply }) => {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ model: query.model || '', operation: query.operation || '', source: query.source || '' });
  const [dates, setDates] = useState({ from: dateValue(query.from), to: dateValue(query.to) });
  const [error, setError] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const openPanel = () => {
    setDraft({ model: query.model || '', operation: query.operation || '', source: query.source || '' });
    setDates({ from: dateValue(query.from), to: dateValue(query.to) });
    setError('');
    setOpen(true);
  };
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (dates.from && dates.to && dates.from > dates.to) {
      setError('开始日期不能晚于结束日期'); return;
    }
    // 日期输入未改动时保留原有时间戳，不把已应用的毫秒精度重算成当天边界。
    const datesChanged = dates.from !== dateValue(query.from) || dates.to !== dateValue(query.to);
    onApply({ ...query, ...draft, ...(datesChanged ? dateBounds(dates) : {}) });
    setOpen(false);
  };
  const quickDate = (next: { from: string; to: string }) => {
    setDates(next); setError('');
    onApply({ ...query, ...dateBounds(next) });
  };
  const reset = () => {
    setDraft({ model: '', operation: '', source: '' });
    setDates({ from: '', to: '' });
    setError('');
    onApply({ sort: 'newest', seed: undefined });
    setOpen(false);
  };
  const filterCount = Number(query.from !== undefined || query.to !== undefined)
    + Number(Boolean(query.favoriteOnly))
    + Number(Boolean(query.model))
    + Number(Boolean(query.operation))
    + Number(Boolean(query.source));
  const chronologicalSort = query.sort === 'favorite' && !query.favoriteOnly ? 'newest' : query.sort || 'newest';
  const form = <form onSubmit={apply} className="space-y-3.5">
    <FilterToggleButton
      active={Boolean(query.favoriteOnly)}
      tone="rose"
      icon={<Heart className={query.favoriteOnly ? 'fill-current' : ''} />}
      onClick={() => {
        const favoriteOnly = !query.favoriteOnly;
        onApply({ ...query, favoriteOnly, sort: !favoriteOnly && query.sort === 'favorite' ? 'newest' : query.sort });
      }}
    >
      {t("只看收藏")}
    </FilterToggleButton>
    <fieldset className="space-y-2">
      <legend className={TOOLBAR_LABEL_CLASS}>{t("时间范围 · {0}", [getDateLabel(query)])}</legend>
      <div className="flex gap-2">
        <ToolbarButton type="button" onClick={() => quickDate(recentDates(1))}>{t("今天")}</ToolbarButton>
        <ToolbarButton type="button" onClick={() => quickDate(recentDates(7))}>{t("近 7 天")}</ToolbarButton>
        <ToolbarButton type="button" onClick={() => quickDate({ from: '', to: '' })}>{t("不限日期")}</ToolbarButton>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={TOOLBAR_LABEL_CLASS}>{t("开始日期")}<input type="date" aria-label={t("开始日期")} className={TOOLBAR_FIELD_CLASS} value={dates.from} onChange={event => setDates(value => ({ ...value, from: event.target.value }))} /></label>
        <label className={TOOLBAR_LABEL_CLASS}>{t("结束日期")}<input type="date" aria-label={t("结束日期")} className={TOOLBAR_FIELD_CLASS} value={dates.to} onChange={event => setDates(value => ({ ...value, to: event.target.value }))} /></label>
      </div>
    </fieldset>
    <div className="grid grid-cols-2 gap-3">
      <label className={TOOLBAR_LABEL_CLASS}>{t("模型")}<select aria-label={t("历史模型")} className={TOOLBAR_FIELD_CLASS} value={draft.model} onChange={event => setDraft(value => ({ ...value, model: event.target.value }))}><option value="">{t("全部模型")}</option>{options.models.map(model => <option key={model} value={model}>{getNaiModelDisplayLabel(model)}</option>)}</select></label>
      <label className={TOOLBAR_LABEL_CLASS}>{t("生成方式")}<select aria-label={t("历史生成方式")} className={TOOLBAR_FIELD_CLASS} value={draft.operation} onChange={event => setDraft(value => ({ ...value, operation: event.target.value }))}>{[['', '全部方式'], ['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <label className={TOOLBAR_LABEL_CLASS}>{t("来源")}<select aria-label={t("历史来源")} className={TOOLBAR_FIELD_CLASS} value={draft.source} onChange={event => setDraft(value => ({ ...value, source: event.target.value }))}><option value="">{t("全部来源")}</option>{options.sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className={TOOLBAR_LABEL_CLASS}>{t("排序")}<select aria-label={t("历史排序")} className={TOOLBAR_FIELD_CLASS} value={chronologicalSort} onChange={event => onApply({ ...query, sort: event.target.value as HistorySort, seed: undefined })}>
        <option value="newest">{t(HISTORY_SORT_LABELS.newest)}</option><option value="oldest">{t(HISTORY_SORT_LABELS.oldest)}</option>
        {query.favoriteOnly && <option value="favorite">{t(HISTORY_SORT_LABELS.favorite)}</option>}
        {query.sort === 'random' && <option value="random" disabled>{t("随机顺序")}</option>}
      </select></label>
    </div>
    <ToolbarButton type="button" className="w-full" onClick={() => { onApply({ ...query, sort: 'random', seed: createUuid() }); setOpen(false); }}>
      <Shuffle />{query.sort === 'random' ? t("重新洗牌") : t("随机浏览")}
    </ToolbarButton>
    {error && <p role="alert" className="text-sm text-red-500">{t(error)}</p>}
    <FilterPanelFooter onReset={reset}>
      <ToolbarButton type="submit" tone="primary">{t("应用筛选")}</ToolbarButton>
    </FilterPanelFooter>
  </form>;
  return <div className="history-browse-controls">
    <div ref={anchor}>
      <ToolbarButton aria-label={t("筛选{0}", [filterCount ? ` ${filterCount}` : ''])} aria-expanded={open} aria-haspopup="dialog" title={t("筛选历史{0}", [filterCount ? ` · ${filterCount}` : ''])} onClick={openPanel} active={filterCount > 0} className="mobile-touch relative !px-2.5 md:!px-3">
        <Filter /><span className="history-button-label">{t("筛选")}</span>
        {filterCount > 0 && <span aria-hidden="true" data-filter-count={filterCount} className="pointer-events-none absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-mini font-bold leading-4 text-white ring-2 ring-white tabular-nums dark:ring-gray-900">{filterCount}</span>}
      </ToolbarButton>
    </div>
    {open && !mobile && <AnchoredToolbarPopover anchorRef={anchor} title={t("筛选")} width={360} onClose={() => setOpen(false)}>{form}</AnchoredToolbarPopover>}
    {open && mobile && <ImagePreviewPortal><MobileBottomSheet open title={t("筛选")} onClose={() => setOpen(false)}>{form}</MobileBottomSheet></ImagePreviewPortal>}
  </div>;
};
