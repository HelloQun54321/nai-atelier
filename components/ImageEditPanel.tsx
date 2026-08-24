import React, { useEffect, useRef, useState } from 'react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft } from '../types';
import { LabPageLayout } from '../services/appearancePreferences';
import { canvasToDataUrl, createOutpaintCanvas, dataUrlToBlob, getCenteredImageEditCrop, getContainedImageEditRect, getImageEditNormalizationTarget, ImageEditNormalizationMode, limitFocusedImageEditRect, normalizeMinimumContextArea, transformCharacterCoordinatesForOutpaint, validateImageEditDimensions } from '../services/imageEdit';
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
  operation: ImageEditOperation;
  draft: LabImageEditDraft;
  layout: LabPageLayout;
  maskData?: string;
  generationCostLabel: (operation: ImageEditOperation, focused: boolean, context?: { width: number; height: number; focusedRect?: { x: number; y: number; width: number; height: number } | null; minimumContextArea?: number }) => string;
  isGenerating?: boolean;
  apiKey: string;
  notify: (message: string, type?: 'success' | 'error') => void;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onPromptSource: (source: LabImageEditDraft['promptSource']) => void;
  onDraftChange: (patch: Partial<LabImageEditDraft> & { maskData?: string }) => void;
  onBaseImageChange: (dataUrl: string, source: 'generated' | 'history' | 'upload') => void;
  onCanvasChange: (imageData: string, maskData: string) => void;
  onGenerate: (request: ImageEditRequest) => Promise<void>;
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
  operation,
  draft,
  layout,
  maskData,
  generationCostLabel,
  apiKey,
  notify,
  onPromptChange,
  onNegativePromptChange,
  onPromptSource,
  onDraftChange,
  onBaseImageChange,
  onCanvasChange,
  onGenerate,
  isGenerating = false,
}) => {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const maskEditable = operation === 'inpaint' || (operation === 'outpaint' && manualMaskEditing);

  const snapshot = (): MaskSnapshot | null => {
    const canvas = maskCanvasRef.current;
    return canvas ? { data: canvas.toDataURL('image/png'), rect: focusedRectRef.current ? { ...focusedRectRef.current } : null } : null;
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
      resetMask(imageCanvas.width, imageCanvas.height);
      restoreMask(restoredMaskData, loadRevision);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable) return;
      if (document.activeElement !== maskCanvasRef.current) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
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
    if (!maskEditable) return;
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
    if (!maskEditable) return;
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

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      onBaseImageChange(dataUrl, 'upload');
      void loadBaseImage(dataUrl, { maskData: undefined, focusedRect: undefined });
    };
    reader.readAsDataURL(file);
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
      focusedRectRef.current = null;
      setState({ width: result.width, height: result.height, focusedRect: null });
      renderOverlay();
      onCanvasChange(canvasToDataUrl(imageCanvas), canvasToDataUrl(mask));
      const nextCharacters = transformCharacterCoordinatesForOutpaint(draft.params.characters, state.width, state.height, expansion);
      onDraftChange({
        maskData: canvasToDataUrl(mask),
        focusedRect: undefined,
        expansion,
        ...(nextCharacters ? { params: { ...draft.params, characters: nextCharacters } } : {}),
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
    if (!imageCanvas || !maskCanvas) return;
    const dimensionError = validateImageEditDimensions(imageCanvas.width, imageCanvas.height);
    if (dimensionError) {
      setError(`请先处理底图尺寸：${dimensionError}`);
      return;
    }
    if (operation === 'inpaint' && focused && (!state.focusedRect || state.focusedRect.width < 2 || state.focusedRect.height < 2)) {
      setError('请先在画布上框选 Focused Inpainting 区域');
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
      mask: operation === 'image-to-image' ? undefined : canvasToDataUrl(maskCanvas),
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
    <div className="chain-editor-body flex min-h-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-gray-900 lg:flex-row lg:overflow-hidden">
      <ImageEditControls
        operation={operation}
        draft={draft}
        layout={layout}
        fileInputRef={fileInputRef}
        selectableParams={draft.params}
        strength={strength}
        noise={noise}
        brushSize={brushSize}
        focused={focused}
        minimumContextArea={minimumContextArea}
        tool={tool}
        manualMaskEditing={manualMaskEditing}
        expansion={expansion}
        canvasSize={{ width: state.width, height: state.height }}
        isBusy={isLoading || isGenerating}
        apiKey={apiKey}
        notify={notify}
        onPromptChange={onPromptChange}
        onNegativePromptChange={onNegativePromptChange}
        onPromptSource={onPromptSource}
        onDraftChange={onDraftChange}
        onFileChange={handleUpload}
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
        baseImage={baseImage}
        error={error}
        generationCostLabel={generationCostLabel(operation, focused, { width: state.width, height: state.height, focusedRect: state.focusedRect, minimumContextArea })}
        onGenerate={() => { void submit(); }}
        imageCanvasRef={imageCanvasRef}
        maskCanvasRef={maskCanvasRef}
        overlayCanvasRef={overlayCanvasRef}
        width={state.width}
        height={state.height}
        focusedRect={state.focusedRect}
        focused={focused}
        isLoading={isLoading}
        isBusy={isLoading || isGenerating}
        maskEditable={maskEditable}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onFocusedInteractionStart={handleFocusedInteractionStart}
        onFocusedInteractionMove={handleFocusedInteractionMove}
        onFocusedInteractionEnd={handleFocusedInteractionEnd}
      />
    </div>
  );
};
