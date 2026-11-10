import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { CharacterReferenceAsset, CharacterReferenceSelection, ImageEditOperation, NAIParams } from '../types';
import { characterReferenceService } from '../services/characterReferenceService';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { SegmentedControl, BackButton, CloseButton, InlineSpinner, PageSpinner } from './DesignSystem';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useAssetManagerLayer } from './useAssetManagerLayer';
import { AssetDefaultsForm } from './AssetDefaultsForm';
import { getPastedImageFile, isTextPasteTarget, readClipboardImage } from '../services/imageClipboard';
import { ReferenceSelectionPreview } from './ReferenceSelectionPreview';
import { CHARACTER_REFERENCE_TYPES, MAX_CHARACTER_REFERENCES } from '../services/characterReferenceTypes';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';

interface Props {
  params: NAIParams;
  setParams: (params: NAIParams) => void;
  markChange: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  operation?: ImageEditOperation;
}

const referenceTypes = CHARACTER_REFERENCE_TYPES;

/**
 * 参考槽的三个数值字段。强度／保真沿用官方输入可越界的保守守卫（-1..2），
 * 信息提取量固定官方 0..1，逐个显式给出范围，避免共用一个 min/max 写错。
 */
const REFERENCE_NUMERIC_FIELDS: Array<{ field: 'strength' | 'fidelity' | 'informationExtracted'; label: string; min: number; max: number }> = [
  { field: 'strength', label: '强度', min: -1, max: 2 },
  { field: 'fidelity', label: '保真', min: -1, max: 2 },
  { field: 'informationExtracted', label: '信息提取量', min: 0, max: 1 },
];

const referenceNumericValue = (slot: CharacterReferenceSelection, field: 'strength' | 'fidelity' | 'informationExtracted') =>
  field === 'informationExtracted' ? slot.informationExtracted ?? 1 : slot[field];

const emptyReferences = (): NonNullable<NAIParams['characterReferences']> => ({ enabled: false, slots: [] });

export const CharacterReferenceManager: React.FC<Props> = ({ params, setParams, markChange, notify, operation }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const runtime = useNaiRuntime();
  const referenceCost = runtime.billing.characterReferenceCost;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { open, setOpen, detail, setDetail, showDetail, backToList, closeManager, sessionRef } = useAssetManagerLayer<CharacterReferenceAsset>('naiCharacterReferenceManager');
  const [allAssets, setAssets] = useState<CharacterReferenceAsset[]>([]);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [pane, setPane] = useState<'library' | 'selection'>('library');
  const assets = allAssets.filter(asset => Boolean(asset.archived) === archived && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const latestParams = useRef(params);
  const selectionRevision = useRef(0);
  useEffect(() => { latestParams.current = params; selectionRevision.current++; }, [params]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState('');
  const imageImportLock = useRef(false);
  const references = params.characterReferences || emptyReferences();
  const enabledCount = references.enabled ? references.slots.length : 0;
  // P2-17：模态焦点管理（焦点移入 / Tab 圈禁 / 关闭后归还）。
  const dialogRef = useModalA11y<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopmostModal(dialogRef.current)) return;
      event.preventDefault();
      if (detail) backToList(); else closeManager();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, detail]);

  const updateReferences = (next: NonNullable<NAIParams['characterReferences']>) => {
    selectionRevision.current++;
    const current = latestParams.current;
    const disablesVibes = Boolean(next.enabled && next.slots.length && current.vibes);
    // 空槽的氛围参考本来就不产生费用，只有真的在生效时才值得提醒。
    const vibeWasEffective = Boolean(current.vibes?.enabled && current.vibes.slots.length);
    const updated = {
      ...current,
      characterReferences: { ...next, slots: next.slots.map(slot => ({ ...slot })) },
      vibes: disablesVibes && current.vibes ? { ...current.vibes, enabled: false } : current.vibes,
    };
    latestParams.current = updated;
    setParams(updated);
    markChange();
    // 新增参考槽会顺带停用正在生效的氛围参考：属于有损操作，当场说明，不能静默。
    if (disablesVibes && vibeWasEffective && next.slots.length > (current.characterReferences?.slots.length ?? 0)) {
      notify(t('已关闭氛围参考：精准参考和氛围参考不能同时启用'));
    }
  };

  const loadSeqRef = useRef(0);
  const load = async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const [active, archivedItems] = await Promise.all([characterReferenceService.list('', false), characterReferenceService.list('', true)]);
      if (seq !== loadSeqRef.current) return;
      const items = [...new Map([...archivedItems, ...active].map(asset => [asset.id, asset])).values()];
      setAssets(items);
      setLoaded(true);
      setLoadError(false);
      setDetail(current => current ? items.find(asset => asset.id === current.id) || current : null);
    } catch (error: any) {
      if (seq === loadSeqRef.current) { setLoadError(true); notify(error.message || '资料库加载失败', 'error'); }
    } finally { if (seq === loadSeqRef.current) setLoading(false); }
  };
  useEffect(() => {
    if (!open) return;
    void load();
    return () => { loadSeqRef.current++; };
  }, [open]);
  const addAsset = (asset: CharacterReferenceAsset) => {
    const current = latestParams.current.characterReferences || emptyReferences();
    if (current.slots.some(slot => slot.assetId === asset.id)) {
      const slots = current.slots.filter(slot => slot.assetId !== asset.id);
      updateReferences({ enabled: slots.length > 0, slots });
      return;
    }
    if (current.slots.length >= MAX_CHARACTER_REFERENCES) { notify(t('一次最多启用 {0} 个精准参考', [MAX_CHARACTER_REFERENCES]), 'error'); return; }
    updateReferences({
      enabled: true,
      slots: [...current.slots, {
        assetId: asset.id,
        assetName: asset.name,
        // 官方新加入的参考图默认「Character & Style」、强度 1、保真 1。
        type: 'character_style',
        strength: asset.defaultStrength ?? 1,
        fidelity: asset.defaultFidelity ?? 1,
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

  const handleUpload = async (source?: File | (() => Promise<File>)) => {
    if (!source || imageImportLock.current || busyId) return;
    const session = sessionRef.current;
    const revision = selectionRevision.current;
    const isCurrent = () => session === sessionRef.current && isTopmostModal(dialogRef.current);
    imageImportLock.current = true;
    setBusyId(typeof source === 'function' ? 'paste' : 'upload');
    try {
      const file = typeof source === 'function' ? await source() : source;
      if (!isCurrent() || revision !== selectionRevision.current) return;
      const result = await characterReferenceService.create(file, file.name.replace(/\.[^.]+$/, '') || '精准参考');
      if (!isCurrent()) return;
      notify(result.duplicate ? '已找到相同的精准参考图' : '精准参考图已保存');
      await load();
      if (!isCurrent() || revision !== selectionRevision.current) return;
      if (!latestParams.current.characterReferences?.slots.some(slot => slot.assetId === result.item.id)) addAsset(result.item);
    } catch (error: any) { if (isCurrent()) notify(error.message || '图片导入失败', 'error'); }
    finally { imageImportLock.current = false; setBusyId(''); if (imageInputRef.current) imageInputRef.current.value = ''; }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isTextPasteTarget(event.target) || !isTopmostModal(dialogRef.current)) return;
    const file = getPastedImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void handleUpload(file);
  };

  const archiveDetail = async () => {
    if (!detail || !await confirmAction({
      rememberKey: 'character-reference.archive',
      title: '归档这张精准参考图？',
      message: '它会从默认资料库隐藏；已有风格串和历史仍保留引用，可随时恢复。',
      confirmLabel: '归档', tone: 'danger',
    })) return;
    try { await characterReferenceService.archive(detail.id); backToList(); await load(); notify('已归档'); }
    catch (error: any) { notify(error.message || '归档失败', 'error'); }
  };

  const restoreDetail = async () => {
    if (!detail) return;
    try { await characterReferenceService.restore(detail.id); backToList(); await load(); notify('已恢复'); }
    catch (error: any) { notify(error.message || '恢复失败', 'error'); }
  };

  const modelInfo = getRuntimeNaiModelInfo(params.model, runtime);
  const supportsReferences = operation === 'inpaint' || operation === 'outpaint'
    ? modelInfo.supportsCharacterReferenceInpainting
    : modelInfo.supportsCharacterReferences;
  const detailSelected = Boolean(detail && references.slots.some(slot => slot.assetId === detail.id));
  // 不支持的辅助模块直接隐藏；已有选择保留，切回支持的模型后由用户重新启用。
  if (!supportsReferences) return null;

  return <>
    <ReferenceSelectionPreview enabled={references.enabled} manageLabel={t('管理精准参考')} onManage={() => setOpen(true)}
      onEnable={references.slots.length ? () => updateReferences({ enabled: true, slots: references.slots }) : undefined}
      items={references.slots.map((slot, index) => {
        const asset = allAssets.find(item => item.id === slot.assetId);
        return { id: `${slot.assetId}:${index}`, name: slot.assetName || asset?.name || t('未知参考'),
          imageUrl: asset?.thumbnailUrl || asset?.originalImageUrl || `/api/character-references/${encodeURIComponent(slot.assetId)}/thumbnail`,
          description: t(referenceTypes.find(item => item.value === slot.type)?.label) };
      })}
      summary={enabledCount > 0 ? <span className="text-meta font-medium text-amber-600 dark:text-amber-400">{t('本次生成额外消耗 {0} × {1} = {2} Anlas', [enabledCount, referenceCost, enabledCount * referenceCost])}</span> : undefined}
    />

    {open && <ImagePreviewPortal><div
      className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-6"
      onClick={event => { if (event.target === event.currentTarget) closeManager(); }}
    >
      <div
        ref={dialogRef}
        onPaste={handlePaste}
        role="dialog"
        aria-modal="true"
        aria-label={detail ? detail.name : t("精准参考")}
        className="operation-dialog ui-modal-enter flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
        onClick={event => event.stopPropagation()}
      >
        <header className="appearance-content operation-header flex flex-none items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {detail && <BackButton onClick={backToList} className="mobile-touch" />}
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">{detail ? detail.name : t("精准参考")}</h2>
              <p className="text-meta text-gray-500">{detail
                ? t('创建于 {0} · {1} Anlas／张／次', [new Date(detail.createdAt).toLocaleString(getLanguage()), referenceCost])
                : t("与氛围参考互斥 · {0} Anlas／张／次", [referenceCost])}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">

            <CloseButton onClick={closeManager} size="sm" />
          </div>
        </header>

        {detail && <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6">
          <div className="workspace-manager-detail mx-auto grid max-w-5xl gap-5 md:grid-cols-[minmax(280px,1fr)_minmax(300px,1fr)]">
            <div className="overflow-hidden rounded-2xl bg-black/5 dark:bg-black/30"><OriginalImage src={detail.originalImageUrl} alt={detail.name} className="max-h-[70vh] w-full object-contain" /></div>
            <div className="space-y-4">
              <AssetDefaultsForm key={detail.id} name={detail.name} strength={detail.defaultStrength} fidelity={detail.defaultFidelity} min={-1} max={2} onSave={async (name, strength, fidelity) => {
                  const session = sessionRef.current;
                  const result = await characterReferenceService.rename(detail.id, name, strength, fidelity);
                  if (session !== sessionRef.current) return;
                  setDetail(current => current?.id === result.item.id ? result.item : current);
                  await load();
                }} />
              {!detail.archived && <button type="button" onClick={() => addAsset(detail)} className={`mobile-touch w-full rounded-xl text-sm font-bold ${detailSelected ? 'border border-indigo-300 bg-white text-indigo-700 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-300' : 'bg-indigo-700 text-white hover:bg-indigo-600 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90'}`}>{detailSelected ? t("从本次使用移除") : t("加入本次使用")}</button>}
              <button type="button" onClick={() => archived ? void restoreDetail() : void archiveDetail()} className={`mobile-touch w-full rounded-xl text-sm font-bold ${archived ? 'bg-emerald-700 text-white' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'}`}>{archived ? t("恢复到资料库") : t("归档")}</button>
            </div>
          </div>
        </main>}
          <div hidden={Boolean(detail)} data-pane={pane} className="manager-library">
          <div className="appearance-content operation-toolbar flex flex-none flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-950/60 sm:px-5">
            <SegmentedControl
              value={archived ? 'archived' : 'active'}
              onChange={val => setArchived(val === 'archived')}
              options={[
                { value: 'active', label: t("资料库") },
                { value: 'archived', label: t("已归档") },
              ]}
              size="sm"
              ariaLabel={t("资料库范围")}
            />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("搜索精准参考…")} className={`${TOOLBAR_FIELD_CLASS} !mt-0 !h-9 min-w-40 flex-1 text-xs`} />
            <input aria-label={t("上传精准参考图片")} ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void handleUpload(event.target.files?.[0])} />
            <button type="button" disabled={Boolean(busyId)} onClick={() => imageInputRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-3.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-50 transition-colors">
              {busyId ? t("保存中…") : t("上传并选用")}
            </button>
            <button type="button" disabled={Boolean(busyId)} onClick={() => void handleUpload(() => readClipboardImage({ pasteHint: '在参考窗口按 Ctrl+V', imagePurpose: '精准参考' }))} className="appearance-group mobile-touch inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-3.5 text-xs font-bold text-indigo-700 disabled:opacity-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-300">{busyId === 'paste' ? t("粘贴中…") : t("粘贴图片")}</button>
          </div>
          <div className="manager-mobile-tabs flex-none gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800"><SegmentedControl value={pane} onChange={value => setPane(value as 'library' | 'selection')} options={[{ value: 'library', label: t("浏览") }, { value: 'selection', label: t("本次使用 ({0})", [references.slots.length]) }]} size="sm" ariaLabel={t("查看区域")} /></div>
            <main className="workspace-manager-split grid min-h-0 flex-1 ">
            <div className="workspace-manager-list overflow-y-auto p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
              {loadError && <p role="alert" className="mb-3 text-sm text-red-600">{t("资料库加载失败")} <button type="button" disabled={loading} onClick={() => void load()} className="mobile-touch rounded-lg px-3 font-bold disabled:opacity-40">{t("重试")}</button></p>}
                {!loaded ? (loading ? <PageSpinner /> : null) : loading && !allAssets.length ? <PageSpinner /> : assets.length ? <>{loading && <InlineSpinner className="mb-3 w-full" />}<div className="workspace-manager-grid grid gap-3">{assets.map(asset => { const selected = references.slots.some(slot => slot.assetId === asset.id); return <article key={asset.id} className={`appearance-group overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-gray-900 ${selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-200 dark:border-gray-800'}`}>
                <button type="button" onClick={() => archived ? showDetail(asset) : addAsset(asset)} className="block w-full text-left"><div className="appearance-media relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800"><SmartImage src={asset.thumbnailUrl || asset.originalImageUrl} alt={asset.name} className="h-full w-full object-contain" />{selected && <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 text-sm font-bold text-white shadow">✓</span>}</div><div className="p-3"><p className="truncate text-sm font-bold">{asset.name}</p><p className="mt-1 text-meta text-gray-500">{t("每次生图 {0} Anlas", [referenceCost])}</p></div></button>
                <button type="button" onClick={() => showDetail(asset)} className="mobile-touch w-full border-t border-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800">{t("详情")}</button>
              </article>; })}</div></> : <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 text-center dark:border-gray-800"><p className="font-bold">{archived ? t("没有已归档的精准参考") : t("还没有精准参考图")}</p>{!archived && <p className="mt-2 max-w-64 text-xs text-gray-500">{t("点上方「上传并选用」，或直接在这个窗口按 Ctrl+V 粘贴图片")}</p>}</div>}
            </div>
            <aside className="appearance-content workspace-manager-selection overflow-y-auto border-t border-gray-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-800 dark:bg-gray-900 md:border-l md:border-t-0 flex flex-col">
              <div>
                <div className="flex items-center justify-between"><h3 className="font-bold text-gray-900 dark:text-white">{t("当前参考")}</h3><span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{references.slots.length}/{MAX_CHARACTER_REFERENCES}</span></div>
                <div className="mt-3 space-y-3">{references.slots.map((slot, index) => <div key={`${slot.assetId}-${index}`} data-agent-object={`精准参考 ${index + 1}：${slot.assetName || slot.assetId}`} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                  <div className="flex items-center gap-2"><span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{index + 1}</span>{allAssets.find(asset => asset.id === slot.assetId)?.thumbnailUrl && <div className="h-8 w-7 flex-none"><SmartImage src={allAssets.find(asset => asset.id === slot.assetId)!.thumbnailUrl} alt="" className="h-full w-full object-contain" /></div>}<p className="min-w-0 flex-1 truncate text-sm font-bold">{slot.assetName || allAssets.find(asset => asset.id === slot.assetId)?.name || (loaded ? t("资产缺失") : slot.assetId)}</p><button type="button" onClick={() => removeSlot(index)} className="mobile-touch flex h-9 w-9 items-center justify-center p-0 text-lg leading-none text-gray-400 hover:text-red-500" aria-label={t("移除")}>×</button></div>
                  <div className="mt-2 space-y-2">
                    <label className="block text-meta text-gray-500">{t("参考类型")}<select value={slot.type} onChange={event => updateSlot(index, { type: event.target.value as CharacterReferenceSelection['type'] })} className="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-2 text-xs dark:border-gray-800">{referenceTypes.map(item => <option key={item.value} value={item.value}>{t(item.label)} · {t(item.hint)}</option>)}</select></label>
                    {REFERENCE_NUMERIC_FIELDS.map(({ field, label, min, max }) => {
                      const value = referenceNumericValue(slot, field);
                      const commit = (input: number) => updateSlot(index, { [field]: Math.max(min, Math.min(max, input)) } as Partial<CharacterReferenceSelection>);
                      return <div key={field} className="grid grid-cols-[42px_minmax(0,1fr)_58px] items-center gap-2"><span className="text-meta text-gray-500">{t(label)}</span><input type="range" min={min} max={max} step={0.05} value={value} onChange={event => commit(Number(event.target.value))} className="min-w-0 accent-indigo-600" /><input type="number" min={min} max={max} step={0.05} value={value} onChange={event => commit(Number(event.target.value))} className="rounded-md border border-gray-200 bg-transparent px-1 py-1 text-right text-xs font-mono dark:border-gray-800" /></div>;
                    })}
                  </div>
                </div>)}{!references.slots.length && <p className="appearance-group rounded-xl bg-gray-50 px-3 py-8 text-center text-xs text-gray-500 dark:bg-gray-950">{t("未选择参考图")}</p>}</div>
                {references.slots.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"><b>{t("本次额外消耗 {0} Anlas", [references.slots.length * referenceCost])}</b><p className="mt-1 opacity-80">{t("{0} 张参考图 × {1}；每次生成都会重新计费。", [references.slots.length, referenceCost])}</p>{references.slots.filter(slot => slot.type !== 'style').length > 1 && <p className="mt-1 font-medium">{t("多个参考在同一次生成里一起生效，费用按张分别计算")}</p>}</div>}
              </div>

            </aside>
          </main>
          </div>
          <footer className="appearance-content operation-footer flex flex-none items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-800"><button type="button" onClick={closeManager} className="mobile-touch rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300" title={t("本次选择即时生效")}>{t("完成")}</button></footer>
      </div>
    </div></ImagePreviewPortal>}
  </>;
};
