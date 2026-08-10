import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, SlidersHorizontal, X } from 'lucide-react';
import { ImageTaggerResult, imageTaggerService } from '../services/imageTaggerService';

interface ImageTaggerPanelProps {
  onInsert: (tags: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export const ImageTaggerPanel: React.FC<ImageTaggerPanelProps> = ({ onInsert, notify }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState<ImageTaggerResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(0.35);
  const [characterThreshold, setCharacterThreshold] = useState(0.85);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!open) return;
    imageTaggerService.getStatus().then(status => setDownloaded(status.downloaded)).catch(() => setDownloaded(null));
  }, [open]);

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
    notify(`已追加 ${selected.size} 个识别 Tag`);
    setOpen(false);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 rounded bg-violet-50 px-2 py-1 text-xs text-violet-600 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300" title="使用本地 WD Tagger 从图片预测 Danbooru Tag">
      <ImagePlus className="h-3.5 w-3.5" />图片反推 Tag
    </button>
    {open && <div className="fixed inset-0 z-[1800] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-center md:p-5" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-950 md:rounded-3xl">
        <header className="flex h-14 flex-none items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800">
          <div><h2 className="text-sm font-black">图片反推 Danbooru Tag</h2><p className="text-[10px] text-gray-500">WD Tagger V3 · 图片只在你的电脑上处理</p></div>
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" aria-label="关闭"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden">
          <section className="space-y-4 border-b border-gray-200 p-4 dark:border-gray-800 md:overflow-y-auto md:border-b-0 md:border-r">
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => chooseFile(event.target.files?.[0])} />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-violet-400 dark:border-gray-700 dark:bg-gray-900">
              {preview ? <img src={preview} alt="待识别图片" className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-2 text-xs"><ImagePlus className="h-8 w-8" />选择图片</span>}
              {busy && <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-xs text-white"><LoaderCircle className="h-7 w-7 animate-spin" />{downloaded === false ? '首次使用正在下载约 379 MB 模型，请稍候…' : '正在本地识别图片…'}</span>}
            </button>
            <div className="space-y-3 rounded-2xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center gap-2 text-xs font-bold"><SlidersHorizontal className="h-4 w-4" />识别阈值</div>
              <label className="block text-[11px] text-gray-500">普通 Tag：{percent(threshold)}<input type="range" min="0.15" max="0.8" step="0.05" value={threshold} onChange={event => setThreshold(Number(event.target.value))} className="mt-1 w-full accent-violet-600" /></label>
              <label className="block text-[11px] text-gray-500">角色 Tag：{percent(characterThreshold)}<input type="range" min="0.4" max="0.95" step="0.05" value={characterThreshold} onChange={event => setCharacterThreshold(Number(event.target.value))} className="mt-1 w-full accent-violet-600" /></label>
              <button type="button" disabled={!file || busy} onClick={() => void run()} className="h-9 w-full rounded-xl bg-violet-600 text-xs font-bold text-white disabled:opacity-40">按当前阈值重新识别</button>
            </div>
          </section>
          <section className="min-h-72 p-4 md:overflow-y-auto">
            {!result && !busy && <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm text-gray-400"><p className="font-bold">选择一张图片开始识别</p><p className="mt-1 max-w-sm text-xs">结果是模型预测，不等于图片原始 Prompt；模型不会识别画师身份。</p></div>}
            {result && <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-black">识别出 {result.tags.length} 个 Tag</p><p className="text-[10px] text-gray-500">角色 {result.character.length} · 普通 {result.general.length}{result.rating ? ` · 分级预测 ${result.rating.name} ${percent(result.rating.confidence)}` : ''}</p></div><div className="flex gap-2"><button type="button" onClick={() => setSelected(new Set(visibleTags.map(item => item.name)))} className="text-xs font-bold text-violet-600">全选</button><button type="button" onClick={() => setSelected(new Set())} className="text-xs font-bold text-gray-500">清空</button></div></div>
              <div className="grid gap-2 sm:grid-cols-2">{visibleTags.map(tag => {
                const checked = selected.has(tag.name);
                return <button key={tag.name} type="button" onClick={() => toggle(tag.name)} className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left ${checked ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
                  <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${checked ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 dark:border-gray-600'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px] font-bold">{tag.name.replaceAll('_', ' ')}</span>{tag.chinese && <span className="block truncate text-[10px] text-gray-500">{tag.chinese}</span>}</span>
                  <span className={`text-[10px] font-black ${tag.category === 'character' ? 'text-emerald-600' : 'text-blue-500'}`}>{percent(tag.confidence)}</span>
                </button>;
              })}</div>
            </div>}
          </section>
        </div>
        <footer className="flex flex-none items-center justify-between gap-3 border-t border-gray-200 p-3 dark:border-gray-800"><p className="hidden text-[10px] text-gray-500 sm:block">模型文件保存在 local-cache，不会进入 Git。</p><button type="button" disabled={!selected.size || busy} onClick={insert} className="mobile-touch ml-auto rounded-xl bg-violet-600 px-5 text-sm font-bold text-white disabled:opacity-40">追加 {selected.size || 0} 个 Tag 到主体</button></footer>
      </div>
    </div>}
  </>;
};
