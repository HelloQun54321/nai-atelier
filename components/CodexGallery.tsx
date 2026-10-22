import { PromptLibraryCaptureButton } from './PromptLibraryAccess';
import { useGalleryFrostedCaption } from '../services/appearancePreferences';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Copy, FlaskConical, FolderTree, ImagePlus, Layers, LoaderCircle, RefreshCw } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { User, ImageEditOperation, PromptChain } from '../types';
import { IMPORT_SESSION_KEY, type BaseImageImport } from '../services/metadataService';
import { codexCharactersToParams, codexEntryMatches, codexPromptImport, loadCodexBook, loadCodexBootstrap, loadCodexCommunity, readCodexImageFile, readCodexImageMetadata, type CodexBootstrap, type CodexEntry, type CodexImageMetadata, type CodexResult } from '../services/codexService';
import { collectionRevision, collectionTargetActive, subscribeCollection, type CollectionImage, type CollectionTarget } from '../services/collectionFavorites';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { getMobileOriginalUrl } from '../services/mobileImageCache';
import { EmptyState, IconButton, MediaCardShell, PageSpinner, ToolbarButton, ToolbarSearch, WorkspaceChrome, WorkspaceToolbar } from './DesignSystem';
import { DetailSidePanel } from './DetailPanel';
import { ImageShareOverlay } from './ImageShareActions';
import { SmartImage } from './SmartImage';
import { ViewableImage } from './ImageLightbox';
import { ShortestColumnMasonry, useMasonryColumnCount } from './ShortestColumnMasonry';
import { useImageRatios } from './useImageRatios';
import { ToolbarPopover, TOOLBAR_FIELD_CLASS, TOOLBAR_MENU_CLASS } from './ToolbarPopover';
import { useMobileHistoryLayer } from './MobileUI';
import { useKeepAliveScrollRestore } from './useKeepAliveScrollRestore';
import { useGallerySelectionAnchor } from './useGallerySelectionAnchor';
import { CodexPromptTools } from './CodexPromptTools';
import { buildPromptFragmentPatch } from '../services/labModeTools';
import { DEFAULT_PARAMS } from './inspiration/InspirationShared';
import { createUuid } from '../services/id';
import { getNaiModelDisplayLabel } from '../services/naiModels';
import { PressRevealSurface } from './PressRevealSurface';

type Mode = 'books' | 'community';
type Filters = { query: string; scope: 'book' | 'all'; path: string; category: string; rating: string; images: string; favorite: boolean; update: string; sort: string };
const defaults = (): Filters => ({ query: '', scope: 'book', path: '', category: '', rating: 'all', images: 'all', favorite: false, update: '', sort: 'default' });
const savedBook = () => { try { return localStorage.getItem('nai-codex-book') || ''; } catch { return ''; } };
const bookKinds: Record<string, string> = { codex: '法典', string: '画师／画风', composition: '构图／服装／场景', pack: '精选图包' };

export function codexCollectionImage(entry: CodexEntry, page: number): CollectionImage {
  const image = entry.images[page];
  return { imageUrl: image.originalUrl || image.url, title: entry.title, sourceType: entry.source,
    sourceId: entry.source === 'codex' ? `${entry.bookId}:${entry.id}` : entry.id, sourceUrl: entry.sourceUrl, imageId: image.id,
    prompt: image.prompt ?? entry.prompt, negativePrompt: image.negative ?? entry.negative,
    params: (image.characters ?? entry.characters).length ? { characters: codexCharactersToParams(image.characters ?? entry.characters) } : undefined,
    analysis: { codex: { bookId: entry.bookId, bookTitle: entry.bookTitle, entryId: entry.id, page, author: entry.author, path: entry.path,
      note: entry.note, raw: image.raw, nsfw: entry.nsfw, r18g: entry.r18g, originalAvailable: Boolean(image.originalUrl), parameterSource: image.parameterSource,
      prompt: entry.prompt, negative: entry.negative, characters: entry.characters }, externalSourcePage: page, collectionGroupSize: entry.images.length },
  };
}
const groupTarget = (entry: CodexEntry): CollectionTarget => ({ ...codexCollectionImage(entry, entry.coverIndex), groupSize: entry.images.length,
  getGroup: async () => entry.images.map((_, page) => codexCollectionImage(entry, page)),
});

export const CodexGallery: React.FC<{ active: boolean; selectionFocusEnabled?: boolean; currentUser: User; notify: (message: string, type?: 'success' | 'error') => void; onNavigateToPlayground: () => void; onCreateArtistChain: (chain: PromptChain) => Promise<void> }> = ({ active, selectionFocusEnabled = true, currentUser, notify, onNavigateToPlayground, onCreateArtistChain }) => {
  const [imageRatios, updateImageRatio] = useImageRatios();
  useLanguage();
  const [mode, setMode] = useState<Mode>('books');
  const [bookId, setBookId] = useState(savedBook);
  const [boot, setBoot] = useState<CodexBootstrap>();
  const [data, setData] = useState<Record<Mode, CodexResult | undefined>>({ books: undefined, community: undefined });
  const [filters, setFilters] = useState<Record<Mode, Filters>>({ books: defaults(), community: defaults() });
  const [selectedKeys, setSelectedKeys] = useState<Record<Mode, string | null>>({ books: null, community: null });
  const [pages, setPages] = useState<Record<Mode, number>>({ books: 0, community: 0 });
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [metadata, setMetadata] = useState<CodexImageMetadata | null>();
  const [metadataError, setMetadataError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [reading, setReading] = useState(false);
  const [bookSearch, setBookSearch] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const bootstrapRefresh = useRef(0);
  const contentRefresh = useRef(0);
  const requestRevision = useRef(0);
  const originalRevision = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const display = useMobileImageDisplayPreferences('codex');
  const columns = useMasonryColumnCount(display, undefined, galleryRef);
  const filter = filters[mode];
  const result = data[mode];
  const entries = result?.entries || [];
  const selectedKey = selectedKeys[mode];
  const selected = entries.find(entry => entry.key === selectedKey);
  const page = pages[mode];
  const selectedImage = selected?.images[page];
  const sourceEntry = useMemo(() => selected && { ...selected, prompt: selectedImage?.prompt ?? selected.prompt,
    negative: selectedImage?.negative ?? selected.negative, characters: selectedImage?.characters ?? selected.characters }, [selected, selectedImage]);
  const importValue = useMemo(() => sourceEntry && (!selectedImage?.originalUrl || metadata !== undefined)
    ? codexPromptImport(sourceEntry, metadata || undefined) : undefined, [sourceEntry, selectedImage?.originalUrl, metadata]);
  const detailEntry = metadata && sourceEntry ? { ...sourceEntry, prompt: metadata.rawPrompt, negative: metadata.rawNegative,
    characters: (metadata.params.characters || []).map((character, index) => ({ label: t('角色 {0}', [index + 1]), prompt: character.prompt, negative: character.negativePrompt || '' })) } : sourceEntry;
  const canImport = Boolean(!metadataError && importValue && (importValue.prompt !== undefined || importValue.negativePrompt !== undefined || importValue.characters?.length
    || importValue.importSettings || importValue.importSeed || importValue.importModel));
  const anchor = useGallerySelectionAnchor(scrollRef, galleryRef, selectedKey, active, selectionFocusEnabled);
  const scrollRestore = useKeepAliveScrollRestore(scrollRef, `codex-${mode}`, { skipRestore: anchor.hasAnchor });
  const closeDetail = useMobileHistoryLayer(Boolean(active && selected), () => { anchor.preserveOnClose(); setSelectedKeys(current => ({ ...current, [mode]: null })); }, 'codex-detail');
  const favoritesVersion = useSyncExternalStore(subscribeCollection, collectionRevision, collectionRevision);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const refresh = reload !== bootstrapRefresh.current;
    bootstrapRefresh.current = reload;
    void loadCodexBootstrap(refresh, controller.signal).then(next => {
      setBoot(next);
      setBookId(current => next.books.some(book => book.id === current) ? current : next.books.find(book => book.id === 'suozhang_nai5')?.id || next.books[0].id);
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setLoading(false); } });
    return () => controller.abort();
  }, [active, reload]);

  useEffect(() => {
    if (!active || (mode === 'books' && (!boot || !bookId))) return;
    const controller = new AbortController();
    const revision = ++requestRevision.current;
    const refresh = reload !== contentRefresh.current;
    contentRefresh.current = reload;
    setLoading(true); setError(''); setProgress('');
    const run = async () => {
      if (mode === 'community') return loadCodexCommunity(controller.signal);
      const books = filter.scope === 'all' ? boot!.books : boot!.books.filter(book => book.id === bookId);
      const all: CodexEntry[] = [];
      const failures: string[] = [];
      let offline = false;
      for (let i = 0; i < books.length; i++) {
        controller.signal.throwIfAborted();
        setProgress(t('正在读取书目 {0}/{1}', [i + 1, books.length]));
        try {
          const loaded = await loadCodexBook(books[i], boot!, refresh, controller.signal);
          all.push(...loaded.entries); offline ||= Boolean(loaded.offline);
          if (loaded.error) failures.push(`${books[i].title}：${loaded.error}`);
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          failures.push(`${books[i].title}：${cause instanceof Error ? cause.message : '读取失败'}`);
        }
      }
      if (!all.length && failures.length) throw new Error(failures.join('；'));
      return { entries: all, release: boot!.release, offline, error: failures.join('；') };
    };
    void run().then(next => {
      if (revision !== requestRevision.current || controller.signal.aborted) return;
      setData(current => ({ ...current, [mode]: next }));
      setSelectedKeys(current => ({ ...current, [mode]: next.entries.some(entry => entry.key === current[mode]) ? current[mode] : null }));
    }).catch(cause => { if (!controller.signal.aborted && revision === requestRevision.current) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted && revision === requestRevision.current) { setLoading(false); setProgress(''); } });
    return () => controller.abort();
  }, [active, mode, bookId, filter.scope, boot?.release, reload]);

  const changeFilter = (patch: Partial<Filters>, targetMode = mode) => {
    setFilters(current => ({ ...current, [targetMode]: { ...current[targetMode], ...patch } }));
    setSelectedKeys(current => ({ ...current, [targetMode]: null })); setVisibleLimit(120);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const selectBook = (id: string) => {
    setMode('books');
    if (id === bookId && filters.books.scope === 'book') return;
    setBookId(id);
    try { localStorage.setItem('nai-codex-book', id); } catch { /* 浏览偏好不影响读取。 */ }
    changeFilter({ scope: 'book', path: '', update: '' }, 'books');
    setData(current => ({ ...current, books: undefined }));
  };
  const paths = useMemo(() => [...new Set(entries.flatMap(entry => entry.path.map((_, i) => entry.path.slice(0, i + 1).join('/'))))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [entries]);
  const updates = useMemo(() => [...new Set(entries.flatMap(entry => entry.updates))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })), [entries]);
  const categories = useMemo(() => [...new Set(entries.flatMap(entry => entry.path))], [entries]);
  const filtered = useMemo(() => {
    const matched = entries.filter(entry => codexEntryMatches(entry, filter.query)
      && (!filter.path || entry.path.join('/').startsWith(`${filter.path}/`) || entry.path.join('/') === filter.path)
      && (!filter.category || entry.path.includes(filter.category))
      && (filter.rating === 'all' || (filter.rating === 'normal' ? !entry.nsfw && !entry.r18g : filter.rating === 'r18g' ? entry.r18g : entry.nsfw && !entry.r18g))
      && (filter.images === 'all' || (filter.images === 'original' ? entry.images.some(image => image.originalUrl) : filter.images === 'none' ? !entry.images.length : entry.images.length > 0))
      && (!filter.update || (filter.update === 'latest' ? entry.isNew || entry.updates.includes(updates[0]) : entry.updates.includes(filter.update)))
      && (!filter.favorite || entry.images.some((_, i) => collectionTargetActive(codexCollectionImage(entry, i)))));
    if (filter.sort === 'name') matched.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    if (filter.sort === 'new' || (mode === 'community' && filter.sort === 'default')) matched.sort((a, b) => b.createdAt - a.createdAt);
    if (filter.sort === 'likes') matched.sort((a, b) => b.likeCount - a.likeCount);
    return matched;
  }, [entries, filter, updates, favoritesVersion, mode]);
  const filterCount = [filter.category, filter.update, filter.favorite, filter.rating !== 'all', filter.images !== 'all', filter.sort !== 'default'].filter(Boolean).length;
  const hasFilters = Boolean(filter.query || filter.path || filterCount);
  const clearFilters = () => changeFilter({ ...defaults(), scope: filter.scope });
  const sourceLabel = mode === 'community' ? t('共创广场') : filter.scope === 'all' ? t('全部书目') : boot?.books.find(book => book.id === bookId)?.title || t('选择书目');
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); notify(t('已复制提示词')); } catch { notify(t('无法复制，请手动选择文本'), 'error'); } };
  const applyImport = () => {
    if (!importValue || !canImport || reading) return;
    try { sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({ ...importValue, targetMode: 'text-to-image' })); onNavigateToPlayground(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : t('导入失败'), 'error'); }
  };
  const saveAsChain = async () => {
    if (!selected || !importValue || !canImport || reading || savingRef.current || currentUser.role === 'guest') return;
    savingRef.current = true; setSaving(true);
    const now = Date.now();
    const draft = { prompt: '', negativePrompt: '', params: { ...DEFAULT_PARAMS, qualityToggle: false } };
    const content = { ...draft, ...buildPromptFragmentPatch(draft, { ...importValue, replace: true }) };
    try {
      await onCreateArtistChain({ id: createUuid(), userId: currentUser.id, username: currentUser.username, type: 'style',
        name: `${selected.title}${selected.images.length > 1 ? ` P${page + 1}` : ''}`, description: selected.sourceUrl, tags: [],
        previewImage: selectedImage?.originalUrl || selectedImage?.url, basePrompt: content.prompt, negativePrompt: content.negativePrompt,
        modules: [], params: content.params, variableValues: { subject: '' }, createdAt: now, updatedAt: now });
      notify(t('已保存到风格串'));
    } catch (cause) { notify(cause instanceof Error ? cause.message : t('保存失败'), 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const readOriginal = useCallback(async () => {
    if (!selectedImage?.originalUrl) return;
    const revision = ++originalRevision.current;
    setReading(true); setMetadataError('');
    try {
      const metadata = await readCodexImageMetadata(await readCodexImageFile(selectedImage.originalUrl));
      if (revision !== originalRevision.current) return;
      setMetadata(metadata);
    } catch (cause) { if (revision === originalRevision.current) setMetadataError(cause instanceof Error ? cause.message : t('原图读取失败')); }
    finally { if (revision === originalRevision.current) setReading(false); }
  }, [selectedImage?.originalUrl]);
  useEffect(() => {
    originalRevision.current++; setReading(false); setMetadata(undefined); setMetadataError('');
    if (active) void readOriginal();
    return () => { originalRevision.current++; };
  }, [active, selectedKey, page, readOriginal]);
  const sendBaseImage = (operation: ImageEditOperation) => {
    if (!selectedImage) return;
    try {
      const payload: BaseImageImport = { mode: 'base-image', imageEditOperation: operation, baseImageUrl: getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url) };
      // 用作底图只投递图片；图片元数据由「导入实验室」自动取用。
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(payload)); onNavigateToPlayground();
    } catch (error) {
      notify(error instanceof Error ? error.message : t('导入失败'), 'error');
    }
  };
  const promptSection = (label: string, text: string, open = false) => text ? <details key={`${selectedKey}:${page}:${label}`} open={open} className="appearance-group rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
    <summary className="flex min-h-9 cursor-pointer items-center gap-2 px-2 text-xs font-semibold"><span className="mr-auto">{t(label)}</span><IconButton label={t('复制提示词')} className="!h-8 !w-8 !border-0 !bg-transparent" onClick={event => { event.preventDefault(); void copy(text); }}><Copy /></IconButton></summary>
    <PromptLibraryCaptureButton text={text} /><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words px-2 pb-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{text}</pre>
  </details> : null;
  const frostedCaption = useGalleryFrostedCaption();
  const estimateHeight = useCallback((entry: CodexEntry, width: number) => {
    const image = entry.images[entry.coverIndex];
    const ratio = image ? imageRatios[entry.key] || (image.width && image.height ? image.width / image.height : 0.75) : 0.75;
    return image ? width / ratio + (frostedCaption ? 2 : 55) : 160;
  }, [frostedCaption, imageRatios]);
  const renderCard = (entry: CodexEntry) => {
    const image = entry.images[entry.coverIndex];
    const partial = image && !collectionTargetActive(groupTarget(entry)) && entry.images.some((_, i) => collectionTargetActive(codexCollectionImage(entry, i)));
    const imageRatio = image ? imageRatios[entry.key] || (image.width && image.height ? image.width / image.height : 0.75) : 0.75;
    return <MediaCardShell pressReveal key={entry.key} data-gallery-work-id={entry.key} data-safe-mode-work="true" selected={selectedKey === entry.key} className={`mobile-gallery-item ${image ? 'gallery-image-card' : ''} group relative flex-col ${selectionFocusEnabled && selectedKey && selectedKey !== entry.key ? 'brightness-[.7]' : ''}`}>
      <button type="button" onClick={() => { anchor.prepareSelection(entry.key); setSelectedKeys(current => ({ ...current, [mode]: entry.key })); setPages(current => ({ ...current, [mode]: entry.coverIndex })); }} className={`block w-full text-left ${image ? 'gallery-card-visual' : ''}`}>
        {image ? <div className="appearance-media mobile-gallery-frame relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800" style={{ '--mobile-image-ratio': `${imageRatio}` } as React.CSSProperties}>
          <SmartImage src={image.url} alt={entry.title} className={display.layout === 'masonry' && !imageRatios[entry.key] ? 'h-full w-full object-contain' : undefined} onLoad={event => updateImageRatio(entry.key, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
          {!frostedCaption && (entry.images.length > 1 || partial) && <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-micro text-white">{partial ? `${t('部分已收藏')} · ` : ''}{t('{0}页', [entry.images.length])}</span>}
        </div> : <div className="appearance-group max-h-40 overflow-hidden bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-950">{entry.prompt || entry.characters.map(character => character.prompt).join('\n') || entry.note}</div>}
        <div className={`p-2.5 ${image ? 'gallery-card-caption' : ''}`}>{frostedCaption && image && (entry.images.length > 1 || partial) && <span className="gallery-card-meta mb-1 block text-micro">{partial ? `${t('部分已收藏')} · ` : ''}{t('{0}页', [entry.images.length])}</span>}<p data-safe-mode-title="true" className="truncate text-xs font-bold">{entry.title}</p><p className="gallery-card-meta mt-1 truncate text-micro text-gray-500">{mode === 'books' ? [filter.scope === 'all' && entry.bookTitle, entry.path.join(' / ') || (filter.scope === 'book' && entry.bookTitle)].filter(Boolean).join(' · ') : entry.author || entry.path.join(' / ')}</p></div>
      </button>
      {image && <ImageShareOverlay imageUrl={getMobileOriginalUrl(image.originalUrl || image.url)} filename={`${entry.id}.png`} favorite={groupTarget(entry)} notify={notify} />}
    </MediaCardShell>;
  };
  const field = (label: string, content: React.ReactNode) => <label className="block text-xs font-semibold text-gray-500">{t(label)}{content}</label>;
  const select = (label: string, name: keyof Filters, values: [string, string][]) => field(label, <select aria-label={t(label)} className={TOOLBAR_FIELD_CLASS} value={String(filter[name])} onChange={event => changeFilter({ [name]: event.target.value })}>{values.map(([value, text]) => <option key={value} value={value}>{t(text)}</option>)}</select>);

  return <div className="flex h-full min-h-0 flex-col" data-agent-page-scope="codex" data-agent-page-title={t('法典')}>
    <WorkspaceChrome>
<WorkspaceToolbar>
      <ToolbarPopover label={sourceLabel} title={t('法典来源')} icon={<BookOpen />} width={440} className="[&>button>span]:inline [&>button>span]:max-w-20 sm:[&>button>span]:max-w-40 [&>button>span]:truncate [&>button>svg]:hidden sm:[&>button>svg]:block">
        {close => <div className="space-y-2">
          <button type="button" className={TOOLBAR_MENU_CLASS} aria-pressed={mode === 'community'} onClick={() => { setMode('community'); setVisibleLimit(120); close(); }}>{t('共创广场')}</button>
          <button type="button" className={TOOLBAR_MENU_CLASS} aria-pressed={mode === 'books' && filter.scope === 'all'} onClick={() => { setMode('books'); if (filters.books.scope !== 'all') changeFilter({ scope: 'all', path: '', update: '' }, 'books'); close(); }}>{t('全部书目')}</button>
          <ToolbarSearch value={bookSearch} onChange={event => setBookSearch(event.target.value)} placeholder={t('搜索书目')} />
          {boot?.books.filter(book => [book.title, book.author, bookKinds[book.type]].join(' ').toLocaleLowerCase().includes(bookSearch.trim().toLocaleLowerCase())).map(book => <button type="button" key={book.id} aria-pressed={mode === 'books' && filter.scope === 'book' && book.id === bookId} className={`block w-full rounded-lg p-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${mode === 'books' && filter.scope === 'book' && book.id === bookId ? 'text-indigo-600 dark:text-indigo-300' : ''}`} onClick={() => { close(); selectBook(book.id); }}><span>{book.title}</span><span className="mt-1 block text-xs text-gray-500">{t(bookKinds[book.type] || '法典')} · {book.entryCount} · {book.version}</span></button>)}
          <button type="button" className={`${TOOLBAR_MENU_CLASS} sm:hidden`} disabled={loading} onClick={() => { setReload(value => value + 1); close(); }}><RefreshCw />{t('刷新')}</button>
        </div>}
      </ToolbarPopover>
      <ToolbarSearch value={filter.query} onChange={event => changeFilter({ query: event.target.value })} placeholder={t('标题、提示词、作者或说明')} containerClassName="min-w-0 md:max-w-none!" />
      {mode === 'books' && <ToolbarPopover label={filter.path.split('/').at(-1) || '目录'} title={filter.path || t('目录')} icon={<FolderTree />} width={360} active={Boolean(filter.path)} className="[&>button>span]:max-w-24 [&>button>span]:truncate">
        {close => <div className="space-y-2">
          <ToolbarSearch aria-label={t('搜索目录')} value={directorySearch} onChange={event => setDirectorySearch(event.target.value)} placeholder={t('搜索目录')} />
          <button type="button" className={TOOLBAR_MENU_CLASS} aria-pressed={!filter.path} onClick={() => { changeFilter({ path: '' }); close(); }}>{t('全部目录')}</button>
          {paths.filter(path => path.toLocaleLowerCase().includes(directorySearch.trim().toLocaleLowerCase())).map(path => <button type="button" key={path} title={path} aria-label={path} aria-pressed={filter.path === path} className={`${TOOLBAR_MENU_CLASS} ${filter.path === path ? '!text-indigo-600 dark:!text-indigo-300' : ''}`} style={{ paddingLeft: `${12 + (path.split('/').length - 1) * 12}px` }} onClick={() => { changeFilter({ path }); close(); }}>{directorySearch ? path : path.split('/').at(-1)}</button>)}
        </div>}
      </ToolbarPopover>}
      <ToolbarPopover title={t('法典筛选')} width={400} count={filterCount}>
        {close => <div className="space-y-4">
          {mode === 'books' ? select('内容更新', 'update', [['', '全部'], ['latest', '最近更新'], ...updates.map(update => [update, update] as [string, string])]) : select('分类', 'category', [['', '全部'], ...categories.map(category => [category, category] as [string, string])])}
          {select('内容分级', 'rating', [['all', '全部'], ['normal', '常规'], ['nsfw', '成人'], ['r18g', '重口']])}
          {select('图片', 'images', [['all', '全部'], ['image', '有配图'], ['original', '有可用原图'], ['none', '纯文本']])}
          {select('排序', 'sort', mode === 'community' ? [['default', '最新投稿'], ['likes', '站内点赞'], ['name', '名称 A → Z']] : [['default', '书目顺序'], ['name', '名称 A → Z']])}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={filter.favorite} onChange={event => changeFilter({ favorite: event.target.checked })} />{t('本地已收藏')}</label>
          <div className="flex justify-between"><ToolbarButton onClick={clearFilters}>{t('重置')}</ToolbarButton><ToolbarButton tone="primary" onClick={close}>{t('确认')}</ToolbarButton></div>
        </div>}
      </ToolbarPopover>
      <span role="status" aria-label={loading ? t('读取中…') : t('{0} 条结果', [filtered.length])} className="flex-none text-xs tabular-nums text-gray-500">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <><span className="sm:hidden">{filtered.length.toLocaleString()}</span><span className="hidden sm:inline">{t('{0} 条结果', [filtered.length])}</span></>}</span>
      <div className="hidden sm:block"><IconButton label={t('刷新')} disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw className={loading ? 'animate-spin' : ''} /></IconButton></div>
    </WorkspaceToolbar>
    {(error || result?.error || boot?.offline || progress) && <div role="status" className="flex-none border-b border-gray-200 px-3 py-2 text-xs text-amber-700 dark:border-gray-800 dark:text-amber-300">{progress || error || result?.error || boot?.error}{(result?.offline || boot?.offline) && ` · ${t('正在使用上次成功的数据')}`}</div>}
    </WorkspaceChrome>
    <div className={`aitag-split relative grid min-h-0 flex-1 grid-cols-1 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_460px]' : ''}`}>
      <div ref={scrollRef} onScroll={() => { scrollRestore(); anchor.onScroll(); }} className="workspace-scroll-viewport min-h-0 overflow-y-auto p-3">
        <div ref={galleryRef}>
          {loading && !result ? <PageSpinner className="min-h-60" /> : !filtered.length ? <EmptyState className="min-h-60" icon={<BookOpen />} title={t(error ? '法典读取失败' : '没有符合条件的内容')} action={error ? <ToolbarButton onClick={() => setReload(value => value + 1)}>{t('重试')}</ToolbarButton> : hasFilters ? <ToolbarButton onClick={clearFilters}>{t('清除筛选')}</ToolbarButton> : undefined} /> : <>
            {display.layout === 'masonry' ? <ShortestColumnMasonry items={filtered.slice(0, visibleLimit)} columns={columns} getItemKey={entry => entry.key} estimateItemHeight={estimateHeight} renderItem={renderCard} stableColumns /> : <div className={mobileGalleryClassName(display)} style={mobileGalleryStyle(display, columns)}>{filtered.slice(0, visibleLimit).map(renderCard)}</div>}
            {filtered.length > visibleLimit && <div className="flex justify-center py-4"><ToolbarButton onClick={() => setVisibleLimit(value => value + 120)}>{t('加载更多')}</ToolbarButton></div>}
          </>}
        </div>
      </div>
      <DetailSidePanel open={Boolean(selected)} title={selected?.title || ''} sensitiveTitle subInfo={selected ? [selected.bookTitle, selected.author, selected.images.length ? t('{0}页', [selected.images.length]) : t('纯文本')].filter(Boolean).join(' · ') : ''} sourceUrl={selected?.sourceUrl} onClose={closeDetail} onBack={closeDetail}>
        {selected && sourceEntry && detailEntry && <div className="space-y-3">
          <div className="appearance-content appearance-card overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
          {selectedImage && <PressRevealSurface pressResetKey={`${selected.key}:${page}`} className="appearance-media group relative mx-auto max-h-[42vh] w-full overflow-hidden bg-black/5 dark:bg-black/20" style={{ aspectRatio: `${selectedImage.width || 3} / ${selectedImage.height || 4}` }}>
            <ViewableImage src={getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url)} alt={selected.title} width={selectedImage.width || 3} height={selectedImage.height || 4} className="absolute inset-0 h-full w-full object-contain" favorite={codexCollectionImage(selected, page)} notify={notify} />
            <ImageShareOverlay imageUrl={getMobileOriginalUrl(selectedImage.originalUrl || selectedImage.url)} filename={`${selected.id}-${page + 1}.png`} favorite={codexCollectionImage(selected, page)} notify={notify} />
          </PressRevealSurface>}
          <div className="appearance-group space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-none items-center gap-1 text-xs text-gray-500">
              {selected.images.length > 1 ? <>
                <IconButton label={t('上一页')} className="!h-8 !w-8" disabled={page <= 0} onClick={() => setPages(current => ({ ...current, [mode]: page - 1 }))}><ChevronLeft /></IconButton>
                <span className="whitespace-nowrap">{page + 1} / {selected.images.length}</span>
                <IconButton label={t('下一页')} className="!h-8 !w-8" disabled={page >= selected.images.length - 1} onClick={() => setPages(current => ({ ...current, [mode]: page + 1 }))}><ChevronRight /></IconButton>
              </> : selectedImage ? 'P1' : t('纯文本')}
            </div>
            <div className="ml-auto flex flex-none items-center gap-2">
              <IconButton label={t('保存到风格串')} tone="save" disabled={!canImport || reading || saving || currentUser.role === 'guest'} aria-busy={saving} onClick={() => void saveAsChain()}>{saving ? <LoaderCircle className="animate-spin" /> : <Layers />}</IconButton>
              <IconButton label={t('导入实验室')} tone="primary" disabled={!canImport || reading} aria-busy={reading} onClick={applyImport}>{reading ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}</IconButton>
              <ToolbarPopover key={`base:${selected.key}:${page}`} label="用作底图" title={t('用作底图')} icon={<ImagePlus />} iconOnly iconTone="edit" disabled={!selectedImage} width={208}>
                {close => <>{([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const).map(([operation, label]) => <button key={operation} type="button" className={TOOLBAR_MENU_CLASS} onClick={() => { close(); sendBaseImage(operation); }}><ImagePlus />{t(label)}</button>)}</>}
              </ToolbarPopover>
            </div>
          </div>
          {metadata && <p className="text-xs text-gray-500">{[metadata.params.model && getNaiModelDisplayLabel(metadata.params.model), metadata.params.width && metadata.params.height && `${metadata.params.width} × ${metadata.params.height}`, metadata.params.steps && `${metadata.params.steps} ${t('步')}`, metadata.params.scale !== undefined && `CFG ${metadata.params.scale}`].filter(Boolean).join(' · ')}</p>}
          {reading && <p role="status" className="text-xs text-gray-500">{t('读取中…')}</p>}
          {metadata === null && <p role="status" className="text-xs text-gray-500">{t('无可用原图配置，取用条目内容')}</p>}
          {importValue?.partialMetadata && <p role="status" className="text-xs text-gray-500">{t('部分元数据，缺失参数保留当前设置')}</p>}
          {metadataError && <div className="space-y-2"><p role="alert" className="text-xs text-amber-700 dark:text-amber-300">{metadataError}</p><ToolbarButton onClick={() => void readOriginal()}>{t('重试')}</ToolbarButton></div>}
          {selectedImage?.parameterSource && <p className="text-xs text-gray-500">{t('图片来源：{0}', [selectedImage.parameterSource])}</p>}
          {promptSection(metadata ? '正向提示词' : '条目提示词', detailEntry.prompt, true)}
          {promptSection('负面提示词', detailEntry.negative)}
          {detailEntry.characters.map((character, i) => <div key={`${selected.key}:char:${i}`} className="space-y-1"><p className="text-xs font-semibold text-gray-500">{character.label}</p>{promptSection(t('角色 {0} 正向', [i + 1]), character.prompt)}{promptSection(t('角色 {0} 负面', [i + 1]), character.negative)}</div>)}
          </div>
          </div>
          {selected.path.length > 0 && <p className="text-xs text-gray-500">{selected.path.join(' / ')}</p>}
          {selectedImage?.raw && promptSection('当前图片原文', selectedImage.raw)}
          {selected.note && promptSection('说明', selected.note)}
          {boot && <CodexPromptTools key={`${selected.key}:${page}`} entry={detailEntry} boot={boot} onOpenEntry={async (id, entryId) => {
            const book = boot.books.find(item => item.id === id); if (!book) return;
            try { const next = await loadCodexBook(book, boot); setData(current => ({ ...current, books: next })); setBookId(id); setMode('books'); setFilters(current => ({ ...current, books: defaults() })); setSelectedKeys(current => ({ ...current, books: next.entries.find(entry => entry.id === entryId)?.key || null })); setPages(current => ({ ...current, books: 0 })); } catch (cause) { notify(String(cause), 'error'); }
          }} />}
          {mode === 'community' && <p className="text-xs text-gray-500">{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : ''} · {t('站内点赞')} {selected.likeCount}</p>}
        </div>}
      </DetailSidePanel>
    </div>
  </div>;
};
