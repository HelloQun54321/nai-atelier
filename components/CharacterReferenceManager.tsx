import React, { useEffect, useRef, useState } from 'react';
import { CharacterReferenceAsset, CharacterReferenceSelection, ImageEditOperation, NAIParams } from '../types';
import { characterReferenceService } from '../services/characterReferenceService';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';

interface Props {
  params: NAIParams;
  setParams: (params: NAIParams) => void;
  markChange: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  operation?: ImageEditOperation;
}

const referenceTypes: Array<{ value: CharacterReferenceSelection['type']; label: string; hint: string }> = [
  { value: 'character', label: '角色', hint: '保留人物身份与外观' },
  { value: 'style', label: '画风', hint: '参考图像的风格表现' },
  { value: 'character_style', label: '角色与画风', hint: '同时参考人物和风格' },
];

const emptyReferences = (): NonNullable<NAIParams['characterReferences']> => ({ enabled: false, slots: [] });
const BackIcon = () => <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>;

export const CharacterReferenceManager: React.FC<Props> = ({ params, setParams, markChange, notify, operation }) => {
  const confirmAction = useConfirmDialog();
  const runtime = useNaiRuntime();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const historyActiveRef = useRef(false);
  const detailRef = useRef<CharacterReferenceAsset | null>(null);
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<CharacterReferenceAsset[]>([]);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [detail, setDetail] = useState<CharacterReferenceAsset | null>(null);
  const references = params.characterReferences || emptyReferences();
  const enabledCount = references.enabled ? references.slots.length : 0;

  useEffect(() => { detailRef.current = detail; }, [detail]);

  useEffect(() => {
    if (!open) return;
    if (!historyActiveRef.current) {
      window.history.pushState({ ...window.history.state, naiCharacterReferenceManager: true }, '');
      historyActiveRef.current = true;
    }
    const handlePopState = () => {
      if (detailRef.current) setDetail(null);
      else { historyActiveRef.current = false; setOpen(false); }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const updateReferences = (next: NonNullable<NAIParams['characterReferences']>) => {
    setParams({
      ...params,
      characterReferences: { ...next, slots: next.slots.map(slot => ({ ...slot })) },
      vibes: next.enabled && next.slots.length && params.vibes
        ? { ...params.vibes, enabled: false }
        : params.vibes,
    });
    markChange();
  };

  const load = async () => {
    setLoading(true);
    try {
      const items = await characterReferenceService.list(search, archived);
      setAssets(items);
      setDetail(current => current ? items.find(item => item.id === current.id) || current : null);
    } catch (error: any) { notify(error.message || '角色参考库加载失败', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(timer);
  }, [open, search, archived]);

  const addAsset = (asset: CharacterReferenceAsset) => {
    if (references.slots.some(slot => slot.assetId === asset.id)) {
      const slots = references.slots.filter(slot => slot.assetId !== asset.id);
      updateReferences({ enabled: slots.length > 0, slots });
      return;
    }
    if (references.slots.length >= 4) { notify('一次最多启用 4 个角色参考', 'error'); return; }
    updateReferences({
      enabled: true,
      slots: [...references.slots, {
        assetId: asset.id,
        assetName: asset.name,
        type: 'character',
        strength: asset.defaultStrength ?? 0.6,
        fidelity: asset.defaultFidelity ?? 0.6,
        informationExtracted: 1,
      }],
    });
  };

  const updateSlot = (index: number, patch: Partial<CharacterReferenceSelection>) => {
    const slots = references.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot);
    updateReferences({ enabled: slots.length > 0, slots });
  };

  const removeSlot = (index: number) => {
    const slots = references.slots.filter((_, slotIndex) => slotIndex !== index);
    updateReferences({ enabled: slots.length > 0, slots });
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setBusyId('upload');
    try {
      const result = await characterReferenceService.create(file, file.name.replace(/\.[^.]+$/, '') || '角色参考');
      notify(result.duplicate ? '已找到相同的角色参考图' : '角色参考图已保存');
      await load();
      if (!references.slots.some(slot => slot.assetId === result.item.id)) addAsset(result.item);
    } catch (error: any) { notify(error.message || '上传失败', 'error'); }
    finally { setBusyId(''); if (imageInputRef.current) imageInputRef.current.value = ''; }
  };

  const showDetail = (asset: CharacterReferenceAsset) => {
    if (!detailRef.current) window.history.pushState({ ...window.history.state, naiCharacterReferenceDetail: true }, '');
    setDetail(asset);
  };

  const archiveDetail = async () => {
    if (!detail || !await confirmAction({
      title: '归档这张角色参考图？',
      message: '它会从默认资料库隐藏；已有风格串和历史仍保留引用，可随时恢复。',
      confirmLabel: '归档', tone: 'danger',
    })) return;
    try { await characterReferenceService.archive(detail.id); window.history.back(); await load(); notify('已归档'); }
    catch (error: any) { notify(error.message || '归档失败', 'error'); }
  };

  const restoreDetail = async () => {
    if (!detail) return;
    try { await characterReferenceService.restore(detail.id); window.history.back(); await load(); notify('已恢复'); }
    catch (error: any) { notify(error.message || '恢复失败', 'error'); }
  };

  const modelInfo = getRuntimeNaiModelInfo(params.model, runtime);
  const supportsReferences = operation === 'inpaint' || operation === 'outpaint'
    ? modelInfo.supportsCharacterReferenceInpainting
    : modelInfo.supportsCharacterReferences;
  // 不支持的辅助模块直接隐藏；已有选择保留，切回支持的模型后由用户重新启用。
  if (!supportsReferences) return null;

  return <>
    <div>
      <button type="button" onClick={() => setOpen(true)} className="mobile-touch flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">角色参考</span>
            {enabledCount > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">{enabledCount} / 4</span>}
          </div>
          {enabledCount ? <>
            <p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300">{references.slots.map(slot => slot.assetName || '未知参考').join(' · ')}</p>
            <p className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">本次生成额外消耗 {enabledCount} × 5 = {enabledCount * 5} Anlas</p>
          </> : <p className="mt-1 text-xs text-gray-500">未启用 · 每张参考图每次生成消耗 5 Anlas</p>}
        </div>
        <span className="flex-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-indigo-600 dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300">管理</span>
      </button>
    </div>

    {open && <div className="workspace-manager fixed inset-0 z-[10000] flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="workspace-command-bar flex h-16 flex-none items-center gap-2 border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
        <button type="button" onClick={() => window.history.back()} className="mobile-touch flex h-11 w-11 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="返回"><BackIcon /></button>
        <div className="min-w-0 flex-1"><h2 className="truncate font-bold">角色参考</h2><p className="text-[10px] text-gray-500">启用后与 Vibe Transfer 互斥</p></div>
        {!detail && <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-bold text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">已选 {references.slots.length}/4</span>}
      </header>

      {detail ? <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
        <div className="workspace-manager-detail mx-auto grid max-w-5xl gap-5 md:grid-cols-[minmax(280px,1fr)_minmax(300px,1fr)]">
          <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30"><OriginalImage src={detail.originalImageUrl} alt={detail.name} className="max-h-[70vh] w-full object-contain" /></div>
          <div className="space-y-4">
            <div><label className="mb-1 block text-xs font-bold text-gray-500">名称</label><input defaultValue={detail.name} onBlur={async event => { const name = event.currentTarget.value.trim(); if (!name || name === detail.name) return; try { const result = await characterReferenceService.rename(detail.id, name, detail.defaultStrength, detail.defaultFidelity); setDetail(result.item); await load(); } catch (error: any) { notify(error.message, 'error'); } }} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900" /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-bold text-gray-500">默认强度</label><input type="number" min="-1" max="2" step="0.05" defaultValue={detail.defaultStrength ?? 0.6} onBlur={async event => { const value = Math.max(-1, Math.min(2, Number(event.currentTarget.value))); try { const result = await characterReferenceService.rename(detail.id, detail.name, value, detail.defaultFidelity); setDetail(result.item); await load(); } catch (error: any) { notify(error.message, 'error'); } }} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900" /></div><div><label className="mb-1 block text-xs font-bold text-gray-500">默认保真</label><input type="number" min="-1" max="2" step="0.05" defaultValue={detail.defaultFidelity ?? 0.6} onBlur={async event => { const value = Math.max(-1, Math.min(2, Number(event.currentTarget.value))); try { const result = await characterReferenceService.rename(detail.id, detail.name, detail.defaultStrength, value); setDetail(result.item); await load(); } catch (error: any) { notify(error.message, 'error'); } }} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900" /></div></div><p className="mt-1 text-[10px] text-gray-500">NovelAI 支持负值；本项目限制为 -1.00～2.00。</p>
            <button type="button" onClick={() => archived ? void restoreDetail() : void archiveDetail()} className={`mobile-touch w-full rounded-xl text-sm font-bold ${archived ? 'bg-emerald-600 text-white' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'}`}>{archived ? '恢复到资料库' : '归档'}</button>
          </div>
        </div>
      </main> : <>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索角色参考…" className="mobile-touch min-w-40 flex-1 rounded-xl border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-700" />
          <button type="button" onClick={() => setArchived(value => !value)} className={`mobile-touch rounded-xl px-3 text-xs font-bold ${archived ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'border border-gray-300 dark:border-gray-700'}`}>{archived ? '查看资料库' : '已归档'}</button>
          <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void handleUpload(event.target.files?.[0])} />
          <button type="button" disabled={Boolean(busyId)} onClick={() => imageInputRef.current?.click()} className="mobile-touch rounded-xl bg-cyan-600 px-4 text-xs font-bold text-white disabled:opacity-50">{busyId ? '保存中…' : '上传图片'}</button>
        </div>
        <main className="workspace-manager-split grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="workspace-manager-list overflow-y-auto p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
            {loading ? <div className="py-20 text-center text-sm text-gray-500">加载中…</div> : assets.length ? <div className="workspace-card-grid workspace-manager-grid grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{assets.map(asset => { const selected = references.slots.some(slot => slot.assetId === asset.id); return <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-gray-900 ${selected ? 'border-cyan-500 ring-2 ring-cyan-500/20' : 'border-gray-200 dark:border-gray-800'}`}>
              <button type="button" onClick={() => archived ? showDetail(asset) : addAsset(asset)} className="block w-full text-left"><div className="relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800"><SmartImage src={asset.thumbnailUrl || asset.originalImageUrl} alt={asset.name} />{selected && <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-sm font-bold text-white shadow">✓</span>}</div><div className="p-3"><p className="truncate text-sm font-bold">{asset.name}</p><p className="mt-1 text-[11px] text-gray-500">每次生图 5 Anlas</p></div></button>
              <button type="button" onClick={() => showDetail(asset)} className="mobile-touch w-full border-t border-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800">详情</button>
            </article>; })}</div> : <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 text-center dark:border-gray-700"><p className="font-bold">{archived ? '没有已归档的角色参考' : '还没有角色参考图'}</p><p className="mt-1 text-xs text-gray-500">上传图片后即可选择，无需预先编码</p></div>}
          </div>
          <aside className="workspace-manager-selection overflow-y-auto border-t border-gray-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between"><h3 className="font-bold">当前参考</h3><span className="text-xs text-gray-500">{references.slots.length}/4</span></div>
            <div className="mt-3 space-y-3">{references.slots.map((slot, index) => <div key={`${slot.assetId}-${index}`} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cyan-100 text-xs font-bold text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">{index + 1}</span><p className="min-w-0 flex-1 truncate text-sm font-bold">{slot.assetName || '资产缺失'}</p><button type="button" onClick={() => removeSlot(index)} className="mobile-touch flex h-9 w-9 items-center justify-center p-0 text-lg leading-none text-gray-400 hover:text-red-500" aria-label="移除">×</button></div>
              <label className="mt-2 block text-[11px] text-gray-500">参考类型</label><select value={slot.type} onChange={event => updateSlot(index, { type: event.target.value as CharacterReferenceSelection['type'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-xs dark:border-gray-700">{referenceTypes.map(item => <option key={item.value} value={item.value}>{item.label} · {item.hint}</option>)}</select>
              {(['strength', 'fidelity'] as const).map(field => <div key={field} className="mt-2 grid grid-cols-[42px_minmax(0,1fr)_58px] items-center gap-2"><span className="text-[11px] text-gray-500">{field === 'strength' ? '强度' : '保真'}</span><input type="range" min="-1" max="2" step="0.05" value={slot[field]} onChange={event => updateSlot(index, { [field]: Number(event.target.value) })} className="min-w-0 accent-cyan-600" /><input type="number" min="-1" max="2" step="0.05" value={slot[field]} onChange={event => updateSlot(index, { [field]: Math.max(-1, Math.min(2, Number(event.target.value))) })} className="rounded-md border border-gray-300 bg-transparent px-1 py-1 text-right text-xs font-mono dark:border-gray-700" /></div>)}
            </div>)}{!references.slots.length && <p className="rounded-xl bg-gray-50 px-3 py-8 text-center text-xs text-gray-500 dark:bg-gray-950">从左侧选择 1～4 张参考图</p>}</div>
            {references.slots.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"><b>本次额外消耗 {references.slots.length * 5} Anlas</b><p className="mt-1 opacity-80">{references.slots.length} 张参考图 × 5；每次生成都会重新计费。</p>{references.slots.filter(slot => slot.type !== 'style').length > 1 && <p className="mt-1 font-medium">多个角色参考会被 NovelAI 混合为一个角色，不会自动对应为多个独立人物。</p>}</div>}
          </aside>
        </main>
      </>}
    </div>}
  </>;
};
