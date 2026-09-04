import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageEditOperation, NAIParams, VibeAsset, VibeGroup, VibeSelection } from '../types';
import { vibeService } from '../services/vibeService';
import { VIBE_MAX_SLOTS, normalizeVibeSelections } from '../services/vibeUtils';
import { useAnlasBudget } from '../services/anlasBudget';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { BackButton, CloseButton, PageSpinner } from './DesignSystem';
import { useModalA11y } from './useModalA11y';

interface VibeManagerProps {
  params: NAIParams;
  setParams: (params: NAIParams) => void;
  markChange: () => void;
  apiKey: string;
  notify: (message: string, type?: 'success' | 'error') => void;
  operation?: ImageEditOperation;
}

const emptyVibes = (): NonNullable<NAIParams['vibes']> => ({
  enabled: false,
  normalizeStrengths: true,
  slots: [],
});

export const VibeManager: React.FC<VibeManagerProps> = ({ params, setParams, markChange, apiKey, notify, operation }) => {
  const confirmAction = useConfirmDialog();
  const runtime = useNaiRuntime();
  const anlasBudget = useAnlasBudget();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const vibeInputRef = useRef<HTMLInputElement>(null);
  const historyActiveRef = useRef(false);
  const detailRef = useRef<VibeAsset | null>(null);
  const [open, setOpen] = useState(false);
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [assets, setAssets] = useState<VibeAsset[]>([]);
  const [groups, setGroups] = useState<VibeGroup[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [detail, setDetail] = useState<VibeAsset | null>(null);
  const [archived, setArchived] = useState(false);
  const [information, setInformation] = useState(1);
  const [groupName, setGroupName] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingGroupId, setEditingGroupId] = useState('');
  const [editingGroupName, setEditingGroupName] = useState('');
  const vibes = params.vibes || emptyVibes();
  const normalized = useMemo(
    () => normalizeVibeSelections(vibes.slots, vibes.normalizeStrengths),
    [vibes.normalizeStrengths, vibes.slots],
  );
  const total = normalized.reduce((sum, slot) => sum + (slot.effectiveStrength ?? slot.strength), 0);

  useEffect(() => { detailRef.current = detail; }, [detail]);

  useEffect(() => {
    if (!open) return;
    if (!historyActiveRef.current) {
      window.history.pushState({ ...window.history.state, naiVibeManager: true }, '');
      historyActiveRef.current = true;
    }
    const handlePopState = () => {
      if (detailRef.current) setDetail(null);
      else {
        historyActiveRef.current = false;
        setOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [open]);

  const showDetail = (asset: VibeAsset) => {
    if (!detailRef.current) window.history.pushState({ ...window.history.state, naiVibeDetail: true }, '');
    setDetail(asset);
  };

  const closeLayer = () => {
    if (detailRef.current) {
      setDetail(null);
      if (window.history.state?.naiVibeDetail) {
        window.history.back();
      }
      return;
    }
    setOpen(false);
    if (historyActiveRef.current) {
      historyActiveRef.current = false;
      window.history.back();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLayer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, detail]);

  const updateVibes = (next: NonNullable<NAIParams['vibes']>) => {
    setParams({
      ...params,
      vibes: { ...next, slots: next.slots.map(slot => ({ ...slot })) },
      characterReferences: next.enabled && next.slots.length && params.characterReferences
        ? { ...params.characterReferences, enabled: false }
        : params.characterReferences,
    });
    markChange();
  };

  // 搜索加载代际：丢弃防抖窗口期快速输入后晚到的旧响应
  const loadSeqRef = useRef(0);
  const load = async () => {
    const loadSeq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const [nextAssets, nextGroups] = await Promise.all([vibeService.list(search, archived), vibeService.listGroups()]);
      if (loadSeq !== loadSeqRef.current) return;
      setAssets(nextAssets);
      setGroups(nextGroups);
      setDetail(current => current ? nextAssets.find(item => item.id === current.id) || current : null);
    } catch (error: any) {
      if (loadSeq !== loadSeqRef.current) return;
      notify(error.message || 'Vibe 库加载失败', 'error');
    } finally {
      if (loadSeq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, archived]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const encode = async (asset: VibeAsset, value: number) => {
    const fixed = Math.round(value * 100) / 100;
    const existing = asset.encodings.find(item => Math.abs(item.informationExtracted - fixed) < 0.001);
    if (existing) {
      notify('该提取量已有编码，已直接复用');
      return existing;
    }
    if (!asset.hasOriginal) {
      notify('这个 Vibe 不含原图，无法追加新的提取量', 'error');
      return null;
    }
    if (!apiKey) {
      notify('请先在全局设置中填写 NovelAI API Key', 'error');
      return null;
    }
    const accepted = await confirmAction({
      title: '生成永久 Vibe',
      message: `模型：NovelAI V4.5 Full\n信息提取量：${fixed.toFixed(2)}\n本次消耗：2 Anlas\n本地预算：${anlasBudget.remaining} → ${Math.max(0, anlasBudget.remaining - 2)}\n\n编码完成后可以无限重复使用，日常生图不会再次产生 Vibe 编码费用。`,
      confirmLabel: '支付 2 Anlas 并生成',
    });
    if (!accepted) return null;
    setBusyId(asset.id);
    try {
      const result = await vibeService.encode(asset.id, fixed, apiKey);
      setAssets(items => items.map(item => item.id === asset.id ? result.item : item));
      setDetail(current => current?.id === asset.id ? result.item : current);
      notify(result.duplicate ? '已有相同编码，未重复扣费' : '永久 Vibe 编码已保存');
      return result.item.encodings.find(item => Math.abs(item.informationExtracted - fixed) < 0.001) || null;
    } catch (error: any) {
      notify(error.message || 'Vibe 编码失败', 'error');
      return null;
    } finally { setBusyId(''); }
  };

  const addAsset = async (asset: VibeAsset) => {
    if (vibes.slots.some(slot => slot.vibeId === asset.id)) {
      updateVibes({ ...vibes, slots: vibes.slots.filter(slot => slot.vibeId !== asset.id), enabled: vibes.slots.length > 1 });
      return;
    }
    if (vibes.slots.length >= VIBE_MAX_SLOTS) {
      notify(`一次最多启用 ${VIBE_MAX_SLOTS} 个 Vibe`, 'error');
      return;
    }
    const usableEncodings = asset.encodings.filter(item => item.model === 'nai-diffusion-4-5-full');
    let encoding: typeof usableEncodings[number] | undefined = usableEncodings.find(item => Math.abs(item.informationExtracted - 1) < 0.001) || usableEncodings[0];
    if (!encoding) encoding = await encode(asset, 1) || undefined;
    if (!encoding) return;
    updateVibes({
      ...vibes,
      enabled: true,
      sourceGroupId: undefined,
      sourceGroupName: undefined,
      slots: [...vibes.slots, {
        vibeId: asset.id,
        vibeName: asset.name,
        encodingId: encoding.id,
        informationExtracted: encoding.informationExtracted,
        strength: asset.defaultStrength || 0.6,
      }],
    });
  };

  const handleImage = async (file?: File) => {
    if (!file) return;
    setBusyId('upload');
    try {
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || '未命名 Vibe';
      const result = await vibeService.create(file, name);
      setAssets(items => [result.item, ...items.filter(item => item.id !== result.item.id)]);
      showDetail(result.item);
      if (result.item.encodings.length) notify('已找到相同图片，直接打开现有 Vibe');
      else await encode(result.item, 1);
    } catch (error: any) { notify(error.message || '上传失败', 'error'); }
    finally { setBusyId(''); if (imageInputRef.current) imageInputRef.current.value = ''; }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setBusyId('import');
    try {
      const result = await vibeService.importFile(file);
      await load();
      showDetail(result.item);
      notify(`已导入 ${result.imported} 个编码，不产生 Anlas 费用`);
    } catch (error: any) { notify(error.message || '导入失败', 'error'); }
    finally { setBusyId(''); if (vibeInputRef.current) vibeInputRef.current.value = ''; }
  };

  const updateSlot = (index: number, patch: Partial<VibeSelection>) => {
    const slots = vibes.slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot);
    updateVibes({ ...vibes, slots, enabled: slots.length > 0, sourceGroupId: undefined, sourceGroupName: undefined });
  };

  const removeSlot = (index: number) => {
    const slots = vibes.slots.filter((_, slotIndex) => slotIndex !== index);
    updateVibes({ ...vibes, slots, enabled: slots.length > 0, sourceGroupId: undefined, sourceGroupName: undefined });
  };

  const moveSlot = (from: number, to: number) => {
    if (from === to || to < 0 || to >= vibes.slots.length) return;
    const slots = [...vibes.slots];
    const [moved] = slots.splice(from, 1);
    slots.splice(to, 0, moved);
    updateVibes({ ...vibes, slots, sourceGroupId: undefined, sourceGroupName: undefined });
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name || !vibes.slots.length) return;
    try {
      const group = await vibeService.createGroup(name, vibes.slots, vibes.normalizeStrengths);
      setGroups(items => [group.item || group, ...items]);
      setGroupName('');
      notify('Vibe 组合已保存');
    } catch (error: any) { notify(error.message || '组合保存失败', 'error'); }
  };

  const loadGroup = (group: VibeGroup) => {
    updateVibes({ enabled: group.slots.length > 0, sourceGroupId: group.id, sourceGroupName: group.name, normalizeStrengths: group.normalizeStrengths, slots: group.slots.map(slot => ({ ...slot })) });
    notify(`已载入组合“${group.name}”`);
  };

  const updateGroup = async (group: VibeGroup, patch: Partial<VibeGroup>) => {
    const next = { ...group, ...patch, updatedAt: Date.now() };
    try {
      await vibeService.updateGroup(next);
      setGroups(items => items.map(item => item.id === group.id ? next : item));
      setEditingGroupId('');
      notify('Vibe 组合已更新');
    } catch (error: any) { notify(error.message || '组合更新失败', 'error'); }
  };

  const archiveDetail = async () => {
    if (!detail) return;
    const accepted = await confirmAction({ title: '归档这个 Vibe？', message: '它会从当前资料库隐藏，但编码和文件仍会保留，已有风格串与历史仍可复现。', confirmLabel: '归档', tone: 'danger' });
    if (!accepted) return;
    try { await vibeService.archive(detail.id); closeLayer(); await load(); notify('已归档'); }
    catch (error: any) { notify(error.message || '归档失败', 'error'); }
  };

  const restoreDetail = async () => {
    if (!detail) return;
    try { await vibeService.restore(detail.id); closeLayer(); await load(); notify('已恢复'); }
    catch (error: any) { notify(error.message || '恢复失败', 'error'); }
  };

  const modelInfo = getRuntimeNaiModelInfo(params.model, runtime);
  // 编辑模式按官方能力隐藏 Vibe；旧选择保留在草稿中，切回可用模式后可继续使用。
  if ((operation && operation !== 'image-to-image') || !modelInfo.supportsVibes) return null;

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Vibe Transfer</span>{vibes.enabled && vibes.slots.length > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-micro font-bold text-white">{vibes.slots.length} / {VIBE_MAX_SLOTS}</span>}</div>
            {vibes.enabled && vibes.slots.length ? <><p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300">{vibes.slots.map(slot => slot.vibeName || '未知 Vibe').join(' · ')}</p><p className="mt-0.5 text-meta text-gray-500">有效总强度 {total.toFixed(2)}{vibes.sourceGroupName ? ` · ${vibes.sourceGroupName}` : ''}</p></> : <p className="mt-1 text-xs text-gray-500">未启用 · 永久编码后可免费重复用于生图</p>}
          </div>
          <button type="button" onClick={() => setOpen(true)} className="mobile-touch flex-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-gray-800 dark:bg-gray-900 dark:text-indigo-300">管理</button>
        </div>
      </div>

      {open && <div
        className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-6"
        onClick={event => { if (event.target === event.currentTarget) closeLayer(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={detail ? detail.name : 'Vibe Transfer'}
          className="ui-modal-enter flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-gray-900 md:h-[88vh] md:max-h-[850px] md:rounded-2xl md:border md:border-gray-800"
          onClick={event => event.stopPropagation()}
        >
          <header className="flex flex-none items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 md:px-5">
            <div className="flex min-w-0 items-center gap-2">
              {detail && <BackButton onClick={() => setDetail(null)} className="mobile-touch" />}
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">{detail ? detail.name : 'Vibe Transfer (氛围参考)'}</h2>
                <p className="text-meta text-gray-500">永久 Vibe 编码 · V4.5 Full</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!detail && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">已选 {vibes.slots.length}/{VIBE_MAX_SLOTS}</span>}
              <CloseButton onClick={closeLayer} size="sm" />
            </div>
          </header>

          {detail ? <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="workspace-manager-detail mx-auto grid max-w-5xl gap-6 md:grid-cols-[minmax(280px,420px)_1fr]">
              <div className="overflow-hidden rounded-2xl bg-gray-200 dark:bg-gray-900">
                {detail.originalImageUrl ? <OriginalImage src={detail.originalImageUrl} alt={detail.name} className="max-h-[65vh] w-full object-contain" /> : <div className="flex aspect-[3/4] items-center justify-center px-6 text-center text-sm text-gray-500">此文件只包含永久编码，没有原图</div>}
              </div>
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_150px]"><div><label className="mb-1 block text-xs font-bold text-gray-500">名称</label><input defaultValue={detail.name} onBlur={async event => { const name = event.currentTarget.value.trim(); if (!name || name === detail.name) return; try { const result = await vibeService.rename(detail.id, name, detail.defaultStrength); setDetail(result.item); await load(); } catch (error: any) { notify(error.message, 'error'); } }} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-900" /></div><div><label className="mb-1 block text-xs font-bold text-gray-500">默认强度</label><input type="number" min="0" max="1" step="0.01" defaultValue={detail.defaultStrength} onBlur={async event => { const strength = Math.max(0, Math.min(1, Number(event.currentTarget.value))); if (Math.abs(strength - detail.defaultStrength) < 0.001) return; try { const result = await vibeService.rename(detail.id, detail.name, strength); setDetail(result.item); await load(); } catch (error: any) { notify(error.message, 'error'); } }} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-900" /></div></div>
                <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">编码变体</h3><span className="text-xs text-gray-500">{detail.encodings.length} 个</span></div><div className="space-y-2">{detail.encodings.map(encoding => { const usable = encoding.model === 'nai-diffusion-4-5-full'; return <div key={encoding.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><div><p className="text-sm font-semibold">信息提取量 {encoding.informationExtracted.toFixed(2)}</p><p className="mt-0.5 text-meta text-gray-500">{usable ? 'NovelAI V4.5 Full' : encoding.model} · {new Date(encoding.createdAt).toLocaleString()}</p></div><span className={`rounded-full px-2 py-1 text-micro font-bold ${usable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{usable ? '可使用' : '已保留'}</span></div>; })}</div></div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h3 className="text-sm font-bold">追加提取量</h3><p className="mt-1 text-xs leading-5 text-gray-500">已有数值会直接复用；新数值需支付 2 Anlas。无原图的 Vibe 无法追加。</p><div className="mt-3 flex gap-2"><input type="number" min="0" max="1" step="0.01" value={information} onChange={event => setInformation(Math.max(0, Math.min(1, Number(event.target.value))))} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 dark:border-gray-800" /><button type="button" disabled={!detail.hasOriginal || busyId === detail.id} onClick={() => void encode(detail, information)} className="mobile-touch rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busyId === detail.id ? '编码中…' : '追加'}</button></div></div>
                <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => void vibeService.download(detail)} className="mobile-touch rounded-xl border border-violet-300 bg-white text-sm font-bold text-violet-700 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300">导出 .naiv4vibe</button><button type="button" onClick={() => archived ? void restoreDetail() : void archiveDetail()} className={`mobile-touch rounded-xl text-sm font-bold ${archived ? 'bg-emerald-600 text-white' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'}`}>{archived ? '恢复' : '归档'}</button></div>
              </div>
            </div>
          </main> : <>
            <div className="flex flex-none flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-950/60 md:px-5">
              <div className="relative min-w-[180px] flex-1"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索我的 Vibe…" className="mobile-touch w-full rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none focus:border-violet-500 dark:border-gray-800 dark:bg-gray-900" /></div>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void handleImage(event.target.files?.[0])} />
              <input ref={vibeInputRef} type="file" accept=".naiv4vibe,application/json" className="hidden" onChange={event => void handleImport(event.target.files?.[0])} />
              <button type="button" disabled={Boolean(busyId)} onClick={() => imageInputRef.current?.click()} className="mobile-touch rounded-xl bg-violet-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-violet-500 disabled:opacity-50">{busyId === 'upload' ? '上传中…' : '上传图片'}</button>
              <button type="button" disabled={Boolean(busyId)} onClick={() => vibeInputRef.current?.click()} className="mobile-touch rounded-xl border border-violet-300 bg-white px-3 text-xs font-bold text-violet-700 disabled:opacity-50 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300">{busyId === 'import' ? '导入中…' : '导入文件'}</button>
            </div>
            <main className="workspace-manager-split grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_340px]">
              <section className="workspace-manager-list overflow-y-auto p-3 md:p-5">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-gray-900 dark:text-white">{archived ? '已归档' : '我的 Vibe'}</h3><button type="button" onClick={() => setArchived(value => !value)} className="mobile-touch rounded-lg px-3 text-xs font-medium text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800">{archived ? '返回资料库' : '查看归档'}</button></div>
                {loading ? <PageSpinner label="加载中…" className="py-20" /> : assets.length ? <div className="workspace-card-grid workspace-manager-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{assets.map(asset => { const selected = vibes.slots.some(slot => slot.vibeId === asset.id); const usableCount = asset.encodings.filter(item => item.model === 'nai-diffusion-4-5-full').length; return <article key={asset.id} className={`group overflow-hidden rounded-2xl border bg-white shadow-sm transition dark:bg-gray-900 ${selected ? 'border-violet-500 ring-2 ring-violet-500/20' : 'border-gray-200 dark:border-gray-800'}`}><button type="button" onClick={() => archived ? showDetail(asset) : void addAsset(asset)} className="block w-full text-left"><div className="relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800">{asset.thumbnailUrl ? <SmartImage src={asset.thumbnailUrl} alt={asset.name} /> : <div className="flex h-full items-center justify-center p-4 text-center text-xs text-gray-500">仅编码</div>}{selected && <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white shadow">✓</span>}</div><div className="p-3"><p className="truncate text-sm font-bold">{asset.name}</p><p className="mt-1 text-meta text-gray-500">{usableCount ? `${usableCount} 个 V4.5 编码` : asset.hasOriginal ? '待编码 · 2 Anlas' : '暂不支持的模型'}</p></div></button><button type="button" onClick={() => showDetail(asset)} className="mobile-touch w-full border-t border-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800">详情</button></article>; })}</div> : <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 text-center dark:border-gray-800"><p className="font-bold">{archived ? '没有已归档的 Vibe' : '还没有永久 Vibe'}</p><p className="mt-1 text-xs text-gray-500">上传图片进行编码，或导入现有 .naiv4vibe</p></div>}
              </section>
              <aside className="workspace-manager-selection mobile-safe-bottom overflow-y-auto border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 md:border-l md:border-t-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between"><h3 className="font-bold text-gray-900 dark:text-white">当前组合</h3><span className="text-xs font-bold text-violet-600 dark:text-violet-400">{vibes.slots.length}/{VIBE_MAX_SLOTS}</span></div>
                  <div className="mt-3 space-y-3">{vibes.slots.map((slot, index) => { const asset = assets.find(item => item.id === slot.vibeId); const usableEncodings = asset?.encodings.filter(item => item.model === 'nai-diffusion-4-5-full') || []; return <div key={`${slot.vibeId}-${index}`} draggable onDragStart={() => setDragIndex(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragIndex !== null) moveSlot(dragIndex, index); setDragIndex(null); }} className={`rounded-xl border border-gray-200 p-3 dark:border-gray-800 ${dragIndex === index ? 'opacity-50' : ''}`}><div className="flex items-center gap-1"><span className="flex h-6 w-6 flex-none cursor-grab items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300" title="拖动排序">{index + 1}</span><p className="min-w-0 flex-1 truncate text-sm font-bold">{slot.vibeName || asset?.name || '资产缺失'}</p><button type="button" disabled={index === 0} onClick={() => moveSlot(index, index - 1)} className="mobile-touch h-9 w-9 text-sm text-gray-400 disabled:opacity-20" aria-label="上移">↑</button><button type="button" disabled={index === vibes.slots.length - 1} onClick={() => moveSlot(index, index + 1)} className="mobile-touch h-9 w-9 text-sm text-gray-400 disabled:opacity-20" aria-label="下移">↓</button><button type="button" onClick={() => removeSlot(index)} className="mobile-touch h-9 w-9 text-lg text-gray-400 hover:text-red-500" aria-label="移除">×</button></div><select value={slot.encodingId} onChange={event => { const encoding = usableEncodings.find(item => item.id === event.target.value); if (encoding) updateSlot(index, { encodingId: encoding.id, informationExtracted: encoding.informationExtracted }); }} className="mt-2 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-2 text-xs dark:border-gray-800">{usableEncodings.length ? usableEncodings.map(encoding => <option key={encoding.id} value={encoding.id}>提取量 {encoding.informationExtracted.toFixed(2)}</option>) : <option>编码缺失或资产已归档</option>}</select><div className="mt-2 flex items-center gap-2"><span className="text-meta text-gray-500">强度</span><input type="range" min="0" max="1" step="0.01" value={slot.strength} onChange={event => updateSlot(index, { strength: Number(event.target.value) })} className="min-w-0 flex-1 accent-violet-600" /><input type="number" min="0" max="1" step="0.01" value={Number(slot.strength.toFixed(2))} onChange={event => updateSlot(index, { strength: Math.max(0, Math.min(1, parseFloat(event.target.value) || 0)) })} className="w-16 rounded-md border border-gray-200 bg-transparent px-1 py-1 text-right text-xs font-mono dark:border-gray-800" /></div>{vibes.normalizeStrengths && Math.abs(slot.strength - (normalized[index]?.effectiveStrength ?? slot.strength)) > 0.0001 && <p className="mt-1 text-right text-micro text-violet-600">有效强度 {normalized[index].effectiveStrength?.toFixed(2)}</p>}</div>; })}{!vibes.slots.length && <p className="rounded-xl bg-gray-50 px-3 py-8 text-center text-xs text-gray-500 dark:bg-gray-950">从左侧选择 1～16 个 Vibe</p>}</div>
                  <label className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 text-sm dark:bg-gray-950"><span><b>超限自动归一化</b><small className="block text-micro text-gray-500">总强度超过 1 时按比例缩放</small></span><input type="checkbox" checked={vibes.normalizeStrengths} onChange={event => updateVibes({ ...vibes, normalizeStrengths: event.target.checked })} className="h-5 w-5 accent-violet-600" /></label>
                  <div className="mt-4 flex gap-2"><input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="组合名称" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-800" /><button type="button" disabled={!groupName.trim() || !vibes.slots.length} onClick={() => void saveGroup()} className="mobile-touch rounded-xl bg-gray-900 px-3 text-xs font-bold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">保存</button></div>
                  {groups.length > 0 && <div className="mt-5"><h4 className="mb-2 text-xs font-bold text-gray-500">已保存组合</h4><div className="space-y-2">{groups.map(group => <div key={group.id} className="rounded-xl border border-gray-200 p-2 dark:border-gray-800">{editingGroupId === group.id ? <div className="flex gap-2"><input autoFocus value={editingGroupName} onChange={event => setEditingGroupName(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-2 text-sm dark:border-gray-800" /><button type="button" disabled={!editingGroupName.trim()} onClick={() => void updateGroup(group, { name: editingGroupName.trim() })} className="mobile-touch rounded-lg bg-violet-600 px-3 text-xs font-bold text-white disabled:opacity-40">保存</button><button type="button" onClick={() => setEditingGroupId('')} className="mobile-touch h-11 w-11 text-gray-500">×</button></div> : <div className="flex items-center gap-1"><button type="button" onClick={() => loadGroup(group)} className="mobile-touch min-w-0 flex-1 text-left"><b className="block truncate text-sm">{group.name}</b><span className="text-micro text-gray-500">{group.slots.length} 个 Vibe</span></button><button type="button" onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }} className="mobile-touch h-10 w-10 text-xs text-gray-400 hover:text-violet-500" aria-label={`重命名 ${group.name}`}>✎</button><button type="button" disabled={!vibes.slots.length} onClick={async () => { if (!await confirmAction({ title: `覆盖“${group.name}”？`, message: `将用当前 ${vibes.slots.length} 个 Vibe 和强度设置替换这个组合。`, confirmLabel: '覆盖组合' })) return; await updateGroup(group, { slots: vibes.slots.map(slot => ({ ...slot })), normalizeStrengths: vibes.normalizeStrengths }); }} className="mobile-touch h-10 w-10 text-xs text-gray-400 hover:text-violet-500 disabled:opacity-20" aria-label={`覆盖 ${group.name}`}>↻</button><button type="button" onClick={async () => { if (!await confirmAction({ title: '删除这个组合？', message: '只删除组合配置，不会删除任何 Vibe 资产或编码。', confirmLabel: '删除', tone: 'danger' })) return; await vibeService.deleteGroup(group.id); setGroups(items => items.filter(item => item.id !== group.id)); }} className="mobile-touch h-10 w-10 text-gray-400 hover:text-red-500" aria-label={`删除 ${group.name}`}>×</button></div>}</div>)}</div></div>}
                </div>
                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
                  <button type="button" onClick={closeLayer} className="mobile-touch w-full rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-violet-500 transition-colors">应用并返回实验室</button>
                </div>
              </aside>
            </main>
          </>}
        </div>
      </div>}
    </>
  );
};
