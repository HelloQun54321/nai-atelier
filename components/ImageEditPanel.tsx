import React, { useEffect, useRef, useState } from 'react';
import { ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft } from '../types';
import { canvasToDataUrl, createOutpaintCanvas, dataUrlToBlob, validateImageEditDimensions } from '../services/imageEdit';
import { ImageEditControls } from './ImageEditControls';
import { ImageEditPreview } from './ImageEditPreview';

export interface ImageEditRequest {
  operation: ImageEditOperation;
  image: string;
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
  maskData?: string;
  generationCostLabel: (operation: ImageEditOperation, focused: boolean) => string;
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

const emptyExpansion: ImageEditCanvasExpansion = { top: 0, right: 0, bottom: 0, left: 0 };

export const ImageEditPanel: React.FC<ImageEditPanelProps> = ({
  baseImage,
  operation,
  draft,
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
}) => {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const selectingRef = useRef(false);
  const startPointRef = useRef({ x: 0, y: 0 });
  const focusedRectRef = useRef<ImageEditPanelState['focusedRect']>(draft.focusedRect || null);
  const undoRef = useRef<MaskSnapshot[]>([]);
  const redoRef = useRef<MaskSnapshot[]>([]);
  const [strength, setStrength] = useState(draft.strength);
  const [noise, setNoise] = useState(draft.noise);
  const [brushSize, setBrushSize] = useState(draft.brushSize);
  const [focused, setFocused] = useState(draft.focused);
  const [minimumContextArea, setMinimumContextArea] = useState(draft.minimumContextArea);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [expansion, setExpansion] = useState<ImageEditCanvasExpansion>(draft.expansion || emptyExpansion);
  const [state, setState] = useState<ImageEditPanelState>({ width: 0, height: 0, focusedRect: draft.focusedRect || null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = (): MaskSnapshot | null => {
    const canvas = maskCanvasRef.current;
    return canvas ? { data: canvas.toDataURL('image/png'), rect: focusedRectRef.current } : null;
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
    const image = new Image();
    image.onload = () => {
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

  const resetMask = (width: number, height: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.clearRect(0, 0, width, height);
    undoRef.current = [];
    redoRef.current = [];
    renderOverlay();
  };

  const restoreMask = (data: string | undefined) => {
    if (!data || !maskCanvasRef.current) return;
    const image = new Image();
    image.onload = () => {
      const canvas = maskCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      renderOverlay();
    };
    image.src = data;
  };

  const loadBaseImage = async (source: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(await dataUrlToBlob(source));
      const imageCanvas = imageCanvasRef.current;
      if (!imageCanvas) return;
      imageCanvas.width = bitmap.width;
      imageCanvas.height = bitmap.height;
      const context = imageCanvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      focusedRectRef.current = draft.focusedRect || null;
      setState({ width: imageCanvas.width, height: imageCanvas.height, focusedRect: draft.focusedRect || null });
      resetMask(imageCanvas.width, imageCanvas.height);
      restoreMask(maskData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '底图读取失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setStrength(draft.strength);
    setNoise(draft.noise);
    setBrushSize(draft.brushSize);
    setFocused(draft.focused);
    setMinimumContextArea(draft.minimumContextArea);
    setExpansion(draft.expansion || emptyExpansion);
  }, [operation, draft.baseImageRef]);

  useEffect(() => {
    if (baseImage) void loadBaseImage(baseImage);
  }, [baseImage, operation, draft.baseImageRef, maskData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  });

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
    };
  };

  const commitSnapshot = () => {
    const item = snapshot();
    if (item) undoRef.current.push(item);
    redoRef.current = [];
  };

  const persistMask = () => {
    const canvas = maskCanvasRef.current;
    if (canvas) onDraftChange({ maskData: canvasToDataUrl(canvas), focusedRect: focusedRectRef.current || undefined });
  };

  const drawMask = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas || focused) return;
    const point = getCanvasPoint(event);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.save();
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    renderOverlay();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(event);
    if (focused) {
      selectingRef.current = true;
      startPointRef.current = point;
      focusedRectRef.current = { x: point.x, y: point.y, width: 1, height: 1 };
      commitSnapshot();
      setState(previous => ({ ...previous, focusedRect: focusedRectRef.current }));
      return;
    }
    drawingRef.current = true;
    commitSnapshot();
    drawMask(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (selectingRef.current) {
      const point = getCanvasPoint(event);
      const start = startPointRef.current;
      focusedRectRef.current = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      setState(previous => ({ ...previous, focusedRect: focusedRectRef.current }));
      return;
    }
    if (drawingRef.current) drawMask(event);
  };

  const handlePointerUp = () => {
    if (selectingRef.current && focused) {
      const canvas = maskCanvasRef.current;
      const rect = focusedRectRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context && rect && rect.width >= 2 && rect.height >= 2) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        renderOverlay();
      }
    }
    if (drawingRef.current || selectingRef.current) persistMask();
    drawingRef.current = false;
    selectingRef.current = false;
  };

  const clearMask = () => {
    commitSnapshot();
    resetMask(state.width, state.height);
    focusedRectRef.current = null;
    setState(previous => ({ ...previous, focusedRect: null }));
    onDraftChange({ maskData: undefined, maskRef: undefined, focusedRect: undefined });
  };

  const invertMask = () => {
    const canvas = maskCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
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
    restoreSnapshot(previous);
    onDraftChange({ maskData: previous.data, focusedRect: previous.rect || undefined });
  };

  const redo = () => {
    const current = snapshot();
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(current);
    restoreSnapshot(next);
    onDraftChange({ maskData: next.data, focusedRect: next.rect || undefined });
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      onBaseImageChange(dataUrl, 'upload');
      void loadBaseImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const applyOutpaint = async () => {
    const imageCanvas = imageCanvasRef.current;
    if (!imageCanvas || !state.width || !state.height) return;
    try {
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
      onDraftChange({ maskData: canvasToDataUrl(mask), focusedRect: undefined, expansion });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '扩图尺寸无效');
    }
  };

  const submit = async () => {
    const imageCanvas = imageCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!imageCanvas || !maskCanvas) return;
    const dimensionError = validateImageEditDimensions(imageCanvas.width, imageCanvas.height);
    if (dimensionError) {
      setError(dimensionError);
      return;
    }
    if ((operation === 'inpaint' || operation === 'outpaint') && focused && (!state.focusedRect || state.focusedRect.width < 2 || state.focusedRect.height < 2)) {
      setError('请先在画布上框选 Focused Inpainting 区域');
      return;
    }
    setError(null);
    await onGenerate({
      operation,
      image: canvasToDataUrl(imageCanvas),
      parentHistoryId: draft.baseImageSource === 'upload' ? undefined : draft.parentHistoryId,
      baseImageSource: draft.baseImageSource,
      mask: operation === 'image-to-image' ? undefined : canvasToDataUrl(maskCanvas),
      strength,
      noise,
      focused: focused && operation !== 'image-to-image',
      minimumContextArea: focused && operation !== 'image-to-image' ? minimumContextArea : undefined,
      expansion: operation === 'outpaint' ? expansion : undefined,
      focusedRect: state.focusedRect || undefined,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      promptSource: draft.promptSource,
    });
  };

  return (
    <div className="chain-editor-body flex min-h-0 flex-1 flex-col overflow-y-auto bg-white dark:bg-gray-900 lg:flex-row lg:overflow-hidden">
      <ImageEditControls
        operation={operation}
        draft={draft}
        fileInputRef={fileInputRef}
        selectableParams={draft.params}
        strength={strength}
        noise={noise}
        brushSize={brushSize}
        focused={focused}
        minimumContextArea={minimumContextArea}
        tool={tool}
        expansion={expansion}
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
        onFocusedChange={value => { setFocused(value); onDraftChange({ focused: value }); }}
        onMinimumContextAreaChange={value => { setMinimumContextArea(value); onDraftChange({ minimumContextArea: value }); }}
        onToolChange={setTool}
        onClearMask={clearMask}
        onInvertMask={invertMask}
        onUndo={undo}
        onRedo={redo}
        onExpansionChange={value => { setExpansion(value); onDraftChange({ expansion: value }); }}
        onApplyOutpaint={() => { void applyOutpaint(); }}
      />
      <ImageEditPreview
        operation={operation}
        baseImage={baseImage}
        error={error}
        generationCostLabel={generationCostLabel(operation, focused)}
        onGenerate={() => { void submit(); }}
        imageCanvasRef={imageCanvasRef}
        maskCanvasRef={maskCanvasRef}
        overlayCanvasRef={overlayCanvasRef}
        width={state.width}
        height={state.height}
        focusedRect={state.focusedRect}
        focused={focused}
        isLoading={isLoading}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
};
