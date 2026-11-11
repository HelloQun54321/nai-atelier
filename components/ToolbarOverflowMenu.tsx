import React, { useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { t } from '../services/i18n';
import { ToolbarButton } from './DesignSystem';
import { AnchoredToolbarPopover } from './ToolbarPopover';
import type { ToolbarOverflowItem } from './MobileUI';

/**
 * 桌面顶栏的「更多操作」入口：与手机同一个条目模型，桌面用锚定浮层而不是底部弹层。
 * 顶栏常驻只留搜索、筛选、主操作与开关类控件，低频动作收进这里。
 */
export const ToolbarOverflowMenu: React.FC<{
  items: ToolbarOverflowItem[];
  label?: string;
  className?: string;
}> = ({ items, label = '更多操作', className = '' }) => {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const entries = items.filter(Boolean);
  if (!entries.length) return null;
  return <div ref={anchor} className={`relative flex-none ${className}`}>
    <ToolbarButton
      aria-label={t(label)}
      title={t(label)}
      aria-haspopup="dialog"
      aria-expanded={open}
      active={open}
      onClick={() => setOpen(value => !value)}
    >
      <MoreVertical className="h-4 w-4" />
    </ToolbarButton>
    {open && <AnchoredToolbarPopover anchorRef={anchor} title={t(label)} width={260} allowMobile compact onClose={() => setOpen(false)}>
      <div className="space-y-1">
        {entries.map(item => <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => { setOpen(false); item.onClick(); }}
          className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors disabled:opacity-40 ${item.tone === 'danger' ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
        >
          {item.icon && <span className="flex h-5 w-5 flex-none items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{t(item.label)}</span>
            {item.hint && <span className="mt-0.5 block truncate text-xs font-normal text-gray-500 dark:text-gray-400">{t(item.hint)}</span>}
          </span>
        </button>)}
      </div>
    </AnchoredToolbarPopover>}
  </div>;
};
