import React, { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { getActiveKeyHash } from '../services/anlasBudget';
import { getLanguage, t, useLanguage } from '../services/i18n';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import type { KeyUsageRow } from '../services/usageEvents';
import './keyUsage.css';

const number = (value: number) => value.toLocaleString(getLanguage());

interface Props {
  rows: KeyUsageRow[];
  period: string;
  periodPicker?: React.ReactNode;
  includeLifetime?: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

export const KeyUsageSection: React.FC<Props> = ({ rows, period, periodPicker, includeLifetime = false, loading, error, onRetry }) => {
  useLanguage();
  const [activeKeyHash, setActiveKeyHash] = useState('');
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void getActiveKeyHash().then(hash => { if (!cancelled && request === revision) setActiveKeyHash(hash); })
        .catch(() => { if (!cancelled && request === revision) setActiveKeyHash(''); });
    };
    refresh();
    window.addEventListener('nai-api-key-changed', refresh);
    return () => { cancelled = true; window.removeEventListener('nai-api-key-changed', refresh); };
  }, []);

  const currentRows = rows.filter(row => row.name || row.keyHash === activeKeyHash);
  const historicalRows = rows.filter(row => !row.name && row.keyHash !== activeKeyHash);
  const anlasLabel = includeLifetime ? t('Anlas · 累计估算') : t('Anlas · 估算');
  const opusLabel = includeLifetime ? t('Opus · 累计张数') : t('Opus · 张');
  const columns = <div aria-hidden="true" className="key-usage__columns key-usage__head border-b border-gray-100 py-2 text-micro text-gray-500 dark:border-gray-800 dark:text-gray-400">
    <span>Key</span><span>{t('已记录张数')}</span><span>V4.5</span><span>V5</span><span>{anlasLabel}</span><span>{opusLabel}</span><span />
  </div>;
  const renderRows = (items: KeyUsageRow[]) => items.map(row => {
    const name = row.name || (row.keyHash === activeKeyHash ? t('当前密钥') : t('历史用量 · {0}', [row.keyHash.slice(0, 6)]));
    const familyImages = (pattern: RegExp) => row.models.reduce((sum, model) => sum + (pattern.test(model.model) ? model.images : 0), 0);
    const v45 = familyImages(/^nai-diffusion-4-5(?:-|$)/);
    const v5 = familyImages(/^nai-diffusion-5(?:-|$)/);
    const hasImages = row.models.length > 0;
    const hasRecords = hasImages || row.encodingAnlas > 0;
    const cumulative = includeLifetime ? row.lifetime : null;
    const imageCount = (amount: number) => hasImages ? number(amount) : '—';
    const resource = (amount: number, known = hasRecords) => !known || (row.unknownBillingImages > 0 && amount === 0) ? '—'
      : row.unknownBillingImages > 0 ? `${number(amount)} + ?` : number(amount);
    return <details key={row.keyHash} className="key-usage__entry group border-b border-gray-100 last:border-0 dark:border-gray-800">
      <summary aria-label={t('{0} 用量明细', [name])} className="key-usage__columns key-usage__summary mobile-touch rounded-lg py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <span className="key-usage__name flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-100">
          <span className="min-w-0 break-words">{name}</span>
          {row.keyHash === activeKeyHash && <span className="whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-micro font-medium text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">{t('使用中')}</span>}
        </span>
        <span className="key-usage__metric key-usage__total"><small>{t('已记录张数')}</small><strong>{imageCount(row.images)}</strong><span className="key-usage__breakdown">V4.5 {imageCount(v45)} · V5 {imageCount(v5)}</span></span>
        <span className="key-usage__metric key-usage__model"><small>V4.5</small><strong>{imageCount(v45)}</strong></span>
        <span className="key-usage__metric key-usage__model"><small>V5</small><strong>{imageCount(v5)}</strong></span>
        <span className="key-usage__metric"><small>{anlasLabel}</small><strong>{resource(cumulative?.anlasSpent ?? row.generationAnlas + row.encodingAnlas, Boolean(cumulative) || hasRecords)}</strong></span>
        <span className="key-usage__metric"><small>{opusLabel}</small><strong>{resource(cumulative?.opusImages ?? row.opusImages, Boolean(cumulative) || hasRecords)}</strong></span>
        <ChevronDown aria-hidden="true" className="key-usage__chevron h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="key-usage__detail mb-3 grid gap-4 rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-800/60">
        <div>
          <h3 className="mb-2 font-medium text-gray-500 dark:text-gray-400">{t('模型明细')}</h3>
          {row.models.length ? row.models.map(model => <div key={model.model} className="flex justify-between gap-3 py-1"><span className="min-w-0 break-words text-gray-600 dark:text-gray-300">{getNaiModelDisplayLabel(model.model)}</span><span className="shrink-0 tabular-nums text-gray-800 dark:text-gray-100">{t('{0} 张', [number(model.images)])}</span></div>) : <p className="text-gray-400">{t('暂无')}</p>}
        </div>
        <div>
          <h3 className="mb-2 font-medium text-gray-500 dark:text-gray-400">{t('新记录费用 · 估算')}</h3>
          <div className="flex justify-between gap-3 py-1"><span className="text-gray-600 dark:text-gray-300">{t('生图')}</span><span className="tabular-nums">{resource(row.generationAnlas)} Anlas</span></div>
          <div className="flex justify-between gap-3 py-1"><span className="text-gray-600 dark:text-gray-300">{t('Vibe 编码')}</span><span className="tabular-nums">{hasRecords ? number(row.encodingAnlas) : '—'} Anlas</span></div>
        </div>
        {row.unknownBillingImages > 0 && <p className="key-usage__detail-wide text-amber-600 dark:text-amber-400">{t('{0} 张图片缺少计费快照，点数与额度未计入已知用量。', [number(row.unknownBillingImages)])}</p>}
        {row.lifetime && <div className="key-usage__detail-wide border-t border-gray-200 pt-2 text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('本地累计（含旧版）：{0} Anlas · {1} 张 Opus，不受所选周期限制。', [number(row.lifetime.anlasSpent), number(row.lifetime.opusImages)])}</div>}
      </div>
    </details>;
  });

  return <section aria-label={t('Key 使用量')} className="key-usage rounded-2xl border border-gray-200 bg-white p-4 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">{t('Key 使用量')}</h2>
      {periodPicker || <span className="text-right text-xs text-gray-500 dark:text-gray-400">{period}</span>}
    </div>
    {loading ? <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500"><LoaderCircle className="h-4 w-4 animate-spin" />{t('正在读取…')}</div>
      : error ? <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm text-gray-500"><span>{error}</span><button type="button" onClick={onRetry} className="mobile-touch font-semibold text-indigo-600 dark:text-indigo-300">{t('重试')}</button></div>
        : rows.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">{t('暂无 Key 用量记录')}</p>
          : <>
            {currentRows.length > 0 && <>{columns}{renderRows(currentRows)}</>}
            {historicalRows.length > 0 && <details className="key-usage__archive mt-2 border-t border-gray-100 dark:border-gray-800">
              <summary className="key-usage__summary mobile-touch flex items-center justify-between gap-3 rounded-lg py-3 text-xs text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-400">
                {t('未关联的历史用量（{0}条）', [historicalRows.length])}<ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform" />
              </summary>
              {columns}{renderRows(historicalRows)}
            </details>}
          </>}
    <p className="mt-2 text-micro leading-5 text-gray-400 dark:text-gray-500">{includeLifetime
      ? t('Anlas／Opus 含已有累计；张数与模型仅含新记录，“—”表示未记录，费用为估算。')
      : t('仅显示所选周期的新记录；已有累计可切到“全部年份”查看，“—”表示未记录。')}</p>
  </section>;
};
