import React, { useEffect, useRef, useState } from 'react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, LocalGenItem } from '../types';
import { LabPageLayout } from '../services/appearancePreferences';
import { canvasToDataUrl, createOutpaintCanvas, dataUrlToBlob, getCenteredImageEditCrop, getContainedImageEditRect, getImageEditNormalizationTarget, ImageEditNormalizationMode, limitFocusedImageEditRect, normalizeMinimumContextArea, validateImageEditDimensions } from '../services/imageEdit';
import { extractMetadata, parseNovelAIMetadata } from '../services/metadataService';
import { ImageEditControls } from './ImageEditControls';
import { ImageEditPreview } from './ImageEditPreview';

export interface ImageEditRequest {
  operation: ImageEditOperation;
  image: string;
  canvasWidth: number;
  canvasHeight: number;
  parentHistoryId?: string;
  baseImageSource?: 'generated' | 'history' | 'upload';
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
  onBaseImageChange: (dataUrl: string, source: 'generated' | 'history' | 'upload', parentHistoryId?: string, meta?: { prompt?: string; negativePrompt?: string; params?: import('../types').NAIParams }) => void;
  onCanvasChange: (imageData: string, maskData: string) => void;
  onGenerate: (request: ImageEditRequest) => Promise<void>;
  latestTextToImageItem?: LocalGenItem;
  onOpenLightbox: (image: string | null) => void;
  getDownloadFilename: () => string;
  canNavigateHistory?: boolean;
  historyLabel?: string;
  onPreviousHistory?: () => void;
  onNextHistory?: () => void;
  canManageHistoryGroup?: boolean;
  onRemoveCurrentHistory?: () => void;
  onClearHistoryGroup?: () => void;
  /** 移动端悬浮生成栏状态变更回调：父组件据此驱动右下角悬浮胶囊按钮（每次渲染都会回调，内容不变时父组件自行去重）。 */
  onGenerateBarChange?: (bar: { generate: () => void; costLabel: string; canGenerate: boolean }) => void;
}

type MaskSnapshot = { data: string; rect: { x: number; y: number; width: number; height: number } | null };
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
  latestTextToImageItem,
  onOpenLightbox,
  getDownloadFilename,
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
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const drawingRef = useRef(false);
  const selectingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedMaskRef = useRef<string | undefined>(undefined);
  const focusedSelectionArmedRef = useRef(!draft.focusedRect);
  const inFlightRef = useRef(false);
  const focusedInteractionRef = useRef<{ mode: 'move' | 'resize'; point: { x: number; y: number }; rect: { x: number; y: number; width: number; height: number } } | null>(null);
  const imageLoadRevisionRef = useRef(0);
  const maskRestoreRevisionRef = useRef(0);
  const startPointRef = useRef({ x: 0, y: 0 });
  const focusedRectRef = useRef<ImageEditPanelState['focusedRect']>(draft.focusedRect || null);
  const undoRef = useRef<MaskSnapshot[]>([]);
  const redoRef = useRef<MaskSnapshot[]>([]);
  const [strength, setStrength] = useState(draft.strength);
  const [noise, setNoise] = useState(draft.noise);
  const [brushSize, setBrushSize] = useState(draft.brushSize);
  const [focused, setFocused] = useState(draft.focused);
  const [minimumContextArea, setMinimumContextArea] = useState(normalizeMinimumContextArea(draft.minimumContextArea));
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [manualMaskEditing, setManualMaskEditing] = useState(false);
  const [expansion, setExpansion] = useState<ImageEditCanvasExpansion>(draft.expansion || emptyExpansion);
  const [state, setState] = useState<ImageEditPanelState>({ width: 0, height: 0, focusedRect: draft.focusedRect || null });
  const [normalization, setNormalization] = useState<ImageEditNormalizationState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBaseImageDragActive, setIsBaseImageDragActive] = useState(false);
  const maskEditable = !safeMode && (operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing));
  // 隐藏画布挂载即存在；只有真正载入底图（width/height 有效）且未在加载时才允许生成，
  // 否则无底图时也会点亮生成按钮，点击后才报尺寸错误。
  const canGenerate = !isLoading && !isGenerating && state.width > 0 && state.height > 0 && Boolean(imageCanvasRef.current) && (operation === 'image-to-image' || Boolean(maskCanvasRef.current));

  // 每次渲染同步移动端悬浮生成栏入口，保证 ChainEditor 拿到的费用标签与预览卡一致；
  // 通过回调上报而非可变 ref，父组件才能在自己渲染时拿到最新状态。
  useEffect(() => {
    if (!onGenerateBarChange) return;
    onGenerateBarChange({
      generate: () => { void submit(); },
      costLabel: generationCostLabel(operation, focused, { width: state.width, height: state.height, focusedRect: state.focusedRect, minimumContextArea }),
      canGenerate,
    });
  });

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
    const image = new Image();
    image.onload = () => {
      if (restoreRevision !== maskRestoreRevisionRef.current) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      focusedRectRef.current = item.rect;
      setState(previous => ({ ...previous, focusedRect: item.rect }));
      renderOverlay();
    };
    image.src = item.data;
  };

  const resetMask = (width: number, height: number, clearHistory = true) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    maskRestoreRevisionRef.current += 1;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.clearRect(0, 0, width, height);
    if (clearHistory) {
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
    image.src = data;
  };

  const loadBaseImage = async (source: string, restore: { maskData?: string; focusedRect?: ImageEditPanelState['focusedRect'] } = { maskData, focusedRect: draft.focusedRect }) => {
    const loadRevision = imageLoadRevisionRef.current + 1;
    imageLoadRevisionRef.current = loadRevision;
    const restoredMaskData = operation === 'image-to-image' ? undefined : restore.maskData;
    const restoredFocusedRect = operation === 'inpaint' ? restore.focusedRect || null : null;
    setIsLoading(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(await dataUrlToBlob(source));
      const imageCanvas = imageCanvasRef.current;
      if (!imageCanvas || loadRevision !== imageLoadRevisionRef.current) {
        bitmap.close();
        return;
      }
      imageCanvas.width = bitmap.width;
      imageCanvas.height = bitmap.height;
      const context = imageCanvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      context.drawImage(bitmap, 0, 0);
      const dimensionError = validateImageEditDimensions(bitmap.width, bitmap.height);
      const normalizationTarget = getImageEditNormalizationTarget(bitmap.width, bitmap.height);
      bitmap.close();
      setNormalization(dimensionError ? { sourceWidth: imageCanvas.width, sourceHeight: imageCanvas.height, targetWidth: normalizationTarget.width, targetHeight: normalizationTarget.height } : null);
      focusedRectRef.current = restoredFocusedRect;
      setState({ width: imageCanvas.width, height: imageCanvas.height, focusedRect: restoredFocusedRect });
      // 图生图无蒙版画布：跳过蒙版重置与恢复，避免触碰不存在的 canvas
      if (operation !== 'image-to-image') {
        resetMask(imageCanvas.width, imageCanvas.height);
        restoreMask(restoredMaskData, loadRevision);
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
  }, [operation, draft.baseImageRef]);

  useEffect(() => {
    if (baseImage) void loadBaseImage(baseImage);
  }, [baseImage, operation, draft.baseImageRef]);

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

  const commitSnapshot = () => {
    const item = snapshot();
    if (item) {
      undoRef.current.push(item);
      if (undoRef.current.length > 30) undoRef.current.shift();
    }
    redoRef.current = [];
  };

  const persistMask = () => {
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const data = canvasToDataUrl(canvas);
      lastAppliedMaskRef.current = data;
      onDraftChange({ maskData: data, focusedRect: focusedRectRef.current || undefined });
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
    if (redoRef.current.length > 30) redoRef.current.shift();
    restoreSnapshot(previous);
    lastAppliedMaskRef.current = previous.data;
    onDraftChange({ maskData: previous.data, focusedRect: previous.rect || undefined });
  };

  const redo = () => {
    const current = snapshot();
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(current);
    if (undoRef.current.length > 30) undoRef.current.shift();
    restoreSnapshot(next);
    lastAppliedMaskRef.current = next.data;
    onDraftChange({ maskData: next.data, focusedRect: next.rect || undefined });
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

  const importBaseImageFile = (file: File) => {
    const isSupportedImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      || /\.(?:png|jpe?g|webp)$/i.test(file.name);
    if (!isSupportedImage) {
      setError('请拖入 PNG、JPEG 或 WebP 图片作为底图');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) {
        setError('底图读取失败');
        return;
      }
      let extractedMeta: { prompt?: string; negativePrompt?: string; params?: import('../types').NAIParams } | undefined;
      try {
        const rawMeta = await extractMetadata(file);
        if (rawMeta) {
          const parsed = parseNovelAIMetadata(rawMeta);
          if (parsed.prompt) {
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
      if (extractedMeta) {
        onBaseImageChange(dataUrl, 'upload', undefined, extractedMeta);
      } else {
        onBaseImageChange(dataUrl, 'upload');
      }
      void loadBaseImage(dataUrl, { maskData: undefined, focusedRect: undefined });
      if (extractedMeta?.prompt) {
        notify('已自动解析并带入底图提示词与参数', 'success');
      }
    };
    reader.onerror = () => setError('底图读取失败');
    reader.readAsDataURL(file);
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) importBaseImageFile(file);
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
    if (imageFile) importBaseImageFile(imageFile);
    else setError('请拖入 PNG、JPEG 或 WebP 图片作为底图');
  };

  const applyOutpaint = async () => {
    const imageCanvas = imageCanvasRef.current;
    if (!imageCanvas || !state.width || !state.height) return;
    try {
      maskRestoreRevisionRef.current += 1;
      const result = await createOutpaintCanvas(await dataUrlToBlob(canvasToDataUrl(imageCanvas)), expansion);
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
      undoRef.current = [];
      redoRef.current = [];
      focusedRectRef.current = null;
      setState({ width: result.width, height: result.height, focusedRect: null });
      renderOverlay();
      onCanvasChange(canvasToDataUrl(imageCanvas), canvasToDataUrl(mask));
      onDraftChange({
        maskData: canvasToDataUrl(mask),
        focusedRect: undefined,
        expansion,
      });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '扩图尺寸无效');
    }
  };

  const applyNormalization = (mode: ImageEditNormalizationMode) => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!imageCanvas || !maskCanvas || !normalization) return;
    maskRestoreRevisionRef.current += 1;
    const { sourceWidth, sourceHeight, targetWidth, targetHeight } = normalization;
    const image = document.createElement('canvas');
    image.width = targetWidth;
    image.height = targetHeight;
    const imageContext = image.getContext('2d');
    const mask = document.createElement('canvas');
    mask.width = targetWidth;
    mask.height = targetHeight;
    const maskContext = mask.getContext('2d');
    if (!imageContext || !maskContext) {
      setError('无法创建尺寸规范化画布');
      return;
    }
    imageContext.imageSmoothingEnabled = true;
    imageContext.imageSmoothingQuality = 'high';
    maskContext.imageSmoothingEnabled = false;
    let sourceRect = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    let destinationRect = { x: 0, y: 0, width: targetWidth, height: targetHeight };
    if (mode === 'crop') sourceRect = getCenteredImageEditCrop(sourceWidth, sourceHeight, targetWidth, targetHeight);
    if (mode === 'contain') destinationRect = getContainedImageEditRect(sourceWidth, sourceHeight, targetWidth, targetHeight);
    if (mode === 'contain') {
      imageContext.fillStyle = '#ffffff';
      imageContext.fillRect(0, 0, targetWidth, targetHeight);
    }
    imageContext.drawImage(imageCanvas, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, destinationRect.x, destinationRect.y, destinationRect.width, destinationRect.height);
    maskContext.drawImage(maskCanvas, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, destinationRect.x, destinationRect.y, destinationRect.width, destinationRect.height);

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
    maskCanvas.width = targetWidth;
    maskCanvas.height = targetHeight;
    maskCanvas.getContext('2d')?.drawImage(mask, 0, 0);
    focusedRectRef.current = nextFocusedRect ? limitFocusedImageEditRect(targetWidth, targetHeight, nextFocusedRect) : null;
    undoRef.current = [];
    redoRef.current = [];
    setState({ width: targetWidth, height: targetHeight, focusedRect: focusedRectRef.current });
    setNormalization(null);
    renderOverlay();
    const imageData = canvasToDataUrl(imageCanvas);
    const maskData = canvasToDataUrl(maskCanvas);
    onCanvasChange(imageData, maskData);
    onDraftChange({ maskData, focusedRect: focusedRectRef.current || undefined });
    notify(`已将底图规范化为 ${targetWidth} × ${targetHeight}`, 'success');
  };

  const submit = async () => {
    if (inFlightRef.current || isGenerating) return;
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    // 图生图不渲染蒙版画布（maskCanvas 为 null），仅要求底图画布存在
    if (!imageCanvas || (operation !== 'image-to-image' && !maskCanvas)) return;
    // 画布存在但尚未载入底图（width=0）时给出明确提示，而不是静默失败
    if (!imageCanvas.width || !imageCanvas.height) {
      setError('请先选择或上传一张底图再生成');
      return;
    }
    const dimensionError = validateImageEditDimensions(imageCanvas.width, imageCanvas.height);
    if (dimensionError) {
      setError(`请先处理底图尺寸：${dimensionError}`);
      return;
    }
    if (operation === 'inpaint' && focused && (!state.focusedRect || state.focusedRect.width < 2 || state.focusedRect.height < 2)) {
      setError('请先在画布上框选 Focused Inpainting 区域');
      return;
    }
    // 蒙版为空（未画任何笔迹/未应用画布扩展）时 infill/outpaint 语义上等于不重绘，
    // 但 NovelAI 仍会按编辑请求计费——拦截并提示，避免白耗 Anlas
    if (operation !== 'image-to-image' && !maskHasInk(maskCanvas!)) {
      setError(operation === 'outpaint' ? '请先设置画布扩展并点击「应用画布扩展」，或手动绘制扩图蒙版' : '请先在蒙版上涂画需要重绘的区域');
      return;
    }
    setError(null);
    inFlightRef.current = true;
    try {
      await onGenerate({
      operation,
      image: canvasToDataUrl(imageCanvas),
      canvasWidth: imageCanvas.width,
      canvasHeight: imageCanvas.height,
      parentHistoryId: draft.baseImageSource === 'upload' ? undefined : draft.parentHistoryId,
      baseImageSource: draft.baseImageSource,
      mask: operation === 'image-to-image' ? undefined : canvasToDataUrl(maskCanvas!),
      strength,
      noise,
      focused: focused && operation === 'inpaint',
      minimumContextArea: focused && operation === 'inpaint' ? minimumContextArea : undefined,
      expansion: operation === 'outpaint' ? expansion : undefined,
      focusedRect: focused && operation === 'inpaint' ? state.focusedRect || undefined : undefined,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      promptSource: draft.promptSource,
      });
    } finally {
      inFlightRef.current = false;
    }
  };

  return (
    <div
      data-image-edit-drop-zone="true"
      className="chain-editor-body relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-gray-900 lg:flex-row lg:overflow-hidden"
      onDragEnter={handleBaseImageDragEnter}
      onDragOver={handleBaseImageDragOver}
      onDragLeave={handleBaseImageDragLeave}
      onDrop={handleBaseImageDrop}
    >
      {isBaseImageDragActive && <div className="pointer-events-none absolute inset-0 z-[90] flex items-center justify-center bg-indigo-950/55 backdrop-blur-sm"><div className="rounded-xl border-2 border-dashed border-white/80 bg-white/95 px-6 py-5 text-center text-sm font-bold text-indigo-700 shadow-2xl dark:bg-gray-900/95 dark:text-indigo-300">松手导入为当前编辑底图<br /><span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">支持 PNG、JPEG、WebP；导入后自动检查并提示规范化尺寸</span></div></div>}
      <ImageEditControls
        operation={operation}
        draft={draft}
        layout={layout}
        fileInputRef={fileInputRef}
        forceEmptySeed={forceEmptySeed}
        enforceFreeStepLimit={enforceFreeStepLimit}
        baseImagePreview={baseImage}
        canvasProps={{
          imageCanvasRef,
          maskCanvasRef,
          overlayCanvasRef,
          width: state.width,
          height: state.height,
          focusedRect: state.focusedRect,
          focused,
          isLoading,
          isBusy: isLoading || isGenerating,
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
        isBusy={isLoading || isGenerating}
        safeMode={safeMode}
        tagAssistEnabled={tagAssistEnabled}
        apiKey={apiKey}
        notify={notify}
        onPromptChange={onPromptChange}
        onNegativePromptChange={onNegativePromptChange}
        onPromptSource={onPromptSource}
        onDraftChange={onDraftChange}
        onFileChange={handleUpload}
        onSelectImageSource={(item, source, importParams) => onBaseImageChange(item.imageUrl, source, item.id, importParams ? {
          prompt: item.prompt,
          negativePrompt: item.negativePrompt,
          params: item.params,
        } : undefined)}
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
        onApplyOutpaint={() => { void applyOutpaint(); }}
        onResetFocusedRect={resetFocusedRect}
        normalization={normalization}
        onNormalize={applyNormalization}
      />
      <ImageEditPreview
        operation={operation}
        image={previewImage}
        baseImage={baseImage}
        onUseResultAsBase={previewImage && previewImage !== baseImage ? () => onBaseImageChange(previewImage, 'generated') : undefined}
        error={error}
        generationCostLabel={generationCostLabel(operation, focused, { width: state.width, height: state.height, focusedRect: state.focusedRect, minimumContextArea })}
        onGenerate={() => { void submit(); }}
        isLoading={isLoading}
        isGenerating={isGenerating}
        canGenerate={canGenerate}
        generationProgress={generationProgress}
        onOpenLightbox={onOpenLightbox}
        getDownloadFilename={getDownloadFilename}
        canNavigateHistory={canNavigateHistory}
        historyLabel={historyLabel}
        onPreviousHistory={onPreviousHistory}
        onNextHistory={onNextHistory}
        canManageHistoryGroup={canManageHistoryGroup}
        onRemoveCurrentHistory={onRemoveCurrentHistory}
        onClearHistoryGroup={onClearHistoryGroup}
      />
    </div>
  );
};
