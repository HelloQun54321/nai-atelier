import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileInput, Folder, FolderOpen, Info, ListChecks, Loader2, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { exportStyleBundle, importStyleBundle, readStyleBundle, type StyleBundlePreview } from '../../services/styleBundle';
import { beginExportTarget, openExportDirectory, type ExportReceipt } from '../../services/exportLocation';
import { downloadFile } from '../../services/fileDownload';
import { db } from '../../services/dbService';
import { api } from '../../services/api';
import { createUuid } from '../../services/id';
import { readChainFolders, updateChainFolderMemberships } from '../../services/chainFolders';
import { getDirectoryPath } from '../../services/directoryTree.mjs';
import { saveChainFolders, useChainFolders } from '../../services/useChainFolders';
import { t, useLanguage } from '../../services/i18n';
import { ToolbarButton, ToolbarSearch } from '../DesignSystem';
import { AnchoredToolbarPopover } from '../ToolbarPopover';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { StyleBundlePreview as BundlePreviewCards } from './StyleBundlePreview';
import { DirectoryTreeChecklist } from '../DirectoryTreeChecklist';
import { DirectoryTreeSelect } from '../DirectoryTreeSelect';

type Scope = 'all' | 'filtered' | 'selected';
interface Props {
  chains: PromptChain[];
  filteredChains: PromptChain[];
  selectedChains: PromptChain[];
  initialScope: Scope;
  onClose: () => void;
  onImported: () => void | Promise<void>;
  onViewFolder?: (folderId: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}
const fieldClass = 'mobile-touch w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export const StyleBundleDialog: React.FC<Props> = props => <ImagePreviewPortal><StyleBundleDialogContent {...props} /></ImagePreviewPortal>;

const StyleBundleDialogContent: React.FC<Props> = ({ chains, filteredChains, selectedChains, initialScope, onClose, onImported, onViewFolder, notify }) => {
  useLanguage();
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [scope, setScope] = useState<Scope>(initialScope);
  const [coverMode, setCoverMode] = useState<'none' | 'compressed' | 'original'>('compressed');
  const [author, setAuthor] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [lastExport, setLastExport] = useState<ExportReceipt>();
  const [preview, setPreview] = useState<StyleBundlePreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const folders = useChainFolders(tab === 'import');
  const [folderMode, setFolderMode] = useState<'new' | 'existing'>('new');
  const [folderName, setFolderName] = useState('');
  const [folderParentId, setFolderParentId] = useState('');
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [targetLocked, setTargetLocked] = useState(false);
  const [unfiledIds, setUnfiledIds] = useState<string[]>([]);
  const [filedFolder, setFiledFolder] = useState('');
  const targetPlan = useRef<{ ids: string[]; name?: string; parentId?: string | null } | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [popover, setPopover] = useState<'folders' | 'selection' | 'info' | null>(null);
  const folderAnchor = useRef<HTMLDivElement>(null);
  const selectionAnchor = useRef<HTMLDivElement>(null);
  const infoAnchor = useRef<HTMLDivElement>(null);
  const closePopover = useCallback(() => setPopover(null), []);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalA11y<HTMLElement>(true);
  const requestClose = useMobileHistoryLayer(true, () => { if (busyRef.current) return false; onClose(); }, 'style-bundle');
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === 'Escape' && isTopmostModal(dialogRef.current)) {
        event.preventDefault();
        if (!busyRef.current) requestClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dialogRef, requestClose]);

  const exportChains = scope === 'all' ? chains : scope === 'filtered' ? filteredChains : selectedChains;
  const entries = preview?.entries || [];
  const filtered = entries.filter(entry => `${entry.name} ${entry.description} ${entry.sources.map(source => `${source.author} ${source.sourceUrl} ${source.note}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const sources = useMemo(() => [...new Map((preview?.entries || []).flatMap(entry => entry.sources).map(source => [JSON.stringify(source), source])).values()], [preview]);
  const pending = (items: typeof entries) => items.filter(entry => !imported.has(entry.id));
  const selectedPending = pending(entries).filter(entry => selected.has(entry.id));
  const importBlocked = busy || !folders.ready || Boolean(folders.error) || (folderMode === 'new' ? !folderName.trim() : !targetFolders.length);
  const reportProgress = (value: { completed: number; total: number; name?: string }) => setProgress(t('{0}/{1}', [value.completed, value.total]) + (value.name ? ` · ${value.name}` : ''));
  const begin = () => { busyRef.current = true; setBusy(true); setError(''); setProgress(''); setPopover(null); };
  const finish = () => { busyRef.current = false; setBusy(false); setProgress(''); };

  const exportBundle = async () => {
    if (busyRef.current || !exportChains.length) return;
    begin();
    try {
      // 目录请求在点击时发起，保留浏览器的用户手势授权。
      const target = beginExportTarget();
      const latestChains = await db.getAllChains();
      const allChainIds = latestChains.filter(chain => chain.type === 'style' || !chain.type).map(chain => chain.id);
      const blob = await exportStyleBundle(exportChains, { allChainIds, coverMode, author, sourceUrl, note, onProgress: reportProgress });
      const receipt = await downloadFile(blob, `NAI-Atelier-${new Date().toISOString().slice(0, 10)}.naia`, target);
      if (receipt.saved || receipt.browserDownload) setLastExport(receipt);
      if (receipt.saved) notify(t('已导出 {0} 条风格串', [exportChains.length]), 'success');
      else if (receipt.browserDownload) notify(t('已开始下载分享包'));
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(errorText(failure)); }
    finally { finish(); }
  };

  const openDirectory = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setOpeningDirectory(true);
    try { await openExportDirectory(lastExport); setError(''); }
    catch (failure) { setError(errorText(failure)); }
    finally { setOpeningDirectory(false); finish(); }
  };

  const readBundle = async (file?: File) => {
    if (!file || busyRef.current) return;
    begin();
    try {
      const next = await readStyleBundle(file, reportProgress);
      setPreview(next); setPreviewVersion(version => version + 1); setQuery(''); setVisibleCount(100); setSelected(new Set(next.entries.map(entry => entry.id)));
      setImported(new Set()); setFailures({});
      setFolderName(file.name.replace(/\.naia$/i, '').slice(0, 60));
      setTargetLocked(false); setUnfiledIds([]); setFiledFolder(''); targetPlan.current = null;
    } catch (failure) {
      setPreview(null); setSelected(new Set()); setImported(new Set()); setFailures({});
      setTargetLocked(false); setUnfiledIds([]); setFiledFolder(''); targetPlan.current = null;
      setError(errorText(failure));
    }
    finally { finish(); }
  };

  const targetMissing = () => {
    targetPlan.current = null; setTargetLocked(false); setTargetFolders([]); setFolderParentId('');
    void folders.reload();
    throw Error('目标文件夹已不存在，请重新选择');
  };

  const ensureTargetFolders = async () => {
    const latest = readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }));
    const plan = targetPlan.current || (folderMode === 'new'
      ? { ids: [createUuid()], name: folderName.trim(), parentId: folderParentId || null }
      : { ids: [...targetFolders] });
    targetPlan.current = plan;
    if (!plan.ids.length) throw Error('请选择目标文件夹');
    if (targetLocked && plan.ids.some(id => !latest.folders.some(folder => folder.id === id))) targetMissing();
    if (plan.name !== undefined && !latest.folders.some(folder => folder.id === plan.ids[0])) {
      if (plan.parentId && !latest.folders.some(folder => folder.id === plan.parentId)) targetMissing();
      await saveChainFolders({ ...latest, folders: [...latest.folders, { id: plan.ids[0], name: plan.name, parentId: plan.parentId || null }] });
    } else if (plan.ids.some(id => !latest.folders.some(folder => folder.id === id))) targetMissing();
    return plan.ids;
  };

  const fileImported = async (ids: string[], targets: string[]) => {
    if (!ids.length) return;
    try {
      const latest = readChainFolders(await api.get('/chain-folders', { cache: 'no-store' }));
      if (targets.some(id => !latest.folders.some(folder => folder.id === id))) targetMissing();
      await saveChainFolders(updateChainFolderMemberships(latest, ids, Object.fromEntries(targets.map(id => [id, true]))));
      setUnfiledIds(previous => previous.filter(id => !ids.includes(id)));
      setFiledFolder(targets[0]);
    } catch (failure) {
      setUnfiledIds(previous => [...new Set([...previous, ...ids])]);
      setError(t('风格串已保存，归类失败：{0}', [errorText(failure)]));
    }
  };

  const retryFiling = async () => {
    if (busyRef.current || !unfiledIds.length) return;
    begin();
    try {
      const targets = await ensureTargetFolders();
      setTargetLocked(true);
      await fileImported(unfiledIds, targets);
    } catch (failure) { setError(t('风格串已保存，归类失败：{0}', [errorText(failure)])); }
    finally { finish(); }
  };

  const importEntries = async (items: typeof entries) => {
    if (!preview || busyRef.current || !items.length) return;
    begin();
    try {
      const targets = await ensureTargetFolders();
      setTargetLocked(true);
      const result = await importStyleBundle(preview, items.map(entry => entry.id), reportProgress);
      const completed = new Set(result.importedEntryIds);
      setImported(previous => new Set([...previous, ...completed]));
      setSelected(previous => new Set([...previous].filter(id => !completed.has(id))));
      setFailures(previous => {
        const next = { ...previous };
        completed.forEach(id => { delete next[id]; });
        result.failed.forEach(item => { next[item.id] = item.error; });
        return next;
      });
      if (result.createdIds.length) {
        notify(t('已导入 {0} 条风格串', [result.createdIds.length]), 'success');
        await fileImported(result.createdIds, targets);
        try { await onImported(); }
        catch (failure) { notify(t('风格串已保存，列表刷新失败：{0}', [errorText(failure)]), 'error'); }
      }
      if (result.failed.length) setError(previous => [previous, t('{0} 条导入失败，可重试', [result.failed.length])].filter(Boolean).join('；'));
    } catch (failure) { setError(errorText(failure)); }
    finally { finish(); }
  };

  const targetCaption = folderMode === 'new' ? [...getDirectoryPath(folders.state.folders, folderParentId).map(folder => folder.name), folderName || t('新建文件夹')].join(' / ')
    : targetFolders.map(id => getDirectoryPath(folders.state.folders, id).map(folder => folder.name).join(' / ')).filter(Boolean).join('、') || t('已有文件夹');
  const infoTitle = [t('分享包信息'), ...(preview?.warnings || []).map(warning => t(warning))].join(' · ');

  return <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onClick={event => { if (event.target === event.currentTarget && !busyRef.current) requestClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('风格串分享包')} aria-busy={busy} className={`appearance-panel mobile-safe-bottom flex w-full ${tab === 'import' ? 'h-[calc(100dvh-1.5rem)] max-h-[64rem] max-w-6xl' : 'h-[min(44rem,90dvh)] max-w-2xl'} flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100`}>
      <header className="shrink-0 space-y-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="sr-only min-w-0 flex-1 truncate font-bold sm:not-sr-only">{t('风格串分享包')}</h2>
          <div role="group" aria-label={t('分享包操作')} className="flex shrink-0 gap-1">
            <ToolbarButton active={tab === 'export'} disabled={busy} className="!px-2" onClick={() => { setTab('export'); setPopover(null); setError(''); }}>{t('导出')}</ToolbarButton>
            <ToolbarButton active={tab === 'import'} disabled={busy} className="!px-2" onClick={() => { setTab('import'); setPopover(null); setError(''); }}>{t('导入')}</ToolbarButton>
          </div>
          {tab === 'import' && <>
            <ToolbarButton aria-label={t('选择 .naia 文件')} title={t('选择 .naia 文件')} className="mobile-touch !px-2" disabled={busy} onClick={() => fileRef.current?.click()}><FileInput /><span className="hidden sm:inline">{t('选择 .naia 文件')}</span></ToolbarButton>
            <div ref={infoAnchor} className="shrink-0"><ToolbarButton aria-label={t('分享包信息')} title={infoTitle} aria-expanded={popover === 'info'} aria-haspopup="dialog" className="mobile-touch !px-2" disabled={!preview} active={popover === 'info'} onClick={() => setPopover(previous => previous === 'info' ? null : 'info')}><Info className={preview?.warnings.length ? 'text-amber-700 dark:text-amber-300' : undefined} /></ToolbarButton></div>
          </>}
          <ToolbarButton disabled={busy} onClick={requestClose} aria-label={t('关闭')} className="mobile-touch ml-auto !px-2"><X /></ToolbarButton>
        </div>
        {tab === 'import' ? <div className="flex min-w-0 items-center gap-1.5">
          <ToolbarSearch aria-label={t('搜索分享包')} placeholder={t('搜索名称或描述')} value={query} disabled={busy || !preview} containerClassName="!max-w-none" onChange={event => { setQuery(event.target.value); setVisibleCount(100); }} />
          <div ref={folderAnchor} className="shrink-0"><ToolbarButton aria-label={t('设置文件夹')} title={[t('导入到'), targetCaption].join(' · ')} aria-expanded={popover === 'folders'} aria-haspopup="dialog" className="mobile-touch !px-2" disabled={!preview} active={popover === 'folders'} onClick={() => setPopover(previous => previous === 'folders' ? null : 'folders')}><Folder /></ToolbarButton></div>
          <div ref={selectionAnchor} className="shrink-0"><ToolbarButton aria-label={t('选择与导入')} title={t('选择与导入')} aria-expanded={popover === 'selection'} aria-haspopup="dialog" className="mobile-touch !px-2" disabled={!preview || busy} active={popover === 'selection'} onClick={() => setPopover(previous => previous === 'selection' ? null : 'selection')}><ListChecks /></ToolbarButton></div>
          <ToolbarButton aria-label={t('导入已选（{0}）', [selectedPending.length])} tone="primary" className="!px-2" disabled={importBlocked || !selectedPending.length} onClick={() => void importEntries(selectedPending)}><span className="hidden sm:inline">{t('导入已选（{0}）', [selectedPending.length])}</span><span className="sm:hidden">{t('导入')}({selectedPending.length})</span></ToolbarButton>
        </div> : <div className="flex items-center justify-end gap-2">
          <ToolbarButton disabled={busy} aria-busy={openingDirectory || undefined} onClick={() => void openDirectory()}>{openingDirectory ? <Loader2 className="animate-spin" /> : <FolderOpen />}<span>{t('打开文件夹')}</span></ToolbarButton>
          <ToolbarButton tone="primary" disabled={busy || !exportChains.length} onClick={() => void exportBundle()}>{t('导出 {0} 条', [exportChains.length])}</ToolbarButton>
        </div>}
        {(error || tab === 'import' && unfiledIds.length > 0) && <div className="flex items-start gap-2"><p role={error ? 'alert' : 'status'} className={`min-w-0 flex-1 break-words text-xs ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>{error ? t(error) : t('已保存到风格串')}</p>{tab === 'import' && !!unfiledIds.length && <ToolbarButton disabled={importBlocked} className="!px-2" onClick={() => void retryFiling()}>{t('重试归类（{0}）', [unfiledIds.length])}</ToolbarButton>}</div>}
        {tab === 'import' && folders.error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t(folders.error)}<button type="button" disabled={busy} onClick={() => void folders.reload()} className="mobile-touch ml-2 underline">{t('重新加载')}</button></p>}
        {busy && !openingDirectory && <p role="status" className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />{progress || t('处理中…')}</p>}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${tab === 'import' ? 'space-y-3 p-3 md:p-4' : 'space-y-4 p-4'}`}>
        {tab === 'export' ? <>
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('导出范围')}</span><select aria-label={t('导出范围')} disabled={busy} value={scope} onChange={event => setScope(event.target.value as Scope)} className={fieldClass}>
            <option value="all">{t('全部（{0}）', [chains.length])}</option><option value="filtered">{t('筛选结果（{0}）', [filteredChains.length])}</option><option value="selected" disabled={!selectedChains.length}>{t('已选（{0}）', [selectedChains.length])}</option>
          </select></label>
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('封面')}</span><select aria-label={t('封面')} disabled={busy} value={coverMode} onChange={event => setCoverMode(event.target.value as typeof coverMode)} className={fieldClass}><option value="none">{t('不带封面')}</option><option value="compressed">{t('压缩封面')}</option><option value="original">{t('原图封面')}</option></select></label>
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('作者')}</span><input aria-label={t('作者')} disabled={busy} value={author} onChange={event => setAuthor(event.target.value)} maxLength={200} className={fieldClass} /></label>
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('来源链接')}</span><input aria-label={t('来源链接')} disabled={busy} value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} maxLength={2000} type="url" className={fieldClass} /></label>
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('分享说明')}</span><textarea aria-label={t('分享说明')} disabled={busy} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} rows={3} className={fieldClass} /></label>

        </> : <>
          <input ref={fileRef} type="file" accept=".naia" aria-label={t('选择 .naia 文件')} disabled={busy} className="sr-only" onChange={event => { void readBundle(event.target.files?.[0]); event.target.value = ''; }} />
          {preview && <>
            <BundlePreviewCards key={previewVersion} preview={preview} entries={filtered.slice(0, visibleCount)} selected={selected} imported={imported} disabled={busy} failures={failures} onSelect={id => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; })} />
            {filtered.length > visibleCount && <ToolbarButton disabled={busy} onClick={() => setVisibleCount(count => count + 100)}>{t('加载更多（{0}）', [filtered.length - visibleCount])}</ToolbarButton>}
            {!filtered.length && <p className="py-4 text-center text-sm text-gray-500">{t('没有匹配的风格串')}</p>}
          </>}
        </>}
      </div>
      {tab === 'import' && preview && popover === 'folders' && <AnchoredToolbarPopover anchorRef={folderAnchor} title={t('导入到')} allowMobile width={360} onClose={closePopover}>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-semibold"><span>{t('导入到')}</span><select aria-label={t('导入到')} value={folderMode} disabled={busy || targetLocked} onChange={event => { setFolderMode(event.target.value as 'new' | 'existing'); targetPlan.current = null; }} className={fieldClass}><option value="new">{t('新建文件夹')}</option><option value="existing">{t('已有文件夹')}</option></select></label>
          {folderMode === 'new' ? <>
            <label className="block space-y-1.5 text-sm font-semibold"><span>{t('文件夹名称')}</span><input aria-label={t('文件夹名称')} maxLength={60} value={folderName} disabled={busy || targetLocked} onChange={event => { setFolderName(event.target.value); targetPlan.current = null; }} className={fieldClass} /></label>
            <label className="block space-y-1.5 text-sm font-semibold"><span>{t('上级文件夹')}</span><DirectoryTreeSelect nodes={folders.state.folders} rootLabel={t('顶层')} aria-label={t('上级文件夹')} value={folderParentId} disabled={busy || targetLocked} onChange={event => { setFolderParentId(event.target.value); targetPlan.current = null; }} className={fieldClass} /></label>
          </> : <div><p className="mb-1 text-sm font-semibold">{t('目标文件夹')}</p><div className="max-h-60 overflow-y-auto"><DirectoryTreeChecklist nodes={folders.state.folders} selectedIds={targetFolders} disabled={busy || targetLocked} label={t('目标文件夹')} onToggle={(id, checked) => { setTargetFolders(previous => checked ? [...previous, id] : previous.filter(value => value !== id)); targetPlan.current = null; }} /></div></div>}
          {filedFolder && onViewFolder && <ToolbarButton disabled={busy} onClick={() => onViewFolder(filedFolder)}><FolderOpen />{t('查看文件夹')}</ToolbarButton>}
        </div>
      </AnchoredToolbarPopover>}
      {tab === 'import' && preview && popover === 'selection' && <AnchoredToolbarPopover anchorRef={selectionAnchor} title={t('选择与导入')} allowMobile width={320} onClose={closePopover}>
        <div className="space-y-3"><p className="text-xs text-gray-500">{t('已选 {0} 条', [selectedPending.length])}</p>
          <div className="flex flex-wrap gap-2"><ToolbarButton disabled={busy} onClick={() => setSelected(new Set(pending(entries).map(entry => entry.id)))}>{t('全选')}</ToolbarButton><ToolbarButton disabled={busy} onClick={() => setSelected(new Set(pending(filtered).map(entry => entry.id)))}>{t('全选筛选结果')}</ToolbarButton><ToolbarButton disabled={busy} onClick={() => setSelected(new Set())}>{t('清空选择')}</ToolbarButton></div>
          <div className="flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700"><ToolbarButton disabled={importBlocked || !pending(entries).length} onClick={() => void importEntries(pending(entries))}>{t('导入全部')}</ToolbarButton><ToolbarButton disabled={importBlocked || !pending(filtered).length} onClick={() => void importEntries(pending(filtered))}>{t('导入筛选结果')}</ToolbarButton></div>
        </div>
      </AnchoredToolbarPopover>}
      {tab === 'import' && preview && popover === 'info' && <AnchoredToolbarPopover anchorRef={infoAnchor} title={t('分享包信息')} allowMobile width={400} onClose={closePopover}>
        <div className="space-y-3 text-xs">
          <p>{t('打包范围')}：<strong>{t(preview.coverage === 'full' ? '整库打包' : preview.coverage === 'partial' ? '部分打包' : '未记录')}</strong></p><p className="text-gray-500">{t('包内风格串：{0} 条', [entries.length])}</p>
          {preview.warnings.map((warning, index) => <p key={index} className="break-words text-amber-700 dark:text-amber-300">{t(warning)}</p>)}
          {!!sources.length && <h3 className="font-semibold">{t('分享声明')}</h3>}
          {sources.map((source, index) => <div key={index} className="appearance-group space-y-1 rounded-lg bg-gray-50 p-3 dark:bg-gray-800"><p className="break-words font-semibold">{source.author}</p>{source.sourceUrl && (/^https?:\/\//i.test(source.sourceUrl) ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-600 underline dark:text-indigo-300">{source.sourceUrl}</a> : <p className="break-all">{source.sourceUrl}</p>)}{source.note && <p className="whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">{source.note}</p>}</div>)}
        </div>
      </AnchoredToolbarPopover>}
    </section>
  </div>;
};
