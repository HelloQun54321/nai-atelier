import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { t } from '../../services/i18n';
import { parseRollArtists } from '../../services/styleRoll';
import { normalizeRollArtistKey } from '../../services/styleRollSeed';
import { searchArtistDictionary, type ArtistDictionaryEntry } from '../../services/tagDictionary';
import { IconButton } from '../DesignSystem';

interface Props {
  label: string; value: string[]; onChange: (tags: string[]) => void;
  limit: number; disabled?: boolean; blocked?: string[];
}

/** 画师管理弹窗中保留手动粘贴 Tag 的入口。 */
export const StyleRollArtistInput: React.FC<Props> = ({ label, value, onChange, limit, disabled, blocked = [] }) => {
  const [text, setText] = useState(''), [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<ArtistDictionaryEntry[]>([]);
  useEffect(() => {
    let current = true;
    setSuggestions([]);
    if (!text.trim()) return;
    const timer = setTimeout(() => { void searchArtistDictionary(text.trim(), 8).then(items => { if (current) setSuggestions(items); }).catch(() => {}); }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [text]);
  const add = (input: string) => {
    try {
      const incoming = parseRollArtists(input).map(artist => artist.tag);
      const blockedKeys = new Set(blocked.map(normalizeRollArtistKey));
      const unavailable = incoming.find(tag => blockedKeys.has(normalizeRollArtistKey(tag)));
      if (unavailable) throw new Error(t('画师已被屏蔽或排除：{0}', [unavailable]));
      const seen = new Set<string>();
      const next = [...value, ...incoming].filter(tag => { const key = normalizeRollArtistKey(tag); if (seen.has(key)) return false; seen.add(key); return true; });
      if (next.length > limit) throw new Error(t('最多可添加 {0} 位画师', [limit]));
      onChange(next); setText(''); setError('');
    } catch (cause) { setError((cause as Error).message); }
  };
  return <div className="space-y-2">
    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
      {t(label)}
      <span className="mt-1 flex items-start gap-2">
        <textarea aria-label={t(label)} placeholder={t('搜索或粘贴画师 Tag，逗号或换行分隔')} value={text} disabled={disabled}
          onChange={event => { setText(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (text.trim()) add(text); } }}
          className="mobile-touch min-h-16 min-w-0 flex-1 resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-normal dark:border-gray-700 dark:bg-gray-950" />
        <IconButton label={t('添加到{0}', [t(label)])} disabled={disabled || !text.trim()} onClick={() => add(text)}><Plus /></IconButton>
      </span>
    </label>
    {!!suggestions.length && <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">{suggestions.map(artist => <button key={artist.name} type="button" disabled={disabled} onClick={() => add(artist.name)} className="mobile-touch rounded-md border border-gray-200 px-2 py-1 text-xs dark:border-gray-700">{artist.name}{artist.chinese ? ` · ${artist.chinese}` : ''}</button>)}</div>}
    {!!value.length && <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">{value.map(tag => <button key={tag} type="button" aria-label={t('从{0}移除 {1}', [t(label), tag])} disabled={disabled} onClick={() => onChange(value.filter(item => item !== tag))} className="appearance-group mobile-touch inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"><span className="truncate">{tag}</span><X className="h-3 w-3 shrink-0" /></button>)}</div>}
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
  </div>;
};
