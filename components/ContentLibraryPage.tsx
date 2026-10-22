import { t, useLanguage } from '../services/i18n';
import React, { Suspense, useEffect, useId, useState } from 'react';
import { ClipboardPaste, Dice5, X } from 'lucide-react';
import { IconButton, ToolbarButton, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { PromptCaptureDialog } from './PromptCaptureDialog';

export type ContentLibrarySection = 'items' | 'saved';

const SECTIONS: ReadonlyArray<readonly [ContentLibrarySection, string]> = [
  ['items', '条目库'],
  ['saved', '组合库'],
];

interface ContentLibraryPageProps {
  section: ContentLibrarySection;
  onSectionChange: (section: ContentLibrarySection) => void;
  active?: boolean;
  rollOpen: boolean;
  rollTitle?: string;
  onRollOpenChange: (open: boolean) => void;
  onCapture?: (text: string, name: string, category: string) => Promise<void>;
  /** 分区按需挂载，只有当前分区把操作挂到共用顶栏。 */
  items: (toolbarSlot: HTMLElement | null) => React.ReactNode;
  roll: (toolbarSlot: HTMLElement | null) => React.ReactNode;
  saved: (toolbarSlot: HTMLElement | null) => React.ReactNode;
}

const Loading = () => <div className="flex flex-1 items-center justify-center text-sm text-gray-400">{t('加载中…')}</div>;

const RollDialog: React.FC<{ open: boolean; title?: string; onClose: () => void; children: ContentLibraryPageProps['roll'] }> = ({ open, title = 'Roll 组合', onClose, children }) => {
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialogRef.current)) {
        event.preventDefault(); onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dialogRef]);
  return <div hidden={!open} className={open ? 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4' : 'hidden'}
    onClick={event => { if (event.target === event.currentTarget && isTopmostModal(dialogRef.current)) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t(title)}
      className="content-library content-roll-dialog appearance-panel flex h-dvh w-full flex-col overflow-hidden border border-gray-200 bg-gray-50 shadow-2xl dark:border-gray-700 dark:bg-gray-950 sm:h-[min(900px,90dvh)] sm:max-w-[1400px] sm:rounded-2xl">
      <header className="appearance-surface flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <Dice5 className="h-5 w-5 text-indigo-500" /><h2 className="flex-1 text-sm font-semibold">{t(title)}</h2>
        <IconButton label="关闭搭配面板" onClick={onClose}><X /></IconButton>
      </header>
      <div ref={setToolbarSlot} className="content-roll-dialog-tools flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800" />
      <Suspense fallback={<Loading />}>{children(toolbarSlot)}</Suspense>
    </div>
  </div>;
};

/** 两种资源常驻，搭配按需打开；隐藏面板保留本次草稿和原列表位置。 */
export const ContentLibraryPage: React.FC<ContentLibraryPageProps> = ({ section, onSectionChange, active = true, rollOpen, rollTitle, onRollOpenChange, onCapture, items, roll, saved }) => {
  useLanguage();
  const id = useId();
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState<ReadonlySet<ContentLibrarySection>>(() => new Set([section]));
  const [rollMounted, setRollMounted] = useState(rollOpen);
  const [captureOpen, setCaptureOpen] = useState(false);
  useEffect(() => {
    setMounted(previous => previous.has(section) ? previous : new Set(previous).add(section));
  }, [section]);
  useEffect(() => { if (rollOpen) setRollMounted(true); }, [rollOpen]);
  const pane = (key: ContentLibrarySection, node: () => React.ReactNode) => mounted.has(key)
    ? <div role="tabpanel" hidden={section !== key} id={`${id}-${key}-panel`} aria-labelledby={`${id}-${key}-tab`} data-content-library-pane={key} className={section === key ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><Suspense fallback={<Loading />}>{node()}</Suspense></div>
    : null;
  return <div className="content-library workspace-canvas flex min-h-0 flex-1 flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
    <WorkspaceChrome>
      <WorkspaceToolbar className="content-library-toolbar">
        <div role="tablist" aria-label={t('内容库分区')} className="appearance-segmented flex h-11 shrink-0 gap-1 rounded-xl border border-gray-200 bg-gray-100/80 p-0.5 dark:border-gray-800 dark:bg-gray-900/80 sm:h-9">
          {SECTIONS.map(([key, label], index) => <button key={key} id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`} type="button" role="tab" aria-selected={section === key} tabIndex={section === key ? 0 : -1}
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
        <div ref={setToolbarSlot} className="content-library-tools flex min-w-0 flex-1 items-center gap-2" />
        {onCapture && <ToolbarButton onClick={() => setCaptureOpen(true)} aria-label={t('粘贴收录')} aria-haspopup="dialog"><ClipboardPaste /><span className="hidden sm:inline">{t('粘贴收录')}</span></ToolbarButton>}
        <ToolbarButton tone="primary" className="content-library-roll-action" onClick={() => onRollOpenChange(true)} aria-haspopup="dialog"><Dice5 /><span>{t('Roll 组合')}</span></ToolbarButton>
      </WorkspaceToolbar>
    </WorkspaceChrome>
    {/* 滚动由嵌入分区自己的 workspace-scroll-viewport 承担，这里只负责留出顶栏高度。 */}
    <div className="content-library-body flex min-h-0 flex-1 flex-col">
      {pane('items', () => items(section === 'items' ? toolbarSlot : null))}
      {pane('saved', () => saved(section === 'saved' ? toolbarSlot : null))}
    </div>
    {rollMounted && <ImagePreviewPortal><RollDialog title={rollTitle} open={active && rollOpen} onClose={() => onRollOpenChange(false)}>{roll}</RollDialog></ImagePreviewPortal>}
    {onCapture && <ImagePreviewPortal><PromptCaptureDialog open={active && captureOpen} onClose={() => setCaptureOpen(false)} onSave={onCapture} /></ImagePreviewPortal>}
  </div>;
};
