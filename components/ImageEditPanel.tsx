import React, { useEffect, useRef, useState } from 'react';
import { Contrast, Eraser, ImagePlus, RotateCcw, RotateCw, Trash2, X } from 'lucide-react';
import { ImageEditCanvasExpansion, ImageEditOperation } from '../types';
import { canvasToDataUrl, createOutpaintCanvas, dataUrlToBlob, validateImageEditDimensions } from '../services/imageEdit';

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
}

interface ImageEditPanelProps {
  open: boolean;
  baseImage: string | null;
  parentHistoryId?: string;
  initialOperation?: ImageEditOperation;
  generationCostLabel: (operation: ImageEditOperation, focused: boolean) => string;
  onClose: () => void;
  onGenerate: (request: ImageEditRequest) => Promise<void>;
}

type MaskSnapshot = { data: string; rect: ImageEditPanelState['focusedRect'] };
type ImageEditPanelState = {
  width: number;
  height: number;
  focusedRect: { x: number; y: number; width: number; height: number } | null;
};

const emptyExpansion: ImageEditCanvasExpansion = { top: 0, right: 0, bottom: 0, left: 0 };

export const ImageEditPanel: React.FC<ImageEditPanelProps> = ({
  open,
  baseImage,
  parentHistoryId,
  initialOperation = 'image-to-image',
  generationCostLabel,
  onClose,
  onGenerate,
}) => {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const selectingRef = useRef(false);
  const startPointRef = useRef({ x: 0, y: 0 });
  const focusedRectRef = useRef<ImageEditPanelState['focusedRect']>(null);
  const undoRef = useRef<MaskSnapshot[]>([]);
  const redoRef = useRef<MaskSnapshot[]>([]);
  const [operation, setOperation] = useState<ImageEditOperation>(initialOperation);
  const [strength, setStrength] = useState(0.7);
  const [noise, setNoise] = useState(0);
  const [brushSize, setBrushSize] = useState(64);
  const [focused, setFocused] = useState(false);
  const [minimumContextArea, setMinimumContextArea] = useState(0.5);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [expansion, setExpansion] = useState<ImageEditCanvasExpansion>(emptyExpansion);
  const [baseImageSource, setBaseImageSource] = useState<'generated' | 'history' | 'upload'>(parentHistoryId ? 'history' : 'generated');
  const [state, setState] = useState<ImageEditPanelState>({ width: 0, height: 0, focusedRect: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = (): MaskSnapshot | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    return { data: canvas.toDataURL('image/png'), rect: state.focusedRect };
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

  const resetMask = (width: number, height: number, fill = false) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (fill) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    undoRef.current = [];
    redoRef.current = [];
    renderOverlay();
  };

  const loadBaseImage = async (source: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const blob = await dataUrlToBlob(source);
      const bitmap = await createImageBitmap(blob);
      const imageCanvas = imageCanvasRef.current;
      if (!imageCanvas) return;
      imageCanvas.width = bitmap.width;
      imageCanvas.height = bitmap.height;
      const context = imageCanvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      setState({ width: imageCanvas.width, height: imageCanvas.height, focusedRect: null });
      focusedRectRef.current = null;
      resetMask(imageCanvas.width, imageCanvas.height);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '底图读取失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !baseImage) return;
    setOperation(initialOperation);
    setExpansion(emptyExpansion);
    setBaseImageSource(parentHistoryId ? 'history' : 'generated');
    void loadBaseImage(baseImage);
  }, [open, baseImage, initialOperation, parentHistoryId]);

  useEffect(() => {
    if (!open) return;
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
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  };

  const commitSnapshot = () => {
    const item = snapshot();
    if (item) undoRef.current.push(item);
    redoRef.current = [];
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
      const nextRect = { x: point.x, y: point.y, width: 1, height: 1 };
      focusedRectRef.current = nextRect;
      commitSnapshot();
      setState(previous => ({ ...previous, focusedRect: nextRect }));
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
      const nextRect = {
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
      };
      focusedRectRef.current = nextRect;
      setState(previous => ({ ...previous, focusedRect: nextRect }));
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
    drawingRef.current = false;
    selectingRef.current = false;
  };

  const clearMask = () => {
    commitSnapshot();
    resetMask(state.width, state.height);
    focusedRectRef.current = null;
    setState(previous => ({ ...previous, focusedRect: null }));
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
  };

  const undo = () => {
    const current = snapshot();
    const previous = undoRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(current);
    restoreSnapshot(previous);
  };

  const redo = () => {
    const current = snapshot();
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(current);
    restoreSnapshot(next);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBaseImageSource('upload');
      void loadBaseImage(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const applyOutpaint = async () => {
    if (!baseImage || !state.width || !state.height) return;
    try {
      const result = await createOutpaintCanvas(await dataUrlToBlob(canvasToDataUrl(imageCanvasRef.current!)), expansion);
      const imageContext = imageCanvasRef.current?.getContext('2d');
      if (!imageContext || !imageCanvasRef.current) return;
      imageCanvasRef.current.width = result.width;
      imageCanvasRef.current.height = result.height;
      imageContext.drawImage(result.image, 0, 0);
      const mask = maskCanvasRef.current;
      if (mask) {
      mask.width = result.width;
        mask.height = result.height;
        mask.getContext('2d')?.drawImage(result.mask, 0, 0);
      }
      focusedRectRef.current = null;
      setState({ width: result.width, height: result.height, focusedRect: null });
      renderOverlay();
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
      parentHistoryId: baseImageSource === 'upload' ? undefined : parentHistoryId,
      baseImageSource,
      mask: operation === 'image-to-image' ? undefined : canvasToDataUrl(maskCanvas),
      strength,
      noise,
      focused: focused && operation !== 'image-to-image',
      minimumContextArea: focused && operation !== 'image-to-image' ? minimumContextArea : undefined,
      expansion: operation === 'outpaint' ? expansion : undefined,
      focusedRect: state.focusedRect || undefined,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm md:p-5" onClick={onClose}>
      <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white dark:bg-gray-950 md:h-[min(92dvh,900px)] md:rounded-2xl md:border md:border-gray-200 md:shadow-2xl dark:md:border-gray-800" onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">编辑图片</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">编辑结果会作为新历史图片保存，不覆盖底图</p>
          </div>
          <button type="button" onClick={onClose} className="mobile-touch flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="关闭编辑图片"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative flex min-h-[42vh] flex-1 items-center justify-center overflow-auto bg-gray-100 p-3 dark:bg-black/40 md:p-6">
            {isLoading && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 text-sm text-white">正在载入底图...</div>}
            <div className="relative max-h-full max-w-full overflow-hidden shadow-2xl" style={{ aspectRatio: `${Math.max(1, state.width)} / ${Math.max(1, state.height)}` }}>
              <canvas ref={imageCanvasRef} className="block max-h-[62vh] max-w-full object-contain" />
              <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
              <canvas ref={maskCanvasRef} className="absolute inset-0 h-full w-full cursor-crosshair opacity-0 touch-none" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
              {focused && state.focusedRect && <div className="pointer-events-none absolute border-2 border-amber-300 bg-amber-300/10" style={{ left: `${state.focusedRect.x / Math.max(1, state.width) * 100}%`, top: `${state.focusedRect.y / Math.max(1, state.height) * 100}%`, width: `${state.focusedRect.width / Math.max(1, state.width) * 100}%`, height: `${state.focusedRect.height / Math.max(1, state.height) * 100}%` }} />}
            </div>
          </div>
          <div className="w-full shrink-0 overflow-y-auto border-t border-gray-200 p-4 dark:border-gray-800 dark:bg-gray-950 lg:w-[340px] lg:border-l lg:border-t-0">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
              {([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setOperation(value); if (value === 'image-to-image') setFocused(false); }} className={`rounded-lg px-2 py-2 text-xs font-bold transition ${operation === value ? 'bg-white text-indigo-600 shadow dark:bg-gray-800 dark:text-indigo-300' : 'text-gray-500'}`}>{label}</button>)}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUpload} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:border-indigo-400 dark:border-gray-700 dark:text-gray-200"><ImagePlus className="h-4 w-4" />导入底图</button>
              {baseImageSource === 'history' && <span className="truncate text-[10px] text-gray-400" title="来源历史图片">历史底图</span>}
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Strength <span className="float-right font-mono">{strength.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={strength} onChange={event => setStrength(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Noise <span className="float-right font-mono">{noise.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={noise} onChange={event => setNoise(Number(event.target.value))} className="mt-2 w-full accent-indigo-500" /></label>
              {operation !== 'image-to-image' && <>
                <label className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-600 dark:text-gray-300"><span>Focused Inpainting</span><input type="checkbox" checked={focused} onChange={event => setFocused(event.target.checked)} className="h-4 w-4 accent-amber-500" /></label>
                {!focused && <div className="flex items-center gap-2"><button type="button" onClick={() => setTool('brush')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs ${tool === 'brush' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}>画笔</button><button type="button" onClick={() => setTool('eraser')} className={`flex h-9 flex-1 items-center justify-center gap-1 rounded-lg text-xs ${tool === 'eraser' ? 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-900'}`}><Eraser className="h-3.5 w-3.5" />橡皮擦</button></div>}
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{focused ? '框选区域' : '笔刷大小'} {!focused && <span className="float-right font-mono">{brushSize}px</span>}{!focused && <input type="range" min="8" max="512" step="4" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} className="mt-2 w-full accent-red-500" />}</label>
                {focused && <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">最小参照范围 <span className="float-right font-mono">{Math.round(minimumContextArea * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={minimumContextArea} onChange={event => setMinimumContextArea(Number(event.target.value))} className="mt-2 w-full accent-amber-500" /></label>}
                <div className="grid grid-cols-4 gap-1"><button type="button" onClick={undo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="撤销"><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={redo} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="重做"><RotateCw className="h-4 w-4" /></button><button type="button" onClick={clearMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="清空蒙版"><Trash2 className="h-4 w-4" /></button><button type="button" onClick={invertMask} className="flex h-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-300" title="反转蒙版"><Contrast className="h-4 w-4" /></button></div>
              </>}
              {operation === 'outpaint' && <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/20"><div className="mb-2 text-xs font-bold text-indigo-700 dark:text-indigo-300">扩展画布（像素）</div><div className="grid grid-cols-2 gap-2">{(['top', 'right', 'bottom', 'left'] as const).map(side => <label key={side} className="text-[11px] text-gray-500 dark:text-gray-400">{({ top: '上', right: '右', bottom: '下', left: '左' } as const)[side]}<input type="number" min="0" step="64" value={expansion[side]} onChange={event => setExpansion(previous => ({ ...previous, [side]: Math.max(0, Number(event.target.value) || 0) }))} className="mt-1 h-9 w-full rounded-lg border border-indigo-100 bg-white px-2 text-sm dark:border-indigo-900/60 dark:bg-gray-900" /></label>)}</div><button type="button" onClick={() => void applyOutpaint()} className="mt-3 h-9 w-full rounded-lg bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-500">应用画布扩展</button></div>}
            </div>
            {!state.width && <div className="mt-4 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-3 text-xs text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/20 dark:text-indigo-300">请先导入 PNG、JPEG 或 WebP 底图</div>}
            {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900"><div className="flex items-center justify-between"><span className="text-gray-500 dark:text-gray-400">本次费用</span><strong className="text-indigo-600 dark:text-indigo-300">{generationCostLabel(operation, focused)}</strong></div><p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">费用为本地预估；最终以 NovelAI 成功返回的实际结算为准。</p></div>
            <button type="button" onClick={() => void submit()} disabled={isLoading} className="generation-action-button mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:opacity-50">生成编辑结果</button>
          </div>
        </div>
      </div>
    </div>
  );
};
