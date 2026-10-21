import React, { useEffect, useRef, useState } from 'react';
import { t } from '../services/i18n';
import { prepareThemeBackground, themeBackgroundStyle, type ThemeBackground, type BackgroundMode } from '../services/themeBackground';
import { SegmentedControl, ToolbarButton, ToolbarSelect } from './DesignSystem';

export const AppearanceBackgroundEditor: React.FC<{ background?: ThemeBackground; mode?: BackgroundMode; onModeChange?: (mode: BackgroundMode) => void; onReset?: () => void; onChange: (background: ThemeBackground | undefined) => boolean }> = ({ background, mode = 'light', onModeChange, onReset, onChange }) => {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { request.current++; setBusy(false); setError(''); }, [mode]);
  const change = (value: ThemeBackground | undefined) => {
    setError(onChange(value) ? '' : '外观存储空间不足，请缩小背景或减少已保存的主题');
  };
  const upload = async (file: File) => {
    const current = ++request.current;
    setBusy(true); setError('');
    try {
      const value = await prepareThemeBackground(file);
      if (current === request.current) change(value);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : '无法读取背景图片，请检查文件');
    } finally { if (current === request.current) setBusy(false); }
  };
  return <details className="appearance-group mt-4 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
    <summary className="cursor-pointer text-xs font-bold text-gray-700 dark:text-gray-200">{t('工作区背景')}</summary>
    {onModeChange && <div className="mt-3"><SegmentedControl ariaLabel={t('背景明暗版本')} options={[{ value: 'light', label: '浅色背景' }, { value: 'dark', label: '深色背景' }]} value={mode} onChange={onModeChange} />
      <p className="mt-2 text-meta text-gray-500 dark:text-gray-400">{t('每个预设的明暗背景单独记住，重新应用预设不会覆盖。')}</p></div>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('选择背景图片')} className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} />
      <ToolbarButton disabled={busy} onClick={() => input.current?.click()}>{t(busy ? '正在处理背景…' : background ? '更换背景图片' : '选择背景图片')}</ToolbarButton>
      {background && <ToolbarButton disabled={busy} onClick={() => change(undefined)}>{t('移除背景图片')}</ToolbarButton>}
      {onReset && <ToolbarButton disabled={busy} onClick={onReset}>{t('恢复默认背景')}</ToolbarButton>}
    </div>
    {background && <>
      <div aria-hidden="true" className="relative isolate mt-3 h-24 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700" style={{ backgroundColor: 'var(--nai-canvas)' }}>
        <div className="theme-background-preview pointer-events-none absolute inset-0 -z-10" style={{ ...themeBackgroundStyle(background, 'var(--nai-canvas)'), '--nai-background-blur': '6px' } as React.CSSProperties & { '--nai-background-blur': string }} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-meta text-gray-600 dark:text-gray-300">{t('背景显示方式')}<ToolbarSelect label="背景显示方式" value={background.fit} onChange={event => change({ ...background, fit: event.target.value as ThemeBackground['fit'] })} containerClassName="mt-1 w-full">
          <option value="cover">{t('铺满')}</option><option value="contain">{t('完整显示')}</option><option value="tile">{t('平铺图案')}</option>
        </ToolbarSelect></label>
        <label className="text-meta text-gray-600 dark:text-gray-300">{t('背景显示强度')} · {Math.round(background.opacity * 100)}%<input aria-label={t('背景显示强度')} type="range" min="0" max="100" value={Math.round(background.opacity * 100)} onChange={event => change({ ...background, opacity: Number(event.target.value) / 100 })} className="mt-3 w-full accent-indigo-600" /></label>
        {background.fit === 'tile' && <label className="text-meta text-gray-600 dark:text-gray-300">{t('图案大小')} · {background.tileSize}px<input aria-label={t('图案大小')} type="range" min="32" max="1024" step="8" value={background.tileSize} onChange={event => change({ ...background, tileSize: Number(event.target.value) })} className="mt-3 w-full accent-indigo-600" /></label>}
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-meta text-red-600 dark:text-red-300">{t(error)}</p>}
  </details>;
};
