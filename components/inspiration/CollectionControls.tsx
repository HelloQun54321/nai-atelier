import React, { useEffect, useId, useState } from 'react';
import { t } from '../../services/i18n';
import { db } from '../../services/dbService';
import { getRecentCollectionFolders } from '../../services/inspirationUtils';
import type { InspirationBoard } from '../../types';

/** 原生候选支持键盘与触屏；逗号输入时只补全最后一个标签。 */
export const CollectionTagInput: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & { value: string; suggestions: string[] }> = ({ value, suggestions, ...props }) => {
  const id = useId();
  const prefix = value.slice(0, Math.max(value.lastIndexOf(','), value.lastIndexOf('，'), value.lastIndexOf('\n')) + 1);
  const existing = new Set(prefix.split(/[,，\n]+/).map(tag => tag.trim()));
  return <><input {...props} value={value} list={id} autoComplete="off" /><datalist id={id}>{suggestions.filter(tag => !existing.has(tag)).map(tag => <option key={tag} value={`${prefix}${prefix ? ' ' : ''}${tag}`} />)}</datalist></>;
};

export const CollectionFolderSelect: React.FC<{
  value: string; onChange: (id: string) => void; boards?: InspirationBoard[]; disabled?: boolean; className?: string;
  notify: (message: string, type?: 'success' | 'error') => void;
}> = ({ value, onChange, boards, disabled, className = 'mobile-touch h-10 min-w-0 rounded-xl border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-950', notify }) => {
  const [loaded, setLoaded] = useState<InspirationBoard[]>([]);
  const [loading, setLoading] = useState(!boards);
  const [failed, setFailed] = useState(false);
  const [loadToken, setLoadToken] = useState(0);
  useEffect(() => {
    if (boards) return;
    let active = true;
    setLoading(true);
    void db.getInspirationBoards().then(items => { if (active) { setLoaded(items); setFailed(false); } })
      .catch(() => { if (active) { setFailed(true); notify('收藏夹加载失败', 'error'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [boards, loadToken]);
  const folders = boards || loaded;
  const recentIds = getRecentCollectionFolders();
  const recent = recentIds.flatMap(id => folders.filter(folder => folder.id === id));
  const remaining = folders.filter(folder => !recentIds.includes(folder.id));
  return <select aria-label={t('收藏夹')} aria-busy={loading} value={value} disabled={disabled || loading} className={className}
    onFocus={() => { if (failed) setLoadToken(token => token + 1); }} onChange={event => onChange(event.target.value)}>
    <option value="">{t('未整理')}</option>
    {value && !folders.some(folder => folder.id === value) && <option value={value}>{t('当前收藏夹')}</option>}
    {recent.length > 0 && <optgroup label={t('最近使用')}>{recent.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</optgroup>}
    {remaining.length > 0 && <optgroup label={t('全部收藏夹')}>{remaining.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</optgroup>}
  </select>;
};
