import React, { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Layers, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { getNaiModelDisplayLabel } from '../../services/naiModels';
import { getArtistSampleDictionary } from '../../services/artistSamples';
import { rollSeedFromChain, countRollChainArtists, normalizeRollArtistKey } from '../../services/styleRollSeed';
import { ROLL_MAX_ARTISTS } from '../../services/styleRoll';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { IconButton, ToolbarButton, ToolbarSearch } from '../DesignSystem';
import { SmartImage } from '../SmartImage';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';

interface Props {
  chains: PromptChain[];
  /** 当前词库中的画师名；用于识别没有 artist: 前缀的裸画师 Tag。 */
  knownArtists?: ReadonlySet<string>;
  createOptions: (chain: PromptChain, options: { preserveWeights: boolean }) => Promise<void>;
  onClose: () => void;
}

export const StyleRollChainSeedDialog: React.FC<Props> = props => <ImagePreviewPortal><SeedForm {...props} /></ImagePreviewPortal>;

const SeedForm: React.FC<Props> = ({ chains, knownArtists, createOptions, onClose }) => {
  useLanguage();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [preserveWeights, setPreserveWeights] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dictionary, setDictionary] = useState<ReadonlySet<string> | null>(knownArtists?.size ? knownArtists : null);
  const [dictionaryLoading, setDictionaryLoading] = useState(!knownArtists?.size);
  const dialog = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'roll-chain-seed');
  useEffect(() => {
    if (knownArtists?.size) { setDictionary(knownArtists); setDictionaryLoading(false); return; }
    let current = true;
    setDictionaryLoading(true);
    void getArtistSampleDictionary().then(entries => {
      if (!current) return;
      setDictionary(new Set(entries.map(entry => normalizeRollArtistKey(entry.name))));
    }).catch(() => { if (current) setDictionary(new Set()); })
      .finally(() => { if (current) setDictionaryLoading(false); });
    return () => { current = false; };
  }, [knownArtists]);
  const styleChains = useMemo(() => chains.filter(chain => chain.type === 'style'), [chains]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const values = query ? styleChains.filter(chain => chain.name.toLowerCase().includes(query) || chain.description.toLowerCase().includes(query)) : styleChains;
    return values.slice(0, 100);
  }, [search, styleChains]);
  const artistCounts = useMemo(() => new Map(filtered.map(chain => [chain.id, countRollChainArtists(chain, dictionary ?? undefined)])), [filtered, dictionary]);
  const selected = styleChains.find(chain => chain.id === selectedId);
  const preview = useMemo(() => {
    if (!selected) return null;
    try { return { seed: rollSeedFromChain(selected, 0, dictionary ?? undefined), error: '' }; }
    catch (cause) { return { seed: null, error: (cause as Error).message }; }
  }, [selected, dictionary]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && isTopmostModal(dialog.current)) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [close, dialog]);

  const create = async () => {
    if (!selected || !preview?.seed || busy) return;
    setBusy(true); setError('');
    try { await createOptions(selected, { preserveWeights }); onClose(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm">
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('从风格串开始')} className="appearance-panel flex h-[min(760px,90dvh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <Layers className="h-4 w-4 text-indigo-500" />
        <strong className="min-w-0 flex-1 text-sm">{t('从风格串开始')}</strong>
        <IconButton label="关闭" disabled={busy} onClick={close}><X /></IconButton>
      </header>
      <div className="flex-none border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        <ToolbarSearch value={search} onChange={event => setSearch(event.target.value)} aria-label={t('搜索风格串')} placeholder={t('搜索风格串名称或描述')} containerClassName="!max-w-none" disabled={busy} />
        {dictionaryLoading && <p className="mt-1.5 text-micro text-gray-500">{t('正在读取画师词库…')}</p>}
      </div>
      <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-gray-200 p-2 dark:border-gray-800 md:border-b-0 md:border-r">
          {filtered.length ? <div className="space-y-1">{filtered.map(chain => {
            const artistCount = artistCounts.get(chain.id) ?? 0;
            return <button key={chain.id} type="button" disabled={busy} onClick={() => { setSelectedId(chain.id); setError(''); }} className={`mobile-touch w-full rounded-xl border px-2.5 py-2 text-left transition ${selectedId === chain.id ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40' : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-800/60'}`}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span data-safe-mode-work="true" className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950">
                  {chain.previewImage ? <SmartImage src={chain.previewImage} alt={chain.name} className="h-full w-full object-cover" containerClassName="absolute inset-0" />
                    : <span className="flex h-full w-full items-center justify-center text-gray-400 dark:text-gray-500"><ImageIcon className="h-4 w-4" /></span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{chain.name}</span>
                  <span className="mt-0.5 block truncate text-micro text-gray-500">{getNaiModelDisplayLabel(chain.params?.model)} · {chain.description || t('风格串')}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-micro">
                    <span className={artistCount && artistCount <= ROLL_MAX_ARTISTS ? 'text-gray-500' : 'text-amber-600 dark:text-amber-400'}>{artistCount ? t('{0} 位画师', [artistCount]) : t('无 artist Tag')}</span>
                    {artistCount > ROLL_MAX_ARTISTS && <span className="text-amber-600 dark:text-amber-400">{t('超过 {0} 位上限', [ROLL_MAX_ARTISTS])}</span>}
                  </span>
                </span>
              </span>
            </button>;
          })}</div>
            : <p className="px-3 py-8 text-center text-sm text-gray-400">{styleChains.length ? t('没有匹配的风格串') : t('还没有风格串，先在实验室保存一条')}</p>}
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          {!selected ? <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-gray-400">
            <Layers className="h-8 w-8" />
            <p>{t('选择一条风格串作为起点')}</p>
            <p className="text-xs">{t('保留提示词、参数、角色与 Seed，只对画师部分重新 Roll。')}</p>
          </div> : <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div data-safe-mode-work="true" className="relative h-36 w-24 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-950">
                {selected.previewImage ? <SmartImage src={selected.previewImage} alt={selected.name} eager className="h-full w-full object-cover" containerClassName="absolute inset-0" />
                  : <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-400 dark:text-gray-500"><ImageIcon className="h-6 w-6" /><span className="text-micro">{t('暂无封面')}</span></div>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-gray-800 dark:text-gray-100">{selected.name}</p>
                <p className="mt-1 text-xs text-gray-500">{getNaiModelDisplayLabel(selected.params?.model)} · {selected.params?.width} × {selected.params?.height}</p>
                {!selected.params?.model && <p className="mt-1 text-micro text-amber-600 dark:text-amber-400">{t('未记录模型，将使用默认模型')}</p>}
              </div>
            </div>
            {preview?.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300">{preview.error}</p> : preview?.seed ? <>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t('画师 {0} 位 · 首次保留原权重', [preview.seed.artists.length])}</p>
                {preview.seed.normalizedWeights && <p className="mb-1.5 text-micro text-amber-600 dark:text-amber-400">{t('部分画师权重已按 0.1 精度取整')}</p>}
                {preview.seed.skippedArtists > 0 && <p className="mb-1.5 text-micro text-amber-600 dark:text-amber-400">{t('{0} 个异常画师 Tag 已跳过', [preview.seed.skippedArtists])}</p>}
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {preview.seed.artists.map(artist => <span key={artist.tag} className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    <span className="truncate">{artist.tag}</span><span className="font-mono text-micro opacity-60">{artist.weight.toFixed(1)}</span>
                  </span>)}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t('公共提示词')}</p>
                <p className="max-h-28 overflow-y-auto break-words rounded-xl bg-gray-50 p-2.5 font-mono text-xs leading-relaxed text-gray-600 dark:bg-gray-950 dark:text-gray-300">{preview.seed.template.prompt}</p>
              </div>
              <label className="mobile-touch flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-xs dark:border-gray-700">
                <input type="checkbox" checked={preserveWeights} onChange={event => setPreserveWeights(event.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
                <span className="min-w-0"><span className="block font-semibold text-gray-700 dark:text-gray-200">{t('保留风格串里的画师权重')}</span><span className="mt-0.5 block text-gray-500">{t('关闭后新建记录会立即重 roll 权重；保留时可在「本轮设置」里随时重 roll。')}</span></span>
              </label>
            </> : null}
          </div>}
        </div>
      </div>
      <footer className="flex flex-none items-center gap-3 border-t border-gray-200 p-3 dark:border-gray-800">
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-red-500">{error}</p>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ToolbarButton disabled={busy} onClick={close}>{t('取消')}</ToolbarButton>
          <ToolbarButton className="!border-emerald-600 !bg-emerald-600 !text-white" disabled={busy || dictionaryLoading || !selected || !preview?.seed} onClick={() => void create()}>{t(busy ? '正在新建…' : '新建 Roll 记录')}</ToolbarButton>
        </div>
      </footer>
    </div>
  </div>;
};
