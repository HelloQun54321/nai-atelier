import React, { useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import { t } from '../services/i18n';
import { ToolbarButton } from './DesignSystem';
import { AnchoredToolbarPopover } from './ToolbarPopover';

/**
 * 分页列表的跳页入口。固定在顶栏，不会像列表末尾那个表单一样被无限加载推离视口；
 * 桌面与手机共用同一个锚定浮层，手机由浮层自身受视口约束。
 */
export const ListJumpButton: React.FC<{
  page: number;
  /** 已知总页数；游标分页页面的总页数未知，传 null 只显示当前页。 */
  totalPages?: number | null;
  disabled?: boolean;
  onJump: (page: number) => void | Promise<void>;
}> = ({ page, totalPages = null, disabled = false, onJump }) => {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  if (totalPages !== null && totalPages <= 1) return null;
  const maximum = totalPages ?? Number.MAX_SAFE_INTEGER;
  const label = totalPages === null ? t('第 {0} 页', [page]) : t('第 {0} / {1} 页', [page, totalPages]);
  const jump = (target: number) => {
    setOpen(false);
    setDraft('');
    if (!Number.isFinite(target) || target < 1 || target > maximum) return;
    void onJump(Math.floor(target));
  };
  const submit = () => {
    const value = Math.floor(Number(draft));
    if (!Number.isFinite(value) || value < 1 || value > maximum) return;
    jump(value);
  };
  return <div ref={anchor} className="relative flex-none">
    <ToolbarButton
      active={open}
      disabled={disabled}
      onClick={() => setOpen(value => !value)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={label}
      title={totalPages === null ? t('跳到第 {0} 页', [page]) : t('跳到第 {0} / {1} 页', [page, totalPages])}
    >
      <Hash className="h-4 w-4" /><span className="hidden xl:inline">{label}</span>
    </ToolbarButton>
    {open && <AnchoredToolbarPopover anchorRef={anchor} title={t('跳转页码')} width={300} allowMobile compact onClose={() => setOpen(false)}>
      <div className="space-y-3">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <button type="button" onClick={() => jump(1)} className="mobile-touch rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold dark:border-gray-600">{t('首页')}</button>
          <input
            type="number" min={1} max={totalPages ?? undefined} value={draft} autoFocus
            placeholder={totalPages === null ? String(page) : `${page} / ${totalPages}`} aria-label={t('输入页码跳转')}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
            className="h-9 min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button type="button" disabled={totalPages === null} onClick={() => totalPages !== null && jump(totalPages)} className="mobile-touch rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-40 dark:border-gray-600">{t('尾页')}</button>
        </div>
        <button type="button" disabled={!draft.trim()} onClick={submit} className="mobile-touch w-full rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90">{t('跳转')}</button>
      </div>
    </AnchoredToolbarPopover>}
  </div>;
};
