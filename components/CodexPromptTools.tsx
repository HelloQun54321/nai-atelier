import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../services/i18n';
import { codexMediaUrl, loadCodexAuxiliary, type CodexBootstrap, type CodexEntry } from '../services/codexService';
import { parsePromptTags } from '../services/tagTranslations';
import { lookupTagTranslations } from '../services/tagDictionary';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { ViewableImage } from './ImageLightbox';
import { InlineSpinner, ToolbarButton } from './DesignSystem';

export function CodexPromptTools({ entry, boot, onOpenEntry }: { entry: CodexEntry; boot: CodexBootstrap; onOpenEntry: (book: string, id: string) => void }) {
  const tokens = useMemo(() => parsePromptTags(entry.prompt), [entry.prompt]);
  const artists = useMemo(() => tokens.filter(token => /artist\s*:/i.test(entry.prompt.slice(token.start, token.end))), [tokens, entry.prompt]);
  const [index, setIndex] = useState<Record<string, any>>();
  const [version, setVersion] = useState(entry.bookId.includes('45') || entry.bookId === 'suozhang' ? 'n45' : 'n5');
  const [expanded, setExpanded] = useState(false);
  const [meanings, setMeanings] = useState<Record<string, string>>();
  const [meaningError, setMeaningError] = useState('');
  const [meaningBusy, setMeaningBusy] = useState(false);
  const [meaningsRequested, setMeaningsRequested] = useState(false);
  const [meaningRetry, setMeaningRetry] = useState(0);
  useEffect(() => {
    if (!artists.length) return;
    let canceled = false;
    void loadCodexAuxiliary(boot, 'artist_index.json').then(value => { if (!canceled) setIndex(value); }).catch(() => { /* 样张索引失败不影响词条和取用。 */ });
    return () => { canceled = true; };
  }, [boot.release, artists]);
  const samples = artists.flatMap(token => {
    if (!index?.versions) return [];
    const name = token.lookupTag.replaceAll('_', ' ');
    const own = index.versions[version];
    const other = index.versions[version === 'n5' ? 'n45' : 'n5'];
    const record = own?.samples?.[name] || other?.samples?.[name];
    const info = own?.samples?.[name] ? own : other;
    if (!Array.isArray(record)) return [];
    const book = boot.books.find(book => book.id === info.book);
    if (!book || record[0] === entry.id && book.id === entry.bookId) return [];
    const url = codexMediaUrl(record[1] || `${record[0]}.jpg`, book, boot.media, { assetRev: record[2], assetCodexId: record[4] });
    const weight = token.groupKind === 'numeric' ? Number(token.groupWeight || 1) : 1.05 ** ((token.groupKind === 'bracket' ? -1 : 1) * (token.groupLevel || 0));
    return url ? [{ name, book: book.id, id: String(record[0]), url, model: info === own ? version : version === 'n5' ? 'n45' : 'n5', weight }] : [];
  });
  useEffect(() => {
    setMeanings(undefined); setMeaningError(''); setMeaningBusy(false);
    if (!meaningsRequested) return;
    let canceled = false;
    setMeaningBusy(true);
    const readMeanings = async () => {
      try {
        const [local, remote, shard] = await Promise.allSettled([
          lookupTagTranslations(tokens.map(token => token.lookupTag)), loadCodexAuxiliary(boot, 'tag_zh/core.json'), loadCodexAuxiliary(boot, `tag_zh/${entry.bookId}.json`),
        ]);
        const value: Record<string, string> = {};
        for (const token of tokens) {
          const known = local.status === 'fulfilled' ? local.value.get(token.lookupTag)?.chinese : '';
          const lookup = (data: Record<string, any>) => [token.lookupTag, token.lookupTag.replaceAll(' ', '_'), `artist:${token.lookupTag}`].flatMap(key => [data.m?.[key], data.d?.[key], data.a?.[key]]).find(item => typeof item === 'string');
          value[token.id] = known || (shard.status === 'fulfilled' ? lookup(shard.value) : '') || (remote.status === 'fulfilled' ? lookup(remote.value) : '') || '';
        }
        if ([local, remote, shard].every(result => result.status === 'rejected')) throw new Error(t('词义读取失败，请重试'));
        if (!canceled) setMeanings(value);
      } catch (cause) { if (!canceled) setMeaningError(cause instanceof Error ? cause.message : t('词义读取失败，请重试')); }
      finally { if (!canceled) setMeaningBusy(false); }
    };
    void readMeanings();
    return () => { canceled = true; };
  }, [tokens, entry.bookId, boot.release, meaningsRequested, meaningRetry]);
  return <>
    {samples.length > 0 && <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
      <summary className="cursor-pointer text-sm font-semibold">{t('画师样张')}</summary>
      <div className="mt-2 flex gap-2">{['n45', 'n5'].map(model => <ToolbarButton key={model} tone={version === model ? 'primary' : 'neutral'} onClick={() => setVersion(model)}>{model === 'n5' ? 'V5' : 'V4.5'}</ToolbarButton>)}</div>
      <div className="mt-3 grid grid-cols-3 gap-2">{(expanded ? samples : samples.slice(0, 9)).map((sample, i) => <div key={`${sample.name}:${i}`} data-safe-mode-work="true" className="min-w-0">
        <ViewableImage src={getMobileOriginalUrl(sample.url)} alt={`artist:${sample.name}`} className="aspect-square w-full rounded-lg object-cover" />
        <p className="mt-1 truncate text-micro" title={`artist:${sample.name}`}>{sample.name}</p>
        <p className="text-micro text-gray-500">{sample.model === 'n5' ? 'V5' : 'V4.5'}{Math.abs(sample.weight - 1) > 0.000001 ? ` · ×${Number(sample.weight.toFixed(6))}` : ''}</p>
        <button className="mobile-touch text-micro text-indigo-600 dark:text-indigo-300" onClick={() => onOpenEntry(sample.book, sample.id)}>{t('打开词条')}</button>
      </div>)}</div>
      {samples.length > 9 && <ToolbarButton className="mt-2" onClick={() => setExpanded(value => !value)}>{t(expanded ? '收起' : '展开全部')}</ToolbarButton>}
    </details>}
    {tokens.length > 0 && <details className="relative rounded-xl border border-gray-200 p-3 dark:border-gray-800" onToggle={event => { if (event.currentTarget.open) setMeaningsRequested(true); }}>
      <summary className="cursor-pointer text-sm font-semibold">{t('中文词义')}</summary>
      {/* 加载提示叠在标题行右侧，absolute 脱离文档流，出现/消失都不挤动下方词义列表 */}
      {meaningBusy && <InlineSpinner label={t('加载中…')} className="pointer-events-none absolute right-3 top-3 text-xs" />}
      {meaningError && <button className="mt-2 text-xs text-amber-600" onClick={() => setMeaningRetry(value => value + 1)}>{meaningError}</button>}
      {meanings && <dl className="mt-3 space-y-2">{tokens.map(token => <div key={token.id} className="grid grid-cols-2 gap-3 text-xs"><dt className="break-words text-gray-500">{token.displayTag}</dt><dd className="break-words">{meanings[token.id] || '—'}</dd></div>)}</dl>}
    </details>}
  </>;
}
