import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, History, Image as ImageIcon } from 'lucide-react';
import { ToolbarButton } from '../DesignSystem';
import { HistoryImagePicker } from '../HistoryImagePicker';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { createUuid } from '../../services/id';
import type { CanvasImageLayer, CanvasPoint, CanvasProject, CanvasSelection, CanvasTool } from '../../services/canvasTypes';
import { applyBrush, copyCanvasSelection, createImageLayer, cropCanvasProject, cropImageLayer, hitCanvasLayer, layerToProject, projectToLayer, renderProject, type CanvasBrushPreview } from '../../services/canvasEngine';
import { moveCanvasSelection, pixelSelectionEdit } from '../../services/canvasPixelEdits';
import { createCanvasAxisMove, updateCanvasAxisMove, type CanvasAxisMoveState } from '../../services/canvasAxisMove';
import { deleteCanvasProject, exportCanvasProject, importCanvasProject, listCanvasProjects, loadCanvasProject, saveCanvasProject, type CanvasProjectSummary } from '../../services/canvasStore';
import { beginCanvasExport, cancelCanvasExport, finishCanvasExport } from '../../services/canvasExport';
import { CanvasTools } from './CanvasTools';
import { CanvasLayerPanel } from './CanvasLayerPanel';
import { CanvasProjectPanel } from './CanvasProjectPanel';
import { CanvasSelectionOverlay, closeCanvasSelection } from './CanvasSelectionOverlay';
import { CanvasAxisGuides } from './CanvasAxisGuides';
import { CanvasNewProjectDialog, CanvasOpenProjectDialog } from './CanvasProjectDialogs';

type Props = { active: boolean; notify: (message: string, type?: 'success' | 'error') => void; onSendToLab: () => void; confirmClose: () => Promise<boolean> };
type HistoryEntry = { project: CanvasProject; selection?: CanvasSelection | null };
type Drag = { kind: 'move' | 'scale' | 'rotate'; layerId: string; start: CanvasPoint; original: CanvasImageLayer; before: CanvasProject } | { kind: 'selection-move'; start: CanvasPoint; original: CanvasImageLayer; selection: CanvasSelection; before: CanvasProject } | { kind: 'rectangle' | 'lasso'; points: CanvasPoint[]; selection: CanvasSelection | null; before: CanvasProject } | { kind: 'brush'; points: CanvasPoint[]; selection: CanvasSelection | null; before: CanvasProject; layerId: string; size: number; mode: 'erase' | 'restore' } | { kind: 'pending-move'; start: CanvasPoint; latest: CanvasPoint; before: CanvasProject; released: boolean };

const freshProject = (): CanvasProject => ({ version: 1, id: createUuid(), name: '未命名画布', width: 1920, height: 1080, background: { kind: 'color', color: '#ffffff' }, layers: [], updatedAt: Date.now() });
const fileDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error || new Error('读取图片失败')); reader.readAsDataURL(file); });
const loadImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片读取失败')); image.src = source; });
const polygonRect = (a: CanvasPoint, b: CanvasPoint): CanvasSelection => ({ points: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] });
const selectionContains = (selection: CanvasSelection, point: CanvasPoint): boolean => {
  let inside = false;
  const points = selection.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const translateSelection = (selection: CanvasSelection, delta: CanvasPoint): CanvasSelection => ({ points: selection.points.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })) });
const strokePath = (context: CanvasRenderingContext2D, points: CanvasPoint[]) => { if (!points.length) return; context.beginPath(); context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); context.closePath(); };
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_') || '画布';
const shortcutClass = 'h-9 w-full !justify-start px-2 text-xs hover:!border-indigo-300 hover:!bg-indigo-50 hover:!text-indigo-700 dark:hover:!border-indigo-700 dark:hover:!bg-indigo-950/60 dark:hover:!text-indigo-200';
const projectThumbnail = async (snapshot: CanvasProject): Promise<string | undefined> => {
  const source = await renderProject(snapshot); const preview = document.createElement('canvas');
  const scale = Math.min(160 / source.width, 100 / source.height);
  preview.width = Math.max(1, Math.round(source.width * scale)); preview.height = Math.max(1, Math.round(source.height * scale));
  const context = preview.getContext('2d'); if (!context) return undefined;
  context.drawImage(source, 0, 0, preview.width, preview.height); return preview.toDataURL('image/png');
};

/** 选区删除只改变该层的透明蒙版，不改素材原图。 */
const clearLayerSelection = async (layer: CanvasImageLayer, selection: CanvasSelection): Promise<CanvasImageLayer> => {
  if (layer.pixelEdits?.length) return pixelSelectionEdit(layer, selection, 'erase-selection');
  const canvas = document.createElement('canvas'); canvas.width = layer.width; canvas.height = layer.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('无法创建图层蒙版');
  if (layer.mask) context.drawImage(await loadImage(layer.mask), 0, 0); else { context.fillStyle = '#fff'; context.fillRect(0, 0, layer.width, layer.height); }
  context.globalCompositeOperation = 'destination-out';
  strokePath(context, selection.points.map(point => projectToLayer(layer, point))); context.fill();
  return { ...layer, mask: canvas.toDataURL('image/png') };
};

export const CanvasWorkspace: React.FC<Props> = ({ active, notify, onSendToLab, confirmClose }) => {
  const [project, setProject] = useState<CanvasProject>(freshProject);
  const projectRef = useRef(project); projectRef.current = project;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [savingState, setSavingState] = useState<'saved' | 'saving' | 'error'>('saving');
  const [tool, setTool] = useState<CanvasTool>('move');
  const [brushSize, setBrushSize] = useState(32);
  const [brushPreview, setBrushPreview] = useState<CanvasBrushPreview | null>(null);
  const [movePreview, setMovePreview] = useState<CanvasImageLayer | null>(null);
  const [axisGuide, setAxisGuide] = useState<{ origin: CanvasPoint; axis: 'x' | 'y' | null } | null>(null);
  const [brushCursor, setBrushCursor] = useState<CanvasPoint | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [polygon, setPolygon] = useState<CanvasPoint[]>([]);
  const [polygonCursor, setPolygonCursor] = useState<CanvasPoint | null>(null);
  const [draftSelection, setDraftSelection] = useState<CanvasSelection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [projectList, setProjectList] = useState<CanvasProjectSummary[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const axisMoveRef = useRef<CanvasAxisMoveState | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const spaceRef = useRef(false);
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const clipboardRef = useRef<CanvasImageLayer | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimerRef = useRef<number | null>(null);
  const closedProjectsRef = useRef(new Set<string>());
  const revisionRef = useRef(0);
  const renderRef = useRef(0);
  const renderQueuedRef = useRef<(() => Promise<void>) | null>(null);
  const renderRunningRef = useRef(false);
  const selected = project.layers.find(layer => layer.id === selectedId) || null;

  const save = useCallback((snapshot: CanvasProject) => {
    const revision = ++revisionRef.current; setSavingState('saving');
    const next = saveQueueRef.current.catch(() => {}).then(async () => {
      if (closedProjectsRef.current.has(snapshot.id)) return;
      let thumbnail = snapshot.thumbnail;
      try { thumbnail = await projectThumbnail(snapshot); } catch { /* 大尺寸无法生成预览时仍需保存完整工程。 */ }
      if (!closedProjectsRef.current.has(snapshot.id)) await saveCanvasProject({ ...snapshot, thumbnail });
    });
    saveQueueRef.current = next;
    void next.then(() => { if (revisionRef.current === revision) setSavingState('saved'); }, () => { if (revisionRef.current === revision) setSavingState('error'); });
    return next;
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => { try { const items = await listCanvasProjects(); if (items.length) { const loaded = await loadCanvasProject(items[0].id); if (!cancelled) { projectRef.current = loaded; setProject(loaded); } } if (!cancelled) { setLoadError(''); setReady(true); } } catch (error) { if (!cancelled) setLoadError(`画布工程读取失败：${error instanceof Error ? error.message : String(error)}`); } })();
    return () => { cancelled = true; };
  }, [loadAttempt]);
  useEffect(() => { if (!ready) return; const timer = window.setTimeout(() => { saveTimerRef.current = null; void save(project).catch(() => {}); }, 900); saveTimerRef.current = timer; return () => { window.clearTimeout(timer); if (saveTimerRef.current === timer) saveTimerRef.current = null; }; }, [project, ready, save]);

  const setCurrent = (next: CanvasProject) => { const value = { ...next, updatedAt: Date.now() }; revisionRef.current += 1; setSavingState('saving'); projectRef.current = value; setProject(value); };
  const commit = (next: CanvasProject, before = projectRef.current, beforeSelection?: CanvasSelection | null) => { pastRef.current = [...pastRef.current.slice(-29), { project: before, selection: beforeSelection }]; futureRef.current = []; setCurrent(next); setHistoryVersion(value => value + 1); };
  const undo = () => { const previous = pastRef.current.pop(); if (!previous) return; futureRef.current.push({ project: projectRef.current, selection: previous.selection === undefined ? undefined : selection }); setCurrent(previous.project); if (previous.selection !== undefined) setSelection(previous.selection); setHistoryVersion(value => value + 1); };
  const redo = () => { const next = futureRef.current.pop(); if (!next) return; pastRef.current.push({ project: projectRef.current, selection: next.selection === undefined ? undefined : selection }); setCurrent(next.project); if (next.selection !== undefined) setSelection(next.selection); setHistoryVersion(value => value + 1); };
  const patchLayer = (id: string, patch: Partial<CanvasImageLayer>) => { const before = projectRef.current; commit({ ...before, layers: before.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) }); };
  const showError = (error: unknown) => notify(error instanceof Error ? error.message : String(error), 'error');
  const operation = async (action: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; try { setBusy(true); await action(); } catch (error) { showError(error); } finally { busyRef.current = false; setBusy(false); } };

  const switchProject = async (next: CanvasProject) => {
    await save(projectRef.current);
    setSelection(null); setPolygon([]); setPolygonCursor(null); setDraftSelection(null); setSelectedId(null); pastRef.current = []; futureRef.current = []; setHistoryVersion(value => value + 1); setCurrent(next); requestAnimationFrame(fitView);
  };
  const openProjects = () => void operation(async () => {
    await save(projectRef.current); const items = await listCanvasProjects(); setProjectList(items); setProjectsOpen(true);
    // 旧工程没有缩略图时仅按需生成预览，不改写原工程。
    void Promise.all(items.filter(item => !item.thumbnail).map(async item => {
      try { return { id: item.id, thumbnail: await projectThumbnail(await loadCanvasProject(item.id)) }; } catch { return { id: item.id, thumbnail: undefined }; }
    })).then(previews => setProjectList(current => current.map(item => ({ ...item, thumbnail: item.thumbnail || previews.find(preview => preview.id === item.id)?.thumbnail }))));
  });
  const closeProject = (id: string) => void (async () => {
    if (!await confirmClose()) return;
    void operation(async () => {
      const current = projectRef.current;
      const remaining = projectList.filter(item => item.id !== id);
      const replacement = current.id === id ? (remaining.length ? await loadCanvasProject(remaining[0].id) : freshProject()) : null;
      closedProjectsRef.current.add(id);
      if (current.id === id && saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      await saveQueueRef.current.catch(() => {});
      try { await deleteCanvasProject(id); }
      catch (error) { closedProjectsRef.current.delete(id); if (current.id === id) await save(current).catch(() => {}); throw error; }
      setProjectList(remaining);
      if (replacement) {
        setSelection(null); setPolygon([]); setPolygonCursor(null); setDraftSelection(null); setSelectedId(null); pastRef.current = []; futureRef.current = []; setHistoryVersion(value => value + 1); setCurrent(replacement); requestAnimationFrame(fitView);
      }
    });
  })();
  const importImage = async (source: string, name?: string, atBottom = false) => {
    const current = projectRef.current; const layer = await createImageLayer(source, current.width, current.height, name);
    const latest = projectRef.current; commit({ ...latest, layers: atBottom ? [layer, ...latest.layers] : [...latest.layers, layer] }); setSelectedId(layer.id);
  };
  const importFile = (file: File, atBottom = false) => void operation(async () => { if (!file.type.startsWith('image/')) throw new Error('请选择图片文件'); await importImage(await fileDataUrl(file), file.name, atBottom); });
  const importHistory = (url: string) => void operation(async () => { const response = await fetch(url); if (!response.ok) throw new Error('读取历史原图失败'); await importImage(await fileDataUrl(await response.blob()), '历史图片'); setPickerOpen(false); });
  const addEmpty = () => void operation(async () => { const current = projectRef.current; const source = document.createElement('canvas'); source.width = current.width; source.height = current.height; const layer = { ...await createImageLayer(source.toDataURL('image/png'), current.width, current.height, '空白图层'), empty: true }; commit({ ...projectRef.current, layers: [...projectRef.current.layers, layer] }); setSelectedId(layer.id); });
  const pasteInternal = () => { if (!clipboardRef.current) return; const current = projectRef.current; const target = current.layers.find(layer => layer.id === selectedId && layer.empty && !layer.locked); const layer = { ...clipboardRef.current, id: target?.id || createUuid(), name: target?.name || `${clipboardRef.current.name} 副本`, empty: false }; commit({ ...current, layers: target ? current.layers.map(item => item.id === target.id ? layer : item) : [...current.layers, layer] }); setSelectedId(layer.id); };
  const copy = (merged: boolean, cut = false) => void operation(async () => {
    const current = projectRef.current; if (!selection || (!merged && !selectedId)) return;
    const layer = current.layers.find(item => item.id === selectedId); if (cut && (!layer || layer.locked)) throw new Error('请选择未锁定的图层');
    clipboardRef.current = await copyCanvasSelection(current, selection, merged ? null : selectedId);
    if (cut && layer) { const erased = await clearLayerSelection(layer, selection); const latest = projectRef.current; commit({ ...latest, layers: latest.layers.map(item => item.id === layer.id ? erased : item) }); }
    notify(cut ? '已剪切选区，可粘贴为新图层' : '已复制选区，可粘贴为新图层');
  });
  const eraseSelection = () => void operation(async () => { if (!selected || !selection || selected.locked) return; const result = await clearLayerSelection(selected, selection); const current = projectRef.current; commit({ ...current, layers: current.layers.map(layer => layer.id === result.id ? result : layer) }); });
  const cropLayer = () => { if (!selected || !selection || selected.locked) return; const current = projectRef.current; const cropped = cropImageLayer(selected, selection); commit({ ...current, layers: current.layers.map(layer => layer.id === selected.id ? cropped : layer) }); setSelection(null); };
  const cropCanvas = () => { if (!selection) return; commit(cropCanvasProject(projectRef.current, selection)); setSelection(null); };

  const fitView = () => { const view = viewportRef.current; if (!view) return; setZoom(Math.max(0.01, Math.min(4, (view.clientWidth - 60) / projectRef.current.width, (view.clientHeight - 60) / projectRef.current.height))); };
  useEffect(() => { if (ready && active) { const frame = requestAnimationFrame(fitView); return () => cancelAnimationFrame(frame); } }, [ready, active]);
  useEffect(() => {
    const token = ++renderRef.current; const canvas = canvasRef.current; if (!canvas || !ready) return;
    // 保持单个渲染任务：绘制已完成的帧，再处理期间收到的最新预览。
    renderQueuedRef.current = async () => {
      try {
        const previewProject = movePreview ? { ...project, layers: project.layers.map(layer => layer.id === movePreview.id ? movePreview : layer) } : project;
        const result = await renderProject(previewProject, brushPreview);
        if (canvasRef.current !== canvas || projectRef.current !== project) return;
        canvas.width = project.width; canvas.height = project.height;
        const context = canvas.getContext('2d'); if (!context) return; context.drawImage(result, 0, 0);
        if (tool === 'move' && !selection && selected && selected.visible) {
          const corners = [{ x: 0, y: 0 }, { x: selected.width, y: 0 }, { x: selected.width, y: selected.height }, { x: 0, y: selected.height }].map(point => layerToProject(selected, point));
          context.save(); context.strokeStyle = '#2563eb'; context.lineWidth = 2 / zoom; strokePath(context, corners); context.stroke();
          const handle = corners[2]; context.fillStyle = '#fff'; context.fillRect(handle.x - 5 / zoom, handle.y - 5 / zoom, 10 / zoom, 10 / zoom); context.strokeRect(handle.x - 5 / zoom, handle.y - 5 / zoom, 10 / zoom, 10 / zoom);
          const rotationHandle = layerToProject(selected, { x: selected.width / 2, y: -30 / Math.max(zoom * Math.abs(selected.scaleY), 0.01) }); context.beginPath(); context.arc(rotationHandle.x, rotationHandle.y, 5 / zoom, 0, Math.PI * 2); context.fill(); context.stroke(); context.restore();
        }
      } catch (error) { if (token === renderRef.current) showError(error); }
    };
    if (!renderRunningRef.current) {
      renderRunningRef.current = true;
      void (async () => {
        while (renderQueuedRef.current) {
          const render = renderQueuedRef.current; renderQueuedRef.current = null;
          await render();
        }
        renderRunningRef.current = false;
      })();
    }
  }, [project, selectedId, tool, zoom, ready, brushPreview, movePreview, Boolean(selection)]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint => { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * projectRef.current.width / rect.width, y: (event.clientY - rect.top) * projectRef.current.height / rect.height }; };
  const updateAxis = (point: CanvasPoint, shift: boolean, display: boolean) => {
    const previous = axisMoveRef.current; if (!previous) return { x: 0, y: 0 };
    const next = updateCanvasAxisMove(previous, point, shift, zoom);
    axisMoveRef.current = next;
    setAxisGuide(display && next.shift ? { origin: next.origin, axis: next.axis === 'x' || next.axis === 'y' ? next.axis : null } : null);
    return next.delta;
  };
  const clearAxis = () => { axisMoveRef.current = null; setAxisGuide(null); };
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || busy) return;
    // 安全模式首次点击只揭示画面，不能同时移动、选取或擦除素材。
    if (event.currentTarget.closest('.safe-mode') && event.currentTarget.parentElement?.dataset.safeRevealed !== 'true') return;
    const point = pointOf(event); event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'polygon') {
      if (event.detail > 1) return;
      if (polygon.length >= 3 && Math.hypot(point.x - polygon[0].x, point.y - polygon[0].y) <= 8 / zoom) { finishPolygon(); return; }
      setPolygon(previous => [...previous, point]); setPolygonCursor(point); return;
    }
    const before = projectRef.current;
    if (tool === 'move') {
      if (selection) {
        if (!selectionContains(selection, point)) return;
        if (!selected || selected.locked || !selected.visible) { notify('请选择可见且未锁定的图层', 'error'); return; }
        dragRef.current = { kind: 'selection-move', start: point, original: selected, selection, before };
        axisMoveRef.current = createCanvasAxisMove(point, event.shiftKey);
        if (event.shiftKey) setAxisGuide({ origin: point, axis: null });
        return;
      }
      if (selected && !selected.locked) {
        const scale = layerToProject(selected, { x: selected.width, y: selected.height });
        const rotation = layerToProject(selected, { x: selected.width / 2, y: -30 / Math.max(zoom * Math.abs(selected.scaleY), 0.01) });
        if (Math.hypot(point.x - scale.x, point.y - scale.y) <= 12 / zoom) { dragRef.current = { kind: 'scale', layerId: selected.id, start: point, original: selected, before }; return; }
        if (Math.hypot(point.x - rotation.x, point.y - rotation.y) <= 12 / zoom) { dragRef.current = { kind: 'rotate', layerId: selected.id, start: point, original: selected, before }; return; }
      }
      const pending: Drag = { kind: 'pending-move', start: point, latest: point, before, released: false };
      dragRef.current = pending;
      axisMoveRef.current = createCanvasAxisMove(point, event.shiftKey);
      void (async () => {
        try {
          let hit: CanvasImageLayer | undefined;
          for (const layer of [...before.layers].reverse()) if (!layer.locked && await hitCanvasLayer(layer, point)) { hit = layer; break; }
          if (dragRef.current !== pending) return;
          if (!hit) { dragRef.current = null; clearAxis(); setSelectedId(null); return; }
          setSelectedId(hit.id);
          const { x: dx, y: dy } = axisMoveRef.current?.delta || { x: 0, y: 0 };
          if (dx || dy) {
            const moved = { ...before, layers: before.layers.map(layer => layer.id === hit!.id ? { ...layer, x: hit!.x + dx, y: hit!.y + dy } : layer) };
            if (pending.released) commit(moved, before); else setCurrent(moved);
          }
          dragRef.current = pending.released ? null : { kind: 'move', layerId: hit.id, start: point, original: hit, before };
          if (pending.released) clearAxis();
          else if (axisMoveRef.current?.shift) setAxisGuide({ origin: axisMoveRef.current.origin, axis: axisMoveRef.current.axis === 'x' || axisMoveRef.current.axis === 'y' ? axisMoveRef.current.axis : null });
        } catch (error) { if (dragRef.current === pending) { dragRef.current = null; clearAxis(); } showError(error); }
      })();
      return;
    }
    if (tool === 'rectangle' || tool === 'lasso') { dragRef.current = { kind: tool, points: [point], selection: null, before }; setDraftSelection({ points: [point] }); return; }
    if ((tool === 'erase' || tool === 'restore') && selected && !selected.locked) {
      const drag: Extract<Drag, { kind: 'brush' }> = { kind: 'brush', points: [point], selection, before, layerId: selected.id, size: brushSize, mode: tool };
      dragRef.current = drag;
      setBrushCursor(point);
      setBrushPreview({ layerId: drag.layerId, stroke: { points: [...drag.points], size: drag.size, mode: drag.mode }, selection: drag.selection });
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointOf(event);
    if (tool === 'polygon' && polygon.length) setPolygonCursor(point);
    if (tool === 'erase' || tool === 'restore') setBrushCursor(point.x >= 0 && point.y >= 0 && point.x <= projectRef.current.width && point.y <= projectRef.current.height ? point : null);
    const drag = dragRef.current; if (!drag) return;
    if (drag.kind === 'pending-move') { drag.latest = point; updateAxis(point, event.shiftKey, false); return; }
    if (drag.kind === 'selection-move') {
      const delta = updateAxis(point, event.shiftKey, true);
      setSelection(translateSelection(drag.selection, delta));
      setMovePreview(moveCanvasSelection(drag.original, drag.selection, delta));
      return;
    }
    if (drag.kind === 'rectangle') { drag.points[1] = point; setDraftSelection(polygonRect(drag.points[0], point)); return; }
    if (drag.kind === 'lasso') { drag.points.push(point); setDraftSelection({ points: [...drag.points] }); return; }
    if (drag.kind === 'brush') { drag.points.push(point); setBrushPreview({ layerId: drag.layerId, stroke: { points: [...drag.points], size: drag.size, mode: drag.mode }, selection: drag.selection }); return; }
    if (!('original' in drag)) return;
    const layer = drag.original; let patch: Partial<CanvasImageLayer>;
    if (drag.kind === 'move') { const delta = updateAxis(point, event.shiftKey, true); patch = { x: layer.x + delta.x, y: layer.y + delta.y }; }
    else if (drag.kind === 'rotate') { const angle = (p: CanvasPoint) => Math.atan2(p.y - layer.y, p.x - layer.x); patch = { rotation: layer.rotation + (angle(point) - angle(drag.start)) * 180 / Math.PI }; }
    else { const start = Math.hypot(drag.start.x - layer.x, drag.start.y - layer.y); const ratio = Math.max(0.01, Math.hypot(point.x - layer.x, point.y - layer.y) / Math.max(1, start)); patch = { scaleX: layer.scaleX * ratio, scaleY: layer.scaleY * ratio }; }
    setCurrent({ ...drag.before, layers: drag.before.layers.map(item => item.id === layer.id ? { ...layer, ...patch } : item) });
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current; if (!drag) return;
    if (drag.kind === 'pending-move') { drag.latest = pointOf(event); updateAxis(drag.latest, event.shiftKey, false); drag.released = true; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.kind === 'selection-move') {
      const delta = updateAxis(pointOf(event), event.shiftKey, false); clearAxis();
      setMovePreview(null);
      setSelection(translateSelection(drag.selection, delta));
      if (delta.x || delta.y) {
        const moved = moveCanvasSelection(drag.original, drag.selection, delta);
        commit({ ...drag.before, layers: drag.before.layers.map(layer => layer.id === moved.id ? moved : layer) }, drag.before, drag.selection);
      }
      return;
    }
    if (drag.kind === 'move') {
      const delta = updateAxis(pointOf(event), event.shiftKey, false); clearAxis();
      const current = projectRef.current.layers.find(layer => layer.id === drag.layerId);
      const x = drag.original.x + delta.x, y = drag.original.y + delta.y;
      if (current && (current.x !== x || current.y !== y)) setCurrent({ ...drag.before, layers: drag.before.layers.map(layer => layer.id === drag.layerId ? { ...drag.original, x, y } : layer) });
    }
    if (drag.kind === 'brush') { const end = pointOf(event); const last = drag.points[drag.points.length - 1]; if (end.x !== last.x || end.y !== last.y) drag.points.push(end); const layer = drag.before.layers.find(item => item.id === drag.layerId); if (!layer) { setBrushPreview(null); return; } void operation(async () => { try { const updated = await applyBrush(layer, { points: drag.points, size: drag.size, mode: drag.mode }, drag.selection); const current = projectRef.current; commit({ ...current, layers: current.layers.map(item => item.id === layer.id ? updated : item) }, drag.before); } finally { setBrushPreview(null); } }); return; }
    if (drag.kind === 'rectangle' || drag.kind === 'lasso') {
      const finalPoint = pointOf(event);
      const points = drag.kind === 'rectangle' ? polygonRect(drag.points[0], finalPoint).points : [...drag.points, finalPoint];
      const closed = closeCanvasSelection(points); if (closed) setSelection(closed); setDraftSelection(null); return;
    }
    if (JSON.stringify(projectRef.current.layers) !== JSON.stringify(drag.before.layers)) { pastRef.current = [...pastRef.current.slice(-29), { project: drag.before }]; futureRef.current = []; setHistoryVersion(value => value + 1); }
  };
  const finishPolygon = () => { const closed = closeCanvasSelection(polygon); if (closed) setSelection(closed); setPolygon([]); setPolygonCursor(null); };

  useEffect(() => {
    if (!active) return;
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input,textarea,select')));
    const key = (event: KeyboardEvent) => {
      if (busyRef.current || isTyping(event.target)) return;
      if (event.code === 'Space') { spaceRef.current = true; event.preventDefault(); return; }
      if (event.key === 'Shift') {
        const drag = dragRef.current; const axis = axisMoveRef.current;
        if (axis && drag && (drag.kind === 'move' || drag.kind === 'selection-move' || (drag.kind === 'pending-move' && !drag.released))) updateAxis(axis.lastPoint, true, drag.kind !== 'pending-move');
        return;
      }
      if (event.key === 'Escape') {
        const drag = dragRef.current;
        if (drag?.kind === 'selection-move') { dragRef.current = null; clearAxis(); setMovePreview(null); setSelection(drag.selection); }
        else if (polygon.length || (drag && (drag.kind === 'rectangle' || drag.kind === 'lasso'))) {
          if (drag && (drag.kind === 'rectangle' || drag.kind === 'lasso')) dragRef.current = null;
          setPolygon([]); setPolygonCursor(null); setDraftSelection(null);
        } else setSelection(null);
        return;
      }
      if (event.key === 'Enter' && tool === 'polygon') { event.preventDefault(); finishPolygon(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selection) { event.preventDefault(); copy(event.shiftKey); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selection) { event.preventDefault(); copy(false, true); return; }
      if (event.key === 'Delete' && selection) { event.preventDefault(); eraseSelection(); }
      if (!selection && selected && !selected.locked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; patchLayer(selected.id, { x: selected.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: selected.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceRef.current = false;
      if (event.key === 'Shift') {
        const drag = dragRef.current; const axis = axisMoveRef.current;
        if (axis && drag && (drag.kind === 'move' || drag.kind === 'selection-move' || (drag.kind === 'pending-move' && !drag.released))) updateAxis(axis.lastPoint, false, false);
      }
    };
    const paste = (event: ClipboardEvent) => { if (busyRef.current || isTyping(event.target)) return; const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/')); if (file) { event.preventDefault(); importFile(file); } else if (clipboardRef.current) { event.preventDefault(); pasteInternal(); } };
    window.addEventListener('keydown', key); window.addEventListener('keyup', keyup); window.addEventListener('paste', paste); return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', keyup); window.removeEventListener('paste', paste); spaceRef.current = false; };
  });
  useEffect(() => { if (!active) setAxisGuide(null); }, [active]);
  useEffect(() => { if (ready && !active && savingState !== 'saved') void save(projectRef.current).catch(() => {}); }, [active, ready]);
  useEffect(() => { const leaving = (event: BeforeUnloadEvent) => { if (ready && savingState !== 'saved') { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', leaving); return () => window.removeEventListener('beforeunload', leaving); }, [ready, savingState]);

  const exportProject = () => {
    const pending = beginCanvasExport('project', `${safeName(projectRef.current.name)}.nai-canvas`);
    void operation(async () => { const target = await pending; if (!target) return; try { await finishCanvasExport(target, await exportCanvasProject(projectRef.current)); } catch (error) { await cancelCanvasExport(target).catch(() => {}); throw error; } });
  };
  const exportImage = (format: 'png' | 'jpeg') => {
    const pending = beginCanvasExport('image', `${safeName(projectRef.current.name)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
    void operation(async () => {
      const target = await pending; if (!target) return;
      try {
        const canvas = await renderProject(projectRef.current); let output = canvas;
        if (format === 'jpeg') { output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height; const context = output.getContext('2d'); if (!context) throw new Error('无法导出图片'); context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height); context.drawImage(canvas, 0, 0); }
        const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.95));
        if (!blob) throw new Error('图片导出失败，画布可能超过设备能力');
        await finishCanvasExport(target, blob);
      } catch (error) { await cancelCanvasExport(target).catch(() => {}); throw error; }
    });
  };
  const send = (mode: 'image-to-image' | 'inpaint' | 'outpaint') => void operation(async () => { const canvas = await renderProject(projectRef.current); const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('无法生成合成底图'); const url = URL.createObjectURL(blob); sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify({ mode: 'base-image', origin: 'canvas', imageEditOperation: mode, baseImageUrl: url })); setSendOpen(false); onSendToLab(); });
  const addFiles = (files: FileList | File[]) => { void operation(async () => { for (const file of Array.from(files)) if (file.type.startsWith('image/')) await importImage(await fileDataUrl(file), file.name); }); };
  void historyVersion;

  if (!ready) return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-gray-500" role="status">{loadError || '正在读取画布工程…'}{loadError && <ToolbarButton onClick={() => { setLoadError(''); setLoadAttempt(value => value + 1); }}>重试</ToolbarButton>}</div>;
  return <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-gray-800 dark:text-gray-100" data-agent-view="canvas" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busyRef.current) addFiles(event.dataTransfer.files); }}>
    <CanvasProjectPanel project={project} savingState={savingState} onRetry={() => void save(projectRef.current).catch(showError)} onRename={name => commit({ ...projectRef.current, name })} onNew={() => setNewOpen(true)} onOpen={openProjects} onImportProject={() => projectInputRef.current?.click()} onExportProject={exportProject} onExportPng={() => exportImage('png')} onExportJpeg={() => exportImage('jpeg')} onSendToLab={() => setSendOpen(true)} onResize={(width, height) => { if (width > 0 && height > 0) commit({ ...projectRef.current, width, height }); }} onBackground={color => commit({ ...projectRef.current, background: color === null ? { kind: 'transparent', color: '#ffffff' } : { kind: 'color', color } })} />
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex flex-none flex-col overflow-y-auto border-r border-gray-200 dark:border-gray-700">
        <div className="flex flex-col gap-1.5 border-b border-gray-200 p-2 dark:border-gray-700"><ToolbarButton className={shortcutClass} onClick={() => setPickerOpen(true)}><History />历史图片</ToolbarButton><ToolbarButton className={shortcutClass} onClick={() => backgroundInputRef.current?.click()}><ImageIcon />背景图片</ToolbarButton><ToolbarButton className={shortcutClass} onClick={pasteInternal}><ClipboardPaste />粘贴选区</ToolbarButton></div>
        <CanvasTools tool={tool} onToolChange={next => { setTool(next); setBrushCursor(null); setPolygon([]); setPolygonCursor(null); setDraftSelection(null); }} brushSize={brushSize} onBrushSizeChange={setBrushSize} onImport={() => imageInputRef.current?.click()} onUndo={undo} onRedo={redo} canUndo={pastRef.current.length > 0} canRedo={futureRef.current.length > 0} hasSelection={Boolean(selection)} hasDraftSelection={Boolean(polygon.length || draftSelection)} hasLayer={Boolean(selected && !selected.locked)} onCopy={() => copy(false)} onCopyMerged={() => copy(true)} onCut={() => copy(false, true)} onDeleteSelection={eraseSelection} onCropLayer={cropLayer} onCropCanvas={cropCanvas} onClearSelection={() => { setSelection(null); setPolygon([]); setPolygonCursor(null); setDraftSelection(null); const drag = dragRef.current; if (drag && (drag.kind === 'rectangle' || drag.kind === 'lasso')) dragRef.current = null; }} />
      </div>
      <div ref={viewportRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-gray-200 p-8 dark:bg-gray-900" onPointerDownCapture={event => { if (event.button !== 1 && !(event.button === 0 && spaceRef.current)) return; const view = viewportRef.current; if (!view) return; event.preventDefault(); event.stopPropagation(); panRef.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop }; view.setPointerCapture(event.pointerId); }} onPointerMoveCapture={event => { const pan = panRef.current; const view = viewportRef.current; if (!pan || !view) return; event.stopPropagation(); view.scrollLeft = pan.left - (event.clientX - pan.x); view.scrollTop = pan.top - (event.clientY - pan.y); }} onPointerUpCapture={event => { if (!panRef.current) return; panRef.current = null; event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onWheel={event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(value => Math.max(0.01, Math.min(4, value * (event.deltaY < 0 ? 1.1 : 0.9)))); } }}>
        <div className="flex min-h-full min-w-full items-center justify-center"><div data-safe-mode-work="true" data-safe-mode-canvas="true" className="relative"><canvas ref={canvasRef} data-safe-mode-image="true" aria-label="拼图画布" className="block flex-none touch-none shadow-lg" style={{ width: Math.round(project.width * zoom), height: Math.round(project.height * zoom), cursor: tool === 'erase' || tool === 'restore' ? 'none' : undefined, backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0,0 10px,10px -10px,-10px 0' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerLeave={() => setBrushCursor(null)} onPointerUp={pointerUp} onPointerCancel={pointerUp} onDoubleClick={() => { if (tool === 'polygon') finishPolygon(); }} /><CanvasSelectionOverlay width={project.width} height={project.height} zoom={zoom} selection={selection} draft={draftSelection} polygon={polygon} cursor={polygonCursor} />{active && axisGuide && <CanvasAxisGuides width={project.width} height={project.height} origin={axisGuide.origin} axis={axisGuide.axis} />}{brushCursor && (tool === 'erase' || tool === 'restore') && <div aria-hidden="true" data-brush-cursor="true" className="pointer-events-none absolute rounded-full border border-black" style={{ left: `${brushCursor.x / project.width * 100}%`, top: `${brushCursor.y / project.height * 100}%`, width: `${brushSize / project.width * 100}%`, height: `${brushSize / project.height * 100}%`, transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 1px white' }} />}</div></div>
      </div>
      <CanvasLayerPanel project={project} selectedLayerId={selectedId} onSelect={setSelectedId} onPatch={patchLayer} onMove={(id, direction) => { const current = projectRef.current; const layers = [...current.layers]; const index = layers.findIndex(layer => layer.id === id); const target = index + (direction === 'up' ? 1 : -1); if (index < 0 || target < 0 || target >= layers.length) return; [layers[index], layers[target]] = [layers[target], layers[index]]; commit({ ...current, layers }); }} onDuplicate={id => { const current = projectRef.current; const layer = current.layers.find(item => item.id === id); if (!layer) return; const copy = { ...layer, id: createUuid(), name: `${layer.name} 副本`, x: layer.x + 20, y: layer.y + 20 }; commit({ ...current, layers: [...current.layers, copy] }); setSelectedId(copy.id); }} onDelete={id => { const current = projectRef.current; commit({ ...current, layers: current.layers.filter(layer => layer.id !== id) }); if (selectedId === id) setSelectedId(null); }} onResetCrop={id => { const layer = projectRef.current.layers.find(item => item.id === id); if (layer) patchLayer(id, { crops: [], pixelEdits: layer.pixelEdits?.filter(edit => edit.kind !== 'crop') }); }} onAddEmpty={addEmpty} onCenter={id => { const current = projectRef.current; const layer = current.layers.find(item => item.id === id); if (layer) { const center = layerToProject(layer, { x: layer.width / 2, y: layer.height / 2 }); patchLayer(id, { x: layer.x + current.width / 2 - center.x, y: layer.y + current.height / 2 - center.y }); } }} />
    </div>
    <div className="flex items-center gap-3 border-t border-gray-200 px-3 py-1 text-xs dark:border-gray-700"><span>{project.width} × {project.height} px</span><button onClick={() => setZoom(value => Math.max(0.01, value / 1.2))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(value => Math.min(4, value * 1.2))}>＋</button><button onClick={fitView}>适配画布</button>{busy && <span>处理中…</span>}</div>
    <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} /><input ref={backgroundInputRef} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) importFile(file, true); event.target.value = ''; }} /><input ref={projectInputRef} type="file" accept=".nai-canvas,.zip" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void operation(async () => switchProject(await importCanvasProject(file))); event.target.value = ''; }} />
    <HistoryImagePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={item => importHistory(item.imageUrl)} />
    <CanvasNewProjectDialog open={newOpen} busy={busy} onClose={() => setNewOpen(false)} onCreate={(name, width, height) => void operation(async () => { await switchProject({ ...freshProject(), name, width, height }); setNewOpen(false); })} />
    <CanvasOpenProjectDialog open={projectsOpen} busy={busy} projects={projectList} onClose={() => setProjectsOpen(false)} onOpen={id => void operation(async () => { await switchProject(await loadCanvasProject(id)); setProjectsOpen(false); })} onDelete={closeProject} />
    {sendOpen && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="送回实验室"><div className="flex flex-col gap-2 rounded-xl bg-white p-4 dark:bg-gray-900"><strong>作为底图送回实验室</strong><button onClick={() => send('image-to-image')}>图生图</button><button onClick={() => send('inpaint')}>局部重绘</button><button onClick={() => send('outpaint')}>扩图</button><button onClick={() => setSendOpen(false)}>取消</button></div></div>}
  </fieldset>;
};
