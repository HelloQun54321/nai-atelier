import React, { useEffect, useMemo, useState } from 'react';
import { Archive, Check, ChevronDown, Copy, Download, ExternalLink, MoreHorizontal, Palette, Pin, Play, Sparkles, UserRound, Wand2, X } from 'lucide-react';
import { Inspiration, InspirationBoard, PromptChain, User } from '../../types';
import { db } from '../../services/dbService';
import { IMPORT_SESSION_KEY, ImportMode, PendingImportData } from '../../services/metadataService';
import { createUuid } from '../../services/id';
import { characterReferenceService } from '../../services/characterReferenceService';
import { vibeService } from '../../services/vibeService';
import { inspirationSimilarity, normalizeInspirationTags, sourceLabel, suggestInspirationTags } from '../../services/inspirationUtils';
import { IconButton } from '../DesignSystem';
import { OriginalImage, SmartImage } from '../SmartImage';
import { ParamsViewer } from '../ParamsViewer';
import { useMobileHistoryLayer } from '../MobileUI';
import { canEditItem, DEFAULT_PARAMS, fetchImageFile, formatDate, RatingStars, sourceIcon, splitTags } from './InspirationShared';

interface Props {
  item: Inspiration;
  items: Inspiration[];
  boards: InspirationBoard[];
  currentUser: User;
  chains: PromptChain[];
  notify: (msg: string, type?: 'success' | 'error') => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onNavigateToPlayground?: () => void;
  onCreateArtistChain?: (chain: PromptChain) => Promise<void>;
  onSetChainCover?: (chainId: string, imageUrl: string) => Promise<void>;
  onOpenItem: (item: Inspiration) => void;
}

export const InspirationDetail: React.FC<Props> = ({ item, items, boards, currentUser, chains, notify, onClose, onRefresh, onNavigateToPlayground, onCreateArtistChain, onSetChainCover, onOpenItem }) => {
  const closeLayer = useMobileHistoryLayer(true, onClose, 'inspiration-detail');
  const [draft, setDraft] = useState(item);
  const [busy, setBusy] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [coverChainId, setCoverChainId] = useState('');
  const [tagText, setTagText] = useState((item.tags || []).join(', '));
  const editable = canEditItem(item, currentUser);
  useEffect(() => { setDraft(item); setTagText((item.tags || []).join(', ')); }, [item]);

  const similar = useMemo(() => items.filter(candidate => candidate.id !== item.id && !candidate.archived)
    .map(candidate => ({ item: candidate, score: inspirationSimilarity(item, candidate) }))
    .filter(entry => entry.score > 1).sort((a, b) => b.score - a.score).slice(0, 6), [item, items]);
  const update = <K extends keyof Inspiration>(key: K, value: Inspiration[K]) => setDraft(previous => ({ ...previous, [key]: value }));

  const save = async () => {
    if (!draft.title.trim()) return notify('标题不能为空', 'error');
    setBusy('save');
    try {
      await db.updateInspiration(item.id, {
        title: draft.title.trim(), prompt: draft.prompt, negativePrompt: draft.negativePrompt || '', notes: draft.notes || '',
        tags: splitTags(tagText), boardId: draft.boardId || '', rating: draft.rating || 0,
        isPinned: Boolean(draft.isPinned), archived: Boolean(draft.archived),
      });
      await onRefresh(); notify('灵感整理已保存'); onClose();
    } catch (error: any) { notify(error.message || '保存失败', 'error'); }
    finally { setBusy(''); }
  };

  const importToPlayground = async (mode: ImportMode) => {
    setBusy(mode);
    try {
      const payload: PendingImportData = { prompt: draft.prompt || '', negativePrompt: draft.negativePrompt || '', params: draft.params || DEFAULT_PARAMS, mode, sourceInspirationId: draft.id };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload));
      await db.markInspirationUsed(draft.id);
      notify(mode === 'replace' ? '完整参数已送往实验室' : '选定内容已送往实验室');
      onClose(); onNavigateToPlayground?.();
    } catch (error: any) { notify(error.message || '导入失败', 'error'); }
    finally { setBusy(''); }
  };

  const createArtistChain = async () => {
    if (!onCreateArtistChain) return;
    setBusy('chain');
    try {
      const now = Date.now();
      await onCreateArtistChain({
        id: createUuid(), userId: currentUser.id, username: currentUser.username, type: 'style', name: draft.title || '灵感风格串',
        description: draft.notes || `由灵感库“${draft.title}”创建`, tags: draft.tags || [], previewImage: draft.imageUrl,
        basePrompt: draft.prompt || '', negativePrompt: draft.negativePrompt || '', modules: [], params: draft.params || DEFAULT_PARAMS,
        variableValues: { subject: '' }, createdAt: now, updatedAt: now,
      });
      await db.markInspirationUsed(draft.id); notify('已创建风格串');
    } catch (error: any) { notify(error.message || '创建风格串失败', 'error'); }
    finally { setBusy(''); }
  };

  const createAsset = async (kind: 'character' | 'vibe') => {
    setBusy(kind);
    try {
      const file = await fetchImageFile(draft);
      if (kind === 'character') await characterReferenceService.create(file, draft.title || '灵感角色参考');
      else await vibeService.create(file, draft.title || '灵感 Vibe');
      await db.markInspirationUsed(draft.id); notify(kind === 'character' ? '已创建角色参考' : '已创建 Vibe 资产');
    } catch (error: any) { notify(error.message || '创建资产失败', 'error'); }
    finally { setBusy(''); }
  };

  const setCover = async () => {
    if (!coverChainId || !onSetChainCover) return;
    setBusy('cover');
    try { await onSetChainCover(coverChainId, draft.imageUrl); await db.markInspirationUsed(draft.id); notify('风格串封面已更新'); setCoverChainId(''); }
    catch (error: any) { notify(error.message || '设置封面失败', 'error'); }
    finally { setBusy(''); }
  };

  const SourceIcon = sourceIcon(draft.sourceType);
  return <div className="ui-backdrop-enter fixed inset-0 z-[1500] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm md:p-6" onClick={closeLayer}>
    <div data-safe-mode-work="true" className="ui-modal-enter flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-950 md:h-[92vh] md:rounded-2xl md:border md:border-gray-800 lg:flex-row" onClick={event => event.stopPropagation()}>
      <section className="relative flex min-h-[36vh] flex-1 items-center justify-center overflow-hidden bg-gray-100 dark:bg-black/60 lg:min-h-0">
        <OriginalImage src={draft.imageUrl} alt={draft.title} className="max-h-full max-w-full object-contain" data-safe-mode-ignore="true" />
        <button type="button" onClick={closeLayer} className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur lg:hidden" aria-label="关闭"><X className="h-5 w-5" /></button>
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur dark:border-white/15 dark:bg-black/60 dark:text-white"><SourceIcon className="h-3.5 w-3.5" />{sourceLabel(draft.sourceType)}</span>{draft.parentId && <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">衍生自 {draft.parentId}</span>}</div>
      </section>
      <section className="flex min-h-0 w-full flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:w-[560px]">
        <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800"><div className="min-w-0 flex-1"><p className="text-meta font-bold uppercase tracking-wider text-indigo-500">灵感档案</p><h2 data-safe-mode-title="true" className="truncate text-lg font-bold text-gray-950 dark:text-white">{draft.title}</h2></div><RatingStars value={draft.rating || 0} onChange={editable ? value => update('rating', value) : undefined} compact /><IconButton label="关闭" onClick={closeLayer} className="hidden lg:inline-flex"><X /></IconButton></header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-5">
          <div className="grid grid-cols-2 gap-3"><button type="button" disabled={!editable} onClick={() => update('isPinned', !draft.isPinned)} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${draft.isPinned ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' : 'border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300'}`}><Pin className={`h-4 w-4 ${draft.isPinned ? 'fill-current' : ''}`} />{draft.isPinned ? '已置顶' : '置顶'}</button><button type="button" disabled={!editable} onClick={() => update('archived', !draft.archived)} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${draft.archived ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300'}`}><Archive className="h-4 w-4" />{draft.archived ? '已归档' : '归档'}</button></div>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold text-gray-500">标题</span><input data-safe-mode-title="true" disabled={!editable} value={draft.title} onChange={event => update('title', event.target.value)} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-900" /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">灵感板</span><select disabled={!editable} value={draft.boardId || ''} onChange={event => update('boardId', event.target.value)} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-900"><option value="">未整理</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label></div>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">整理备注</span><textarea disabled={!editable} value={draft.notes || ''} onChange={event => update('notes', event.target.value)} placeholder="记录为什么收藏、适合什么场景、下次要怎么改……" className="min-h-24 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900" /></label>
          <div><div className="mb-1 flex items-center justify-between"><span className="text-xs font-bold text-gray-500">标签</span>{editable && <button type="button" onClick={() => { const tags = suggestInspirationTags({ ...draft, tags: splitTags(tagText) }); update('tags', tags); setTagText(tags.join(', ')); }} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600"><Wand2 className="h-3.5 w-3.5" />自动整理</button>}</div><input disabled={!editable} value={tagText} onChange={event => setTagText(event.target.value)} onBlur={() => update('tags', splitTags(tagText))} placeholder="构图, 光影, 角色, 待尝试" className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-900" />{splitTags(tagText).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{splitTags(tagText).map(tag => <span key={tag} className="rounded-full bg-indigo-50 px-2.5 py-1 text-meta font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">#{tag}</span>)}</div>}</div>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">提示词</span><textarea disabled={!editable} value={draft.prompt} onChange={event => update('prompt', event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-5 dark:border-gray-800 dark:bg-gray-900" /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">负面提示词</span><textarea disabled={!editable} value={draft.negativePrompt || ''} onChange={event => update('negativePrompt', event.target.value)} className="min-h-20 w-full resize-y rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-5 dark:border-gray-800 dark:bg-gray-900" /></label>
          <div className="rounded-2xl border border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800"><div className="flex items-center gap-2"><SourceIcon className="h-4 w-4" /><b>{sourceLabel(draft.sourceType)}</b><span>·</span><span>{formatDate(draft.createdAt)}</span></div><div className="mt-2 grid grid-cols-2 gap-2"><span>使用 {draft.useCount || 0} 次</span><span>最近：{formatDate(draft.lastUsedAt)}</span></div>{draft.sourceId && <p className="mt-2 break-all text-meta text-gray-400">来源 ID：{draft.sourceId}</p>}{draft.sourceUrl && <a href={draft.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-bold text-indigo-600"><ExternalLink className="h-3.5 w-3.5" />打开原始来源</a>}</div>
          <details className="rounded-2xl border border-gray-200 p-3 dark:border-gray-800"><summary className="cursor-pointer text-sm font-bold">生成参数</summary><div className="mt-3"><ParamsViewer params={draft.params || DEFAULT_PARAMS} prompt={draft.prompt} negativePrompt={draft.negativePrompt || ''} notify={notify} /></div></details>
          {similar.length > 0 && <div><h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-violet-500" />相似灵感</h3><div className="grid grid-cols-3 gap-2">{similar.map(entry => <button type="button" key={entry.item.id} data-safe-mode-work="true" title={`相似度 ${entry.score}`} onClick={() => onOpenItem(entry.item)} className="overflow-hidden rounded-xl border border-gray-200 text-left dark:border-gray-800"><div className="aspect-square"><SmartImage src={entry.item.imageUrl} alt={entry.item.title} eager thumbnailVariant="thumb-240" /></div><p data-safe-mode-title="true" className="truncate px-2 py-1.5 text-micro font-bold">{entry.item.title}</p></button>)}</div></div>}
        </div>
        <footer className="flex-none space-y-2 border-t border-gray-200 p-3 dark:border-gray-800">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><button type="button" disabled={Boolean(busy)} onClick={() => void importToPlayground('replace')} className="mobile-touch col-span-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 sm:col-span-1"><Play className="h-4 w-4" />完整导入</button><button type="button" disabled={Boolean(busy)} onClick={() => void importToPlayground('append-prompt')} className="mobile-touch rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">追加提示词</button><div className="relative"><button type="button" onClick={() => setMoreOpen(!moreOpen)} className="mobile-touch flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"><MoreHorizontal className="h-4 w-4" />更多复用<ChevronDown className="h-3.5 w-3.5" /></button>{moreOpen && <div className="absolute bottom-12 right-0 z-20 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-gray-900">{([['prompt-only', '仅使用正向提示词'], ['negative-only', '仅使用负面提示词'], ['params-only', '仅使用生成参数']] as [ImportMode, string][]).map(([mode, label]) => <button key={mode} type="button" onClick={() => void importToPlayground(mode)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800">{label}</button>)}<div className="my-1 border-t border-gray-200 dark:border-gray-800" /><button type="button" disabled={!onCreateArtistChain || Boolean(busy)} onClick={() => void createArtistChain()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><Palette className="h-4 w-4" />创建风格串</button><button type="button" disabled={Boolean(busy)} onClick={() => void createAsset('character')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"><UserRound className="h-4 w-4" />创建角色参考</button><button type="button" disabled={Boolean(busy)} onClick={() => void createAsset('vibe')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"><Sparkles className="h-4 w-4" />创建 Vibe</button></div>}</div></div>
          {onSetChainCover && chains.some(chain => chain.type === 'style') && <div className="flex gap-2"><select value={coverChainId} onChange={event => setCoverChainId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-xs dark:border-gray-800 dark:bg-gray-900"><option value="">选择风格串作为封面目标</option>{chains.filter(chain => chain.type === 'style').map(chain => <option key={chain.id} value={chain.id}>{chain.name}</option>)}</select><button type="button" disabled={!coverChainId || Boolean(busy)} onClick={() => void setCover()} className="rounded-xl border border-gray-200 px-3 text-xs font-bold disabled:opacity-40 dark:border-gray-800">设为封面</button></div>}
          <div className="flex gap-2"><button type="button" onClick={() => { navigator.clipboard.writeText(draft.prompt); notify('提示词已复制'); }} className="mobile-touch flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"><Copy className="h-3.5 w-3.5" />复制</button><a href={draft.imageUrl} download={`${draft.title || 'inspiration'}.png`} className="mobile-touch flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"><Download className="h-3.5 w-3.5" />下载</a>{editable && <button type="button" disabled={busy === 'save'} onClick={() => void save()} className="mobile-touch flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"><Check className="h-3.5 w-3.5" />保存整理</button>}</div>
        </footer>
      </section>
    </div>
  </div>;
};
