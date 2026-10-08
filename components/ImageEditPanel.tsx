import type { PromptAgentDraft, NAIParams } from '../types';
import { agentOperationError } from '../services/agentOperation.mjs';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ImageEditBaseImageSource, ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, LocalGenItem } from '../types';
import { LabPageLayout } from '../services/appearancePreferences';
import { canvasToDataUrl, createOutpaintCanvas, dataUrlToBlob, getCenteredImageEditCrop, getContainedImageEditRect, getImageEditNormalizationTarget, ImageEditNormalizationMode, isSameOutpaintExpansion, limitFocusedImageEditRect, normalizeMinimumContextArea, transformCharacterCoordinatesForImageRect, transformCharacterCoordinatesForOutpaint, validateImageEditDimensions } from '../services/imageEdit';
import { extractMetadata, parseNovelAIMetadata } from '../services/metadataService';
import { getPastedImageFile, isTextPasteTarget, readClipboardImage } from '../services/imageClipboard';
import { getCopiedImageData, type ImageGenerationData } from '../services/imageClipboardContext';
import { ImageEditControls } from './ImageEditControls';
import { ImageEditPreview } from './ImageEditPreview';
import { useAgentCommand } from '../services/agentCommands';
import { agentRect, paintAgentMask } from '../services/agentCanvas';

export interface ImageEditRequest {
  operation: ImageEditOperation;
  image: string;
  canvasWidth: number;
  canvasHeight: number;
  parentHistoryId?: string;
  baseImageSource?: ImageEditBaseImageSource;
  mask?: string;
  strength: number;
  noise: number;
  focused?: boolean;
  minimumContextArea?: number;
  expansion?: ImageEditCanvasExpansion;
  focusedRect?: { x: number; y: number; width: number; height: number };
  prompt: string;
  negativePrompt: string;
  promptSource: LabImageEditDraft['promptSource'];
}

interface ImageEditPanelProps {
  baseImage: string | null;
  /** 同一张图片再次作为新底图导入时，也必须重建画布并清掉旧蒙版。 */
  baseImageVersion?: number;
  previewImage: string | null;
  operation: ImageEditOperation;
  draft: LabImageEditDraft;
  layout: LabPageLayout;
  maskData?: string;
  generationCostLabel: (operation: ImageEditOperation, focused: boolean, context?: { width: number; height: number; focusedRect?: { x: number; y: number; width: number; height: number } | null; minimumContextArea?: number }) => string;
  isGenerating?: boolean;
  generationProgress?: { step: number; total: number } | null;
  safeMode?: boolean;
  tagAssistEnabled: boolean;
  forceEmptySeed?: boolean;
  enforceFreeStepLimit?: boolean;
  apiKey: string;
  notify: (message: string, type?: 'success' | 'error') => void;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onPromptSource: (source: LabImageEditDraft['promptSource']) => void;
  onDraftChange: (patch: Partial<LabImageEditDraft> & { maskData?: string }) => void;
  onBaseImageChange: (dataUrl: string, source: ImageEditBaseImageSource, parentHistoryId?: string, meta?: { prompt?: string; negativePrompt?: string; params?: import('../types').NAIParams }) => void | Promise<void>;
  onCanvasChange: (imageData: string, maskData?: string) => void | Promise<void>;
  onGenerate: (request: ImageEditRequest, options?: { params: NAIParams; onApproved?: () => Promise<void>; agent: true }) => Promise<boolean | void>;
  onAgentGenerateReady?: (generate: (draft: PromptAgentDraft, onApproved?: () => Promise<void>) => Promise<boolean>) => void;
  latestTextToImageItem?: LocalGenItem;
  onOpenLightbox: (image: string | null) => void;
  getDownloadFilename: () => string;
  generationData?: ImageGenerationData;
  canNavigateHistory?: boolean;
  historyLabel?: string;
  onPreviousHistory?: () => void;
  onNextHistory?: () => void;
  canManageHistoryGroup?: boolean;
  onRemoveCurrentHistory?: () => void;
  onClearHistoryGroup?: () => void;
  /** 移动端悬浮生成栏状态变更回调：父组件据此驱动右下角悬浮胶囊按钮（每次渲染都会回调，内容不变时父组件自行去重）。 */
  onGenerateBarChange?: (bar: { generate: () => void; costLabel: string; canGenerate: boolean; unavailableLabel?: string }) => void;
}

type MaskSnapshot = {
  data: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  /** 解码完成的位图快照（仅当浏览器支持 createImageBitmap 时异步生成）。恢复时优先按像素精确回贴，
   *  不经过二次 PNG 编码；生成期间或解码失败时回退到 data 字段的 dataURL 解码。 */
  bitmap?: ImageBitmap;
  /** 异步位图解码进行中标记：清栈/释放时置 false，让挂起的解码结果自我丢弃。 */
  bitmapPending?: boolean;
};
type ImageEditPanelState = {
  width: number;
  height: number;
  focusedRect: { x: number; y: number; width: number; height: number } | null;
};

type ImageEditNormalizationState = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
};

const emptyExpansion: ImageEditCanvasExpansion = { top: 0, right: 0, bottom: 0, left: 0 };

export const ImageEditPanel: React.FC<ImageEditPanelProps> = ({
  baseImage,
  baseImageVersion = 0,
  previewImage,
  operation,
  draft,
  layout,
  maskData,
  generationCostLabel,
  tagAssistEnabled,
  forceEmptySeed = false,
  enforceFreeStepLimit = true,
  apiKey,
  notify,
  onPromptChange,
  onNegativePromptChange,
  onPromptSource,
  onDraftChange,
  onBaseImageChange,
  onCanvasChange,
  onGenerate,
  onAgentGenerateReady,
  latestTextToImageItem,
  onOpenLightbox,
  getDownloadFilename,
  generationData,
  canNavigateHistory,
  historyLabel,
  onPreviousHistory,
  onNextHistory,
  canManageHistoryGroup,
  onRemoveCurrentHistory,
  onClearHistoryGroup,
  isGenerating = false,
  generationProgress,
  safeMode = false,
  onGenerateBarChange,
}) => {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const agentScopeRef = useRef<HTMLDivElement>(null);
  const agentCommandScope = useId();
  const [agentCanvasRevision, setAgentCanvasRevision] = useState(0);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseImportRevisionRef = useRef(0);
  const importingImageRef = useRef(false);
  const dragDepthRef = useRef(0);
  const drawingRef = useRef(false);
  const selectingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedMaskRef = useRef<string | undefined>(undefined);
  const focusedSelectionArmedRef = useRef(!draft.focusedRect);
  const inFlightRef = useRef(false);
  const applyingOutpaintRef = useRef(false);
  const focusedInteractionRef = useRef<{ mode: 'move' | 'resize'; point: { x: number; y: number }; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const imageLoadRevisionRef = useRef(0);
  const maskRestoreRevisionRef = useRef(0);
  const startPointRef = useRef({ x: 0, y: 0 });
  const focusedRectRef = useRef<ImageEditPanelState['focusedRect']>(draft.focusedRect || null);
  const undoRef = useRef<MaskSnapshot[]>([]);
  const redoRef = useRef<MaskSnapshot[]>([]);
  const pendingMaskRestoreRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // 卸载时释放撤销/重做栈中残留的位图快照，避免组件销毁后 GPU 位图泄漏
  useEffect(() => {
    return () => {
      imageLoadRevisionRef.current += 1;
      undoRef.current.forEach(releaseSnapshotBitmap);
      redoRef.current.forEach(releaseSnapshotBitmap);
    };
    // 仅挂载时注册一次卸载清理；releaseSnapshotBitmap/undoRef/redoRef 均为稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [strength, setStrength] = useState(draft.strength);
  const [noise, setNoise] = useState(draft.noise);
  const [brushSize, setBrushSize] = useState(draft.brushSize);
  const [focused, setFocused] = useState(draft.focused);
  const [minimumContextArea, setMinimumContextArea] = useState(normalizeMinimumContextArea(draft.minimumContextArea));
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [manualMaskEditing, setManualMaskEditing] = useState(false);
  const [expansion, setExpansion] = useState<ImageEditCanvasExpansion>(draft.expansion || emptyExpansion);
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [isApplyingOutpaint, setIsApplyingOutpaint] = useState(false);
  const [state, setState] = useState<ImageEditPanelState>({ width: 0, height: 0, focusedRect: draft.focusedRect || null });
  const [normalization, setNormalization] = useState<ImageEditNormalizationState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBaseImageDragActive, setIsBaseImageDragActive] = useState(false);
  const [mobileTab, setMobileTab] = useState<'canvas' | 'prompt' | 'params'>('canvas');
  useEffect(() => {
    setMobileTab('canvas');
  }, [operation]);
  useEffect(() => {
    importingImageRef.current = false;
    setIsImportingImage(false);
    // 切模式、重置／换底图或卸载后，旧剪贴板读取与文件解析不得提交到新草稿。
    return () => { baseImportRevisionRef.current += 1; };
  }, [operation, baseImage, draft.baseImageRef, baseImageVersion]);
  const maskEditable = !safeMode && !isImportingImage && (operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing));
  // 隐藏画布挂载即存在；只有真正载入底图（width/height 有效）且未在加载时才允许生成，
  // 否则无底图时也会点亮生成按钮，点击后才报尺寸错误。
  const pendingOutpaint = operation === 'outpaint' && !isSameOutpaintExpansion(expansion, draft.appliedExpansion || emptyExpansion);
  const canGenerate = !isLoading && !isImportingImage && !isGenerating && !isApplyingOutpaint && !pendingOutpaint && state.width > 0 && state.height > 0 && Boolean(imageCanvasRef.current) && (operation === 'image-to-image' || Boolean(maskCanvasRef.current));

  // 每次渲染同步移动端悬浮生成栏入口，保证 ChainEditor 拿到的费用标签与预览卡一致；
  // 通过回调上报而非可变 ref，父组件才能在自己渲染时拿到最新状态。
  useEffect(() => {
    if (!onGenerateBarChange) return;
    onGenerateBarChange({
      generate: () => { void submit(); },
      costLabel: generationCostLabel(operation, focused, { width: state.width, height: state.height, focusedRect: state.focusedRect, minimumContextArea }),
      canGenerate,
      unavailableLabel: isImportingImage ? '读取图片中…' : pendingOutpaint ? '请先应用画布扩展' : isApplyingOutpaint || isLoading ? '画布加载中…' : '请先选择底图',
    });
  });

  useEffect(() => { onAgentGenerateReady?.((draft, onApproved) => submit(draft, onApproved)); });

  const snapshot = (): MaskSnapshot | null => {
    const canvas = maskCanvasRef.current;
    return canvas ? { data: canvas.toDataURL('image/png'), rect: focusedRectRef.current ? { ...focusedRectRef.current } : null } : null;
  };

  /** 蒙版画布上是否存在任何非透明像素（即用户是否画了内容）；按 alpha 通道逐像素检查，遇非零提前返回。 */
  const maskHasInk = (canvas: HTMLCanvasElement): boolean => {
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) return false;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 0) return true;
    }
    return false;
  };

  const renderOverlay = () => {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;
    overlay.width = mask.width;
    overlay.height = mask.height;
    const source = mask.getContext('2d')?.getImageData(0, 0, mask.width, mask.height);
    const target = overlay.getContext('2d');
    if (!source || !target) return;
    const output = target.createImageData(mask.width, mask.height);
    for (let index = 0; index < source.data.length; index += 4) {
      output.data[index] = 239;
      output.data[index + 1] = 68;
      output.data[index + 2] = 68;
      output.data[index + 3] = source.data[index + 3] ? Math.max(40, source.data[index + 3] * 0.55) : 0;
    }
    target.putImageData(output, 0, 0);
  };

  const restoreSnapshot = (item: MaskSnapshot) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const restoreRevision = maskRestoreRevisionRef.current + 1;
    maskRestoreRevisionRef.current = restoreRevision;
    // 位图优先：已是解码后的像素快照，直接同步回贴，避免经 dataURL 二次解码
    const context = canvas.getContext('2d');
    if (item.bitmap && context) {
      pendingMaskRestoreRef.current = Promise.resolve(true);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(item.bitmap, 0, 0);
      setAgentCanvasRevision(previous => previous + 1);
      focusedRectRef.current = item.rect;
      setState(previous => ({ ...previous, focusedRect: item.rect }));
      renderOverlay();
      return;
    }
    const image = new Image();
    let complete!: (restored: boolean) => void;
    pendingMaskRestoreRef.current = new Promise(resolve => { complete = resolve; });
    image.onload = () => {
      if (restoreRevision !== maskRestoreRevisionRef.current) { complete(false); return; }
      const loadContext = canvas.getContext('2d');
      if (!loadContext) { complete(false); return; }
      loadContext.clearRect(0, 0, canvas.width, canvas.height);
      loadContext.drawImage(image, 0, 0);
      setAgentCanvasRevision(previous => previous + 1);
      focusedRectRef.current = item.rect;
      setState(previous => ({ ...previous, focusedRect: item.rect }));
      renderOverlay();
      complete(true);
    };
    // 快照 dataURL 解码失败：仅告警并保持当前画布原状（画布内容已是撤销前的状态，堆栈已出栈）
    image.onerror = () => {
      complete(false);
      console.warn('蒙版快照解码失败，撤销/重做已跳过该步骤', item.rect);
    };
    image.src = item.data;
  };

  const resetMask = (width: number, height: number, clearHistory = true) => {
    setAgentCanvasRevision(previous => previous + 1);
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    maskRestoreRevisionRef.current += 1;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.clearRect(0, 0, width, height);
    if (clearHistory) {
      disposeSnapshotBitmaps();
      undoRef.current = [];
      redoRef.current = [];
    }
    renderOverlay();
  };

  const restoreMask = (data: string | undefined, expectedRevision = imageLoadRevisionRef.current) => {
    const restoreRevision = maskRestoreRevisionRef.current + 1;
    maskRestoreRevisionRef.current = restoreRevision;
    lastAppliedMaskRef.current = data;
    if (!data || !maskCanvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      if (expectedRevision !== imageLoadRevisionRef.current || restoreRevision !== maskRestoreRevisionRef.current) return;
      const canvas = maskCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      renderOverlay();
    };
    // 草稿蒙版解码失败：画布保持原状并告警，不静默丢失用户笔迹；后续同 data 的恢复仍会重试
    image.onerror = () => {
      console.warn('外部蒙版解码失败，保留当前画布内容');
    };
    image.src = data;
  };

  const loadBaseImage = async (source: string, restore: { maskData?: string; focusedRect?: ImageEditPanelState['focusedRect'] } = { maskData, focusedRect: draft.focusedRect }) => {
    const loadRevision = imageLoadRevisionRef.current + 1;
    imageLoadRevisionRef.current = loadRevision;
    const restoredMaskData = operation === 'image-to-image' ? undefined : restore.maskData;
    const restoredFocusedRect = operation === 'inpaint' ? restore.focusedRect || null : null;
    setIsLoading(true);
    setIsApplyingOutpaint(false);
    setError(null);
    try {
      const bitmap = await createImageBitmap(await dataUrlToBlob(source));
      const imageCanvas = imageCanvasRef.current;
      if (!imageCanvas || loadRevision !== imageLoadRevisionRef.current) {
        bitmap.close();
        return;
      }
      const originalSize = { width: bitmap.width, height: bitmap.height };
      const expanded = operation === 'outpaint' && draft.appliedExpansion
        ? await createOutpaintCanvas(await dataUrlToBlob(source), draft.appliedExpansion)
        : undefined;
      if (loadRevision !== imageLoadRevisionRef.current) { bitmap.close(); return; }
      setSourceSize(originalSize);
      imageCanvas.width = expanded?.width || bitmap.width;
      imageCanvas.height = expanded?.height || bitmap.height;
      const context = imageCanvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      context.drawImage(expanded?.image || bitmap, 0, 0);
      const dimensionError = validateImageEditDimensions(imageCanvas.width, imageCanvas.height);
      const normalizationTarget = getImageEditNormalizationTarget(imageCanvas.width, imageCanvas.height);
      bitmap.close();
      setNormalization(dimensionError ? { sourceWidth: imageCanvas.width, sourceHeight: imageCanvas.height, targetWidth: normalizationTarget.width, targetHeight: normalizationTarget.height } : null);
      focusedRectRef.current = restoredFocusedRect;
      setState({ width: imageCanvas.width, height: imageCanvas.height, focusedRect: restoredFocusedRect });
      // 图生图无蒙版画布：跳过蒙版重置与恢复，避免触碰不存在的 canvas
      if (operation !== 'image-to-image') {
        resetMask(imageCanvas.width, imageCanvas.height);
        if (expanded) maskCanvasRef.current?.getContext('2d')?.drawImage(expanded.mask, 0, 0);
        restoreMask(restoredMaskData, loadRevision);
        renderOverlay();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '底图读取失败');
    } finally {
      if (loadRevision === imageLoadRevisionRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    setStrength(draft.strength);
    setNoise(draft.noise);
    setBrushSize(draft.brushSize);
    setFocused(draft.focused);
    setMinimumContextArea(normalizeMinimumContextArea(draft.minimumContextArea));
    focusedSelectionArmedRef.current = !draft.focusedRect;
    setExpansion(draft.expansion || emptyExpansion);
    setManualMaskEditing(false);
  }, [operation, draft.baseImageRef, baseImageVersion]);

  useEffect(() => {
    if (baseImage) void loadBaseImage(baseImage);
  }, [baseImage, operation, draft.baseImageRef, manualMaskEditing, baseImageVersion]);

  useEffect(() => {
    if (operation === 'image-to-image' || !maskData || maskData === lastAppliedMaskRef.current || drawingRef.current || selectingRef.current) return;
    restoreMask(maskData);
  }, [maskData, operation]);

  // 键盘快捷键 effect 为空依赖，需要经由 ref 始终调用最新一轮渲染的 undo/redo，
  // 否则会捕获首帧闭包里的 onDraftChange（其中 activeEditOperation 是挂载时的模式），
  // 把蒙版撤销写进另一个编辑模式的草稿。
  const latestUndoRedoRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => {}, redo: () => {} });
  useEffect(() => {
    latestUndoRedoRef.current = { undo, redo };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable) return;
      if (document.activeElement !== maskCanvasRef.current) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) latestUndoRedoRef.current.redo(); else latestUndoRedoRef.current.undo();
      }
      if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        latestUndoRedoRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const getCanvasPoint = (event: React.PointerEvent<HTMLElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
    };
  };

  const handleFocusedInteractionStart = (event: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'resize') => {
    const rect = focusedRectRef.current;
    if (isGenerating || !rect) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    maskRestoreRevisionRef.current += 1;
    commitSnapshot();
    focusedInteractionRef.current = { mode, point: getCanvasPoint(event), rect: { ...rect } };
  };

  const handleFocusedInteractionMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = focusedInteractionRef.current;
    if (!interaction) return;
    event.stopPropagation();
    const point = getCanvasPoint(event);
    const deltaX = point.x - interaction.point.x;
    const deltaY = point.y - interaction.point.y;
    const candidate = interaction.mode === 'move'
      ? { ...interaction.rect, x: interaction.rect.x + deltaX, y: interaction.rect.y + deltaY }
      : { ...interaction.rect, width: Math.max(2, interaction.rect.width + deltaX), height: Math.max(2, interaction.rect.height + deltaY) };
    const next = limitFocusedImageEditRect(state.width, state.height, candidate);
    focusedRectRef.current = next;
    setState(previous => ({ ...previous, focusedRect: next }));
  };

  const handleFocusedInteractionEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!focusedInteractionRef.current) return;
    event.stopPropagation();
    persistMask();
    focusedInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** 释放一张快照的位图；bitmapPending=false 会让挂起的解码结果自我丢弃（见 ensureSnapshotBitmap）。 */
  const releaseSnapshotBitmap = (item: MaskSnapshot) => {
    if (item.bitmap) {
      item.bitmap.close();
      item.bitmap = undefined;
    }
    item.bitmapPending = false;
  };

  /** 为快照异步生成位图并回填。同步置位 bitmapPending 后异步解码：
   *  快照 data 一经压栈即不可变，解码结果只属于该快照自身，不会过期；
   *  唯一需要否决的场景是该快照已被释放（清栈/淘汰/弹出）——此时 bitmapPending 被置 false，
   *  挂起的解码结果自我丢弃，防止把位图重新挂到已释放对象上。解码失败无妨，恢复走 data 兜底。 */
  const ensureSnapshotBitmap = (item: MaskSnapshot) => {
    if (item.bitmap || item.bitmapPending || typeof createImageBitmap !== 'function') return;
    item.bitmapPending = true;
    const capturedItem = item;
    void (async () => {
      try {
        const blob = await dataUrlToBlob(capturedItem.data);
        const decoded = await createImageBitmap(blob);
        if (capturedItem.bitmapPending !== true) {
          // 快照已被释放（清栈/淘汰/弹出）：丢弃这次解码结果
          decoded.close();
          return;
        }
        capturedItem.bitmap = decoded;
      } catch {
        // 解码失败不影响功能：恢复时回退到 data 字段的 dataURL 路径
      } finally {
        capturedItem.bitmapPending = false;
      }
    })();
  };

  /** 释放快照栈中所有未关闭的位图（清空/更换画布尺寸时调用，防止 GPU 位图泄漏）。 */
  const disposeSnapshotBitmaps = () => {
    undoRef.current.forEach(releaseSnapshotBitmap);
    redoRef.current.forEach(releaseSnapshotBitmap);
  };

  const commitSnapshot = () => {
    const item = snapshot();
    if (item) {
      // 与撤销栈顶去重：同一撤销点重复入栈（如同一 stroke 中重复落点/点击）只保留最后一张，
      // 避免用户多点几下撤销时看似"没反应"；同时避免重复触发位图解码。
      // 数据与选区矩形都相同才算同一撤销点（选区移动可能不改像素，但仍应作为可撤销步骤保留）
      const top = undoRef.current[undoRef.current.length - 1];
      const sameState = top && top.data === item.data && JSON.stringify(top.rect) === JSON.stringify(item.rect);
      if (sameState) {
        releaseSnapshotBitmap(item);
        return;
      }
      undoRef.current.push(item);
      if (undoRef.current.length > 30) {
        const evicted = undoRef.current.shift();
        if (evicted) releaseSnapshotBitmap(evicted);
      }
      ensureSnapshotBitmap(item);
    }
    // 新撤销点使整条重做分支失效：释放其中快照的位图再清栈
    redoRef.current.forEach(releaseSnapshotBitmap);
    redoRef.current = [];
  };

  const persistMask = () => {
    setAgentCanvasRevision(previous => previous + 1);
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const data = canvasToDataUrl(canvas);
      lastAppliedMaskRef.current = data;
      onDraftChange({ maskData: data, focusedRect: focusedRectRef.current || undefined }); window.dispatchEvent(new Event("nai-agent-capabilities-changed"));
    }
  };

  const drawMask = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas || (focused && !focusedRectRef.current)) return;
    const point = getCanvasPoint(event);
    const focusedRect = focusedRectRef.current;
    if (focused && focusedRect) {
      point.x = Math.max(focusedRect.x, Math.min(focusedRect.x + focusedRect.width, point.x));
      point.y = Math.max(focusedRect.y, Math.min(focusedRect.y + focusedRect.height, point.y));
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const previous = lastPointRef.current || point;
    const distance = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / Math.max(1, brushSize / 2)));
    context.save();
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.fillStyle = '#ffffff';
    for (let step = 0; step <= distance; step += 1) {
      const ratio = step / distance;
      const x = previous.x + (point.x - previous.x) * ratio;
      const y = previous.y + (point.y - previous.y) * ratio;
      context.beginPath();
      context.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    lastPointRef.current = point;
    renderOverlay();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskEditable || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    maskRestoreRevisionRef.current += 1;
    const point = getCanvasPoint(event);
    if (focused && (focusedSelectionArmedRef.current || !focusedRectRef.current || event.shiftKey)) {
      selectingRef.current = true;
      startPointRef.current = point;
      focusedRectRef.current = { x: point.x, y: point.y, width: 1, height: 1 };
      commitSnapshot();
      setState(previous => ({ ...previous, focusedRect: focusedRectRef.current }));
      return;
    }
    drawingRef.current = true;
    lastPointRef.current = null;
    commitSnapshot();
    drawMask(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskEditable || !event.isPrimary) return;
    if (selectingRef.current) {
      const point = getCanvasPoint(event);
      const start = startPointRef.current;
      focusedRectRef.current = limitFocusedImageEditRect(state.width, state.height, {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      });
      setState(previous => ({ ...previous, focusedRect: focusedRectRef.current }));
      return;
    }
    if (drawingRef.current) drawMask(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary) return;
    if (maskEditable && (drawingRef.current || selectingRef.current)) persistMask();
    drawingRef.current = false;
    selectingRef.current = false;
    lastPointRef.current = null;
    focusedSelectionArmedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearMask = () => {
    maskRestoreRevisionRef.current += 1;
    commitSnapshot();
    resetMask(state.width, state.height, false);
    focusedRectRef.current = null;
    setState(previous => ({ ...previous, focusedRect: null }));
    onDraftChange({ maskData: undefined, maskRef: undefined, focusedRect: undefined });
  };

  const invertMask = () => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    maskRestoreRevisionRef.current += 1;
    commitSnapshot();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) image.data[index + 3] = 255 - image.data[index + 3];
    context.putImageData(image, 0, 0);
    renderOverlay();
    persistMask();
  };

  const undo = () => {
    const current = snapshot();
    const previous = undoRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(current);
    if (redoRef.current.length > 30) {
      const evicted = redoRef.current.shift();
      if (evicted) releaseSnapshotBitmap(evicted);
    }
    ensureSnapshotBitmap(current);
    restoreSnapshot(previous);
    lastAppliedMaskRef.current = previous.data;
    onDraftChange({ maskData: previous.data, focusedRect: previous.rect || undefined });
    // 该快照已从栈中弹出且不再被引用：释放其位图（恢复若走同步位图路径则此时已回贴完毕）
    releaseSnapshotBitmap(previous);
  };

  const redo = () => {
    const current = snapshot();
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(current);
    if (undoRef.current.length > 30) {
      const evicted = undoRef.current.shift();
      if (evicted) releaseSnapshotBitmap(evicted);
    }
    ensureSnapshotBitmap(current);
    restoreSnapshot(next);
    lastAppliedMaskRef.current = next.data;
    onDraftChange({ maskData: next.data, focusedRect: next.rect || undefined });
    // 该快照已从栈中弹出且不再被引用：释放其位图（恢复若走同步位图路径则此时已回贴完毕）
    releaseSnapshotBitmap(next);
  };

  const resetFocusedRect = () => {
    focusedSelectionArmedRef.current = true;
    focusedRectRef.current = null;
    maskRestoreRevisionRef.current += 1;
    setState(previous => ({ ...previous, focusedRect: null }));
    const canvas = maskCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    renderOverlay();
    persistMask();
  };

  const importBaseImageFile = async (readFile: () => File | Promise<File>, source: 'upload' | 'clipboard' = 'upload') => {
    if (importingImageRef.current || isLoading || isGenerating || isApplyingOutpaint) return;
    const revision = ++baseImportRevisionRef.current;
    const isCurrent = () => revision === baseImportRevisionRef.current;
    importingImageRef.current = true;
    setIsImportingImage(true);
    setError(null);
    try {
      const file = await readFile();
      if (!isCurrent()) return;
      const isSupportedImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        || (!file.type && /\.(?:png|jpe?g|webp)$/i.test(file.name));
      if (!isSupportedImage) throw new Error('请使用 PNG、JPEG 或 WebP 图片作为底图');
      // 先确认可解码再保存，损坏图片不能覆盖现有底图。尺寸规范化仍交给原画布流程。
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (!isCurrent()) return;
      if (!pixels || pixels > 40_000_000) throw new Error('底图尺寸无效或超过 4000 万像素，请使用较小的图片');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => reader.result ? resolve(String(reader.result)) : reject(new Error('底图读取失败'));
        reader.onerror = () => reject(new Error('底图读取失败'));
        reader.readAsDataURL(file);
      });
      if (!isCurrent()) return;
      const inheritGenerationData = operation !== 'image-to-image';
      let extractedMeta: ImageGenerationData | undefined = inheritGenerationData && source === 'clipboard' ? await getCopiedImageData(file) : undefined;
      // 项目内复制优先读取与实际像素匹配的配置；外部图片和上传共用元数据解析。
      // 图生图换底图保留独立配置；完整生成信息通过工作台顶栏主动读取。
      if (inheritGenerationData && !extractedMeta) {
        try {
          const rawMeta = await extractMetadata(file);
          if (rawMeta) {
            const parsed = parseNovelAIMetadata(rawMeta);
            if (parsed.prompt || parsed.params.characters?.some(character => character.prompt.trim())) {
              extractedMeta = {
                prompt: parsed.prompt,
                negativePrompt: parsed.negativePrompt,
                params: parsed.params,
              };
            }
          }
        } catch (metaErr) {
          console.warn('解析底图元数据跳过:', metaErr);
        }
      }
      if (!isCurrent()) return;
      if (extractedMeta) await onBaseImageChange(dataUrl, source, undefined, extractedMeta);
      else await onBaseImageChange(dataUrl, source);
      // 等父层更新草稿后再由底图 effect 加载，避免沿用上一张图的已应用扩展量。
      if (isCurrent() && extractedMeta) {
        notify('已自动解析并带入底图提示词与参数', 'success');
      }
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : '底图读取失败';
      setError(message);
      if (source === 'clipboard') notify(message, 'error');
    } finally {
      if (isCurrent()) {
        importingImageRef.current = false;
        setIsImportingImage(false);
      }
    }
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importBaseImageFile(() => file);
  };

  const handleBaseImagePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (isTextPasteTarget(event.target)) return;
    const file = getPastedImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void importBaseImageFile(() => file, 'clipboard');
  };

  const hasDraggedImage = (dataTransfer: DataTransfer) => Array.from(dataTransfer.items || []).some(item => item.kind === 'file' && (item.type.startsWith('image/') || !item.type));

  const handleBaseImageDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsBaseImageDragActive(true);
  };

  const handleBaseImageDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleBaseImageDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsBaseImageDragActive(false);
  };

  const handleBaseImageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const imageFile = Array.from(event.dataTransfer.files || []).find(file => file.type.startsWith('image/') || /\.(?:png|jpe?g|webp)$/i.test(file.name));
    if (!imageFile && !hasDraggedImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsBaseImageDragActive(false);
    if (imageFile) void importBaseImageFile(() => imageFile);
    else setError('请拖入 PNG、JPEG 或 WebP 图片作为底图');
  };

  const applyOutpaint = async () => {
    const imageCanvas = imageCanvasRef.current;
    if (!baseImage || !imageCanvas || !state.width || !state.height || applyingOutpaintRef.current || importingImageRef.current || isLoading || isGenerating || !pendingOutpaint) return;
    applyingOutpaintRef.current = true;
    setIsApplyingOutpaint(true);
    const revision = imageLoadRevisionRef.current;
    const appliedExpansion = { ...expansion };
    try {
      // 每次都从本轮原图重建；上一轮白边永远不能变成下一次扩展的底图。
      const result = await createOutpaintCanvas(await dataUrlToBlob(baseImage), appliedExpansion);
      if (revision !== imageLoadRevisionRef.current) return;
      maskRestoreRevisionRef.current += 1;
      const imageContext = imageCanvas.getContext('2d');
      if (!imageContext) return;
      imageCanvas.width = result.width;
      imageCanvas.height = result.height;
      imageContext.drawImage(result.image, 0, 0);
      const mask = maskCanvasRef.current;
      if (!mask) return;
      mask.width = result.width;
      mask.height = result.height;
      mask.getContext('2d')?.drawImage(result.mask, 0, 0);
      // 画布尺寸已变，旧快照按原尺寸回贴会把扩图白边错误恢复成"保留"语义，必须清空撤销/重做栈
      disposeSnapshotBitmaps();
      undoRef.current = [];
      redoRef.current = [];
      focusedRectRef.current = null;
      setState({ width: result.width, height: result.height, focusedRect: null });
      renderOverlay();
      const nextMaskData = canvasToDataUrl(mask);
      lastAppliedMaskRef.current = nextMaskData;
      await onCanvasChange(baseImage, nextMaskData);
      if (revision !== imageLoadRevisionRef.current) return;
      onDraftChange({
        maskData: nextMaskData,
        focusedRect: undefined,
        expansion: appliedExpansion,
        appliedExpansion,
      });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '扩图尺寸无效');
    } finally {
      applyingOutpaintRef.current = false;
      if (revision === imageLoadRevisionRef.current) setIsApplyingOutpaint(false);
    }
  };

  const applyNormalization = (mode: ImageEditNormalizationMode) => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!imageCanvas || (operation !== 'image-to-image' && !maskCanvas) || !normalization) return;
    maskRestoreRevisionRef.current += 1;
    const { sourceWidth, sourceHeight, targetWidth, targetHeight } = normalization;
    const image = document.createElement('canvas');
    image.width = targetWidth;
    image.height = targetHeight;
    const imageContext = image.getContext('2d');
    const mask = maskCanvas ? document.createElement('canvas') : null;
    if (mask) {
      mask.width = targetWidth;
      mask.height = targetHeight;
    }
    const maskContext = mask?.getContext('2d');
    if (!imageContext || (mask && !maskContext)) {
      setError('无法创建尺寸规范化画布');
      return;
    }
    imageContext.imageSmoothingEnabled = true;
    imageContext.imageSmoothingQuality = 'high';
    if (maskContext) {
      maskContext.imageSmoothingEnabled = false;
    }
    let sourceRect = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    let destinationRect = { x: 0, y: 0, width: targetWidth, height: targetHeight };
    if (mode === 'crop') sourceRect = getCenteredImageEditCrop(sourceWidth, sourceHeight, targetWidth, targetHeight);
    if (mode === 'contain') destinationRect = getContainedImageEditRect(sourceWidth, sourceHeight, targetWidth, targetHeight);
    if (mode === 'contain') {
      imageContext.fillStyle = '#ffffff';
      imageContext.fillRect(0, 0, targetWidth, targetHeight);
    }
    imageContext.drawImage(imageCanvas, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, destinationRect.x, destinationRect.y, destinationRect.width, destinationRect.height);
    if (maskCanvas && maskContext) {
      maskContext.drawImage(maskCanvas, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, destinationRect.x, destinationRect.y, destinationRect.width, destinationRect.height);
    }

    const currentRect = focusedRectRef.current;
    const nextFocusedRect = currentRect ? {
      x: (currentRect.x - sourceRect.x) * destinationRect.width / Math.max(1, sourceRect.width) + destinationRect.x,
      y: (currentRect.y - sourceRect.y) * destinationRect.height / Math.max(1, sourceRect.height) + destinationRect.y,
      width: currentRect.width * destinationRect.width / Math.max(1, sourceRect.width),
      height: currentRect.height * destinationRect.height / Math.max(1, sourceRect.height),
    } : null;
    imageCanvas.width = targetWidth;
    imageCanvas.height = targetHeight;
    imageCanvas.getContext('2d')?.drawImage(image, 0, 0);
    if (maskCanvas && mask) {
      maskCanvas.width = targetWidth;
      maskCanvas.height = targetHeight;
      maskCanvas.getContext('2d')?.drawImage(mask, 0, 0);
    }
    focusedRectRef.current = nextFocusedRect ? limitFocusedImageEditRect(targetWidth, targetHeight, nextFocusedRect) : null;
    disposeSnapshotBitmaps();
    undoRef.current = [];
    redoRef.current = [];
    setState({ width: targetWidth, height: targetHeight, focusedRect: focusedRectRef.current });
    setNormalization(null);
    if (operation !== 'image-to-image') {
      renderOverlay();
    }
    const imageData = canvasToDataUrl(imageCanvas);
    const maskData = maskCanvas ? canvasToDataUrl(maskCanvas) : undefined;
    // 扩图草稿位置仍基于原图；规范化把当前扩展画布变为新底图，先换算到该画布再随裁剪／填充变换。
    const canvasCharacters = operation === 'outpaint' && draft.appliedExpansion
      ? transformCharacterCoordinatesForOutpaint(draft.params.characters, sourceSize.width, sourceSize.height, draft.appliedExpansion)
      : draft.params.characters;
    onCanvasChange(imageData, maskData);
    onDraftChange({ maskData, focusedRect: focusedRectRef.current || undefined,
      params: { ...draft.params, characters: transformCharacterCoordinatesForImageRect(canvasCharacters,
        sourceWidth, sourceHeight, sourceRect, destinationRect, targetWidth, targetHeight) },
      ...(operation === 'outpaint' ? { expansion: { ...emptyExpansion }, appliedExpansion: undefined, outpaintRatioId: 'custom' } : {}),
    });
    notify(`已将底图规范化为 ${targetWidth} × ${targetHeight}`, 'success');
  };

  const submit = async (override?: PromptAgentDraft, onApproved?: () => Promise<void>): Promise<boolean> => {
    const stop = (message: string, code: string) => {
      setError(message);
      if (override) throw agentOperationError(message, code);
      return false;
    };
    if (isApplyingOutpaint || applyingOutpaintRef.current || importingImageRef.current || isLoading) return stop('底图或画布正在加载，请等待完成后再生成', 'canvas_busy');
    if (pendingOutpaint) return stop('画布扩展已调整，请先应用后再生成', 'outpaint_pending');
    if (inFlightRef.current || isGenerating) return stop('已有图片正在生成，请等待完成', 'generation_busy');
    if (!baseImage || !state.width || !state.height) return stop('请先选择或上传一张底图再生成', 'missing_base_image');
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    // 图生图不渲染蒙版画布（maskCanvas 为 null），仅要求底图画布存在
    if (!imageCanvas || (operation !== 'image-to-image' && !maskCanvas)) return stop('编辑画布尚未准备好，请先选择底图', 'canvas_not_ready');
    // 画布存在但尚未载入底图（width=0）时给出明确提示，而不是静默失败
    if (!imageCanvas.width || !imageCanvas.height) {
      return stop('请先选择或上传一张底图再生成', 'missing_base_image');
    }
    const dimensionError = validateImageEditDimensions(imageCanvas.width, imageCanvas.height);
    if (dimensionError) {
      return stop(`请先处理底图尺寸：${dimensionError}`, 'invalid_dimensions');
    }
    if (operation === 'inpaint' && focused && (!state.focusedRect || state.focusedRect.width < 2 || state.focusedRect.height < 2)) {
      return stop('请先在画布上框选聚焦重绘区域', 'missing_focused_region');
    }
    // 蒙版为空（未画任何笔迹/未应用画布扩展）时 infill/outpaint 语义上等于不重绘，
    // 但 NovelAI 仍会按编辑请求计费——拦截并提示，避免白耗 Anlas
    if (operation !== 'image-to-image' && !maskHasInk(maskCanvas!)) {
      return stop(operation === 'outpaint' ? '请先设置画布扩展并点击「应用画布扩展」，或手动绘制扩图蒙版' : '请先在蒙版上涂画需要重绘的区域', 'missing_mask');
    }
    setError(null);
    inFlightRef.current = true;
    try {
      const result = await onGenerate({
      operation,
      image: canvasToDataUrl(imageCanvas),
      canvasWidth: imageCanvas.width,
      canvasHeight: imageCanvas.height,
      parentHistoryId: draft.baseImageSource === 'upload' || draft.baseImageSource === 'inspiration' || draft.baseImageSource === 'clipboard' ? undefined : draft.parentHistoryId,
      baseImageSource: draft.baseImageSource,
      mask: operation === 'image-to-image' ? undefined : canvasToDataUrl(maskCanvas!),
      strength,
      noise,
      focused: focused && operation === 'inpaint',
      minimumContextArea: focused && operation === 'inpaint' ? minimumContextArea : undefined,
      expansion: operation === 'outpaint' ? draft.appliedExpansion || emptyExpansion : undefined,
      focusedRect: focused && operation === 'inpaint' ? state.focusedRect || undefined : undefined,
      prompt: override ? [override.basePrompt, override.subjectPrompt, ...override.modules.filter(module => module.isActive).map(module => module.content)].filter(Boolean).join(', ') : draft.prompt,
      negativePrompt: override?.negativePrompt ?? draft.negativePrompt,
      promptSource: override ? 'custom' : draft.promptSource,
      }, override ? { params: override.params, onApproved, agent: true } : undefined);
      return result === true;
    } finally {
      inFlightRef.current = false;
    }
  };

  const agentCanvasState = () => ({ operation, width: imageCanvasRef.current?.width || 0, height: imageCanvasRef.current?.height || 0, sourceSize, focused, focusedRect: focusedRectRef.current, strength, noise, expansion, appliedExpansion: draft.appliedExpansion, hasMask: Boolean(maskCanvasRef.current && maskHasInk(maskCanvasRef.current)), canGenerate, busy: isLoading || isImportingImage || isApplyingOutpaint, error });
  const latestAgentCanvasState = useRef(agentCanvasState); latestAgentCanvasState.current = agentCanvasState;
  const readCommittedCanvasState = async () => {
    let previous = '', stableSince = Date.now(); const deadline = Date.now() + 5000;
    // 等待父组件草稿与异步图片解码提交；仅等一帧仍可能读到旧的 busy／canGenerate。
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
      const current = latestAgentCanvasState.current(), signature = JSON.stringify(current);
      if (signature !== previous) { previous = signature; stableSince = Date.now(); }
      if (!current.busy && Date.now() - stableSince >= 80) return current;
    }
    throw new Error('画布状态仍未稳定，请重新读取实际结果');
  };
  useAgentCommand({ name: 'get_image_edit_state', label: '读取真实编辑画布', description: '读取底图实际像素尺寸、蒙版、聚焦重绘选区和扩图状态。坐标以实际画布像素为准。', parameters: { type: 'object', properties: {} }, readOnly: true, scope: () => agentScopeRef.current, execute: agentCanvasState });
  useAgentCommand({ name: 'inspect_edit_canvas', label: '观察当前底图', description: '通过图片观察工具把当前底图交给当前模型；不调用其他视觉模型。', parameters: { type: 'object', properties: {} }, readOnly: true, scope: () => agentScopeRef.current, execute: () => {
    const source = imageCanvasRef.current;
    if (!source || isLoading || !state.width) throw new Error('当前底图尚未准备好');
    const canvas = document.createElement('canvas'), ratio = Math.min(1, 1280 / Math.max(source.width, source.height));
    canvas.width = Math.round(source.width * ratio); canvas.height = Math.round(source.height * ratio);
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .8).split(',')[1];
    if (!data || data.length > 1_500_000) throw new Error('画布过大，无法交给当前模型');
    return { image: { data, mimeType: 'image/jpeg', width: source.width, height: source.height }, canvas: agentCanvasState() };
  } });
  useAgentCommand({ name: 'edit_image_canvas', label: '编辑蒙版与画布', description: '使用实际像素编辑当前模式。蒙版白色为重绘区域，保留其他像素和撤销记录；聚焦重绘模式必须先设置选区。扩图先设置四边扩展，再应用。不会生成图片或扣费。', parameters: { type: 'object', required: ['operation'], properties: { operation: { enum: ['paint_rectangle', 'paint_ellipse', 'paint_polygon', 'brush_stroke', 'erase_rectangle', 'clear_mask', 'invert_mask', 'undo', 'redo', 'set_focused_rect', 'normalize', 'set_expansion', 'apply_expansion'] }, rect: { type: 'object', required: ['x', 'y', 'width', 'height'], properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } }, points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } }, brushSize: { type: 'number', minimum: 1, maximum: 256 }, erase: { type: 'boolean' }, expansion: { type: 'object', properties: { top: { type: 'number' }, right: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' } } }, mode: { enum: ['contain', 'crop', 'stretch'] } } }, scope: () => agentScopeRef.current, execute: async args => {
    const canvas = maskCanvasRef.current, image = imageCanvasRef.current;
    if (!image || !state.width || isLoading || isImportingImage || isGenerating || isApplyingOutpaint) throw new Error('底图未准备好或当前正在执行，请等待真实画布');
    if (safeMode) throw new Error('当前安全模式禁止编辑画布，请先由用户调整安全模式');
    const action = String(args.operation);
    if (action === 'normalize') {
      if (!['contain', 'crop', 'stretch'].includes(String(args.mode))) throw new Error('请选择 contain、crop 或 stretch 规范化方式');
      applyNormalization(args.mode as ImageEditNormalizationMode);
    } else if (action === 'set_expansion') {
      if (operation !== 'outpaint') throw new Error('当前不是扩图模式');
      const value = args.expansion as ImageEditCanvasExpansion;
      if (!value || !['top', 'right', 'bottom', 'left'].every(key => { const amount = value[key as keyof ImageEditCanvasExpansion]; return Number.isInteger(amount) && amount >= 0 && amount <= 4096 && amount % 64 === 0; })) throw new Error('四边扩展必须是 0～4096 的 64 倍数');
      const message = validateImageEditDimensions(sourceSize.width + value.left + value.right, sourceSize.height + value.top + value.bottom); if (message) throw new Error(message);
      setExpansion({ ...value }); onDraftChange({ expansion: { ...value } });
      return { ...await readCommittedCanvasState(), expansion: value, applied: false };
    } else if (action === 'apply_expansion') {
      if (operation !== 'outpaint' || !pendingOutpaint) throw new Error('没有待应用的画布扩展');
      await applyOutpaint();
      if (image.width !== sourceSize.width + expansion.left + expansion.right || image.height !== sourceSize.height + expansion.top + expansion.bottom) throw new Error('扩图未完成，请核对页面错误');
    } else {
      if (operation === 'image-to-image' || !canvas || !maskEditable) throw new Error('当前模式没有可编辑蒙版；扩图手绘需先开启手动蒙版');
      if (action === 'set_focused_rect') {
        if (operation !== 'inpaint') throw new Error('选区仅用于局部重绘');
        const rect = limitFocusedImageEditRect(image.width, image.height, agentRect(args.rect, image.width, image.height));
        commitSnapshot(); setFocused(true); focusedRectRef.current = rect; focusedSelectionArmedRef.current = false;
        setState(previous => ({ ...previous, focusedRect: rect })); onDraftChange({ focused: true, focusedRect: rect });
        return { ...await readCommittedCanvasState(), focused: true, focusedRect: rect };
      }
      if (action === 'clear_mask') clearMask();
      else if (action === 'invert_mask') invertMask();
      else if (action === 'undo' || action === 'redo') {
        if (!(action === 'undo' ? undoRef.current : redoRef.current).length) throw new Error(`没有可${action === 'undo' ? '撤销' : '重做'}的画布操作`);
        if (action === 'undo') undo(); else redo();
        if (!await pendingMaskRestoreRef.current) throw new Error('蒙版恢复未完成，请重新读取实际画布');
      }
      else {
        if (focused && !focusedRectRef.current) throw new Error('聚焦重绘需要先设置实际选区');
        const context = canvas.getContext('2d'); if (!context) throw new Error('蒙版画布不可用');
        const original = context.getImageData(0, 0, canvas.width, canvas.height);
        const painted = paintAgentMask(original.data, canvas.width, canvas.height, args, focused ? focusedRectRef.current : null);
        commitSnapshot(); maskRestoreRevisionRef.current += 1; original.data.set(painted.data); context.putImageData(original, 0, 0); renderOverlay(); persistMask();
        return { ...await readCommittedCanvasState(), changedPixels: painted.changedPixels };
      }
    }
    return readCommittedCanvasState();
  } });

  const mobileTabs = operation === 'image-to-image'
    ? ([['canvas', '底图'], ['prompt', '提示'], ['params', '参数']] as const)
    : operation === 'inpaint'
    ? ([['canvas', '画板'], ['prompt', '提示'], ['params', '参数']] as const)
    : ([['canvas', '画布'], ['prompt', '提示'], ['params', '参数']] as const);

  return (
    <div ref={agentScopeRef} data-agent-command-scope={agentCommandScope} data-agent-canvas-state={JSON.stringify({ operation, width: state.width, height: state.height, focusedRect: state.focusedRect, focused, revision: agentCanvasRevision, busy: isLoading || isImportingImage || isApplyingOutpaint, error })} aria-busy={isLoading || isImportingImage || isApplyingOutpaint} className="flex min-h-0 flex-1 flex-col">
      <nav className="grid h-10 flex-none grid-cols-3 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 lg:hidden">
        {mobileTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mobileTab === value}
            onClick={() => setMobileTab(value)}
            className={`relative min-w-0 text-sm font-bold ${mobileTab === value ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {label}
            {mobileTab === value && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-indigo-500" />}
          </button>
        ))}
      </nav>
      <div
        data-image-edit-drop-zone="true"
        tabIndex={-1}
        className="chain-editor-body relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-gray-900 lg:flex-row lg:overflow-hidden"
        onDragEnter={handleBaseImageDragEnter}
        onDragOver={handleBaseImageDragOver}
        onDragLeave={handleBaseImageDragLeave}
        onDrop={handleBaseImageDrop}
        onPaste={handleBaseImagePaste}
        onPointerDownCapture={event => {
          if (!(event.target instanceof Element)) return;
          const control = event.target.closest('button, a, input, textarea, select, [contenteditable], [tabindex]');
          if (!control || control === event.currentTarget) event.currentTarget.focus({ preventScroll: true });
        }}
      >
        {isBaseImageDragActive && <div className="pointer-events-none absolute inset-0 z-[90] flex items-center justify-center bg-indigo-950/55 backdrop-blur-sm"><div className="rounded-xl border-2 border-dashed border-white/80 bg-white/95 px-6 py-5 text-center text-sm font-bold text-indigo-700 shadow-2xl dark:bg-gray-900/95 dark:text-indigo-300">松手导入为当前编辑底图<br /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">PNG / JPEG / WebP</span></div></div>}
        <ImageEditControls
          operation={operation}
          draft={draft}
          layout={layout}
          mobileTab={mobileTab}
          fileInputRef={fileInputRef}
          forceEmptySeed={forceEmptySeed}
          enforceFreeStepLimit={enforceFreeStepLimit}
          baseImagePreview={baseImage}
          canvasProps={{
            agentCommandScope,
            imageCanvasRef,
            maskCanvasRef,
            overlayCanvasRef,
            width: state.width,
            height: state.height,
            focusedRect: state.focusedRect,
            focused,
            isLoading,
            isBusy: isLoading || isImportingImage || isGenerating,
            maskEditable,
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onFocusedInteractionStart: handleFocusedInteractionStart,
            onFocusedInteractionMove: handleFocusedInteractionMove,
            onFocusedInteractionEnd: handleFocusedInteractionEnd,
          }}
          latestTextToImageItem={latestTextToImageItem}
          selectableParams={draft.params}
          strength={strength}
          noise={noise}
          brushSize={brushSize}
          focused={focused}
          minimumContextArea={minimumContextArea}
          tool={tool}
          manualMaskEditing={manualMaskEditing}
          expansion={expansion}
          isBusy={isLoading || isImportingImage || isGenerating || isApplyingOutpaint}
          safeMode={safeMode}
          tagAssistEnabled={tagAssistEnabled}
          apiKey={apiKey}
          notify={notify}
          onPromptChange={onPromptChange}
          onNegativePromptChange={onNegativePromptChange}
          onPromptSource={onPromptSource}
          onDraftChange={onDraftChange}
          onFileChange={handleUpload}
          onPasteImage={() => { void importBaseImageFile(readClipboardImage, 'clipboard'); }}
          onSelectImageSource={(item, source) => {
            if (importingImageRef.current || isLoading || isGenerating || isApplyingOutpaint) return;
            const revision = ++baseImportRevisionRef.current;
            importingImageRef.current = true;
            setIsImportingImage(true);
            setError(null);
            void (async () => {
              try {
                await onBaseImageChange(item.imageUrl, source, item.id);
              } catch (error) {
                if (revision === baseImportRevisionRef.current) setError(error instanceof Error ? error.message : '底图载入失败');
              } finally {
                if (revision === baseImportRevisionRef.current) {
                  importingImageRef.current = false;
                  setIsImportingImage(false);
                }
              }
            })();
          }}
          onStrengthChange={value => { setStrength(value); onDraftChange({ strength: value }); }}
          onNoiseChange={value => { setNoise(value); onDraftChange({ noise: value }); }}
          onBrushSizeChange={value => { setBrushSize(value); onDraftChange({ brushSize: value }); }}
          onFocusedChange={value => { setFocused(value); focusedSelectionArmedRef.current = value; if (!value) { focusedRectRef.current = null; setState(previous => ({ ...previous, focusedRect: null })); } onDraftChange({ focused: value, ...(value ? {} : { focusedRect: undefined }) }); }}
          onMinimumContextAreaChange={value => { setMinimumContextArea(value); onDraftChange({ minimumContextArea: value }); }}
          onToolChange={setTool}
          onManualMaskEditingChange={setManualMaskEditing}
          onClearMask={clearMask}
          onInvertMask={invertMask}
          onUndo={undo}
          onRedo={redo}
          onExpansionChange={value => { setExpansion(value); onDraftChange({ expansion: value }); }}
          outpaintSourceSize={sourceSize}
          onApplyOutpaint={() => { void applyOutpaint(); }}
          onResetFocusedRect={resetFocusedRect}
          normalization={normalization}
          onNormalize={applyNormalization}
        />
        <ImageEditPreview
          operation={operation}
          image={previewImage}
          error={error}
          generationCostLabel={generationCostLabel(operation, focused, { width: state.width, height: state.height, focusedRect: state.focusedRect, minimumContextArea })}
          onGenerate={() => { void submit(); }}
          isLoading={isLoading || isImportingImage}
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          generationProgress={generationProgress}
          onOpenLightbox={onOpenLightbox}
          getDownloadFilename={getDownloadFilename}
          generationData={generationData}
          canNavigateHistory={canNavigateHistory}
          historyLabel={historyLabel}
          onPreviousHistory={onPreviousHistory}
          onNextHistory={onNextHistory}
          canManageHistoryGroup={canManageHistoryGroup}
          onRemoveCurrentHistory={onRemoveCurrentHistory}
          onClearHistoryGroup={onClearHistoryGroup}
        />
      </div>
    </div>
  );
};
