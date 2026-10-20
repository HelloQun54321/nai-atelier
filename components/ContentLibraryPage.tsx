import { t, useLanguage } from '../services/i18n';
import React, { Suspense, useEffect, useState } from 'react';
import { WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';

export type ContentLibrarySection = 'items' | 'roll' | 'saved';

const SECTIONS: ReadonlyArray<readonly [ContentLibrarySection, string]> = [
  ['items', '条目库'],
  ['roll', '一键 Roll'],
  ['saved', '已存组合'],
];

interface ContentLibraryPageProps {
  section: ContentLibrarySection;
  onSectionChange: (section: ContentLibrarySection) => void;
  /** 分区节点按需函数：只在首次进入该分区时渲染，避免一次加载三套页面。条目库接收顶栏工具槽。 */
  items: (toolbarSlot: HTMLElement | null) => React.ReactNode;
  roll: () => React.ReactNode;
  saved: () => React.ReactNode;
}

const Loading = () => <div className="flex flex-1 items-center justify-center text-sm text-gray-400">{t('加载中…')}</div>;

/**
 * 内容库：把「图片提示词库」「一键 Roll」「Roll 内容库」收进同一个入口与顶栏。
 * 条目库的搜索／筛选与三个分区共用一条可收起顶栏；分类作为二级侧栏。
 */
export const ContentLibraryPage: React.FC<ContentLibraryPageProps> = ({ section, onSectionChange, items, roll, saved }) => {
  useLanguage();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState<ReadonlySet<ContentLibrarySection>>(() => new Set([section]));
  useEffect(() => {
    setMounted(previous => previous.has(section) ? previous : new Set(previous).add(section));
  }, [section]);
  const pane = (key: ContentLibrarySection, node: () => React.ReactNode) => mounted.has(key)
    ? <div data-content-library-pane={key} className={section === key ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><Suspense fallback={<Loading />}>{node()}</Suspense></div>
    : null;
  return <div className="workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
    <WorkspaceChrome>
      <WorkspaceToolbar>
        <div role="tablist" aria-label={t('内容库分区')} className="appearance-segmented flex h-11 shrink-0 gap-1 rounded-xl border border-gray-200 bg-gray-100/80 p-0.5 dark:border-gray-800 dark:bg-gray-900/80 sm:h-9">
          {SECTIONS.map(([key, label], index) => <button key={key} type="button" role="tab" aria-selected={section === key} tabIndex={section === key ? 0 : -1}
            onClick={() => onSectionChange(key)}
            onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % SECTIONS.length
                : event.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              onSectionChange(SECTIONS[next][0]);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
            className={`appearance-segmented min-w-0 whitespace-nowrap rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-indigo-500 sm:px-3 ${section === key ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>
            {t(label)}
          </button>)}
        </div>
        {/* 条目库的搜索／筛选挂进同一条顶栏；其它分区只为它保留空位。 */}
        <div ref={setToolbarSlot} className="flex min-w-0 flex-1 items-center gap-2" />
      </WorkspaceToolbar>
    </WorkspaceChrome>
    {/* 滚动由嵌入分区自己的 workspace-scroll-viewport 承担，这里只负责留出顶栏高度。 */}
    <div className="content-library-body flex min-h-0 flex-1 flex-col">
      {pane('items', () => items(section === 'items' ? toolbarSlot : null))}
      {pane('roll', roll)}
      {pane('saved', saved)}
    </div>
  </div>;
};
