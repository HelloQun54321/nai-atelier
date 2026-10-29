import React, { useState } from 'react';
import { t, useLanguage } from '../services/i18n';
import { OriginalImage } from './SmartImage';

export interface ReferenceSelectionPreviewItem {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
}

const ReferenceThumbnail: React.FC<{ item: ReferenceSelectionPreviewItem }> = ({ item }) => {
  const [failedSource, setFailedSource] = useState<string>();
  return <span className="appearance-media flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-950">
    {item.imageUrl && failedSource !== item.imageUrl
      ? <OriginalImage src={item.imageUrl} alt={item.name} className="h-full w-full object-contain" onError={() => setFailedSource(item.imageUrl)} />
      : <span className="px-1 text-center text-micro leading-4 text-gray-500 dark:text-gray-400">{t('暂无预览')}</span>}
  </span>;
};

export const ReferenceSelectionPreview: React.FC<{
  items: ReferenceSelectionPreviewItem[];
  enabled: boolean;
  manageLabel: string;
  onManage: () => void;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ items, enabled, manageLabel, onManage, summary, actions }) => {
  useLanguage();
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className={items.length && enabled ? 'font-semibold text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}>{items.length ? enabled ? t('已启用') : t('已停用') : t('未选择参考图')}</span>
        {items.length > 0 && <span className="text-gray-500 dark:text-gray-400">{t('已选 {0} 张', [items.length])}</span>}
        {summary}
      </div>
      {actions}
      <button type="button" onClick={onManage} aria-label={manageLabel} className="appearance-group mobile-touch flex-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-gray-800 dark:bg-gray-900 dark:text-indigo-300">{t('管理')}</button>
    </div>
    {items.length > 0 && <ul className="flex flex-wrap gap-2">{items.map(item => <li key={item.id} className="min-w-0 max-w-full flex-[1_1_12rem]">
      <button type="button" onClick={onManage} aria-label={t('查看参考：{0}', [item.name])} className="appearance-group flex w-full min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 text-left hover:border-indigo-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-indigo-700">
        <ReferenceThumbnail item={item} />
        <span className="min-w-0 flex-1"><span className="line-clamp-2 break-words text-xs font-semibold text-gray-700 dark:text-gray-200">{item.name}</span>{item.description && <span className="mt-0.5 block text-meta text-gray-500 dark:text-gray-400">{item.description}</span>}</span>
      </button>
    </li>)}</ul>}
  </div>;
};
