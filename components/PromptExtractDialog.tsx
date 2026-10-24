/**
 * 提示词／图片 → AI 提取六类候选 → 用户审阅 → 分别落库。
 *
 * 与「AI 一键六库」的区别：这里不做创作补全，只做忠实提取。
 *   - 文字来源：原文切片、原词、权重与重复项由服务端按原片段重组，模型只判断类别；
 *   - 图片来源：先从原始文件读完整内嵌生成信息（普通文本块与 stealth 都读，不压缩、
 *     不转码），有元数据时优先按原始提示词分类，也允许用户主动改选「AI 看图提取」；
 *     两者来源在界面明确区分；
 *   - 角色归属：元数据里每个角色的正向内容单独成组，不同角色不混成同一条候选。
 *
 * 费用与授权：只有用户点击「开始分类」或「AI 看图提取」才调用一次当前创作助手模型，
 * 不消耗生图额度，模型服务可能收费。图片只作本次分析的输入，不入库、不生成封面。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPaste, Eraser, ImagePlus, LoaderCircle, Sparkles, Upload, X } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { prepareAgentAttachment } from '../services/agentAttachments';
import { type ExtractedEntryDraft } from '../services/extractedPromptEntry';
import {
  clearExtractDraft,
  EXTRACT_DRAFT_VERSION,
  hasExtractDraftContent,
  loadExtractDraft,
  saveExtractDraft,
  type ExtractDraftCandidate,
  type ExtractDraftImage,
  type ExtractDraftSnapshot,
} from '../services/promptExtractDraft';
import { TagAutocompleteTextarea } from './TagAutocompleteTextarea';
import { useConfirmDialog } from './ConfirmDialog';
import { extractPngMetadata } from '../services/pngMetadata.mjs';
import { parseStoredGenerationMetadata } from '../services/promptExtraction.mjs';
import {
  PROMPT_LIBRARY_KIND_LABELS,
  promptAgentService,
  type PromptExtractionCharacter,
  type PromptExtractionResult,
  type PromptLibraryKind,
} from '../services/promptAgent';
import { IconButton, ToolbarButton } from './DesignSystem';
import { TOOLBAR_FIELD_CLASS } from './ToolbarPopover';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

const DETAIL_FIELD_CLASS = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const DETAIL_LABEL_CLASS = 'text-sm font-semibold text-gray-700 dark:text-gray-200';
/** 与服务端 MAX_EXTRACTION_TEXT 一致：超长时提示分段，不静默截断。 */
const MAX_EXTRACTION_TEXT = 12_000;
const KIND_ORDER = Object.keys(PROMPT_LIBRARY_KIND_LABELS) as PromptLibraryKind[];
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const hasChinese = (value: string) => CJK_PATTERN.test(String(value || ''));

/** 审阅中的一条候选：多了勾选态与本地 id，保存后只移除成功项。 */
interface ExtractedDraft extends ExtractedEntryDraft {
  id: number;
  picked: boolean;
  /** 中文没有拿到可用英文译法：默认不勾选，补上英文后才能入库。 */
  needsTranslation: boolean;
  /** 权重／括号结构无法可靠套回译文：默认不勾选，需人工改写后才能入库。 */
  needsReview: boolean;
  reviewNote: string;
}

/** 元数据里的一个角色分栏：正向内容单独成组，角色负面只展示不混入正向。 */
interface StoredCharacter {
  label: string;
  prompt: string;
  negative?: string;
}

/** 从原始文件读到的完整生成信息：全局正向 + 每个角色的正向与角色负面。 */
interface StoredGeneration {
  globalPrompt: string;
  characters: StoredCharacter[];
  negative: string;
}

interface ImageSlot {
  /** 刷新后恢复草稿时原图不在本页，此时为 null：候选可照常编辑保存，重新看图提取需重选原图。 */
  file: File | null;
  url: string;
  name: string;
  /** reading = 正在读原始文件；ready = 已读到；empty = 确实没有内嵌信息；failed = 读取失败。 */
  state: 'reading' | 'ready' | 'empty' | 'failed';
  stored: StoredGeneration | null;
  /** 读不到或读失败的具体说明，不能用「没有元数据」掩盖读取失败。 */
  note: string;
}

const EMPTY_STORED: StoredGeneration = { globalPrompt: '', characters: [], negative: '' };

/**
 * 同一次打开期间记住已选图片：关闭面板再打开仍能直接看图提取。
 * 文件对象不能写进浏览器存储（blob URL 不能跨刷新），刷新后只恢复已解析的元数据与候选。
 */
let rememberedImage: { name: string; file: File } | null = null;

/** 候选与持久化形态互转：id、勾选与待处理标记都要原样保留。 */
const toPersistedCandidate = (draft: ExtractedDraft): ExtractDraftCandidate => ({
  id: draft.id,
  kind: draft.kind as ExtractDraftCandidate['kind'],
  name: draft.name,
  prompt: draft.prompt,
  original: draft.original || '',
  needsTranslation: draft.needsTranslation,
  needsReview: draft.needsReview,
  reviewNote: draft.reviewNote,
  picked: draft.picked,
});

const fromPersistedCandidate = (item: ExtractDraftCandidate): ExtractedDraft => ({
  id: item.id,
  picked: item.picked,
  kind: item.kind as ExtractedEntryDraft['kind'],
  name: item.name,
  prompt: item.prompt,
  original: item.original,
  needsTranslation: item.needsTranslation,
  needsReview: item.needsReview,
  reviewNote: item.reviewNote,
});

const restoreImageSlot = (saved: ExtractDraftImage | null): ImageSlot | null => {
  if (!saved) return null;
  const file = rememberedImage && rememberedImage.name === saved.name ? rememberedImage.file : null;
  return {
    file,
    url: file ? URL.createObjectURL(file) : '',
    name: saved.name,
    state: saved.state,
    stored: saved.stored
      ? {
        globalPrompt: saved.stored.globalPrompt,
        characters: saved.stored.characters.map(entry => ({ label: entry.label, prompt: entry.prompt, ...(entry.negative ? { negative: entry.negative } : {}) })),
        negative: saved.stored.negative,
      }
      : null,
    note: saved.note,
  };
};

const describeRestore = (load: ReturnType<typeof loadExtractDraft>) => {
  if (load.issue === 'corrupt') return t('本端保存的提取草稿读不出来（版本或内容不符），已按空草稿开始，不会覆盖任何已入库内容。');
  if (load.issue === 'unavailable') return t('本端浏览器存储不可用，这次的工作只保留在当前页面，刷新或关闭浏览器会丢失。');
  if (!load.draft || !hasExtractDraftContent(load.draft)) return '';
  const count = load.draft.candidates.length;
  return count
    ? t('已恢复上次未完成的提取草稿（{0} 条候选），确认后才会入库。', [String(count)])
    : t('已恢复上次未完成的提取草稿，确认后才会入库。');
};

/** 提示的种类：存储损坏／不可用属于持久状态，恢复成功提示则要随草稿清空而撤下。 */
const describeRestoreKind = (load: ReturnType<typeof loadExtractDraft>): '' | 'corrupt' | 'unavailable' | 'restored' => {
  if (load.issue) return load.issue;
  return load.draft && hasExtractDraftContent(load.draft) ? 'restored' : '';
};

const describeFormat = (mime: string) => (mime ? mime.replace('image/', '').toUpperCase() : t('该格式'));

export interface PromptExtractDialogProps {
  open: boolean;
  onClose: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 保存一条已确认的候选：父级负责建条目、刷新列表，并分别反馈创建与刷新结果。 */
  onSave: (draft: ExtractedEntryDraft) => Promise<void>;
}

export const PromptExtractDialog: React.FC<PromptExtractDialogProps> = ({ open, onClose, notify, onSave }) => {
  useLanguage();
  const dialog = useModalA11y<HTMLDivElement>(open);
  const confirmAction = useConfirmDialog();
  /** 首次挂载时读一次本端草稿：之后的关闭／重开由内存状态自行保留，不再清空。 */
  const initialLoad = useMemo(() => loadExtractDraft(), []);
  // 注意：初始化必须直接从草稿取值，不能先写空状态再由 effect 补，否则会先覆盖旧草稿。
  const [text, setText] = useState(() => initialLoad.draft?.text ?? '');
  const [image, setImage] = useState<ImageSlot | null>(() => restoreImageSlot(initialLoad.draft?.image ?? null));
  const [config, setConfig] = useState<{ label: string; imageInput: boolean } | null>(null);
  const [drafts, setDrafts] = useState<ExtractedDraft[]>(() => (initialLoad.draft?.candidates ?? []).map(fromPersistedCandidate));
  const [unclassified, setUnclassified] = useState<string>(() => initialLoad.draft?.unclassified ?? '');
  const [excluded, setExcluded] = useState<{ negative: string; parameters: string }>(() => initialLoad.draft?.excluded ?? { negative: '', parameters: '' });
  const [sourceLabel, setSourceLabel] = useState(() => initialLoad.draft?.sourceLabel ?? '');
  const [restoreNote, setRestoreNote] = useState(() => describeRestore(initialLoad));
  const restoreKindRef = useRef(describeRestoreKind(initialLoad));
  const [persistIssue, setPersistIssue] = useState<'' | 'unavailable' | 'failed'>(() => (initialLoad.issue === 'unavailable' ? 'unavailable' : ''));
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 每次分析/输入变化/关闭都递增。任务从点击那一刻就被登记，因此图片预处理的
   * await 结束时也能发现「这次点击已经作废」，不会把旧图片发给模型。
   */
  const runRef = useRef(0);
  const draftIdRef = useRef(initialLoad.draft?.nextId ?? 0);
  const pending = useRef(false);
  /** 递增后，之前排队的延迟持久化任务一律作废，不会把已保存或已清空的草稿写回来。 */
  const persistStampRef = useRef(0);
  const hydratedRef = useRef(false);
  useEffect(() => { hydratedRef.current = true; }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      runRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  /** 输入变化后旧候选立即失效：不能拿上一次输入的结果直接入库。 */
  const resetResult = useCallback(() => {
    setDrafts([]);
    setUnclassified('');
    setExcluded({ negative: '', parameters: '' });
    setSourceLabel('');
  }, []);

  /** 作废当前任务：中止在途请求，迟到的响应不再写入草稿。 */
  const invalidateRun = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setAnalyzing(false);
  }, []);

  /** 当前草稿的快照：默认取内存状态；保存流程可传入「已去掉成功项」的候选列表。 */
  const buildSnapshot = useCallback((nextDrafts?: ExtractedDraft[]): ExtractDraftSnapshot => ({
    version: EXTRACT_DRAFT_VERSION,
    updatedAt: Date.now(),
    text,
    sourceLabel,
    // 「正在读取」是瞬时状态，不写进草稿：恢复后不会假装还在读取。
    image: image && image.state !== 'reading'
      ? {
        name: image.name,
        state: image.state,
        note: image.note,
        stored: image.stored
          ? {
            globalPrompt: image.stored.globalPrompt,
            characters: image.stored.characters.map(entry => ({ label: entry.label, prompt: entry.prompt, negative: entry.negative || '' })),
            negative: image.stored.negative,
          }
          : null,
      }
      : null,
    candidates: (nextDrafts ?? drafts).map(toPersistedCandidate),
    unclassified,
    excluded,
    nextId: draftIdRef.current,
  }), [drafts, excluded, image, sourceLabel, text, unclassified]);

  /** 立即写入并作废排队的延迟写入；失败时如实提示，不宣称已持久保存。 */
  const persistNow = useCallback((snapshot: ExtractDraftSnapshot): void => {
    persistStampRef.current += 1;
    const result = saveExtractDraft(snapshot);
    if (aliveRef.current) setPersistIssue(result === 'saved' ? '' : result);
  }, []);

  /** 有内容就写入，没有内容就清空存储：删除图片／全部保存后不会留下过期副本。 */
  const syncDraft = useCallback((snapshot: ExtractDraftSnapshot): void => {
    if (hasExtractDraftContent(snapshot)) persistNow(snapshot);
    else { persistStampRef.current += 1; clearExtractDraft(); }
  }, [persistNow]);

  /**
   * 修改后自动暂存。每次变化都重新排队并作废旧定时器，因此：
   * 清空草稿、保存成功后的副本、刷新前关闭都不会被更早的延迟写入覆盖回去。
   */
  useEffect(() => {
    if (!open || !hydratedRef.current) return;
    const snapshot = buildSnapshot();
    if (!hasExtractDraftContent(snapshot)) {
      // 内容被删空（例如手动清空唯一的一段文字）：同步清掉旧副本并作废排队的写入，
      // 否则关闭重开或刷新会把已经删掉的内容恢复回来。
      persistStampRef.current += 1;
      clearExtractDraft();
      // 「已恢复上次草稿」的提示也要收掉：现在草稿是空的，不能再暗示还有内容。
      // 存储损坏／不可用的提示属于持久状态，继续保留。
      if (restoreKindRef.current === 'restored') setRestoreNote('');
      return;
    }
    const stamp = ++persistStampRef.current;
    const timer = window.setTimeout(() => {
      if (stamp !== persistStampRef.current || !aliveRef.current) return;
      const result = saveExtractDraft(snapshot);
      setPersistIssue(result === 'saved' ? '' : result);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [buildSnapshot, open]);

  // 打开时不重置内容：关闭重开、切走内容库再回来，这次的输入、候选与修改都保留。
  useEffect(() => {
    if (!open) return;
    invalidateRun();
    setConfig(null);
    setError('');
    void promptAgentService.getConfig()
      .then(current => {
        if (!aliveRef.current) return;
        setConfig({ label: [current.provider, current.model].filter(Boolean).join(' · '), imageInput: Boolean(current.imageInput) });
      })
      .catch(() => { /* 读不到配置时按未知处理：看图入口保持可试，失败由服务端如实报错。 */ });
  }, [invalidateRun, open]);

  const closeDialog = useCallback(() => {
    if (pending.current) return;
    invalidateRun();
    // 关闭前把最新状态落盘：不依赖 350ms 的延迟写入，避免刚改完就关丢掉修改。
    if (hydratedRef.current) {
      const snapshot = buildSnapshot();
      if (hasExtractDraftContent(snapshot)) persistNow(snapshot);
      else {
        // 已经空了的草稿不能留着旧副本，否则重开又变成「有内容」。
        persistStampRef.current += 1;
        clearExtractDraft();
      }
    }
    onClose();
  }, [buildSnapshot, invalidateRun, onClose, persistNow]);

  useMobileHistoryLayer(open, () => {
    if (pending.current) return false;
    closeDialog();
    return true;
  }, 'prompt-extract');

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopmostModal(dialog.current)) return;
      event.preventDefault();
      closeDialog();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDialog, dialog, open]);

  // 外部把窗口隐藏（open 变 false）时旧任务必须作废，否则迟到的结果无处可去。
  useEffect(() => {
    if (open) return;
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  const dropImage = useCallback(async (file: File) => {
    if (saving || pending.current) return;
    if (!file.type.startsWith('image/')) { setError(t('请选择图片文件')); return; }
    invalidateRun();
    resetResult();
    setError('');
    const url = URL.createObjectURL(file);
    // 只在本次打开期间记住原图对象：刷新后恢复草稿不会再拿它冒充可用的图片地址。
    rememberedImage = { name: file.name, file };
    setImage(previous => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { file, url, name: file.name, state: 'reading', stored: null, note: '' };
    });
    const settle = (patch: Partial<ImageSlot>) => {
      if (!aliveRef.current) return;
      setImage(current => (current && current.url === url ? { ...current, ...patch } : current));
    };
    try {
      // 必须从原始文件读取：先压缩转码会丢掉内嵌生成信息（普通文本块与 stealth）。
      const bytes = new Uint8Array(await file.arrayBuffer());
      const raw = await extractPngMetadata(bytes);
      if (!raw) {
        settle({
          state: 'empty',
          note: file.type === 'image/png'
            ? t('这张 PNG 确实没有内嵌生成信息，可以改用看图提取')
            : t('{0} 不含内嵌生成信息，只有 PNG 可能内嵌提示词；可以改用看图提取', [describeFormat(file.type)]),
        });
        return;
      }
      const stored = parseStoredGenerationMetadata(raw) as StoredGeneration;
      if (!stored.globalPrompt && !stored.characters.length) {
        settle({ state: 'empty', note: t('读到了内嵌信息，但其中没有可用的正向提示词') });
        return;
      }
      settle({ state: 'ready', stored, note: '' });
    } catch (e) {
      // 读取失败与「确实没有」必须分开说明，不能让失败看起来像没有元数据。
      settle({ state: 'failed', note: t('读取图片内嵌信息失败：{0}；可以改用看图提取', [String((e as Error)?.message || t('未知错误'))]) });
    }
  }, [invalidateRun, resetResult, saving]);

  const clearImage = useCallback(() => {
    if (saving || pending.current) return;
    invalidateRun();
    resetResult();
    rememberedImage = null;
    const nextText = text;
    setImage(previous => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
    // 立即同步存储：否则重开还会把刚删掉的图片恢复回来。
    syncDraft({
      ...buildSnapshot([]),
      image: null,
      sourceLabel: '',
      text: nextText,
    });
  }, [buildSnapshot, invalidateRun, resetResult, saving, syncDraft, text]);

  /**
   * 文字来源：输入框优先；否则用图片内嵌的原始提示词（全局 + 角色）。
   * 角色正向通过 characters 单独传输，这样服务端能保留角色归属；
   * 全局负面与角色负面仍拼进文本，由服务端剥离后展示，不会混入正向内容。
   */
  const textSource = useMemo(() => {
    if (text.trim()) return { value: text, label: t('输入框提示词'), characters: [] as StoredCharacter[] };
    const stored = image?.stored;
    if (stored && (stored.globalPrompt || stored.characters.length)) {
      const negative = stored.negative.trim();
      const value = negative ? `${stored.globalPrompt}\nNegative prompt: ${negative}` : stored.globalPrompt;
      return { value, label: t('图片内嵌原始提示词'), characters: stored.characters };
    }
    return { value: '', label: '', characters: [] as StoredCharacter[] };
  }, [image?.stored, text]);

  /**
   * 登记一次任务并返回标识。注意：这一步必须在任何 await 之前完成，
   * 这样预处理期间关闭、换图或改输入都能让这次点击失效。
   */
  const beginRun = () => {
    const run = ++runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAnalyzing(true);
    return { run, controller };
  };

  const cancelRun = () => {
    if (runRef.current === 0) return;
    invalidateRun();
    setError(t('已中止本次提取；已断开本地请求，但模型服务可能仍会完成这次调用'));
  };

  const runAnalysis = async (mode: 'text' | 'vision') => {
    if (analyzing || saving || pending.current) return;
    setError('');
    if (mode === 'text') {
      if (!textSource.value.trim() && !textSource.characters.length) { setError(t('请先粘贴提示词，或选择一张带内嵌提示词的图片')); return; }
      if (textSource.value.length > MAX_EXTRACTION_TEXT) { setError(t('提示词过长，请分段提取')); return; }
    } else if (!image) {
      setError(t('请先选择一张本地图片'));
      return;
    } else if (!image.file) {
      // 刷新后恢复的草稿只有已解析的元数据，没有原始文件：不假装还能看图提取。
      setError(t('这次草稿里的图片原文件没有保留（刷新后浏览器不再持有它），请重新选择原图再做看图提取；已提取的候选不受影响'));
      return;
    }
    const visionFile = image?.file ?? null;

    const { run, controller } = beginRun();
    const stillCurrent = () => aliveRef.current && run === runRef.current && !controller.signal.aborted;
    try {
      const payload: Parameters<typeof promptAgentService.extractCandidates>[0] = { mode };
      if (mode === 'text') {
        payload.text = textSource.value;
        if (textSource.characters.length) payload.characters = textSource.characters;
      } else {
        // 压缩副本只用于发送；元数据早已从原始文件读到，不受这次转码影响。
        const attachment = await prepareAgentAttachment(visionFile!);
        if (!stillCurrent()) return;
        payload.images = [{ data: attachment.data, mimeType: attachment.mimeType }];
      }
      if (!stillCurrent()) return;
      const result: PromptExtractionResult = await promptAgentService.extractCandidates(payload, controller.signal);
      // 迟到的响应（已重新分析／已取消／已关闭）一律丢弃，不覆盖当前草稿。
      if (!stillCurrent()) return;
      const items = Array.isArray(result?.items) ? result.items.filter(item => item && String(item.prompt || '').trim()) : [];
      const leftover = String(result?.unclassified?.prompt || '').trim();
      if (!items.length && !leftover) throw new Error(t('没有提取到可用的候选，请检查提示词或换一张图片'));
      setDrafts(items.map(item => {
        const prompt = String(item.prompt || '').trim();
        const needsTranslation = Boolean(item.needsTranslation) || hasChinese(prompt);
        const needsReview = Boolean(item.needsReview);
        return {
          id: ++draftIdRef.current,
          // 中文还没换到英文、或权重结构没能可靠还原时默认不勾选：不允许直接入库。
          picked: !needsTranslation && !needsReview,
          kind: item.kind as ExtractedEntryDraft['kind'],
          name: String(item.name || '').trim() || PROMPT_LIBRARY_KIND_LABELS[item.kind as PromptLibraryKind],
          prompt,
          original: String(item.original || ''),
          needsTranslation,
          needsReview,
          reviewNote: String(item.reviewNote || ''),
        };
      }));
      setUnclassified(leftover);
      setExcluded({
        negative: String(result?.excluded?.negative || '').trim(),
        parameters: String(result?.excluded?.parameters || '').trim(),
      });
      const ignored = Number(result?.ignored) || 0;
      const characterLabels = textSource.characters.map(entry => entry.label).join('、');
      setSourceLabel([
        mode === 'vision' ? t('AI 看图提取（视觉推断，不是原始提示词）') : (textSource.label || t('提示词文本')),
        mode === 'text' && characterLabels ? t('含角色分栏：{0}', [characterLabels]) : '',
        [result.provider, result.model].filter(Boolean).join(' · '),
        ignored > 0 ? t('有 {0} 条内容无法解析，已忽略', [String(ignored)]) : '',
      ].filter(Boolean).join(' · '));
      // 这一轮已经有新结果，恢复提示不再成立。
      setRestoreNote('');
    } catch (e) {
      if (!aliveRef.current || run !== runRef.current) return;
      if (controller.signal.aborted) { setError(t('已中止本次提取；已断开本地请求，但模型服务可能仍会完成这次调用')); return; }
      // 失败保留原始输入，方便用户改一改再试。
      console.warn('Prompt extraction failed:', e);
      setError(t('提取失败：{0}', [(e as Error)?.message || t('请稍后重试')]));
    } finally {
      if (aliveRef.current && run === runRef.current) setAnalyzing(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const patchDraft = (id: number, patch: Partial<ExtractedDraft>) => {
    if (saving || pending.current) return;
    setDrafts(previous => previous.map(draft => (draft.id === id
      ? {
        ...draft,
        ...patch,
        ...(patch.prompt === undefined ? {} : {
          needsTranslation: hasChinese(patch.prompt),
          // 用户手工改过提示词，说明结构已由人工确认，解除「待处理」。
          needsReview: false,
          reviewNote: '',
        }),
      }
      : draft)));
  };

  const togglePick = (id: number) => {
    if (saving || pending.current) return;
    setDrafts(previous => previous.map(draft => (draft.id === id ? { ...draft, picked: !draft.picked } : draft)));
  };

  const pickedDrafts = drafts.filter(draft => draft.picked && String(draft.prompt || '').trim());
  const grouped = KIND_ORDER
    .map(kind => ({ kind, list: drafts.filter(draft => draft.kind === kind) }))
    .filter(group => group.list.length > 0);
  /** 落库前只做结构校验：名称与提示词不能为空，避免建出空条目。 */
  const invalidDraft = pickedDrafts.find(draft => !String(draft.name || '').trim() || !String(draft.prompt || '').trim());
  /** 中文还没换成英文的候选不能被当作英文提示词入库。 */
  const untranslatedDraft = pickedDrafts.find(draft => hasChinese(draft.prompt));
  /** 权重／括号结构没还原的候选不能被当作正确提示词入库。 */
  const reviewDraft = pickedDrafts.find(draft => draft.needsReview);

  /** 逐条创建：成功的移除，失败的保留在面板里，重试不会重复创建已成功的条目。 */
  const savePicked = async () => {
    if (saving || analyzing || pending.current) return;
    if (!pickedDrafts.length) { notify(t('请先勾选要保存的条目'), 'error'); return; }
    if (invalidDraft) { setError(t('勾选的条目需要名称和提示词')); return; }
    if (untranslatedDraft) { setError(t('「{0}」还是中文，请先补上英文提示词，或取消勾选', [untranslatedDraft.name])); return; }
    if (reviewDraft) { setError(t('「{0}」的权重或括号结构没能可靠还原，请手动改写提示词后再保存，或取消勾选', [reviewDraft.name])); return; }
    pending.current = true;
    setSaving(true);
    setError('');
    const batch = pickedDrafts;
    const savedIds = new Set<number>();
    try {
      for (const draft of batch) {
        try {
          await onSave({ kind: draft.kind, name: draft.name, prompt: draft.prompt, original: draft.original });
          savedIds.add(draft.id);
        } catch (e) {
          console.warn('Prompt extraction save failed:', e);
        }
      }
    } finally {
      pending.current = false;
      if (aliveRef.current) setSaving(false);
    }
    if (!aliveRef.current) return;
    const saved = savedIds.size;
    const failed = batch.length - saved;
    if (saved > 0) {
      const remaining = drafts.filter(draft => !savedIds.has(draft.id));
      // 成功项立即从持久副本移除；全部存完就结束这一轮草稿，下次打开不会复活已入库的候选。
      syncDraft(buildSnapshot(remaining));
      notify(t('已存入 {0} 条', [saved]));
      if (!remaining.length) {
        // 这一轮任务已完成：输入、图片、元数据与会话内的图片引用一起结束，
        // 避免下次打开恢复成「未保存」的空任务、或只剩一张已经用过的旧图片。
        persistStampRef.current += 1;
        clearExtractDraft();
        setText('');
        setDrafts([]);
        setUnclassified('');
        setExcluded({ negative: '', parameters: '' });
        setSourceLabel('');
        rememberedImage = null;
        setImage(previous => {
          if (previous) URL.revokeObjectURL(previous.url);
          return null;
        });
        if (fileRef.current) fileRef.current.value = '';
        onClose();
        return;
      }
      setDrafts(remaining);
    }
    if (failed > 0) notify(t('有 {0} 条保存失败，已保留在面板中可重试', [failed]), 'error');
  };

  /** 只清空本功能的提取草稿：不动输入框以外的任何工作台状态，也不删除已入库条目。 */
  const clearDraft = async () => {
    if (saving || analyzing || pending.current) return;
    const hasContent = hasExtractDraftContent(buildSnapshot());
    if (hasContent) {
      const confirmed = await confirmAction({
        title: t('清空提取草稿'),
        message: t('会清空这次粘贴的提示词、已选图片、六类候选与编辑内容；已入库条目不受影响。'),
        confirmLabel: t('清空草稿'),
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    invalidateRun();
    // 先作废排队的延迟写入，再清空，保证清空后不会被旧任务写回来。
    persistStampRef.current += 1;
    clearExtractDraft();
    setText('');
    rememberedImage = null;
    setImage(previous => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setConfig(null);
    setDrafts([]);
    setUnclassified('');
    setExcluded({ negative: '', parameters: '' });
    setSourceLabel('');
    setRestoreNote('');
    setPersistIssue('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!open) return null;

  const visionBlocked = config ? !config.imageInput : false;
  const costNotice = config?.label
    ? t('使用当前创作助手模型（{0}）调用一次，模型服务可能收费；不消耗生图额度。', [config.label])
    : t('使用当前创作助手模型调用一次，模型服务可能收费；不消耗生图额度。');
  /** 保存期间锁住会改变本批次的输入与编辑操作。 */
  const inputLocked = saving || pending.current;
  const stored = image?.stored;

  return (
    <div className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-6">
      <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={t('AI 提取分类')}
          className="content-library appearance-panel flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:rounded-2xl"
        >
          <header className="flex flex-none items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
            <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <h2 className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-white">{t('AI 提取分类')}</h2>
            <IconButton label={t('关闭')} onClick={closeDialog}><X /></IconButton>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {restoreNote && (
              <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-micro text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">{restoreNote}</p>
            )}
            {persistIssue && (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-micro text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {persistIssue === 'unavailable'
                  ? t('本端浏览器存储不可用，草稿只保留在当前页面，刷新会丢失；已入库条目不受影响。')
                  : t('草稿暂存失败（可能是浏览器存储已满或被清理），这次的工作还在当前页面，请先保存要保留的条目。')}
              </p>
            )}
            <label className="block">
              <span className={DETAIL_LABEL_CLASS}>{t('提示词原文')}</span>
              <TagAutocompleteTextarea
                aria-label={t('提示词原文')}
                containerClassName="mt-2"
                className={`${TOOLBAR_FIELD_CLASS} min-h-32 resize-y font-mono!`}
                value={text}
                disabled={inputLocked}
                tagAssistEnabled
                showTranslations
                allowAiTranslation
                onValueChange={next => { invalidateRun(); resetResult(); setText(next); setError(''); }}
                placeholder={t('粘贴提示词，保留原词与权重；也可以只放一张图片走看图提取')}
              />
            </label>

            <div
              data-extract-image="true"
              onDragOver={event => { event.preventDefault(); if (!inputLocked) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault();
                setDragging(false);
                if (inputLocked) return;
                const file = event.dataTransfer.files?.[0];
                if (file) void dropImage(file);
              }}
              onPaste={event => {
                if (inputLocked) return;
                const file = Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith('image/'));
                if (!file) return;
                event.preventDefault();
                void dropImage(file);
              }}
              className={`rounded-2xl border border-dashed p-3 ${dragging ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/30' : 'border-gray-300 dark:border-gray-700'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${DETAIL_LABEL_CLASS} flex-none`}>{t('图片（可选）')}</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  aria-label={t('选择图片')}
                  onChange={event => { const file = event.target.files?.[0]; if (file) void dropImage(file); }}
                />
                <ToolbarButton onClick={() => fileRef.current?.click()} disabled={analyzing || inputLocked} className="mobile-touch">
                  <ImagePlus /><span>{t('选择图片')}</span>
                </ToolbarButton>
                <span className="text-micro text-gray-400 dark:text-gray-500">{t('或拖入、粘贴图片；图片只用于本次分析')}</span>
              </div>
              {image && (
                <div className="mt-3 flex gap-3">
                  <img src={image.url} alt={t('待分析图片')} className="h-20 w-20 flex-none rounded-xl border border-gray-200 object-cover dark:border-gray-700" />
                  <div className="min-w-0 flex-1 text-xs text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono!">{image.name}</span>
                      <IconButton label={t('移除图片')} onClick={clearImage} disabled={analyzing || inputLocked}><X /></IconButton>
                    </div>
                    {image.state === 'reading' && <p className="mt-1 text-gray-400">{t('正在读取图片内嵌生成信息…')}</p>}
                    {image.state === 'ready' && (
                      <p className="mt-1 text-emerald-600 dark:text-emerald-400">
                        {stored?.characters.length
                          ? t('已读到图片内嵌的原始提示词（含 {0} 个角色分栏），按原文分类不会丢掉角色内容', [String(stored.characters.length)])
                          : t('已读到图片内嵌的原始提示词，可直接按其分类，不会丢掉原词')}
                      </p>
                    )}
                    {(image.state === 'empty' || image.state === 'failed') && (
                      <p role={image.state === 'failed' ? 'alert' : undefined} className="mt-1 text-amber-600 dark:text-amber-400">{image.note}</p>
                    )}
                    {stored && (stored.globalPrompt || stored.characters.length > 0) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-gray-500 dark:text-gray-400">{t('查看图片内嵌提示词')}</summary>
                        {stored.globalPrompt && (
                          <p className="mt-1 break-words rounded-lg bg-gray-50 p-2 font-mono! text-micro text-gray-600 dark:bg-gray-800 dark:text-gray-300">{stored.globalPrompt}</p>
                        )}
                        {stored.characters.map(entry => (
                          <div key={entry.label} data-extract-character={entry.label} className="mt-1 rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
                            <p className="text-micro font-semibold text-gray-600 dark:text-gray-300">{entry.label}</p>
                            <p className="break-words font-mono! text-micro text-gray-600 dark:text-gray-300">{entry.prompt}</p>
                            {entry.negative && <p className="mt-1 break-words text-micro text-gray-400">{t('角色负面：{0}', [entry.negative])}</p>}
                          </div>
                        ))}
                        {stored.negative && <p className="mt-1 break-words text-micro text-gray-400">{t('内嵌负面提示词：{0}', [stored.negative])}</p>}
                      </details>
                    )}
                  </div>
                </div>
              )}
              <p className="mt-2 text-micro text-gray-400 dark:text-gray-500">{costNotice}</p>
              {visionBlocked && <p role="status" className="mt-1 text-micro text-amber-600 dark:text-amber-400">{t('当前助手模型未声明图片输入能力，不能看图提取，也不会自动换用其他模型；带原始生成信息的 PNG 仍可按原始提示词分类。')}</p>}
            </div>

            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            {sourceLabel && <p role="status" className="text-micro text-gray-500 dark:text-gray-400">{t('来源：{0}', [sourceLabel])}</p>}

            {grouped.length > 0 && (
              <div className="space-y-3">
                <p className="text-micro text-gray-400 dark:text-gray-500">{t('默认勾选有效候选；可以改名称、改提示词、换分类或取消勾选，未勾选的不会入库。')}</p>
                {grouped.map(group => (
                  <section key={group.kind} data-extract-kind={group.kind} className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t(PROMPT_LIBRARY_KIND_LABELS[group.kind])}</h3>
                    {group.list.map(draft => {
                      const label = t(PROMPT_LIBRARY_KIND_LABELS[draft.kind as PromptLibraryKind] || '提示词');
                      return (
                        <div key={draft.id}
                          className={`rounded-2xl border p-3 ${draft.picked ? 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-800'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <input type="checkbox" checked={draft.picked} onChange={() => togglePick(draft.id)} disabled={inputLocked}
                              aria-label={t('选择{0}', [label])} className="h-4 w-4 flex-none accent-indigo-500" />
                            <input value={draft.name} onChange={event => patchDraft(draft.id, { name: event.target.value })} disabled={inputLocked}
                              aria-label={t('{0}名称', [label])} placeholder={t('条目名称')}
                              className={`${DETAIL_FIELD_CLASS} mt-0 min-w-0 flex-1`} maxLength={200} />
                            <select value={draft.kind} onChange={event => patchDraft(draft.id, { kind: event.target.value as ExtractedEntryDraft['kind'] })} disabled={inputLocked}
                              aria-label={t('{0}分类', [label])} className={`${DETAIL_FIELD_CLASS} mt-0 w-auto flex-none`}>
                              {KIND_ORDER.map(kind => <option key={kind} value={kind}>{t(PROMPT_LIBRARY_KIND_LABELS[kind])}</option>)}
                            </select>
                          </div>
                          <TagAutocompleteTextarea value={draft.prompt} onValueChange={next => patchDraft(draft.id, { prompt: next })} disabled={inputLocked}
                            aria-label={t('{0}提示词', [label])} className={`${DETAIL_FIELD_CLASS} h-20 resize-y font-mono!`}
                            tagAssistEnabled showTranslations allowAiTranslation />
                          {draft.needsTranslation && (
                            <p className="mt-1 text-micro text-amber-600 dark:text-amber-400">{t('这段中文还没有英文译法，默认不勾选；补上英文提示词后才会入库。')}</p>
                          )}
                          {draft.needsReview && (
                            <p className="mt-1 text-micro text-amber-600 dark:text-amber-400">
                              {t('权重／括号结构没能可靠还原（{0}），默认不勾选；请手动改写英文提示词加上权重后再入库。', [draft.reviewNote || t('结构可疑')])}
                            </p>
                          )}
                          {draft.original && (
                            <p className="mt-1 break-words text-micro text-gray-400 dark:text-gray-500">{t('中文原文：{0}', [draft.original])}</p>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            )}

            {unclassified && (
              <section data-extract-unclassified="true" className="rounded-2xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-300">{t('未归类内容（不会入库，可手动复制）')}</h3>
                <p className="mt-1 break-words font-mono! text-micro text-gray-700 dark:text-gray-200">{unclassified}</p>
              </section>
            )}

            {(excluded.negative || excluded.parameters) && (
              <section data-extract-excluded="true" className="rounded-2xl border border-gray-200 p-3 text-micro text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <p className="font-semibold">{t('已从正向内容中剥离（不会入库）')}</p>
                {excluded.negative && <p className="mt-1 break-words">{t('负面提示词：{0}', [excluded.negative])}</p>}
                {excluded.parameters && <p className="mt-1 break-words">{t('生成参数：{0}', [excluded.parameters])}</p>}
              </section>
            )}
          </div>

          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            <ToolbarButton onClick={() => void clearDraft()} disabled={analyzing || inputLocked || (!text.trim() && !image && !drafts.length)}
              className="mobile-touch mr-auto" title={t('只清空这次提取的草稿，不影响已入库条目')}>
              <Eraser /><span>{t('清空草稿')}</span>
            </ToolbarButton>
            <ToolbarButton tone="primary" onClick={() => void runAnalysis('text')}
              disabled={analyzing || inputLocked || (!textSource.value.trim() && !textSource.characters.length)} className="mobile-touch">
              {analyzing ? <LoaderCircle className="animate-spin" /> : <ClipboardPaste />}
              <span>{analyzing ? t('正在提取…') : drafts.length ? t('重新按文字分类') : t('开始分类')}</span>
            </ToolbarButton>
            <ToolbarButton onClick={() => void runAnalysis('vision')}
              disabled={analyzing || inputLocked || !image || Boolean(visionBlocked)} className="mobile-touch">
              <Upload /><span>{t('AI 看图提取')}</span>
            </ToolbarButton>
            <ToolbarButton onClick={() => void savePicked()}
              disabled={analyzing || inputLocked || pickedDrafts.length === 0} className="mobile-touch">
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              <span>{saving ? t('保存中…') : t('保存勾选项（{0}）', [String(pickedDrafts.length)])}</span>
            </ToolbarButton>
            {analyzing && (
              <ToolbarButton onClick={cancelRun} className="mobile-touch">
                <X /><span>{t('中止分析')}</span>
              </ToolbarButton>
            )}
            <ToolbarButton onClick={closeDialog} disabled={inputLocked} className="mobile-touch"><span>{t('关闭并保留草稿')}</span></ToolbarButton>
          </footer>
        </div>
      </div>
  );
};
