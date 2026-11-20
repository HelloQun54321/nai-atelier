import React from 'react';
import { t, useLanguage } from '../services/i18n';

/** 大数字只留概数：统一用 k／M，避免顶栏被一长串数字撑开。 */
export const compactCount = (value: number) => {
  const trim = (input: number) => input.toFixed(input >= 100 ? 0 : 1).replace(/\.0$/, '');
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return String(value);
};

/** 顶栏计数：inline 形态嵌在搜索框尾部显示单行柔和结果数；无搜索框页面沿用独立竖排分数，只有一个数字时只显示单值。 */
export const ToolbarCountBadge: React.FC<{ loaded?: number; total?: number; hint?: string; inline?: boolean; className?: string }> = ({ loaded, total, hint, inline = false, className = '' }) => {
  useLanguage();
  const hasTotal = typeof total === 'number' && Number.isFinite(total);
  const hasLoaded = typeof loaded === 'number' && Number.isFinite(loaded);
  if (!hasTotal && !hasLoaded) return null;
  const fraction = hasLoaded && hasTotal && loaded !== total;
  const single = hasLoaded && hasTotal ? total : hasTotal ? total : loaded;
  const title = hint || (hasLoaded && hasTotal ? t('已加载 {0} / 共 {1}', [loaded, total]) : hasTotal ? t('共 {0}', [total]) : t('已加载 {0}', [loaded]));
  if (inline) {
    return <span data-toolbar-count-badge="true" data-inline="true" title={title} aria-label={title}
      className={`hidden flex-none select-none items-center gap-0.5 whitespace-nowrap pr-2 text-xs font-medium leading-none tabular-nums text-gray-400 dark:text-gray-400 md:inline-flex ${className}`}>
      {fraction ? <>
        <span>{compactCount(loaded as number)}</span>
        <span aria-hidden="true" className="opacity-60">/</span>
        <span>{compactCount(total as number)}</span>
      </> : <span>{compactCount(single as number)}</span>}
    </span>;
  }
  // 手机顶栏空间紧，不在文件夹旁常驻数字；电脑保留竖排「已加载／总数」徽标。
  return <span data-toolbar-count-badge="true" title={title} aria-label={title}
    className={`hidden flex-none select-none flex-col items-center justify-center font-semibold leading-none tabular-nums md:flex ${fraction ? 'text-micro' : 'text-xs'} text-gray-500 dark:text-gray-300 ${className}`}>
    {fraction ? <>
      <span>{compactCount(loaded as number)}</span>
      <span aria-hidden="true" className="my-[2px] h-px w-full bg-current opacity-40" />
      <span>{compactCount(total as number)}</span>
    </> : <span>{compactCount(single as number)}</span>}
  </span>;
};
