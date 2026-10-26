import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { Inspiration, InspirationBoard, User } from '../../types';
import { api } from '../../services/api';
import { db } from '../../services/dbService';
import { createUuid } from '../../services/id';
import { extractMetadata, parseNovelAIMetadata } from '../../services/metadataService';
import { rememberCollectionFolder } from '../../services/inspirationUtils';
import { t, useLanguage } from '../../services/i18n';
import { IconButton, ToolbarButton } from '../DesignSystem';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useMobileHistoryLayer } from '../MobileUI';
import { isTopmostModal, useModalA11y } from '../useModalA11y';
import { CollectionFolderPicker, CollectionTagInput } from './CollectionControls';
import { splitTags } from './InspirationShared';

interface CollectionImportDialogProps {
  currentUser: User;
  boards: InspirationBoard[];
  tagSuggestions: string[];
  initialFiles: File[];
  initialBoardId: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  notify: (message: string, type?: 'success' | 'error') => void;
}

interface Candidate {
  id: string;
  file: File;
  preview: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  params?: Inspiration['params'];
  edited: { prompt?: boolean; negativePrompt?: boolean };
  status: 'reading' | 'ready' | 'saving' | 'saved' | 'failed';
  readFailed?: boolean;
  error?: string;
  uploadedUrl?: string;
  createdAt: number;
}

export const CollectionImportDialog: React.FC<CollectionImportDialogProps> = props => <ImagePreviewPortal><CollectionImportPanel {...props} /></ImagePreviewPortal>;

const CollectionImportPanel: React.FC<CollectionImportDialogProps> = ({ currentUser, boards, tagSuggestions, initialFiles, initialBoardId, onClose, onRefresh, notify }) => {
  useLanguage();
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const itemsRef = useRef<Candidate[]>([]);
  const initialSeenRef = useRef(new Set<File>());
  const previewsRef = useRef(new Map<string, string>());
  const [items, setItems] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [boardIds, setBoardIds] = useState<string[]>(initialBoardId ? [initialBoardId] : []);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useLayoutEffect(() => {
    const list = listRef.current, item = list?.querySelector<HTMLElement>(`[data-import-id="${selectedId}"]`);
    if (!list || !item) return;
    const bounds = list.getBoundingClientRect(), selected = item.getBoundingClientRect();
    if (selected.bottom > bounds.bottom) list.scrollTop += selected.bottom - bounds.bottom;
    else if (selected.top < bounds.top) list.scrollTop -= bounds.top - selected.top;
  }, [selectedId]);
  const close = () => { if (savingRef.current) return false; onClose(); };
  useMobileHistoryLayer(true, close, 'collection-import');
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewsRef.current.forEach(url => URL.revokeObjectURL(url));
      previewsRef.current.clear(); itemsRef.current = []; initialSeenRef.current.clear();
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dialogRef]);

  const changeItems = (update: (previous: Candidate[]) => Candidate[]) => {
    if (!mountedRef.current) return;
    itemsRef.current = update(itemsRef.current);
    setItems(itemsRef.current);
  };
  const patch = (id: string, update: (item: Candidate) => Candidate) => changeItems(previous => previous.map(item => item.id === id ? update(item) : item));
  const prepare = async (candidate: Candidate): Promise<boolean> => {
    try {
      const raw = await extractMetadata(candidate.file);
      const parsed = raw ? parseNovelAIMetadata(raw) : undefined;
      patch(candidate.id, item => ({ ...item, params: parsed?.params,
        prompt: item.edited.prompt ? item.prompt : parsed?.prompt || '',
        negativePrompt: item.edited.negativePrompt ? item.negativePrompt : parsed?.negativePrompt || '',
        status: 'ready', readFailed: false, error: undefined,
      }));
      return true;
    } catch (error) {
      patch(candidate.id, item => ({ ...item, status: 'failed', readFailed: true, error: error instanceof Error ? error.message : t('读取失败') }));
      return false;
    }
  };
  const enqueue = (files: File[]) => {
    if (savingRef.current || currentUser.role === 'guest') return;
    const added: Candidate[] = [];
    for (const file of files) {
      if (file.webkitRelativePath || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notify(t('只支持 PNG、JPEG 或 WebP 图片'), 'error'); continue; }
      if (!file.size || file.size > 12 * 1024 * 1024) { notify(t('收藏图片不能超过 12 MB'), 'error'); continue; }
      if ([...itemsRef.current, ...added].some(item => item.file === file)) continue;
      const item: Candidate = { id: createUuid(), file, preview: URL.createObjectURL(file), title: file.name.replace(/\.[^/.]+$/, ''), prompt: '', negativePrompt: '', edited: {}, status: 'reading', createdAt: Date.now() };
      previewsRef.current.set(item.id, item.preview); added.push(item);
    }
    if (!added.length) return;
    changeItems(previous => [...previous, ...added]); setSelectedId(added[added.length - 1].id);
    added.forEach(item => void prepare(item));
  };
  useEffect(() => {
    const fresh = initialFiles.filter(file => !initialSeenRef.current.has(file));
    fresh.forEach(file => initialSeenRef.current.add(file)); enqueue(fresh);
  }, [initialFiles]);

  const remove = (item: Candidate) => {
    if (savingRef.current) return;
    URL.revokeObjectURL(item.preview); previewsRef.current.delete(item.id);
    changeItems(previous => previous.filter(candidate => candidate.id !== item.id));
    if (selectedId === item.id) setSelectedId(itemsRef.current[0]?.id || '');
  };
  const edit = (item: Candidate, field: 'title' | 'prompt' | 'negativePrompt', value: string) => {
    if (savingRef.current || item.status === 'saved') return;
    patch(item.id, candidate => ({ ...candidate, [field]: value, edited: field === 'title' ? candidate.edited : { ...candidate.edited, [field]: true } }));
  };
  const refresh = async () => {
    try { await onRefresh(); setRefreshFailed(false); return true; }
    catch (error) {
      setRefreshFailed(true);
      notify(`${t('图片已保存，但收藏库刷新失败')}${error instanceof Error ? `：${error.message}` : ''}`, 'error');
      return false;
    }
  };
  const reload = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true);
    try { await refresh(); }
    finally { savingRef.current = false; setBusy(false); }
  };
  const save = async () => {
    const pending = itemsRef.current.filter(item => item.status !== 'saved');
    if (savingRef.current || currentUser.role === 'guest' || !pending.length || pending.some(item => item.status === 'reading' || !item.title.trim())) return;
    savingRef.current = true; setBusy(true);
    let saved = 0;
    let lastError = '';
    try {
      for (const candidate of pending) {
        if (candidate.readFailed && !await prepare(candidate)) { lastError = itemsRef.current.find(item => item.id === candidate.id)?.error || t('读取失败'); continue; }
        const item = itemsRef.current.find(item => item.id === candidate.id);
        if (!item) continue;
        patch(item.id, current => ({ ...current, status: 'saving', error: undefined }));
        try {
          const imageUrl = item.uploadedUrl || (await api.uploadFile(item.file, 'inspirations')).url;
          patch(item.id, current => ({ ...current, uploadedUrl: imageUrl }));
          await db.saveInspiration({ id: item.id, userId: currentUser.id, username: currentUser.username,
            title: item.title.trim(), imageUrl, prompt: item.prompt, negativePrompt: item.negativePrompt, params: item.params,
            tags: splitTags(tags), boardIds, sourceType: 'upload', createdAt: item.createdAt, updatedAt: Date.now(),
          });
          patch(item.id, current => ({ ...current, status: 'saved' })); saved++;
        } catch (error) {
          lastError = error instanceof Error ? error.message : t('导入失败');
          patch(item.id, current => ({ ...current, status: 'failed', error: lastError }));
        }
      }
      if (saved) boardIds.forEach(rememberCollectionFolder);
      const refreshed = saved ? await refresh() : true;
      const failures = itemsRef.current.filter(item => item.status !== 'saved').length;
      if (failures) notify(saved ? t('已导入 {0} 张，失败 {1} 张', [saved, failures]) : lastError || t('导入失败'), 'error');
      else if (refreshed) { notify(t('已加入收藏库')); if (itemsRef.current.length === 1) onClose(); }
    } finally { savingRef.current = false; setBusy(false); }
  };
  const selected = items.find(item => item.id === selectedId);
  const pending = items.filter(item => item.status !== 'saved');
  const reading = pending.some(item => item.status === 'reading');
  const savedCount = items.filter(item => item.status === 'saved').length;
  const fieldClass = 'h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950';
  const statusLabel = (item: Candidate) => item.status === 'reading' ? t('正在读取图片…') : item.status === 'saving' ? t('正在保存…') : item.status === 'saved' ? t('已保存') : item.status === 'failed' ? item.readFailed ? t('读取失败') : t('导入失败') : t('待导入');

  return <div className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-5" onClick={close}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('加入收藏库')} aria-busy={busy} className="operation-dialog ui-modal-enter flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900" onClick={event => event.stopPropagation()}
      onDragOver={event => { if (Array.from(event.dataTransfer.types || []).includes('Files') || event.dataTransfer.files?.length) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }}
      onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); enqueue(Array.from(event.dataTransfer.files)); }}>
      <header className="appearance-content operation-header flex flex-none items-center justify-between border-b border-gray-200 px-5 dark:border-gray-800"><h2 className="text-xl font-black">{t('加入收藏库')}</h2><IconButton label={t('关闭')} disabled={busy} onClick={close}><X /></IconButton></header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-5">
        <div className="flex flex-none items-end gap-3">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold text-gray-500">{t('收藏夹')}</span><CollectionFolderPicker value={boardIds} onToggle={(id, checked) => setBoardIds(previous => checked ? [...previous, id] : previous.filter(value => value !== id))} boards={boards} disabled={busy} label="收藏夹" className={`${fieldClass} w-full`} /></label><label><span className="mb-1 block text-xs font-bold text-gray-500">{t('公共标签')}</span><CollectionTagInput aria-label={t('公共标签')} onPick={setTags} suggestions={tagSuggestions} value={tags} disabled={busy} onChange={event => setTags(event.target.value)} placeholder={t('构图, 光影')} className={fieldClass} /></label></div>
          {items.length > 0 && <IconButton label={t('追加图片')} disabled={busy || currentUser.role === 'guest'} onClick={() => inputRef.current?.click()} className="!h-11 !w-11"><Upload /></IconButton>}
        </div>
        <input aria-label={t('上传收藏图片')} disabled={busy || currentUser.role === 'guest'} ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { enqueue(Array.from(event.target.files || [])); event.target.value = ''; }} />
        {!items.length ? <button type="button" aria-label={t('选择或拖入图片')} disabled={busy || currentUser.role === 'guest'} onClick={() => inputRef.current?.click()} className="appearance-group flex min-h-64 w-full flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-6 text-gray-500 outline-none transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-400 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"><Upload className="h-10 w-10" /><span className="text-base font-semibold text-gray-700 dark:text-gray-200">{t('选择或拖入图片')}</span><span className="text-xs">{t('PNG / JPEG / WebP，最多 12 MB')}</span></button> : <div className="grid min-w-0 gap-4 md:grid-cols-[260px_1fr]">
          <ul ref={listRef} className="max-h-64 min-w-0 space-y-2 overflow-y-auto">
            {items.map(item => <li key={item.id} data-import-id={item.id} data-safe-mode-work="true" className={`rounded-xl border p-2 ${item.id === selectedId ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-800'}`}>
              <div className="flex items-center gap-2"><button type="button" disabled={busy} aria-label={t('选择候选：{0}', [item.file.name])} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"><img src={item.preview} alt={item.file.name} className="h-16 w-16 flex-none rounded-lg object-contain" /><span className="min-w-0"><span data-safe-mode-title="true" className="block truncate text-sm font-semibold">{item.title}</span><span className={`block text-xs ${item.status === 'failed' ? 'text-red-500' : item.status === 'saved' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500'}`}>{statusLabel(item)}</span></span></button><IconButton label={t('移除候选：{0}', [item.file.name])} disabled={busy} className="!h-11 !w-11" onClick={() => remove(item)}><X /></IconButton></div>
              {item.error && <p role="alert" className="mt-1 break-words text-xs text-red-500">{item.error}</p>}
            </li>)}
          </ul>
          {selected && <fieldset data-safe-mode-work="true" disabled={busy || selected.status === 'saved'} className="min-w-0 space-y-3">
            <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">{t('标题')}</span><input data-safe-mode-title="true" value={selected.title} onChange={event => edit(selected, 'title', event.target.value)} className={fieldClass} /></label>
            <div className="appearance-media flex h-56 max-h-72 items-center justify-center overflow-hidden rounded-xl bg-gray-50 dark:bg-gray-950 sm:h-64"><img src={selected.preview} alt={selected.title} className="appearance-media h-full w-full object-contain" /></div>
            <details key={selected.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
              <summary className="mobile-touch min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-400">{t('生成信息（可选）')}</summary>
              <div className="space-y-3 p-3 pt-0">
                <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">{t('提示词')}</span><textarea value={selected.prompt} onChange={event => edit(selected, 'prompt', event.target.value)} className="min-h-32 w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950" /></label>
                <label className="block"><span className="mb-1 block text-xs font-bold text-gray-500">{t('负面提示词')}</span><textarea value={selected.negativePrompt} onChange={event => edit(selected, 'negativePrompt', event.target.value)} className="min-h-20 w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950" /></label>
              </div>
            </details>
          </fieldset>}
        </div>}
      </div>
      <footer className="appearance-content operation-footer flex flex-none flex-wrap items-center gap-3 border-t border-gray-200 dark:border-gray-800"><span role="status" aria-live="polite" className="min-w-0 flex-1 text-xs text-gray-500">{items.length ? t('已保存 {0}/{1} 张', [savedCount, items.length]) : ''}</span>{refreshFailed && <ToolbarButton disabled={busy} onClick={() => void reload()}>{t('刷新')}</ToolbarButton>}<button type="button" disabled={busy} onClick={close} className="mobile-touch min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-bold text-gray-600 disabled:opacity-40 dark:border-gray-800 dark:text-gray-300">{savedCount ? t('完成') : t('取消')}</button><button type="button" disabled={busy || reading || !pending.length || pending.some(item => !item.title.trim()) || currentUser.role === 'guest'} onClick={() => void save()} className="mobile-touch min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 disabled:opacity-40">{busy ? t('正在保存…') : reading ? t('正在读取图片…') : t('加入收藏库')}</button></footer>
    </div>
  </div>;
};
