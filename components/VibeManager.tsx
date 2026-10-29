import { confirmationCostScope } from '../services/dailyConfirmation';
import { t, useLanguage, getLanguage } from '../services/i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageEditOperation, LabWorkspaceSession, NAIParams, VibeAsset, VibeGroup, VibeSelection } from '../types';
import type { ExportReceipt } from '../services/exportLocation';
import { vibeService } from '../services/vibeService';
import { VIBE_MAX_SLOTS, normalizeVibeSelections, resolveVibeSlots } from '../services/vibeUtils';
import { defaultVibeInformation, vibeBaseModel, vibeStrength } from '../services/vibeProtocol.mjs';
import { useAnlasBudget } from '../services/anlasBudget';
import { useNovelaiUsage } from '../services/naiUsage';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { useNaiRuntime } from '../services/naiRuntime';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { SegmentedControl, BackButton, CloseButton, PageSpinner } from './DesignSystem';
import { useModalA11y, isTopmostModal } from './useModalA11y';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useAssetManagerLayer } from './useAssetManagerLayer';
import { AssetDefaultsForm } from './AssetDefaultsForm';

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

const assertUnusedVibe = (params: NAIParams, asset: VibeAsset, encodingId?: string) => {
  const knownEncodings = new Set(asset.encodings.map(item => item.id));
  const check = (candidate: Partial<NAIParams> | undefined, source: string) => {
    if (Array.isArray(candidate?.vibes?.slots) && candidate.vibes.slots.some(slot => slot.vibeId === asset.id && (!encodingId || !knownEncodings.has(slot.encodingId) || slot.encodingId === encodingId))) {
      throw new Error(t('{0}仍被{1}引用，请先移除对应参考后再永久删除', [encodingId ? t('这份 Vibe 编码') : t('这个 Vibe'), source]));
    }
  };
  check(params, t('当前实验室草稿'));
  const references: Array<{ params?: Partial<NAIParams>; source: string }> = [];
  const workspace = (value: Partial<LabWorkspaceSession> | null) => {
    references.push({ params: value?.textToImage?.params, source: t('本浏览器的实验室草稿') });
    for (const mode of ['image-to-image', 'inpaint', 'outpaint'] as const) references.push({ params: value?.edits?.[mode]?.params, source: t('本浏览器的实验室草稿') });
  };
  const parse = (raw: string | null) => {
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error();
    return value;
  };
  try {
    for (const storage of [sessionStorage, localStorage]) {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith('nai-lab-workspace-v1:')) workspace(parse(storage.getItem(key)));
      }
    }
    references.push({ params: parse(sessionStorage.getItem('nai_pending_import'))?.params, source: t('待导入配置') });
    references.push({ params: parse(sessionStorage.getItem('nai_last_copied_image'))?.data?.params, source: t('最后复制图片的配置') });
    const backup = parse(localStorage.getItem('nai-update-lab-drafts'));
    if (backup !== null) {
      if (typeof backup.savedAt !== 'number' || !backup.entries || typeof backup.entries !== 'object' || Array.isArray(backup.entries)) throw new Error();
      if (Date.now() - backup.savedAt <= 24 * 60 * 60 * 1000) {
        for (const [key, value] of Object.entries(backup.entries)) if (key.startsWith('nai-lab-workspace-v1:')) {
          if (typeof value !== 'string') throw new Error();
          workspace(parse(value));
        }
      }
    }
  } catch { throw new Error(t('浏览器草稿无法读取，无法核对引用；已保留 Vibe，请先检查草稿后再删除')); }
  references.forEach(reference => check(reference.params, reference.source));
};

export const VibeManager: React.FC<VibeManagerProps> = ({ params, setParams, markChange, apiKey, notify, operation }) => {
  useLanguage();
  const confirmAction = useConfirmDialog();
  const runtime = useNaiRuntime();
  const encodingCost = runtime.billing.vibeEncodingCost;
  const model = vibeBaseModel(params.model);
  const modelInfo = getRuntimeNaiModelInfo(params.model, runtime);
  const modelLabel = modelInfo.label || model;
  const defaultInformation = defaultVibeInformation(model);
  const anlasBudget = useAnlasBudget();
  const { refreshIfStale: refreshUsageIfStale } = useNovelaiUsage();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const vibeInputRef = useRef<HTMLInputElement>(null);
  const { open, setOpen, detail, setDetail, showDetail, backToList, closeManager, sessionRef } = useAssetManagerLayer<VibeAsset>('naiVibeManager');
  const dialogRef = useModalA11y<HTMLDivElement>(open);
  const [allAssets, setAssets] = useState<VibeAsset[]>([]);
  const [groups, setGroups] = useState<VibeGroup[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [exportingId, setExportingId] = useState('');
  const exportLock = useRef(false);
  const [deletingId, setDeletingId] = useState('');
  const deleteLock = useRef(false);
  const latestDetailId = useRef(detail?.id);
  latestDetailId.current = detail?.id;
  const encodingLock = useRef(false);
  const [archived, setArchived] = useState(false);
  const [pane, setPane] = useState<'library' | 'selection'>('library');
  const assets = allAssets.filter(asset => Boolean(asset.archived) === archived && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const latestParams = useRef(params);
  const latestApiKey = useRef(apiKey);
  useEffect(() => { latestApiKey.current = apiKey; }, [apiKey]);
  const selectionRevision = useRef(0);
  useEffect(() => { latestParams.current = params; selectionRevision.current++; }, [params, apiKey]);
  const [information, setInformation] = useState(defaultInformation);
  const [metadataRetry, setMetadataRetry] = useState(0);
  useEffect(() => { setInformation(defaultInformation); }, [model]);
  const [groupName, setGroupName] = useState('');
  const [selectionTab, setSelectionTab] = useState<'current' | 'groups'>('current');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingGroupId, setEditingGroupId] = useState('');
  const [editingGroupName, setEditingGroupName] = useState('');
  const vibes = params.vibes || emptyVibes();
  const maxSlots = VIBE_MAX_SLOTS;
  const normalized = useMemo(
    () => normalizeVibeSelections(vibes.slots, vibes.normalizeStrengths),
    [vibes.normalizeStrengths, vibes.slots],
  );
  const total = normalized.reduce((sum, slot) => sum + Math.abs(slot.effectiveStrength ?? slot.strength), 0);

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

  const updateVibes = (next: NonNullable<NAIParams['vibes']>) => {
    selectionRevision.current++;
    const current = latestParams.current;
    const updated = {
      ...current,
      vibes: { ...next, slots: next.slots.map(slot => ({ ...slot })) },
      characterReferences: next.enabled && next.slots.length && current.characterReferences
        ? { ...current.characterReferences, enabled: false }
        : current.characterReferences,
    };
    latestParams.current = updated;
    setParams(updated);
    markChange();
  };

  useEffect(() => {
    if (!params.vibes?.embedded) { setBusyId(current => current === 'metadata' ? '' : current); return; }
    const embedded = params.vibes.embedded;
    const importedSlots = params.vibes.slots;
    let active = true;
    setBusyId('metadata');
    void vibeService.resolveParams(params).then(resolved => {
      const current = latestParams.current.vibes;
      if (!active || current?.embedded !== embedded) return;
      updateVibes({ ...current, embedded: undefined,
        slots: JSON.stringify(current.slots) === JSON.stringify(importedSlots) ? resolved.vibes!.slots : current.slots });
    }).catch(error => { if (active) notify(error.message || 'Vibe 导入失败', 'error'); })
      .finally(() => { if (active) setBusyId(''); });
    return () => { active = false; };
  }, [params.vibes?.embedded, metadataRetry]);

  // 切换模型只复用同参数的已有编码；缺少的留给创作者主动处理，不付费补齐。
  useEffect(() => {
    if (!open && !params.vibes?.slots.length) return;
    const selected = params.vibes;
    let active = true;
    void Promise.all([vibeService.list('', false), vibeService.list('', true)]).then(lists => {
      if (!active || latestParams.current.vibes !== selected || !selected) return;
      const assets = lists.flat();
      const slots = resolveVibeSlots(selected.slots, assets, model);
      if (slots.some((slot, index) => slot !== selected.slots[index])) updateVibes({ ...selected, slots });
    }).catch(() => { /* 实际打开管理窗口时沿用统一加载错误提示。 */ });
    return () => { active = false; };
  }, [model]);

  useEffect(() => {
    if (!params.vibes?.slots.length || !allAssets.length) return;
    const slots = resolveVibeSlots(params.vibes.slots, allAssets, model);
    if (slots.some((slot, index) => slot !== params.vibes!.slots[index])) updateVibes({ ...params.vibes, slots });
  }, [model, allAssets, params.vibes]);

  const loadSeqRef = useRef(0);
  const load = async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setGroupsLoading(true);
    await Promise.all([
      Promise.all([vibeService.list('', false), vibeService.list('', true)]).then(([active, archivedItems]) => {
        if (seq !== loadSeqRef.current) return;
        const items = [...new Map([...archivedItems, ...active].map(asset => [asset.id, asset])).values()];
        setAssets(items);
        setLoaded(true);
        setLoadError(false);
        setDetail(current => current ? items.find(asset => asset.id === current.id) || current : null);
      }).catch(error => {
        if (seq === loadSeqRef.current) { setLoadError(true); notify(error.message || '资料库加载失败', 'error'); }
      }).finally(() => { if (seq === loadSeqRef.current) setLoading(false); }),
      vibeService.listGroups().then(nextGroups => {
        if (seq !== loadSeqRef.current) return;
        setGroups(nextGroups);
        setGroupsLoaded(true);
        setGroupsError(false);
      }).catch(error => {
        if (seq === loadSeqRef.current) { setGroupsError(true); notify(error.message || '组合加载失败', 'error'); }
      }).finally(() => { if (seq === loadSeqRef.current) setGroupsLoading(false); }),
    ]);
  };
  useEffect(() => {
    if (!open) return;
    void load();
    return () => { loadSeqRef.current++; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const encode = async (asset: VibeAsset, value: number) => {
    const session = sessionRef.current;
    const fixed = value;
    const existing = asset.encodings.find(item => item.model === model && item.informationKnown !== false && !item.parameters?.mask && item.informationExtracted === fixed);
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
    await refreshUsageIfStale();
    if (session !== sessionRef.current || latestApiKey.current !== apiKey || encodingLock.current) return null;
    encodingLock.current = true;
    setBusyId(asset.id);
    try {
      const accepted = await confirmAction({
        rememberKey: 'vibe.encode', rememberScope: confirmationCostScope(apiKey, encodingCost, 1, anlasBudget.remaining, [model, fixed]),
        title: '生成永久 Vibe',
        message: `模型：${modelLabel}\n信息提取量：${fixed.toFixed(2)}\n本次估算：${encodingCost} Anlas\n本地预算：${anlasBudget.remaining} → ${Math.max(0, anlasBudget.remaining - encodingCost)}\n\n编码永久复用。`,
        confirmLabel: `支付 ${encodingCost} Anlas 并生成`,
      });
      if (!accepted || session !== sessionRef.current || latestApiKey.current !== apiKey || vibeBaseModel(latestParams.current.model) !== model) return null;
      const result = await vibeService.encode(asset.id, fixed, apiKey, model);
      if (session !== sessionRef.current) return null;
      setAssets(items => items.map(item => item.id === asset.id ? result.item : item));
      setDetail(current => current?.id === asset.id ? result.item : current);
      notify(result.duplicate ? '已有相同编码，未重复扣费' : '永久 Vibe 编码已保存');
      return result.item.encodings.find(item => item.model === model && item.informationKnown !== false && item.informationExtracted === fixed) || null;
    } catch (error: any) {
      notify(error.message || 'Vibe 编码失败', 'error');
      return null;
    } finally { encodingLock.current = false; setBusyId(''); }
  };

  const addAsset = async (asset: VibeAsset) => {
    if (encodingLock.current) return;
    const session = sessionRef.current;
    const revision = selectionRevision.current;
    if (vibes.slots.some(slot => slot.vibeId === asset.id)) {
      updateVibes({ ...vibes, slots: vibes.slots.filter(slot => slot.vibeId !== asset.id), enabled: vibes.slots.length > 1 });
      return;
    }
    if (vibes.slots.length >= maxSlots) {
      notify(`一次最多启用 ${maxSlots} 个 Vibe`, 'error');
      return;
    }
    const usableEncodings = asset.encodings.filter(item => item.model === model);
    let encoding: typeof usableEncodings[number] | undefined = usableEncodings.find(item => item.informationExtracted === defaultInformation) || usableEncodings[0];
    if (!encoding) encoding = await encode(asset, defaultInformation) || undefined;
    if (!encoding) return;
    if (session !== sessionRef.current || revision !== selectionRevision.current) {
      notify('编码已保存，当前选择已变化，请重新选择该 Vibe');
      return;
    }
    const current = latestParams.current.vibes || emptyVibes();
    updateVibes({
      ...current,
      enabled: true,
      sourceGroupId: undefined,
      sourceGroupName: undefined,
      slots: [...current.slots, {
        vibeId: asset.id,
        vibeName: asset.name,
        encodingId: encoding.id,
        informationExtracted: encoding.informationExtracted,
        informationKnown: encoding.informationKnown,
        strength: asset.defaultStrength ?? 0.6,
      }],
    });
  };

  const handleImage = async (file?: File) => {
    if (!file) return;
    const session = sessionRef.current;
    setBusyId('upload');
    try {
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || '未命名 Vibe';
      const result = await vibeService.create(file, name);
      if (session !== sessionRef.current) return;
      setAssets(items => [result.item, ...items.filter(item => item.id !== result.item.id)]);
      showDetail(result.item);
      if (result.item.encodings.length) notify('已找到相同图片，直接打开现有 Vibe');
      else await encode(result.item, defaultInformation);
    } catch (error: any) { notify(error.message || '上传失败', 'error'); }
    finally { setBusyId(''); if (imageInputRef.current) imageInputRef.current.value = ''; }
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    const session = sessionRef.current;
    const revision = selectionRevision.current;
    setBusyId('import');
    try {
      const result = await vibeService.importFile(file, model);
      if (session !== sessionRef.current) return;
      await load();
      if (session !== sessionRef.current) return;
      if (revision !== selectionRevision.current) { notify('资料已导入，当前选择已变化，请从资料库取用'); return; }
      if (result.slots) {
        const current = latestParams.current.vibes || emptyVibes();
        const slots = importMode === 'append' ? [...current.slots, ...result.slots] : result.slots;
        if (slots.length > maxSlots) { notify('资料已导入，当前组合超过 16 项，请先调整选择', 'error'); return; }
        updateVibes({ enabled: true, normalizeStrengths: current.slots.length && importMode === 'append' ? current.normalizeStrengths : result.normalizeStrengths, slots });
        setPane('selection'); setSelectionTab('current'); setGroupName(file.name.replace(/\.[^.]+$/, ''));
      } else showDetail(result.item);
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

  const exportFile = async (id: string, download: () => Promise<ExportReceipt>) => {
    if (exportLock.current || deleteLock.current) return;
    exportLock.current = true; setExportingId(id);
    try {
      const receipt = await download();
      if (receipt.cancelled) return;
      if (receipt.saved) notify(t('Vibe 文件已保存'), 'success');
      else if (receipt.browserDownload) notify(t('已开始下载 Vibe 文件'));
      else throw new Error(t('导出文件未写入'));
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) notify(error instanceof Error ? error.message : '导出失败', 'error'); }
    finally { exportLock.current = false; setExportingId(''); }
  };

  const deleteArchived = async (asset: VibeAsset, encoding?: VibeAsset['encodings'][number]) => {
    if (!asset.archived || deleteLock.current || exportLock.current || busyId) return;
    const session = sessionRef.current;
    deleteLock.current = true; setDeletingId(encoding?.id || asset.id);
    try {
      assertUnusedVibe(latestParams.current, asset, encoding?.id);
      const accepted = await confirmAction({
        rememberKey: encoding ? 'vibe-encoding.delete' : 'vibe.delete',
        title: encoding ? t('永久删除这份编码？') : t('永久删除“{0}”？', [asset.name]),
        message: encoding
          ? t('将永久删除这份编码，原图和其他编码保留。此操作无法恢复，重新编码可能产生费用。其他标签页、浏览器或设备的未保存草稿无法检查。')
          : t('将永久删除原图及全部 {0} 份编码，无法恢复。有引用时会阻止删除；其他标签页、浏览器或设备的未保存草稿无法检查。', [asset.encodings.length]),
        confirmLabel: t('永久删除'), tone: 'danger',
      });
      if (!accepted || session !== sessionRef.current || latestDetailId.current !== asset.id) return;
      assertUnusedVibe(latestParams.current, asset, encoding?.id);
      if (encoding) {
        const result = await vibeService.deleteEncoding(asset.id, encoding.id);
        setAssets(items => items.map(item => item.id === asset.id ? result.item : item));
        setDetail(current => current?.id === asset.id ? result.item : current);
        notify(t('已永久删除编码'));
      } else {
        await vibeService.delete(asset.id);
        setAssets(items => items.filter(item => item.id !== asset.id));
        if (session === sessionRef.current && latestDetailId.current === asset.id) backToList();
        notify(t('已永久删除 Vibe'));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t('删除失败'), 'error');
      if (error instanceof Error && 'status' in error && error.status === 503) {
        const seq = ++loadSeqRef.current;
        try {
          const lists = await Promise.all([vibeService.list('', false), vibeService.list('', true)]);
          if (seq !== loadSeqRef.current) return;
          const items = [...new Map(lists.flat().map(item => [item.id, item])).values()];
          setAssets(items);
          if (session === sessionRef.current && latestDetailId.current === asset.id) {
            const updated = items.find(item => item.id === asset.id);
            setDetail(current => current?.id === asset.id ? updated || null : current);
            if (!updated) backToList();
          }
        } catch { /* 保留删除错误和当前草稿，不重试删除。 */ }
      }
    }
    finally { deleteLock.current = false; setDeletingId(''); }
  };

  const loadGroup = (group: VibeGroup) => {
    updateVibes({ enabled: group.slots.length > 0, sourceGroupId: group.id, sourceGroupName: group.name, normalizeStrengths: group.normalizeStrengths, slots: resolveVibeSlots(group.slots.map(slot => ({ ...slot })), allAssets, model) });
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
    const accepted = await confirmAction({ rememberKey: 'vibe.archive', title: '归档这个 Vibe？', message: '它会从当前资料库隐藏，但编码和文件仍会保留，已有风格串与历史仍可复现。', confirmLabel: '归档', tone: 'danger' });
    if (!accepted) return;
    try { await vibeService.archive(detail.id); backToList(); await load(); notify('已归档'); }
    catch (error: any) { notify(error.message || '归档失败', 'error'); }
  };

  const restoreDetail = async () => {
    if (!detail) return;
    try { await vibeService.restore(detail.id); backToList(); await load(); notify('已恢复'); }
    catch (error: any) { notify(error.message || '恢复失败', 'error'); }
  };

  // 编辑模式按官方能力隐藏 Vibe；旧选择保留在草稿中，切回可用模式后可继续使用。
  if ((operation && operation !== 'image-to-image') || !modelInfo.supportsVibes) return null;

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Vibe Transfer</span>{vibes.enabled && vibes.slots.length > 0 && <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-micro font-bold text-white">{vibes.slots.length} / {maxSlots}</span>}</div>
            {vibes.enabled && vibes.slots.length ? <><p className="mt-1 truncate text-xs text-gray-700 dark:text-gray-300">{vibes.slots.map(slot => slot.vibeName || '未知 Vibe').join(' · ')}</p><p className="mt-0.5 text-meta text-gray-500">{t("有效总强度 {0}{1}", [total.toFixed(2), vibes.sourceGroupName ? ` · ${vibes.sourceGroupName}` : ''])}</p></> : <p className="mt-1 text-xs text-gray-500">{t("未启用")}</p>}
          </div>
          {vibes.embedded && <button type="button" disabled={busyId === 'metadata'} onClick={() => setMetadataRetry(value => value + 1)} className="mobile-touch text-xs text-amber-600">{busyId === 'metadata' ? t('导入中…') : t('重试导入')}</button>}
          <button type="button" onClick={() => setOpen(true)} className="appearance-group mobile-touch flex-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:border-gray-800 dark:bg-gray-900 dark:text-indigo-300">{t("管理")}</button>
        </div>
      </div>

      {open && <ImagePreviewPortal><div
        className="ui-backdrop-enter fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-6"
        onClick={event => { if (event.target === event.currentTarget) closeManager(); }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={detail ? detail.name : 'Vibe Transfer'}
          className="operation-dialog ui-modal-enter flex flex-col border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
          onClick={event => event.stopPropagation()}
        >
          <header className="appearance-content operation-header flex flex-none items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 md:px-5">
            <div className="flex min-w-0 items-center gap-2">
              {detail && <BackButton onClick={backToList} className="mobile-touch" />}
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">{detail ? detail.name : t("Vibe Transfer (氛围参考)")}</h2>
                <p className="text-meta text-gray-500">{t("永久 Vibe 编码 · {0}", [modelLabel])}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">

              <CloseButton onClick={closeManager} size="sm" />
            </div>
          </header>

          {detail && <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="workspace-manager-detail mx-auto grid max-w-5xl gap-6 md:grid-cols-[minmax(280px,420px)_1fr]">
              <div className="appearance-media overflow-hidden rounded-2xl bg-gray-200 dark:bg-gray-900">
                {detail.originalImageUrl ? <OriginalImage src={detail.originalImageUrl} alt={detail.name} className="max-h-[65vh] w-full object-contain" /> : <div className="flex aspect-[3/4] items-center justify-center px-6 text-center text-sm text-gray-500">{t("此文件只包含永久编码，没有原图")}</div>}
              </div>
              <div className="space-y-5">
                <AssetDefaultsForm key={detail.id} name={detail.name} strength={detail.defaultStrength} min={-Infinity} max={Infinity} onSave={async (name, strength) => {
                  const session = sessionRef.current;
                  const result = await vibeService.rename(detail.id, name, strength);
                  if (session !== sessionRef.current) return;
                  setDetail(current => current?.id === result.item.id ? result.item : current);
                  await load();
                }} />
                <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">{t("编码变体")}</h3><span className="text-xs text-gray-500">{t("{0} 个", [detail.encodings.length])}</span></div><div className="space-y-2">{detail.encodings.map(encoding => { const usable = encoding.model === model; return <div key={encoding.id} className="appearance-group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"><div className="min-w-0 flex-1 basis-40"><p className="text-sm font-semibold">{t("信息提取量 {0}", [encoding.informationKnown === false ? t('未知') : encoding.informationExtracted.toFixed(2)])}</p><p className="mt-0.5 break-all text-meta text-gray-500">{encoding.model} · {new Date(encoding.createdAt).toLocaleString(getLanguage())}</p></div><span className={`rounded-full px-2 py-1 text-micro font-bold ${usable ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{usable ? t("可使用") : t("已保留")}</span>{detail.archived && <button type="button" disabled={Boolean(deletingId || exportingId || busyId)} onClick={() => void deleteArchived(detail, encoding)} aria-label={t("永久删除编码 {0} · {1}", [encoding.model, encoding.informationKnown === false ? t("未知") : encoding.informationExtracted.toFixed(2)])} className="mobile-touch flex-none whitespace-nowrap rounded-lg px-2 text-xs text-red-600 disabled:opacity-40">{deletingId === encoding.id ? t("删除中…") : t("删除编码")}</button>}</div>; })}</div></div>
                <div className="appearance-group rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h3 className="text-sm font-bold">{t("追加提取量")}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{t("新提取量：{0} Anlas；无原图不可追加。", [encodingCost])}</p><div className="mt-3 flex gap-2"><input type="number" min="0" max="1" step="0.01" value={information} onChange={event => setInformation(Math.max(0, Math.min(1, Number(event.target.value))))} className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 dark:border-gray-800" /><button type="button" disabled={!detail.hasOriginal || busyId === detail.id || Boolean(deletingId)} onClick={() => void encode(detail, information)} className="mobile-touch rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50">{busyId === detail.id ? t("编码中…") : t("追加")}</button></div></div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" disabled={Boolean(exportingId || deletingId)} onClick={() => void exportFile('asset:' + detail.id, () => vibeService.download(detail))} className="appearance-group mobile-touch rounded-xl border border-violet-300 bg-white text-sm font-bold text-violet-700 disabled:opacity-40 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300">{exportingId === 'asset:' + detail.id ? t("导出中…") : t("导出全部编码")}</button>
                  <button type="button" disabled={Boolean(deletingId)} onClick={() => archived ? void restoreDetail() : void archiveDetail()} className={`mobile-touch rounded-xl text-sm font-bold disabled:opacity-40 ${archived ? 'bg-emerald-700 text-white' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'}`}>{archived ? t("恢复") : t("归档")}</button>
                </div>
                {detail.archived && <button type="button" disabled={Boolean(deletingId || exportingId || busyId)} onClick={() => void deleteArchived(detail)} className="mobile-touch w-full rounded-xl border border-red-200 px-3 text-sm font-bold text-red-600 disabled:opacity-40 dark:border-red-900">{deletingId === detail.id ? t("删除中…") : t("永久删除 Vibe")}</button>}
              </div>
            </div>
          </main>}
          <div hidden={Boolean(detail)} data-pane={pane} className="manager-library">
            <div className="appearance-content operation-toolbar flex flex-none flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-950/60 md:px-5">
              <SegmentedControl value={archived ? 'archived' : 'active'} onChange={value => setArchived(value === 'archived')} options={[{ value: 'active', label: t("资料库") }, { value: 'archived', label: t("已归档") }]} size="sm" ariaLabel={t("资料库范围")} />
              <div className="relative min-w-[180px] flex-1"><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t("搜索我的 Vibe…")} className="mobile-touch h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-xs outline-none focus:border-violet-500 dark:border-gray-800 dark:bg-gray-900" /></div>
              <input aria-label={t("上传 Vibe 图片")} ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void handleImage(event.target.files?.[0])} />
              <select aria-label={t("Vibe 导入方式")} value={importMode} onChange={event => setImportMode(event.target.value as 'append' | 'replace')} className="mobile-touch h-9 rounded-xl border border-gray-200 bg-transparent px-2 text-xs dark:border-gray-800"><option value="append">{t("追加参考")}</option><option value="replace">{t("替换参考")}</option></select><input aria-label={t("导入 Vibe 编码文件")} ref={vibeInputRef} type="file" accept=".naiv4vibe,.naiv4vibeBundle,.png,application/json,image/png" className="hidden" onChange={event => void handleImport(event.target.files?.[0])} />
              <button type="button" disabled={Boolean(busyId)} onClick={() => imageInputRef.current?.click()} className="mobile-touch h-9 rounded-xl bg-violet-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-violet-500 disabled:opacity-50">{busyId === 'upload' ? t("上传中…") : t("上传并编码")}</button>
              <button type="button" disabled={Boolean(busyId)} onClick={() => vibeInputRef.current?.click()} className="appearance-group mobile-touch h-9 rounded-xl border border-violet-300 bg-white px-3 text-xs font-bold text-violet-700 disabled:opacity-50 dark:border-violet-800 dark:bg-gray-900 dark:text-violet-300">{busyId === 'import' ? t("导入中…") : t("导入文件")}</button>
            </div>
            <div className="manager-mobile-tabs flex-none gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800"><SegmentedControl value={pane} onChange={value => setPane(value as 'library' | 'selection')} options={[{ value: 'library', label: t("资料库") }, { value: 'selection', label: t("当前选择 ({0})", [vibes.slots.length]) }]} size="sm" ariaLabel={t("查看区域")} /></div>
            <main className="workspace-manager-split grid min-h-0 flex-1 ">
              <section className="workspace-manager-list overflow-y-auto p-3 md:p-5">

                {loadError && <p role="alert" className="mb-3 text-sm text-red-600">{t("资料库加载失败")} <button type="button" disabled={loading} onClick={() => void load()} className="mobile-touch rounded-lg px-3 font-bold disabled:opacity-40">{t("重试")}</button></p>}
                {!loaded ? (loading ? <PageSpinner label={t("加载中…")} className="appearance-media py-20" /> : null) : loading && !allAssets.length ? <PageSpinner label={t("加载中…")} className="appearance-media py-20" /> : assets.length ? <div className="workspace-manager-grid grid gap-3">{assets.map(asset => { const selected = vibes.slots.some(slot => slot.vibeId === asset.id); const usableCount = asset.encodings.filter(item => item.model === model).length; return <article key={asset.id} className={`appearance-group group overflow-hidden rounded-2xl border bg-white shadow-sm transition dark:bg-gray-900 ${selected ? 'border-violet-500 ring-2 ring-violet-500/20' : 'border-gray-200 dark:border-gray-800'}`}><button type="button" onClick={() => archived ? showDetail(asset) : void addAsset(asset)} className="block w-full text-left"><div className="appearance-media relative aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800">{asset.thumbnailUrl ? <SmartImage src={asset.thumbnailUrl} alt={asset.name} className="appearance-media h-full w-full object-contain" /> : <div className="appearance-media flex h-full items-center justify-center p-4 text-center text-xs text-gray-500">{t("仅编码")}</div>}{selected && <span className="appearance-media absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white shadow">✓</span>}</div><div className="p-3"><p className="truncate text-sm font-bold">{asset.name}</p><p className="mt-1 text-meta text-gray-500">{usableCount ? t("{0} 个当前模型编码", [usableCount]) : asset.hasOriginal ? t("待编码 · {0} Anlas", [encodingCost]) : t("暂不支持的模型")}</p></div></button><button type="button" onClick={() => showDetail(asset)} className="mobile-touch w-full border-t border-gray-100 text-xs font-medium text-gray-500 dark:border-gray-800">{t("详情")}</button></article>; })}</div> : <div className="appearance-media flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 text-center dark:border-gray-800"><p className="appearance-media font-bold">{archived ? t("没有已归档的 Vibe") : t("还没有永久 Vibe")}</p></div>}
              </section>
              <aside className="appearance-content workspace-manager-selection mobile-safe-bottom overflow-y-auto border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 md:border-l md:border-t-0 flex flex-col">
                <div>
                  <div className="flex items-center justify-between"><h3 className="font-bold text-gray-900 dark:text-white">{t("当前组合")}</h3><span className="text-xs font-bold text-violet-600 dark:text-violet-400">{vibes.slots.length}/{maxSlots}</span></div>
                  <div className="mt-3"><SegmentedControl value={selectionTab} onChange={value => setSelectionTab(value as 'current' | 'groups')} options={[{ value: 'current', label: t("当前参数") }, { value: 'groups', label: t("组合管理") }]} size="sm" ariaLabel={t("Vibe 选择管理")} /></div>
                  <div hidden={selectionTab !== 'current'}>
                  {loaded && vibes.slots.some(slot => !allAssets.find(asset => asset.id === slot.vibeId)?.encodings.some(item => item.id === slot.encodingId && item.model === model)) && <p role="status" className="mt-3 text-xs text-amber-600">{t('当前组合有编码缺失或模型不匹配，不会自动付费补齐')}</p>}
                  <p className="mt-2 text-xs text-gray-500">{t('每张参考附加费：{0} Anlas', [Math.max(0, vibes.slots.length - runtime.billing.freeVibeCount) * runtime.billing.extraVibeCost || 0])}</p>
                  <div className="mt-3 space-y-3">{vibes.slots.map((slot, index) => { const asset = allAssets.find(item => item.id === slot.vibeId); const usableEncodings = asset?.encodings.filter(item => item.model === model) || []; return <div key={`${slot.vibeId}-${index}`} data-agent-object={`Vibe ${index + 1}：${slot.vibeName || slot.vibeId}`} draggable onDragStart={() => setDragIndex(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragIndex !== null) moveSlot(dragIndex, index); setDragIndex(null); }} className={`rounded-xl border border-gray-200 p-3 dark:border-gray-800 ${dragIndex === index ? 'opacity-50' : ''}`}><div className="flex items-center gap-1"><span className="flex h-6 w-6 flex-none cursor-grab items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300" title={t("拖动排序")}>{index + 1}</span>{asset?.thumbnailUrl && <div className="h-8 w-7 flex-none"><SmartImage src={asset.thumbnailUrl} alt="" className="h-full w-full object-contain" /></div>}<p className="min-w-0 flex-1 truncate text-sm font-bold">{slot.vibeName || asset?.name || (loaded ? t("资产缺失") : slot.vibeId)}</p><button type="button" disabled={index === 0} onClick={() => moveSlot(index, index - 1)} className="mobile-touch h-9 w-9 text-sm text-gray-400 disabled:opacity-20" aria-label={t("上移")}>↑</button><button type="button" disabled={index === vibes.slots.length - 1} onClick={() => moveSlot(index, index + 1)} className="mobile-touch h-9 w-9 text-sm text-gray-400 disabled:opacity-20" aria-label={t("下移")}>↓</button><button type="button" disabled={vibes.slots.length >= maxSlots} onClick={() => updateVibes({ ...vibes, slots: [...vibes.slots, { ...slot }], sourceGroupId: undefined, sourceGroupName: undefined })} className="mobile-touch h-9 w-9 text-gray-400 disabled:opacity-20" aria-label={t("添加副本")}>+</button><button type="button" onClick={() => removeSlot(index)} className="mobile-touch h-9 w-9 text-lg text-gray-400 hover:text-red-500" aria-label={t("移除")}>×</button></div><details className="mt-2"><summary className="cursor-pointer text-xs text-gray-500">{t("参数 · 强度 {0}", [slot.strength.toFixed(2)])}</summary><select disabled={!loaded} value={slot.encodingId} onChange={event => { const encoding = usableEncodings.find(item => item.id === event.target.value); if (encoding) updateSlot(index, { encodingId: encoding.id, informationExtracted: encoding.informationExtracted, informationKnown: encoding.informationKnown }); }} className="mt-2 w-full rounded-lg border border-gray-200 bg-transparent px-2 py-2 text-xs dark:border-gray-800">{!loaded && <option value={slot.encodingId}>{t(loading ? '加载中…' : '资料库加载失败')}</option>}{loaded && !usableEncodings.some(item => item.id === slot.encodingId) && <option value={slot.encodingId}>{t('当前模型缺少对应编码')}</option>}{loaded && (usableEncodings.length ? usableEncodings.map(encoding => <option key={encoding.id} value={encoding.id}>{t("提取量 {0}", [encoding.informationKnown === false ? t('未知') : encoding.informationExtracted.toFixed(2)])}</option>) : <option>{t("编码缺失或资产已归档")}</option>)}</select><div className="mt-2 flex items-center gap-2"><span className="text-meta text-gray-500">{t("强度")}</span><input type="range" min={Math.min(-1, slot.strength)} max={Math.max(1, slot.strength)} step="0.01" value={slot.strength} onChange={event => updateSlot(index, { strength: Number(event.target.value) })} className="min-w-0 flex-1 accent-violet-600" /><input type="number" step="0.01" value={slot.strength} onChange={event => updateSlot(index, { strength: vibeStrength(parseFloat(event.target.value), 0) })} className="w-16 rounded-md border border-gray-200 bg-transparent px-1 py-1 text-right text-xs font-mono dark:border-gray-800" /></div>{vibes.normalizeStrengths && Math.abs(slot.strength - (normalized[index]?.effectiveStrength ?? slot.strength)) > 0.0001 && <p className="mt-1 text-right text-micro text-violet-600">{t("有效强度 {0}", [normalized[index].effectiveStrength?.toFixed(2)])}</p>}</details></div>; })}{!vibes.slots.length && <p className="appearance-group rounded-xl bg-gray-50 px-3 py-8 text-center text-xs text-gray-500 dark:bg-gray-950">{t("未选择 Vibe")}</p>}</div>
                  <label className="appearance-group mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 text-sm dark:bg-gray-950"><span><b>{t("超限自动归一化")}</b><small className="block text-micro text-gray-500">{t("强度绝对值之和超过 1 时按比例缩放")}</small></span><input type="checkbox" checked={vibes.normalizeStrengths} onChange={event => updateVibes({ ...vibes, normalizeStrengths: event.target.checked })} className="h-5 w-5 accent-violet-600" /></label>
                  </div>
                  <div hidden={selectionTab !== 'groups'}>
                  {groupsError && <p role="alert" className="mt-3 text-sm text-red-600">{t("组合加载失败")} <button type="button" disabled={groupsLoading} onClick={() => void load()} className="mobile-touch rounded-lg px-3 font-bold disabled:opacity-40">{t("重试")}</button></p>}
                  {groupsLoading && !groupsLoaded && <PageSpinner label={t("加载中…")} className="py-5" />}
                  {groupsLoaded && !groups.length && !groupsLoading && !groupsError && <p className="mt-3 text-xs text-gray-500">{t("还没有保存的组合")}</p>}
                  <div className="mt-4 flex gap-2"><input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder={t("组合名称")} className="h-9 min-w-0 flex-1 rounded-xl border border-gray-200 bg-transparent px-3 text-sm dark:border-gray-800" /><button type="button" disabled={!groupName.trim() || !vibes.slots.length} onClick={() => void saveGroup()} className="appearance-contrast mobile-touch rounded-xl bg-gray-900 px-3 text-xs font-bold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">{t("保存")}</button></div>
                  <button type="button" disabled={!vibes.slots.length || Boolean(exportingId || deletingId)} onClick={() => void exportFile("current", () => vibeService.downloadGroup(groupName, vibes.slots, vibes.normalizeStrengths))} className="mobile-touch mt-2 w-full rounded-xl border border-violet-300 px-3 text-xs font-bold text-violet-700 disabled:opacity-40 dark:border-violet-800 dark:text-violet-300">{exportingId === "current" ? t("导出中…") : t("导出当前组合")}</button>{groups.length > 0 && <div className="mt-5"><h4 className="mb-2 text-xs font-bold text-gray-500">{t("已保存组合")}</h4><div className="space-y-2">{groups.map(group => <div key={group.id} className="rounded-xl border border-gray-200 p-2 dark:border-gray-800">{editingGroupId === group.id ? <div className="flex gap-2"><input autoFocus value={editingGroupName} onChange={event => setEditingGroupName(event.target.value)} className="mobile-touch min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-2 text-sm dark:border-gray-800" /><button type="button" disabled={!editingGroupName.trim()} onClick={() => void updateGroup(group, { name: editingGroupName.trim() })} className="mobile-touch rounded-lg bg-violet-600 px-3 text-xs font-bold text-white disabled:opacity-40">{t("保存")}</button><button type="button" onClick={() => setEditingGroupId('')} className="mobile-touch h-11 w-11 text-gray-500">×</button></div> : <div className="flex items-center gap-1"><button type="button" onClick={() => loadGroup(group)} className="mobile-touch min-w-0 flex-1 text-left"><b className="block truncate text-sm">{group.name}</b><span className="text-micro text-gray-500">{t("{0} 个 Vibe", [group.slots.length])}</span></button><button type="button" onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }} className="mobile-touch h-10 w-10 text-xs text-gray-400 hover:text-violet-500" aria-label={t("重命名 {0}", [group.name])}>✎</button><button type="button" disabled={Boolean(exportingId || deletingId)} onClick={() => void exportFile("group:" + group.id, () => vibeService.downloadGroup(group.name, group.slots, group.normalizeStrengths))} className="mobile-touch h-10 w-10 text-xs text-gray-400 hover:text-violet-500 disabled:opacity-40" aria-label={exportingId === "group:" + group.id ? t("导出中…") : t("导出 {0}", [group.name])}>{exportingId === "group:" + group.id ? "…" : "↓"}</button><button type="button" disabled={!vibes.slots.length} onClick={async () => { if (!await confirmAction({ rememberKey: 'vibe-group.overwrite', title: `覆盖“${group.name}”？`, message: `将用当前 ${vibes.slots.length} 个 Vibe 和强度设置替换这个组合。`, confirmLabel: '覆盖组合' })) return; await updateGroup(group, { slots: vibes.slots.map(slot => ({ ...slot })), normalizeStrengths: vibes.normalizeStrengths }); }} className="mobile-touch h-10 w-10 text-xs text-gray-400 hover:text-violet-500 disabled:opacity-20" aria-label={t("覆盖 {0}", [group.name])}>↻</button><button type="button" onClick={async () => { if (!await confirmAction({ rememberKey: 'vibe-group.delete', title: '删除这个组合？', message: '只删除组合配置，不会删除任何 Vibe 资产或编码。', confirmLabel: '删除', tone: 'danger' })) return; await vibeService.deleteGroup(group.id); setGroups(items => items.filter(item => item.id !== group.id)); }} className="mobile-touch h-10 w-10 text-gray-400 hover:text-red-500" aria-label={t("删除 {0}", [group.name])}>×</button></div>}</div>)}</div></div>}
                  </div>
                </div>

              </aside>
            </main>
          </div>
          <footer className="appearance-content operation-footer flex flex-none items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-800"><button type="button" onClick={closeManager} className="mobile-touch rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300" title={t("本次选择即时生效")}>{t("完成")}</button></footer>
        </div>
      </div></ImagePreviewPortal>}
    </>
  );
};
