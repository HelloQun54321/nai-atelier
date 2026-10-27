import React, { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';

export interface SearchFilterChipData {
  key: string;
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}

export const SearchFilterChip: React.FC<{ chip: SearchFilterChipData; hidden?: boolean; onRemoved?: () => void }> = ({ chip, hidden, onRemoved }) => (
  <button type="button" data-search-filter-chip={chip.key} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}
    style={hidden ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } : undefined}
    onClick={() => { chip.onRemove(); onRemoved?.(); }} disabled={chip.disabled}
    aria-label={t('移除筛选：{0}', [chip.label])} title={chip.label}
    className="mobile-touch inline-flex h-8 w-max max-w-56 flex-none items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50/70 pl-2.5 pr-1.5 text-xs font-medium text-indigo-700 hover:border-indigo-300 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200 md:h-6">
    <span className="truncate">{chip.label}</span><X aria-hidden="true" className="h-3.5 w-3.5 flex-none opacity-70" />
  </button>
);

/** 依真实宽度收纳条件，输入优先占位；只在原有筛选面板展开完整条件。 */
export const SearchFilterChips: React.FC<{ chips: SearchFilterChipData[]; expanded: boolean; onMore: () => void }> = ({ chips, expanded, onMore }) => {
  useLanguage();
  const rail = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(chips.length);
  const signature = chips.map(chip => `${chip.key}:${chip.label}`).join('|');
  useLayoutEffect(() => {
    const node = rail.current, field = node?.parentElement;
    if (!node || !field) return;
    const update = () => {
      const width = field.clientWidth;
      if (!width) { setVisibleCount(node.querySelectorAll('[data-search-filter-chip]').length); return; }
      const style = getComputedStyle(field);
      const available = width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(getComputedStyle(node).columnGap) || 6;
      const widths = Array.from(node.querySelectorAll<HTMLElement>('[data-search-filter-chip]')).map(chip => chip.offsetWidth);
      const moreWidth = more.current?.offsetWidth || 44;
      const budget = Math.max(moreWidth, Math.min(available * .6, available - Math.min(128, available * .5)));
      let count = widths.length;
      if (widths.reduce((sum, item) => sum + item, 0) + Math.max(0, widths.length - 1) * gap > budget) {
        let used = moreWidth;
        count = 0;
        while (count < widths.length && used + gap + widths[count] <= budget) { used += gap + widths[count]; count++; }
      }
      setVisibleCount(previous => previous === count ? previous : count);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(field);
    for (const child of Array.from(node.children)) observer?.observe(child);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [signature]);
  if (!chips.length) return null;
  const hiddenCount = Math.max(0, chips.length - visibleCount);
  return <div ref={rail} role="group" aria-label={t('已生效的筛选条件')} aria-hidden={expanded || undefined} className="relative flex flex-none items-center gap-1.5 overflow-hidden whitespace-nowrap">
    {chips.map((chip, index) => <SearchFilterChip key={chip.key} chip={chip} hidden={index >= visibleCount} onRemoved={() => rail.current?.parentElement?.querySelector('input')?.focus()} />)}
    <button ref={more} type="button" aria-label={t('查看其余 {0} 个筛选条件', [hiddenCount])} aria-haspopup="dialog" aria-expanded={expanded}
      onClick={onMore} tabIndex={hiddenCount ? undefined : -1} aria-hidden={!hiddenCount || undefined}
      style={!hiddenCount ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } : undefined}
      className="mobile-touch inline-flex h-8 flex-none items-center justify-center rounded-full px-2 text-xs font-bold text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 md:h-6">+{hiddenCount}</button>
  </div>;
};
