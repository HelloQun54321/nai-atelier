import { createUuid } from '../id';
import type {
  ComicBlendMode,
  ComicDrawingLayerData,
  ComicImageLayerItem,
  ComicLayerNode,
  ComicPageDraft,
  ComicSelection,
  ComicStroke,
} from './comicTypes';

export const COMIC_BLEND_MODES: Array<{
  id: ComicBlendMode;
  label: string;
  canvasOp: GlobalCompositeOperation;
}> = [
  { id: 'normal', label: '正常', canvasOp: 'source-over' },
  { id: 'multiply', label: '正片叠底', canvasOp: 'multiply' },
  { id: 'screen', label: '滤色', canvasOp: 'screen' },
  { id: 'overlay', label: '叠加', canvasOp: 'overlay' },
  { id: 'darken', label: '变暗', canvasOp: 'darken' },
  { id: 'lighten', label: '变亮', canvasOp: 'lighten' },
  { id: 'soft-light', label: '柔光', canvasOp: 'soft-light' },
  { id: 'hard-light', label: '强光', canvasOp: 'hard-light' },
  { id: 'difference', label: '差值', canvasOp: 'difference' },
];

export const blendModeToCanvasOp = (mode?: ComicBlendMode): GlobalCompositeOperation =>
  COMIC_BLEND_MODES.find(item => item.id === mode)?.canvasOp || 'source-over';

export const blendModeLabel = (mode?: ComicBlendMode): string =>
  COMIC_BLEND_MODES.find(item => item.id === mode)?.label || '正常';

export const DEFAULT_PANELS_LAYER_ID = 'layer-panels';
export const DEFAULT_DRAWING_LAYER_ID = 'drawing-base';

const STICKER_LABEL_MAP: Record<string, string> = {
  speedlines: '集中线',
  sweat: '汗滴',
  anger: '怒筋',
  sparkle: '星芒',
  exclamation: '惊叹 !',
  question: '问号 ?',
  shock: '震惊线',
  heart: '爱心',
};

const summarizeText = (text: string, fallback: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 14 ? `${clean.slice(0, 14)}…` : clean;
};

/**
 * 保证草稿拥有完整、一致的 PS 风格图层栈（自动兼容迁移旧版 4 分类草稿与 strokes）。
 * 数组顺序 = 从底到顶（0 在最底层，length - 1 在最顶层）。
 */
export const syncComicLayerStack = (draft: ComicPageDraft): ComicPageDraft => {
  // 1. 确保至少存在 1 个独立手绘图层，并将旧版 draft.strokes 无损迁入首个手绘图层
  let drawingLayers: ComicDrawingLayerData[] = Array.isArray(draft.drawingLayers) && draft.drawingLayers.length > 0
    ? draft.drawingLayers
    : [{ id: DEFAULT_DRAWING_LAYER_ID, strokes: Array.isArray(draft.strokes) ? draft.strokes : [] }];

  // 若外部直接往旧版 draft.strokes 追加了笔迹而 drawingLayers 尚未同步，做兜底对齐
  if (!draft.drawingLayers && draft.strokes.length > 0 && drawingLayers[0].strokes.length === 0) {
    drawingLayers = [{ id: DEFAULT_DRAWING_LAYER_ID, strokes: draft.strokes }];
  }

  const imageLayers: ComicImageLayerItem[] = Array.isArray(draft.imageLayers) ? draft.imageLayers : [];
  const validDrawingIds = new Set(drawingLayers.map(d => d.id));
  const validImageIds = new Set(imageLayers.map(img => img.id));
  const validBubbleIds = new Set(draft.bubbles.map(b => b.id));
  const validTextIds = new Set(draft.texts.map(t => t.id));
  const validStickerIds = new Set(draft.stickers.map(s => s.id));

  const legacyLayers = draft.layers;
  const rawStack = Array.isArray(draft.layerStack) ? draft.layerStack : [];

  // 2. 过滤已删除实体对应的陈旧节点，同时去重
  const seenKeys = new Set<string>();
  const kept: ComicLayerNode[] = [];
  for (const node of rawStack) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    if (node.kind === 'group') {
      if (seenKeys.has(`group:${node.id}`)) continue;
      seenKeys.add(`group:${node.id}`);
      kept.push({
        ...node,
        opacity: Number.isFinite(node.opacity) ? Math.max(0, Math.min(1, node.opacity)) : 1,
        blendMode: node.blendMode || 'normal',
        expanded: node.expanded !== false,
      });
      continue;
    }
    const refId = node.refId || (node.kind === 'panels' ? 'panels' : '');
    if (!refId) continue;
    if (node.kind === 'drawing' && !validDrawingIds.has(refId)) continue;
    if (node.kind === 'image' && !validImageIds.has(refId)) continue;
    if (node.kind === 'bubble' && !validBubbleIds.has(refId)) continue;
    if (node.kind === 'text' && !validTextIds.has(refId)) continue;
    if (node.kind === 'sticker' && !validStickerIds.has(refId)) continue;
    const key = `${node.kind}:${refId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    let syncedName = node.name;
    if (node.kind === 'bubble') {
      const b = draft.bubbles.find(item => item.id === refId);
      const liveText = b?.text.trim().slice(0, 14) || '';
      const isDefaultName = !syncedName.trim() || syncedName === '输入台词…' || syncedName === '空白气泡' || syncedName === '漫画气泡';
      if (isDefaultName && liveText && liveText !== '输入台词…') syncedName = liveText;
    } else if (node.kind === 'text') {
      const txt = draft.texts.find(item => item.id === refId);
      const liveText = txt?.text.trim().slice(0, 14) || '';
      const isDefaultName = !syncedName.trim() || syncedName === '效果文字';
      if (isDefaultName && liveText) syncedName = liveText;
    }
    kept.push({
      ...node,
      name: syncedName,
      refId,
      opacity: Number.isFinite(node.opacity) ? Math.max(0, Math.min(1, node.opacity)) : 1,
      blendMode: node.blendMode || 'normal',
    });
  }

  // 3. 补齐尚未入栈的底层与新增元素（首次迁移遵循旧版 4 图层 order 顺序）
  const appendMissing = (node: ComicLayerNode) => {
    const key = `${node.kind}:${node.refId}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    kept.push(node);
  };

  if (!seenKeys.has('panels:panels')) {
    // 分镜底图默认放最底层
    seenKeys.add('panels:panels');
    kept.unshift({
      id: DEFAULT_PANELS_LAYER_ID,
      kind: 'panels',
      refId: 'panels',
      name: draft.creationMode === 'ai-page' ? 'AI 整页底图' : '分镜画格底图',
      visible: legacyLayers?.panels?.visible !== false,
      locked: legacyLayers?.panels?.locked === true,
      opacity: 1,
      blendMode: 'normal',
    });
  }

  drawingLayers.forEach((dl, idx) => {
    appendMissing({
      id: `layer-drawing-${dl.id}`,
      kind: 'drawing',
      refId: dl.id,
      name: `手绘图层 ${idx + 1}`,
      visible: legacyLayers?.drawing?.visible !== false,
      locked: legacyLayers?.drawing?.locked === true,
      opacity: 1,
      blendMode: 'normal',
    });
  });

  imageLayers.forEach((img, idx) => {
    appendMissing({
      id: `layer-image-${img.id}`,
      kind: 'image',
      refId: img.id,
      name: img.name || `图片图层 ${idx + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
    });
  });

  draft.stickers.forEach(st => {
    appendMissing({
      id: `layer-sticker-${st.id}`,
      kind: 'sticker',
      refId: st.id,
      name: `贴纸 · ${STICKER_LABEL_MAP[st.kind] || st.kind}`,
      visible: legacyLayers?.stickers?.visible !== false,
      locked: legacyLayers?.stickers?.locked === true,
      opacity: Number.isFinite(st.opacity) ? st.opacity : 1,
      blendMode: 'normal',
    });
  });

  draft.bubbles.forEach((b, idx) => {
    appendMissing({
      id: `layer-bubble-${b.id}`,
      kind: 'bubble',
      refId: b.id,
      name: summarizeText(b.text, `气泡 ${idx + 1}`),
      visible: legacyLayers?.bubbles?.visible !== false,
      locked: legacyLayers?.bubbles?.locked === true,
      opacity: 1,
      blendMode: 'normal',
    });
  });

  draft.texts.forEach((txt, idx) => {
    appendMissing({
      id: `layer-text-${txt.id}`,
      kind: 'text',
      refId: txt.id,
      name: summarizeText(txt.text, `文字 ${idx + 1}`),
      visible: legacyLayers?.bubbles?.visible !== false,
      locked: legacyLayers?.bubbles?.locked === true,
      opacity: 1,
      blendMode: 'normal',
    });
  });

  // 4. 清理失效的 parentId（若父组已被删，自动提升到顶层）
  const groupIds = new Set(kept.filter(n => n.kind === 'group').map(n => n.id));
  const normalizedStack = kept.map(node => (
    node.parentId && (!groupIds.has(node.parentId) || node.parentId === node.id)
      ? { ...node, parentId: undefined }
      : node
  ));

  return {
    ...draft,
    drawingLayers,
    imageLayers,
    layerStack: normalizedStack,
  };
};

export interface EffectiveLayerProps {
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: ComicBlendMode;
  depth: number;
}

/** 结合所属图层组折叠/继承关系，计算某图层的实际渲染显隐、锁定、不透明度与混合模式。 */
export const resolveEffectiveLayerProps = (
  node: ComicLayerNode,
  stack: ComicLayerNode[],
): EffectiveLayerProps => {
  const byId = new Map(stack.map(n => [n.id, n]));
  let visible = node.visible;
  let locked = node.locked;
  let opacity = node.opacity;
  let blendMode: ComicBlendMode = node.blendMode;
  let depth = 0;

  const visited = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    visible = visible && parent.visible;
    locked = locked || parent.locked;
    opacity = opacity * parent.opacity;
    if (blendMode === 'normal' && parent.blendMode !== 'normal') {
      blendMode = parent.blendMode;
    }
    parentId = parent.parentId;
  }

  return {
    visible,
    locked,
    opacity: Math.max(0, Math.min(1, opacity)),
    blendMode,
    depth,
  };
};

export const isDescendantOf = (
  stack: ComicLayerNode[],
  candidateId: string,
  ancestorId: string,
): boolean => {
  const byId = new Map(stack.map(n => [n.id, n]));
  const visited = new Set<string>();
  let cur = byId.get(candidateId)?.parentId;
  while (cur && !visited.has(cur)) {
    if (cur === ancestorId) return true;
    visited.add(cur);
    cur = byId.get(cur)?.parentId;
  }
  return false;
};

/**
 * PS 风格拖拽排序：
 * - stack 下标 0 为最底层，length - 1 为最顶层
 * - position = 'above' 表示排到目标层视觉上方（更高下标）
 * - position = 'below' 表示排到目标层视觉下方（更低下标）
 * - position = 'inside' 表示放入目标图层组内（仅 target 为 group 时生效）
 */
export const reorderLayerStack = (
  stack: ComicLayerNode[],
  sourceId: string,
  targetId: string,
  position: 'above' | 'below' | 'inside',
): ComicLayerNode[] => {
  if (sourceId === targetId) return stack;
  const source = stack.find(n => n.id === sourceId);
  const target = stack.find(n => n.id === targetId);
  if (!source || !target) return stack;
  if (source.kind === 'group' && isDescendantOf(stack, targetId, sourceId)) {
    return stack;
  }

  // 收集被移动的整个子树（若 source 为 group，则连同所有子图层一起移动）
  const movingIds = new Set<string>([sourceId]);
  if (source.kind === 'group') {
    for (const node of stack) {
      if (isDescendantOf(stack, node.id, sourceId)) movingIds.add(node.id);
    }
  }

  const nextParentId = position === 'inside' && target.kind === 'group'
    ? target.id
    : target.parentId;

  const movingBlock = stack
    .filter(n => movingIds.has(n.id))
    .map(n => (n.id === sourceId ? { ...n, parentId: nextParentId } : n));
  const remaining = stack.filter(n => !movingIds.has(n.id));

  const targetIdx = remaining.findIndex(n => n.id === targetId);
  if (targetIdx < 0) return stack;

  let insertAt = targetIdx;
  if (position === 'above') {
    insertAt = targetIdx + 1;
  } else if (position === 'inside' && target.kind === 'group') {
    // 组内子项位于该组节点紧邻下方，展示时挂在组标题之下
    insertAt = targetIdx;
  } else {
    insertAt = targetIdx;
  }

  const next = [...remaining];
  next.splice(insertAt, 0, ...movingBlock);
  return next;
};

/** 将选中的画布对象映射到对应的 PS 图层节点 ID。 */
export const findLayerNodeForSelection = (
  stack: ComicLayerNode[],
  selection: ComicSelection,
): ComicLayerNode | undefined => {
  if (!selection) return undefined;
  if (selection.kind === 'panel') return stack.find(n => n.kind === 'panels');
  if (selection.kind === 'bubble') return stack.find(n => n.kind === 'bubble' && n.refId === selection.id);
  if (selection.kind === 'text') return stack.find(n => n.kind === 'text' && n.refId === selection.id);
  if (selection.kind === 'sticker') return stack.find(n => n.kind === 'sticker' && n.refId === selection.id);
  if (selection.kind === 'image') return stack.find(n => n.kind === 'image' && n.refId === selection.id);
  if (selection.kind === 'drawing') return stack.find(n => n.kind === 'drawing' && n.refId === selection.id);
  if (selection.kind === 'group') return stack.find(n => n.kind === 'group' && n.id === selection.id);
  return undefined;
};

/** 查找当前画笔/橡皮应当落笔的手绘图层 ID（优先选中手绘图层，否则取最顶层可见未锁手绘图层）。 */
export const resolveActiveDrawingLayerId = (
  draft: ComicPageDraft,
  selection: ComicSelection,
): string | null => {
  const synced = syncComicLayerStack(draft);
  const stack = synced.layerStack || [];
  if (selection?.kind === 'drawing') {
    const node = stack.find(n => n.kind === 'drawing' && n.refId === selection.id);
    if (node) {
      const eff = resolveEffectiveLayerProps(node, stack);
      if (eff.visible && !eff.locked) return selection.id;
      return null;
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const node = stack[i];
    if (node.kind === 'drawing' && node.refId) {
      const eff = resolveEffectiveLayerProps(node, stack);
      if (eff.visible && !eff.locked) return node.refId;
    }
  }
  return null;
};

export const appendStrokeToDrawingLayer = (
  draft: ComicPageDraft,
  drawingLayerId: string,
  stroke: ComicStroke,
): ComicPageDraft => {
  const synced = syncComicLayerStack(draft);
  const nextDrawingLayers = (synced.drawingLayers || []).map(dl => (
    dl.id === drawingLayerId ? { ...dl, strokes: [...dl.strokes, stroke] } : dl
  ));
  return {
    ...synced,
    drawingLayers: nextDrawingLayers,
    strokes: nextDrawingLayers.flatMap(dl => dl.strokes),
  };
};

export const createDrawingLayerInDraft = (
  draft: ComicPageDraft,
  name?: string,
): { draft: ComicPageDraft; layer: ComicLayerNode; drawingId: string } => {
  const synced = syncComicLayerStack(draft);
  const drawingId = `draw-${createUuid().slice(0, 8)}`;
  const count = (synced.drawingLayers?.length || 0) + 1;
  const layer: ComicLayerNode = {
    id: `layer-drawing-${drawingId}`,
    kind: 'drawing',
    refId: drawingId,
    name: name || `手绘图层 ${count}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
  return {
    drawingId,
    layer,
    draft: {
      ...synced,
      drawingLayers: [...(synced.drawingLayers || []), { id: drawingId, strokes: [] }],
      layerStack: [...(synced.layerStack || []), layer],
    },
  };
};

export const createImageLayerInDraft = (
  draft: ComicPageDraft,
  input: {
    name: string;
    url: string;
    width?: number;
    height?: number;
    assetId?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    lockAspect?: boolean;
    flipX?: boolean;
    flipY?: boolean;
  },
): { draft: ComicPageDraft; layer: ComicLayerNode; imageItem: ComicImageLayerItem } => {
  const synced = syncComicLayerStack(draft);
  const id = `img-${createUuid().slice(0, 8)}`;
  const imageItem: ComicImageLayerItem = {
    id,
    name: input.name || '导入图片',
    url: input.url,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.naturalWidth ? { naturalWidth: input.naturalWidth } : {}),
    ...(input.naturalHeight ? { naturalHeight: input.naturalHeight } : {}),
    lockAspect: input.lockAspect ?? true,
    ...(input.flipX ? { flipX: true } : {}),
    ...(input.flipY ? { flipY: true } : {}),
    x: 0.5,
    y: 0.5,
    width: input.width ?? 0.45,
    height: input.height ?? 0.45,
    rotation: 0,
  };
  const layer: ComicLayerNode = {
    id: `layer-image-${id}`,
    kind: 'image',
    refId: id,
    name: imageItem.name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
  };
  return {
    imageItem,
    layer,
    draft: {
      ...synced,
      imageLayers: [...(synced.imageLayers || []), imageItem],
      layerStack: [...(synced.layerStack || []), layer],
    },
  };
};

export const createGroupLayerInDraft = (
  draft: ComicPageDraft,
  wrapLayerId?: string,
): { draft: ComicPageDraft; group: ComicLayerNode } => {
  const synced = syncComicLayerStack(draft);
  const stack = synced.layerStack || [];
  const groupCount = stack.filter(n => n.kind === 'group').length + 1;
  const group: ComicLayerNode = {
    id: `group-${createUuid().slice(0, 8)}`,
    kind: 'group',
    name: `图层组 ${groupCount}`,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    expanded: true,
  };

  const target = wrapLayerId ? stack.find(n => n.id === wrapLayerId && n.kind !== 'panels') : undefined;
  if (target) {
    group.parentId = target.parentId;
    const idx = stack.findIndex(n => n.id === target.id);
    const nextStack = stack.map(n => (n.id === target.id ? { ...n, parentId: group.id } : n));
    nextStack.splice(idx + 1, 0, group);
    return { group, draft: { ...synced, layerStack: nextStack } };
  }
  return { group, draft: { ...synced, layerStack: [...stack, group] } };
};

export const duplicateLayerInDraft = (
  draft: ComicPageDraft,
  layerId: string,
): { draft: ComicPageDraft; newLayer?: ComicLayerNode } => {
  const synced = syncComicLayerStack(draft);
  const stack = synced.layerStack || [];
  const node = stack.find(n => n.id === layerId);
  if (!node || node.kind === 'panels' || node.kind === 'group') {
    return { draft: synced };
  }

  const idx = stack.findIndex(n => n.id === layerId);
  const insertCopy = (nextDraft: ComicPageDraft, newNode: ComicLayerNode) => {
    const nextStack = [...(nextDraft.layerStack || [])];
    nextStack.splice(idx + 1, 0, newNode);
    return { draft: { ...nextDraft, layerStack: nextStack }, newLayer: newNode };
  };

  if (node.kind === 'bubble' && node.refId) {
    const orig = synced.bubbles.find(b => b.id === node.refId);
    if (!orig) return { draft: synced };
    const copyId = createUuid();
    const copy = {
      ...orig,
      id: copyId,
      x: Math.min(0.92, orig.x + 0.03),
      y: Math.min(0.92, orig.y + 0.03),
      tailX: Math.min(0.96, orig.tailX + 0.03),
      tailY: Math.min(0.96, orig.tailY + 0.03),
    };
    const newNode: ComicLayerNode = { ...node, id: `layer-bubble-${copyId}`, refId: copyId, name: `${node.name} 副本` };
    return insertCopy({ ...synced, bubbles: [...synced.bubbles, copy] }, newNode);
  }
  if (node.kind === 'text' && node.refId) {
    const orig = synced.texts.find(t => t.id === node.refId);
    if (!orig) return { draft: synced };
    const copyId = createUuid();
    const copy = { ...orig, id: copyId, x: Math.min(0.92, orig.x + 0.03), y: Math.min(0.92, orig.y + 0.03) };
    const newNode: ComicLayerNode = { ...node, id: `layer-text-${copyId}`, refId: copyId, name: `${node.name} 副本` };
    return insertCopy({ ...synced, texts: [...synced.texts, copy] }, newNode);
  }
  if (node.kind === 'sticker' && node.refId) {
    const orig = synced.stickers.find(s => s.id === node.refId);
    if (!orig) return { draft: synced };
    const copyId = createUuid();
    const copy = { ...orig, id: copyId, x: Math.min(0.92, orig.x + 0.03), y: Math.min(0.92, orig.y + 0.03) };
    const newNode: ComicLayerNode = { ...node, id: `layer-sticker-${copyId}`, refId: copyId, name: `${node.name} 副本` };
    return insertCopy({ ...synced, stickers: [...synced.stickers, copy] }, newNode);
  }
  if (node.kind === 'image' && node.refId) {
    const orig = (synced.imageLayers || []).find(img => img.id === node.refId);
    if (!orig) return { draft: synced };
    const copyId = `img-${createUuid().slice(0, 8)}`;
    const copy = { ...orig, id: copyId, name: `${orig.name} 副本`, x: Math.min(0.92, orig.x + 0.03), y: Math.min(0.92, orig.y + 0.03) };
    const newNode: ComicLayerNode = { ...node, id: `layer-image-${copyId}`, refId: copyId, name: `${node.name} 副本` };
    return insertCopy({ ...synced, imageLayers: [...(synced.imageLayers || []), copy] }, newNode);
  }
  if (node.kind === 'drawing' && node.refId) {
    const orig = (synced.drawingLayers || []).find(dl => dl.id === node.refId);
    if (!orig) return { draft: synced };
    const copyId = `draw-${createUuid().slice(0, 8)}`;
    const copy: ComicDrawingLayerData = {
      id: copyId,
      strokes: orig.strokes.map(st => ({ ...st, id: createUuid(), points: st.points.map(p => ({ ...p })) })),
    };
    const newNode: ComicLayerNode = { ...node, id: `layer-drawing-${copyId}`, refId: copyId, name: `${node.name} 副本` };
    return insertCopy({ ...synced, drawingLayers: [...(synced.drawingLayers || []), copy] }, newNode);
  }
  return { draft: synced };
};

/** 向下合并：合并相邻的两个手绘图层，或解散图层组并把组内所有手绘图层合并为一层。 */
export const mergeLayerDownInDraft = (
  draft: ComicPageDraft,
  layerId: string,
): { draft: ComicPageDraft; merged: boolean; message: string } => {
  const synced = syncComicLayerStack(draft);
  const stack = synced.layerStack || [];
  const idx = stack.findIndex(n => n.id === layerId);
  if (idx < 0) return { draft: synced, merged: false, message: '未找到目标图层' };
  const node = stack[idx];

  if (node.kind === 'group') {
    const children = stack.filter(n => n.parentId === node.id);
    const drawChildren = children.filter(n => n.kind === 'drawing' && n.refId);
    if (drawChildren.length >= 2) {
      const targetDrawId = drawChildren[0].refId!;
      const mergedStrokes = drawChildren.flatMap(c => {
        const dl = (synced.drawingLayers || []).find(d => d.id === c.refId);
        return (dl?.strokes || []).map(st => ({ ...st, opacity: st.opacity * c.opacity * node.opacity }));
      });
      const removeDrawIds = new Set(drawChildren.slice(1).map(c => c.refId!));
      const removeNodeIds = new Set([node.id, ...drawChildren.slice(1).map(c => c.id)]);
      const nextDrawingLayers = (synced.drawingLayers || [])
        .filter(dl => !removeDrawIds.has(dl.id))
        .map(dl => (dl.id === targetDrawId ? { ...dl, strokes: mergedStrokes } : dl));
      const nextStack = stack
        .filter(n => !removeNodeIds.has(n.id))
        .map(n => (n.parentId === node.id ? { ...n, parentId: node.parentId } : n));
      return {
        draft: { ...synced, drawingLayers: nextDrawingLayers, strokes: nextDrawingLayers.flatMap(d => d.strokes), layerStack: nextStack },
        merged: true,
        message: '已合并图层组内的手绘图层',
      };
    }
    // 普通组：解散文件夹，保留全部子图层
    const nextStack = stack
      .filter(n => n.id !== node.id)
      .map(n => (n.parentId === node.id ? { ...n, parentId: node.parentId } : n));
    return {
      draft: { ...synced, layerStack: nextStack },
      merged: true,
      message: '已解散图层组并保留子图层',
    };
  }

  if (node.kind === 'drawing' && node.refId) {
    // 找紧邻下方最近的手绘图层
    let lowerIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (stack[i].kind === 'drawing' && stack[i].refId) {
        lowerIdx = i;
        break;
      }
    }
    if (lowerIdx < 0) {
      return { draft: synced, merged: false, message: '下方没有可合并的手绘图层' };
    }
    const lowerNode = stack[lowerIdx];
    const upperDl = (synced.drawingLayers || []).find(d => d.id === node.refId);
    const lowerDl = (synced.drawingLayers || []).find(d => d.id === lowerNode.refId);
    if (!upperDl || !lowerDl) return { draft: synced, merged: false, message: '图层数据不存在' };

    const mergedStrokes = [
      ...lowerDl.strokes,
      ...upperDl.strokes.map(st => ({ ...st, opacity: st.opacity * node.opacity })),
    ];
    const nextDrawingLayers = (synced.drawingLayers || [])
      .filter(d => d.id !== upperDl.id)
      .map(d => (d.id === lowerDl.id ? { ...d, strokes: mergedStrokes } : d));
    const nextStack = stack.filter(n => n.id !== node.id);
    return {
      draft: {
        ...synced,
        drawingLayers: nextDrawingLayers,
        strokes: nextDrawingLayers.flatMap(d => d.strokes),
        layerStack: nextStack,
      },
      merged: true,
      message: `已将「${node.name}」向下合并至「${lowerNode.name}」`,
    };
  }

  return { draft: synced, merged: false, message: '矢量气泡/文字/贴纸图层保持可编辑，仅支持合并手绘图层或图层组' };
};

export const deleteLayerInDraft = (
  draft: ComicPageDraft,
  layerId: string,
): { draft: ComicPageDraft; deleted: boolean } => {
  const synced = syncComicLayerStack(draft);
  const stack = synced.layerStack || [];
  const node = stack.find(n => n.id === layerId);
  if (!node || node.kind === 'panels') return { draft: synced, deleted: false };

  const removeIds = new Set<string>([node.id]);
  if (node.kind === 'group') {
    for (const candidate of stack) {
      if (isDescendantOf(stack, candidate.id, node.id)) removeIds.add(candidate.id);
    }
  }

  const removedNodes = stack.filter(n => removeIds.has(n.id));
  const rmBubbles = new Set(removedNodes.filter(n => n.kind === 'bubble').map(n => n.refId));
  const rmTexts = new Set(removedNodes.filter(n => n.kind === 'text').map(n => n.refId));
  const rmStickers = new Set(removedNodes.filter(n => n.kind === 'sticker').map(n => n.refId));
  const rmImages = new Set(removedNodes.filter(n => n.kind === 'image').map(n => n.refId));
  const rmDrawings = new Set(removedNodes.filter(n => n.kind === 'drawing').map(n => n.refId));

  let nextDrawingLayers = (synced.drawingLayers || []).filter(d => !rmDrawings.has(d.id));
  let nextStack = stack.filter(n => !removeIds.has(n.id));
  // 永远保证至少留 1 个空白手绘图层，防止画笔工具失效
  if (nextDrawingLayers.length === 0) {
    nextDrawingLayers = [{ id: DEFAULT_DRAWING_LAYER_ID, strokes: [] }];
    nextStack = [
      ...nextStack,
      {
        id: `layer-drawing-${DEFAULT_DRAWING_LAYER_ID}`,
        kind: 'drawing',
        refId: DEFAULT_DRAWING_LAYER_ID,
        name: '手绘图层 1',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
      },
    ];
  }

  return {
    deleted: true,
    draft: {
      ...synced,
      bubbles: synced.bubbles.filter(b => !rmBubbles.has(b.id)),
      texts: synced.texts.filter(t => !rmTexts.has(t.id)),
      stickers: synced.stickers.filter(s => !rmStickers.has(s.id)),
      imageLayers: (synced.imageLayers || []).filter(img => !rmImages.has(img.id)),
      drawingLayers: nextDrawingLayers,
      strokes: nextDrawingLayers.flatMap(d => d.strokes),
      layerStack: nextStack,
    },
  };
};
