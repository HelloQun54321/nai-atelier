import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, SlidersHorizontal, X } from 'lucide-react';
import { ImageTaggerResult, imageTaggerService } from '../services/imageTaggerService';
import { IMPORT_SESSION_KEY, PendingImportData } from '../services/metadataService';
import { IconButton } from './DesignSystem';
import { MobileIconButton } from './MobileUI';
import { useModalA11y } from './useModalA11y';

interface ImageTaggerPanelProps {
  open: boolean;
  onClose: () => void;
  onInsert: (tags: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 底部按钮文案，{count} 会被替换为选中 Tag 数量 */
  actionLabel?: string;
  /** 打开面板时自动加载该图片（网络图直接反推，无需先下载到本地）。 */
  imageUrl?: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 送往实验室时使用的默认参数基底（与图库导入一致）。 */
const TAGGER_DEFAULT_PARAMS: PendingImportData['params'] = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 7,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
};

export const ImageTaggerPanel: React.FC<ImageTaggerPanelProps> = ({ open, onClose, onInsert, notify, actionLabel, imageUrl }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState<ImageTaggerResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(0.35);
  const [characterThreshold, setCharacterThreshold] = useState(0.85);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLDivElement>(open);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!open) return;
    imageTaggerService.getStatus().then(status => setDownloaded(status.downloaded)).catch(() => setDownloaded(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  // 打开面板时若提供了 imageUrl（图库“反推此图”），自动抓取并识别，无需手动选文件。
  useEffect(() => {
    if (!open || !imageUrl) return;
    let active = true;
    const load = async () => {
      setBusy(true);
      setResult(null);
      setSelected(new Set());
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!active) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
          notify('该图片不是 PNG/JPEG/WebP，无法直接反推', 'error');
          return;
        }
        if (preview) URL.revokeObjectURL(preview);
        const nextFile = new File([blob], 'tagger-image', { type: blob.type });
        setFile(nextFile);
        setPreview(URL.createObjectURL(blob));
        const next = await imageTaggerService.tagFile(nextFile, { threshold, characterThreshold });
        if (!active) return;
        setResult(next);
        setSelected(new Set(next.tags.map(item => item.name)));
        setDownloaded(true);
      } catch {
        if (active) notify('无法直接读取这张图片，请先保存到本地再反推', 'error');
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    return () => { active = false; };
    // 面板重新打开同一 URL 时无需重复识别；imageUrl 变化才重新加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageUrl]);

  const run = async (nextFile = file) => {
    if (!nextFile || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const next = await imageTaggerService.tagFile(nextFile, { threshold, characterThreshold });
      setResult(next);
      setSelected(new Set(next.tags.map(item => item.name)));
      setDownloaded(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片反推 Tag 失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(nextFile.type)) {
      notify('只支持 PNG、JPEG 和 WebP 图片', 'error');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    void run(nextFile);
  };

  const visibleTags = useMemo(() => result?.tags || [], [result]);
  const toggle = (name: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const insert = () => {
    if (!selected.size) return;
    const tags = visibleTags.filter(item => selected.has(item.name)).map(item => item.name.replaceAll('_', ' ')).join(', ');
    onInsert(tags);
    onClose();
  };

  // 把选中 Tag 直接送往实验室（追加到主体提示词），并自动跳转；任何页面可用。
  const sendToLab = () => {
    if (!selected.size) return;
    const tags = visibleTags.filter(item => selected.has(item.name)).map(item => item.name.replaceAll('_', ' ')).join(', ');
    try {
      const pending: PendingImportData = { prompt: tags, negativePrompt: '', params: { ...TAGGER_DEFAULT_PARAMS }, mode: 'append-prompt' };
      sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(pending));
      onClose();
      window.dispatchEvent(new CustomEvent('nai-agent-navigate', { detail: { view: 'playground', externalImport: true } }));
    } catch {
      notify('送往实验室失败，请重试', 'error');
    }
  };

  if (!open) return null;

  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="图片反推 Tag" className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-center md:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-950 md:rounded-2xl">
      <header className="flex h-14 flex-none items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
        <div><h2 className="text-sm font-black">图片反推 Danbooru Tag</h2><p className="text-micro text-gray-500">WD Tagger V3 · 图片只在你的电脑上处理</p></div>
        <button type="button" disabled={busy} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" aria-label="关闭"><X className="h-4 w-4" /></button>
      </header>
      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden">
        <section className="space-y-4 border-b border-gray-200 p-4 dark:border-gray-800 md:overflow-y-auto md:border-b-0 md:border-r">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-gray-400 hover:border-violet-400 dark:border-gray-800 dark:bg-gray-900">
            {preview ? <img src={preview} alt="待识别图片" className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-2 text-xs"><ImagePlus className="h-8 w-8" />选择图片</span>}
            {busy && <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-xs text-white"><LoaderCircle className="h-7 w-7 animate-spin" />{downloaded === false ? '首次使用正在下载约 379 MB 模型，请稍候…' : '正在本地识别图片…'}</span>}
          </button>
          <div className="space-y-3 rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center gap-2 text-xs font-bold"><SlidersHorizontal className="h-4 w-4" />识别阈值</div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-meta text-gray-500">普通 Tag 阈值</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="15"
                    max="80"
                    step="1"
                    disabled={busy}
                    aria-label="普通 Tag 阈值百分比"
                    value={Math.round(threshold * 100)}
                    onChange={event => setThreshold(Math.max(0.15, Math.min(0.8, (parseInt(event.target.value, 10) || 15) / 100)))}
                    className="w-14 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-violet-600 outline-none transition focus:border-violet-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-violet-400 dark:focus:border-violet-400 dark:focus:bg-gray-900"
                  />
                  <span className="font-mono text-meta text-gray-400">%</span>
                </div>
              </div>
              <input type="range" min="0.15" max="0.8" step="0.01" aria-label="普通 Tag 阈值" disabled={busy} value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="w-full cursor-pointer accent-violet-600 disabled:cursor-not-allowed disabled:opacity-50" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-meta text-gray-500">角色 Tag 阈值</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="40"
                    max="95"
                    step="1"
                    disabled={busy}
                    aria-label="角色 Tag 阈值百分比"
                    value={Math.round(characterThreshold * 100)}
                    onChange={event => setCharacterThreshold(Math.max(0.4, Math.min(0.95, (parseInt(event.target.value, 10) || 40) / 100)))}
                    className="w-14 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-violet-600 outline-none transition focus:border-violet-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-violet-400 dark:focus:border-violet-400 dark:focus:bg-gray-900"
                  />
                  <span className="font-mono text-meta text-gray-400">%</span>
                </div>
              </div>
              <input type="range" min="0.4" max="0.95" step="0.01" aria-label="角色 Tag 阈值" disabled={busy} value={characterThreshold} onChange={event => setCharacterThreshold(Number(event.target.value))} className="w-full cursor-pointer accent-violet-600 disabled:cursor-not-allowed disabled:opacity-50" />
            </div>
            <button type="button" disabled={!file || busy} onClick={() => void run()} className="h-9 w-full rounded-xl bg-violet-600 text-xs font-bold text-white disabled:opacity-40">按当前阈值重新识别</button>
          </div>
        </section>
        <section className="min-h-72 p-4 md:overflow-y-auto">
          {!result && !busy && <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm text-gray-400"><p className="font-bold">选择一张图片开始识别</p><p className="mt-1 max-w-sm text-xs">结果是模型预测，不等于图片原始 Prompt；模型不会识别画师身份。</p></div>}
          {result && <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-black">识别出 {result.tags.length} 个 Tag</p><p className="text-micro text-gray-500">角色 {result.character.length} · 普通 {result.general.length}{result.rating ? ` · 分级预测 ${result.rating.name} ${percent(result.rating.confidence)}` : ''}</p></div><div className="flex gap-2"><button type="button" onClick={() => setSelected(new Set(visibleTags.map(item => item.name)))} className="text-xs font-bold text-violet-600">全选</button><button type="button" onClick={() => setSelected(new Set())} className="text-xs font-bold text-gray-500">清空</button></div></div>
            <div className="grid gap-2 sm:grid-cols-2">{visibleTags.map(tag => {
              const checked = selected.has(tag.name);
              return <button key={tag.name} type="button" onClick={() => toggle(tag.name)} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left ${checked ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
                <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${checked ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 dark:border-gray-600'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-mono text-meta font-bold">{tag.name.replaceAll('_', ' ')}</span>{tag.chinese && <span className="block truncate text-micro text-gray-500">{tag.chinese}</span>}</span>
                <span className={`text-micro font-black ${tag.category === 'character' ? 'text-emerald-600' : 'text-blue-500'}`}>{percent(tag.confidence)}</span>
              </button>;
            })}</div>
          </div>}
        </section>
      </div>
      <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 p-3 dark:border-gray-800"><p className="hidden text-micro text-gray-500 sm:block">模型文件保存在本地缓存，首次加载后可完全离线运行。</p><div className="ml-auto flex items-center gap-2"><button type="button" disabled={!selected.size || busy} onClick={sendToLab} className="mobile-touch rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-40">送往实验室</button><button type="button" disabled={!selected.size || busy} onClick={insert} className="mobile-touch rounded-xl bg-violet-600 px-5 text-sm font-bold text-white disabled:opacity-40">{(actionLabel ?? '追加 {count} 个 Tag 到全局提示词').replace('{count}', String(selected.size))}</button></div></footer>
    </div>
  </div>;
};

interface ImageTaggerActionProps {
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 默认把选中 Tag 复制到剪贴板；实验室等页面传入追加到全局提示词的逻辑 */
  onInsert?: (tags: string) => void;
  /** 底部按钮文案，{count} 会被替换为选中 Tag 数量 */
  actionLabel?: string;
  className?: string;
  /** 打开面板时自动加载该图片（图库“反推此图”入口）。 */
  imageUrl?: string;
}

/** 全局右上角“图片反推 Tag”入口：桌面用 DesignSystem 图标按钮、手机用移动图标按钮，共用同一个面板。 */
export const ImageTaggerAction: React.FC<ImageTaggerActionProps> = ({ notify, onInsert, actionLabel, className = '', imageUrl }) => {
  const [open, setOpen] = useState(false);
  const handleInsert = onInsert ?? ((tags: string) => {
    void navigator.clipboard.writeText(tags).then(
      () => notify(`已复制 ${tags.split(',').length} 个 Tag 到剪贴板`),
      () => notify('复制失败，请手动选择复制', 'error'),
    );
  });
  return <>
    <IconButton label="图片反推 Tag" onClick={() => setOpen(true)} className={`max-md:hidden ${className}`}><ImagePlus className="h-4 w-4" /></IconButton>
    <MobileIconButton label="图片反推 Tag" onClick={() => setOpen(true)} className={`border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:hidden ${className}`}><ImagePlus className="h-5 w-5" /></MobileIconButton>
    {open && <ImageTaggerPanel open={open} onClose={() => setOpen(false)} onInsert={handleInsert} notify={notify} actionLabel={actionLabel ?? (onInsert ? '追加 {count} 个 Tag 到全局提示词' : '复制 {count} 个 Tag')} imageUrl={imageUrl} />}
  </>;
};
