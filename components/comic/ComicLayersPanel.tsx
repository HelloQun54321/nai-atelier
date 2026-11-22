import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brush,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Layers,
  LayoutGrid,
  Lock,
  Merge,
  PanelRightClose,
  Plus,
  Sticker,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import { t, useLanguage } from '../../services/i18n';
import {
  blendModeLabel,
  COMIC_BLEND_MODES,
  findLayerNodeForSelection,
  resolveEffectiveLayerProps,
  syncComicLayerStack,
} from '../../services/comic/comicLayers';
import type {
  ComicBlendMode,
  ComicLayerNode,
  ComicPageDraft,
  ComicSelection,
} from '../../services/comic/comicTypes';
import { ComicBubbleShapeIcon } from './ComicBubbleShapeIcon';

interface ComicLayersPanelProps {
  draft: ComicPageDraft;
  selection: ComicSelection;
  collapsed: boolean;
  dockMode?: 'tab' | 'column' | 'bottom';
  onToggleCollapsed: () => void;
  onSelectLayer: (node: ComicLayerNode) => void;
  onUpdateLayerNode: (layerId: string, updater: (node: ComicLayerNode) => ComicLayerNode, commit?: boolean) => void;
  onReorderLayer: (sourceId: string, targetId: string, position: 'above' | 'below' | 'inside') => void;
  onCreateDrawingLayer: () => void;
  onImportImageLayer: (file: File) => void;
  onCreateGroupLayer: (wrapLayerId?: string) => void;
  onDuplicateLayer: (layerId: string) => void;
  onMergeLayerDown: (layerId: string) => void;
  onDeleteLayer: (layerId: string) => void;
}

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.22) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

/**
 * 仿 Photoshop 真实图层面板（常驻于右侧工作台下半区）：
 * 实时缩略图、拖拽上下排序、不透明度、混合模式、多手绘图层、导入图片层、图层组/文件夹、双击改名、复制/向下合并/删除。
 */
export const ComicLayersPanel: React.FC<ComicLayersPanelProps> = ({
  draft,
  selection,
  collapsed,
  dockMode = 'tab',
  onToggleCollapsed,
  onSelectLayer,
  onUpdateLayerNode,
  onReorderLayer,
  onCreateDrawingLayer,
  onImportImageLayer,
  onCreateGroupLayer,
  onDuplicateLayer,
  onMergeLayerDown,
  onDeleteLayer,
}) => {
  useLanguage();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'above' | 'below' | 'inside' } | null>(null);

  const synced = useMemo(() => syncComicLayerStack(draft), [draft]);
  const stack = useMemo(() => synced.layerStack || [], [synced.layerStack]);

  // PS 习惯：最顶层显示在列表最上方（倒序），且折叠的文件夹隐藏其子图层
  const displayRows = useMemo(() => {
    const byId = new Map(stack.map(n => [n.id, n]));
    const isHiddenByCollapsedParent = (node: ComicLayerNode): boolean => {
      let cur = node.parentId;
      const visited = new Set<string>();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const parent = byId.get(cur);
        if (!parent) break;
        if (parent.expanded === false) return true;
        cur = parent.parentId;
      }
      return false;
    };

    const rows: Array<{ node: ComicLayerNode; depth: number; effectiveVisible: boolean; effectiveLocked: boolean }> = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      const node = stack[i];
      if (isHiddenByCollapsedParent(node)) continue;
      const eff = resolveEffectiveLayerProps(node, stack);
      rows.push({
        node,
        depth: eff.depth,
        effectiveVisible: eff.visible,
        effectiveLocked: eff.locked,
      });
    }
    return rows;
  }, [stack]);

  const activeNode = useMemo(
    () => findLayerNodeForSelection(stack, selection) || stack[stack.length - 1],
    [selection, stack],
  );

  const bubbleMap = useMemo(() => new Map(draft.bubbles.map(b => [b.id, b])), [draft.bubbles]);
  const imageMap = useMemo(() => new Map((synced.imageLayers || []).map(img => [img.id, img])), [synced.imageLayers]);
  const drawingMap = useMemo(() => new Map((synced.drawingLayers || []).map(dl => [dl.id, dl])), [synced.drawingLayers]);

  const commitRename = (layerId: string) => {
    const clean = renameValue.trim();
    if (clean) {
      onUpdateLayerNode(layerId, cur => ({ ...cur, name: clean }), true);
    }
    setRenamingId(null);
  };

  const renderThumbnail = (node: ComicLayerNode) => {
    if (node.kind === 'group') {
      return (
        <div className="flex h-6 w-8 flex-none items-center justify-center rounded border border-amber-300/60 bg-amber-50/70 text-amber-600 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-400">
          {node.expanded === false ? <Folder className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />}
        </div>
      );
    }
    if (node.kind === 'bubble' && node.refId) {
      const bubble = bubbleMap.get(node.refId);
      return (
        <div style={CHECKER_STYLE} className="flex h-6 w-8 flex-none items-center justify-center overflow-hidden rounded border border-gray-300/80 text-gray-800 dark:border-gray-600 dark:text-gray-200">
          <ComicBubbleShapeIcon shape={bubble?.shape || 'soft'} className="h-5 w-7" />
        </div>
      );
    }
    if (node.kind === 'text') {
      return (
        <div style={CHECKER_STYLE} className="flex h-6 w-8 flex-none items-center justify-center rounded border border-gray-300/80 text-indigo-600 dark:border-gray-600 dark:text-indigo-300">
          <Type className="h-3.5 w-3.5" />
        </div>
      );
    }
    if (node.kind === 'sticker') {
      return (
        <div style={CHECKER_STYLE} className="flex h-6 w-8 flex-none items-center justify-center rounded border border-gray-300/80 text-purple-600 dark:border-gray-600 dark:text-purple-300">
          <Sticker className="h-3.5 w-3.5" />
        </div>
      );
    }
    if (node.kind === 'image' && node.refId) {
      const img = imageMap.get(node.refId);
      return (
        <div style={CHECKER_STYLE} className="flex h-6 w-8 flex-none items-center justify-center overflow-hidden rounded border border-gray-300/80 dark:border-gray-600">
          {img?.url ? (
            <img src={img.url} alt={node.name} className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5 text-gray-400" />
          )}
        </div>
      );
    }
    if (node.kind === 'drawing' && node.refId) {
      const dl = drawingMap.get(node.refId);
      const count = dl?.strokes.length || 0;
      return (
        <div style={CHECKER_STYLE} className="relative flex h-6 w-8 flex-none items-center justify-center overflow-hidden rounded border border-gray-300/80 dark:border-gray-600">
          {count > 0 ? (
            <svg viewBox="0 0 32 24" className="h-full w-full">
              {(dl?.strokes || []).slice(-6).map(st => (
                <polyline
                  key={st.id}
                  fill="none"
                  stroke={st.tool === 'eraser' ? '#94a3b8' : st.color}
                  strokeWidth={1.6}
                  points={st.points.map(p => `${(p.x * 32).toFixed(1)},${(p.y * 24).toFixed(1)}`).join(' ')}
                />
              ))}
            </svg>
          ) : (
            <Brush className="h-3 w-3 text-gray-400" />
          )}
        </div>
      );
    }
    // panels base layer
    const aiThumb = draft.creationMode === 'ai-page' ? draft.aiPage.generatedPageImage?.url : undefined;
    return (
      <div className="flex h-6 w-8 flex-none items-center justify-center overflow-hidden rounded border border-gray-300/80 bg-white dark:border-gray-600 dark:bg-gray-800">
        {aiThumb ? (
          <img src={aiThumb} alt={node.name} className="h-full w-full object-cover" />
        ) : (
          <LayoutGrid className="h-3.5 w-3.5 text-indigo-500" />
        )}
      </div>
    );
  };

  // 桌面端独立列折叠态：仿 PS 经典 36px 竖向图标窄条，点一下即可展开
  if (dockMode === 'column' && collapsed) {
    return (
      <section
        aria-label={t('PS 图层面板')}
        className="appearance-panel flex h-full w-9 flex-none flex-col items-center border-l border-gray-200/90 bg-white/90 py-2.5 dark:border-gray-800/90 dark:bg-gray-900/90"
      >
        <button
          type="button"
          aria-expanded={false}
          aria-label={t('展开图层面板')}
          title={t('展开图层面板')}
          onClick={onToggleCollapsed}
          className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-gray-600 transition hover:bg-indigo-50 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
        >
          <Layers className="h-4 w-4" aria-hidden="true" />
          <span className="text-[11px] font-bold tracking-wider" style={{ writingMode: 'vertical-rl' }}>
            {t('图层')}
          </span>
          <span className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {stack.length}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label={t('PS 图层面板')}
      className={`flex h-full min-h-0 flex-1 flex-col ${dockMode === 'tab' ? 'bg-transparent' : dockMode === 'column' ? 'appearance-panel border-l border-gray-200/90 bg-white/90 dark:border-gray-800/90 dark:bg-gray-900/90' : 'appearance-surface border-t border-gray-200/90 dark:border-gray-800/90'}`}
    >
      {/* 标题栏（独立列或底部停靠态显示折叠按钮；标签页态直接把满高留给图层内容） */}
      {dockMode !== 'tab' && (
        <div className="flex h-10 flex-none items-center justify-between gap-2 border-b border-gray-200/80 px-2.5 dark:border-gray-800/80">
          {dockMode === 'column' ? (
            <>
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-gray-100">
                <Layers className="h-3.5 w-3.5 flex-none text-indigo-500" aria-hidden="true" />
                <span>{t('图层')}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {stack.length}
                </span>
              </div>
              <button
                type="button"
                aria-expanded={true}
                aria-label={t('收起图层面板')}
                title={t('收起为窄条')}
                onClick={onToggleCollapsed}
                className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              >
                <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={onToggleCollapsed}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-800 hover:text-indigo-600 dark:text-gray-100 dark:hover:text-indigo-300"
              >
                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span>{t('图层')}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {stack.length}
                </span>
              </button>
              {activeNode && !collapsed && (
                <span className="max-w-36 truncate text-[10px] text-gray-400">
                  {activeNode.name}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {(!collapsed || dockMode === 'tab') && (
        <>
          {/* PS 顶部混合模式 + 不透明度 + 锁定条 */}
          {activeNode && (
            <div className={`flex flex-none border-b border-gray-200/70 px-3 py-2 text-[11px] dark:border-gray-800/70 ${dockMode === 'tab' ? 'items-center gap-2' : 'flex-col gap-1.5 px-2.5'}`}>
              {dockMode === 'tab' ? (
                <>
                  <select
                    aria-label={t('图层混合模式')}
                    value={activeNode.blendMode}
                    onChange={e => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, blendMode: e.target.value as ComicBlendMode }), true)}
                    className="w-24 flex-none rounded border border-gray-200 bg-white px-1.5 py-1 text-[11px] font-medium text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    {COMIC_BLEND_MODES.map(mode => (
                      <option key={mode.id} value={mode.id}>{t(mode.label)}</option>
                    ))}
                  </select>
                  <label className="flex min-w-0 flex-1 items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span className="flex-none text-[10px]">{t('不透明度')}</span>
                    <input
                      type="range"
                      aria-label={t('图层不透明度')}
                      min={0}
                      max={100}
                      value={Math.round(activeNode.opacity * 100)}
                      onChange={e => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, opacity: Number(e.target.value) / 100 }), false)}
                      onMouseUp={() => onUpdateLayerNode(activeNode.id, cur => cur, true)}
                      className="min-w-0 flex-1 accent-indigo-600"
                    />
                    <span className="w-8 flex-none text-right font-mono text-[10px] font-semibold text-gray-700 dark:text-gray-200">
                      {Math.round(activeNode.opacity * 100)}%
                    </span>
                  </label>
                  <button
                    type="button"
                    aria-label={activeNode.locked ? t('解锁当前图层') : t('锁定当前图层')}
                    title={activeNode.locked ? t('解锁当前图层') : t('锁定当前图层')}
                    onClick={() => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, locked: !cur.locked }), true)}
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded transition ${activeNode.locked ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'}`}
                  >
                    {activeNode.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label={t('图层混合模式')}
                      value={activeNode.blendMode}
                      onChange={e => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, blendMode: e.target.value as ComicBlendMode }), true)}
                      className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-800 outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                      {COMIC_BLEND_MODES.map(mode => (
                        <option key={mode.id} value={mode.id}>{t(mode.label)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={activeNode.locked ? t('解锁当前图层') : t('锁定当前图层')}
                      title={activeNode.locked ? t('解锁当前图层') : t('锁定当前图层')}
                      onClick={() => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, locked: !cur.locked }), true)}
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded transition ${activeNode.locked ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'}`}
                    >
                      {activeNode.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <label className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <span className="flex-none text-[10px]">{t('不透明度')}</span>
                    <input
                      type="range"
                      aria-label={t('图层不透明度')}
                      min={0}
                      max={100}
                      value={Math.round(activeNode.opacity * 100)}
                      onChange={e => onUpdateLayerNode(activeNode.id, cur => ({ ...cur, opacity: Number(e.target.value) / 100 }), false)}
                      onMouseUp={() => onUpdateLayerNode(activeNode.id, cur => cur, true)}
                      className="min-w-0 flex-1 accent-indigo-600"
                    />
                    <span className="w-8 flex-none text-right font-mono text-[10px] font-semibold text-gray-700 dark:text-gray-200">
                      {Math.round(activeNode.opacity * 100)}%
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* PS 可拖拽图层栈列表（顶层在上，底层在下） */}
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1.5 text-xs">
            {displayRows.map(({ node, depth, effectiveVisible, effectiveLocked }, rowIdx) => {
              const isSelected = activeNode?.id === node.id;
              const isRenaming = renamingId === node.id;
              const isDropAbove = dropTarget?.id === node.id && dropTarget.position === 'above';
              const isDropBelow = dropTarget?.id === node.id && dropTarget.position === 'below';
              const isDropInside = dropTarget?.id === node.id && dropTarget.position === 'inside';
              const metaTags: string[] = [];
              if (node.blendMode !== 'normal') metaTags.push(t(blendModeLabel(node.blendMode)));
              if (node.opacity < 0.999) metaTags.push(`${Math.round(node.opacity * 100)}%`);

              return (
                <div
                  key={node.id}
                  draggable={!isRenaming}
                  onDragStart={e => {
                    setDragSourceId(node.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', node.id);
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    if (!dragSourceId || dragSourceId === node.id) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relY = (e.clientY - rect.top) / Math.max(1, rect.height);
                    let pos: 'above' | 'below' | 'inside' = relY < 0.5 ? 'above' : 'below';
                    if (node.kind === 'group' && relY >= 0.25 && relY <= 0.75) pos = 'inside';
                    setDropTarget({ id: node.id, position: pos });
                  }}
                  onDragLeave={() => {
                    if (dropTarget?.id === node.id) setDropTarget(null);
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    if (dragSourceId && dragSourceId !== node.id && dropTarget) {
                      onReorderLayer(dragSourceId, node.id, dropTarget.position);
                    }
                    setDragSourceId(null);
                    setDropTarget(null);
                  }}
                  onDragEnd={() => {
                    setDragSourceId(null);
                    setDropTarget(null);
                  }}
                  onClick={() => onSelectLayer(node)}
                  style={{ paddingLeft: `${6 + depth * 16}px` }}
                  className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg border py-1 pr-1.5 transition ${
                    isSelected
                      ? 'border-indigo-400/90 bg-indigo-50/85 dark:border-indigo-500/80 dark:bg-indigo-950/55'
                      : 'border-transparent hover:bg-gray-100/80 dark:hover:bg-gray-800/60'
                  } ${!effectiveVisible ? 'opacity-45' : ''} ${isDropInside ? 'ring-2 ring-indigo-500' : ''}`}
                >
                  {isDropAbove && <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 -top-0.5 h-0.5 rounded-full bg-indigo-500" />}
                  {isDropBelow && <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-indigo-500" />}

                  {/* 眼睛显隐按钮 */}
                  <button
                    type="button"
                    aria-label={node.visible ? t('隐藏图层 {0}', [node.name]) : t('显示图层 {0}', [node.name])}
                    onClick={e => {
                      e.stopPropagation();
                      onUpdateLayerNode(node.id, cur => ({ ...cur, visible: !cur.visible }), true);
                    }}
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded ${node.visible ? 'text-indigo-600 hover:bg-indigo-100/70 dark:text-indigo-400 dark:hover:bg-indigo-900/40' : 'text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700'}`}
                  >
                    {node.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>

                  {/* 文件夹折叠展开箭头 */}
                  {node.kind === 'group' && (
                    <button
                      type="button"
                      aria-label={node.expanded === false ? t('展开图层组') : t('折叠图层组')}
                      onClick={e => {
                        e.stopPropagation();
                        onUpdateLayerNode(node.id, cur => ({ ...cur, expanded: cur.expanded === false }), false);
                      }}
                      className="flex h-4 w-4 flex-none items-center justify-center text-gray-500 hover:text-gray-800 dark:text-gray-400"
                    >
                      {node.expanded === false ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}

                  {/* 实时微缩图 */}
                  {renderThumbnail(node)}

                  {/* 图层名称（双击原地重命名） */}
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <input
                        type="text"
                        autoFocus
                        aria-label={t('重命名图层')}
                        value={renameValue}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(node.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(node.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full rounded border border-indigo-400 bg-white px-1 py-0.5 text-[11px] font-medium text-gray-900 outline-none dark:bg-gray-900 dark:text-white"
                      />
                    ) : (
                      <div
                        onDoubleClick={e => {
                          e.stopPropagation();
                          setRenamingId(node.id);
                          setRenameValue(node.name);
                        }}
                        title={t('双击重命名图层')}
                        className="truncate text-[11px] font-medium text-gray-800 dark:text-gray-100"
                      >
                        {node.name}
                      </div>
                    )}
                    {metaTags.length > 0 && !isRenaming && (
                      <div className="truncate text-[9px] text-indigo-500 dark:text-indigo-300">
                        {metaTags.join(' · ')}
                      </div>
                    )}
                  </div>

                  {/* 快捷上移 / 下移 / 锁标识 */}
                  <div className="flex flex-none items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={t('上移图层 {0}', [node.name])}
                      disabled={rowIdx === 0}
                      onClick={e => {
                        e.stopPropagation();
                        const aboveRow = displayRows[rowIdx - 1];
                        if (aboveRow) onReorderLayer(node.id, aboveRow.node.id, 'above');
                      }}
                      className="rounded p-0.5 text-gray-400 opacity-0 transition hover:bg-gray-200/80 hover:text-gray-700 disabled:opacity-0 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('下移图层 {0}', [node.name])}
                      disabled={rowIdx === displayRows.length - 1}
                      onClick={e => {
                        e.stopPropagation();
                        const belowRow = displayRows[rowIdx + 1];
                        if (belowRow) onReorderLayer(node.id, belowRow.node.id, 'below');
                      }}
                      className="rounded p-0.5 text-gray-400 opacity-0 transition hover:bg-gray-200/80 hover:text-gray-700 disabled:opacity-0 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    {effectiveLocked && (
                      <Lock className="h-3 w-3 text-amber-500" aria-label={t('已锁定')} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* PS 经典底部图层动作工具条（6 枚统一尺寸图标按钮，左右均衡对齐） */}
          <div className="flex flex-none items-center justify-between gap-1 border-t border-gray-200/80 px-2 py-1.5 dark:border-gray-800/80">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={t('新建手绘图层')}
                title={t('新建手绘图层')}
                onClick={onCreateDrawingLayer}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) onImportImageLayer(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                aria-label={t('导入图片图层')}
                title={t('导入图片图层（支持网点/特效/叠加图）')}
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('新建图层组')}
                title={t('新建图层组（文件夹）')}
                onClick={() => onCreateGroupLayer(activeNode && activeNode.kind !== 'panels' ? activeNode.id : undefined)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={t('复制当前图层')}
                title={t('复制当前图层')}
                disabled={!activeNode || activeNode.kind === 'panels' || activeNode.kind === 'group'}
                onClick={() => activeNode && onDuplicateLayer(activeNode.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('向下合并图层')}
                title={t('向下合并手绘图层 / 解散图层组')}
                disabled={!activeNode || (activeNode.kind !== 'drawing' && activeNode.kind !== 'group')}
                onClick={() => activeNode && onMergeLayerDown(activeNode.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Merge className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('删除当前图层')}
                title={t('删除当前图层')}
                disabled={!activeNode || activeNode.kind === 'panels'}
                onClick={() => activeNode && onDeleteLayer(activeNode.id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
