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

const useCountParts = (loaded?: number, total?: number) => {
  const hasTotal = typeof total === 'number' && Number.isFinite(total);
  const hasLoaded = typeof loaded === 'number' && Number.isFinite(loaded);
  const fraction = hasLoaded && hasTotal && loaded !== total;
  const single = hasTotal ? total : loaded;
  return { hasTotal, hasLoaded, fraction, single };
};

/** 分数本身：分子在上、分母在下、中间一条细线；只有一个数字时就只显示它。 */
export const CountFraction: React.FC<{ loaded?: number; total?: number; hint?: string; className?: string }> = ({ loaded, total, hint, className = '' }) => {
  useLanguage();
  const { hasTotal, hasLoaded, fraction, single } = useCountParts(loaded, total);
  if (!hasTotal && !hasLoaded) return null;
  const title = hint || (hasLoaded && hasTotal ? t('已加载 {0} / 共 {1}', [loaded, total]) : hasTotal ? t('共 {0}', [total]) : t('已加载 {0}', [loaded]));
  return <span data-toolbar-count-badge="true" title={title} aria-label={title}
    className={`flex flex-none select-none flex-col items-center justify-center text-[10px] font-semibold leading-none tabular-nums ${className}`}>
    {fraction ? <>
      <span>{compactCount(loaded as number)}</span>
      <span aria-hidden="true" className="my-[2px] h-px w-full bg-current opacity-40" />
      <span>{compactCount(total as number)}</span>
    </> : <span>{compactCount(single as number)}</span>}
  </span>;
};

/** 独立徽标：带一块浅底和圆角，用于目录按钮无法改动结构的页面。 */
export const ToolbarCountBadge: React.FC<{ loaded?: number; total?: number; hint?: string; className?: string }> = (props) => {
  const { hasTotal, hasLoaded } = useCountParts(props.loaded, props.total);
  if (!hasTotal && !hasLoaded) return null;
  return <CountFraction {...props} className={`rounded-md bg-gray-500/10 px-1.5 py-0.5 text-gray-500 dark:bg-gray-100/10 dark:text-gray-300 ${props.className || ''}`} />;
};
