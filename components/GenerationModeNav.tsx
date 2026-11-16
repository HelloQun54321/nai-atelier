import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { GenerationMode } from '../types';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { MobileBottomSheet } from './MobileUI';

const GENERATION_MODES: { mode: GenerationMode; label: string }[] = [
  { mode: 'text-to-image', label: '文生图' },
  { mode: 'image-to-image', label: '图生图' },
  { mode: 'inpaint', label: '局部重绘' },
  { mode: 'outpaint', label: '扩图' },
];

interface GenerationModeNavProps {
  activeMode: GenerationMode;
  onSelect: (mode: GenerationMode) => void | Promise<void>;
  /** 生成进行中禁用模式切换：native disabled 拦截点击，另加视觉降级。 */
  disabled?: boolean;
}

export const GenerationModeNav: React.FC<GenerationModeNavProps> = ({ activeMode, onSelect, disabled = false }) => {
  useLanguage();
  const modes = GENERATION_MODES;
  const active = modes.find(item => item.mode === activeMode) ?? modes[0];
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!isMobile) setSheetOpen(false);
  }, [isMobile]);

  // 手机：顶栏只显示当前模式，点开底部面板切换；避免四段文字与返回／保存挤成一级噪音。
  if (isMobile) {
    return <>
      <nav className="generation-mode-nav appearance-segmented mx-auto flex w-full min-w-0 max-w-3xl justify-center" aria-label={t('生成模式')} data-mode-chrome="compact">
        <button
          type="button"
          data-appearance="control"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-current="page"
          onClick={() => { if (!disabled) setSheetOpen(true); }}
          className="mobile-touch inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-xl border border-gray-200/60 bg-white px-3 py-1.5 text-sm font-bold text-indigo-600 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800/80 dark:bg-gray-800 dark:text-indigo-300"
        >
          <span className="min-w-0 truncate">{t(active.label)}</span>
          <ChevronDown className="h-4 w-4 flex-none opacity-70" aria-hidden="true" />
        </button>
      </nav>
      <ImagePreviewPortal>
        <MobileBottomSheet open={sheetOpen} title={t('生成模式')} onClose={() => setSheetOpen(false)}>
          <div role="listbox" aria-label={t('生成模式')} className="space-y-1">
            {modes.map(({ mode, label }) => {
              const selected = activeMode === mode;
              return <button
                key={mode}
                type="button"
                role="option"
                data-value={mode}
                aria-selected={selected}
                disabled={disabled}
                onClick={() => {
                  void onSelect(mode);
                  setSheetOpen(false);
                }}
                className={`mobile-touch flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-bold ${selected ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'} ${disabled ? 'opacity-50' : ''}`}
              >{t(label)}</button>;
            })}
          </div>
        </MobileBottomSheet>
      </ImagePreviewPortal>
    </>;
  }

  return <nav className="generation-mode-nav appearance-segmented mx-auto grid w-full max-w-3xl grid-cols-4 gap-1 rounded-xl border border-gray-200/60 bg-gray-100/90 p-1 dark:border-gray-800/80 dark:bg-gray-900/90" aria-label={t('生成模式')} data-mode-chrome="segmented">
    {modes.map(({ mode, label }) => (
      <button
        key={mode}
        type="button"
        data-appearance="control"
        disabled={disabled}
        aria-current={activeMode === mode ? 'page' : undefined}
        onClick={() => void onSelect(mode)}
        className={`mobile-touch min-w-0 whitespace-nowrap rounded-lg px-0 py-1.5 text-meta font-bold transition sm:px-3 sm:text-xs disabled:cursor-not-allowed disabled:opacity-50 ${activeMode === mode ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
      >
        {t(label)}
      </button>
    ))}
  </nav>;
};
