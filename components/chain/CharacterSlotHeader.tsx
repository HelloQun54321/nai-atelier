import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, EyeOff, MapPin, Plus } from 'lucide-react';
import type { CharacterParams } from '../../types';

export interface CharacterSlotHeaderProps {
  characters: CharacterParams[];
  activeCharacterId: string;
  onSelectCharacter: (id: string) => void;
  canEdit: boolean;
  useCoords: boolean;
  onUseCoordsChange: (useCoords: boolean) => void;
  positionOpen: boolean;
  onTogglePosition: () => void;
  coordinateHint?: string;
  showPositionControls?: boolean;
  onAddCharacter: () => void;
  maxCharacters?: number;
  onReorderCharacters?: (fromIndex: number, toIndex: number) => void;
  emptyExtraAction?: React.ReactNode;
}

const characterTileLabel = (item: CharacterParams, index: number) => item.name?.trim() || t('角色 {0}', [index + 1]);

/**
 * 实验室普通模式与提示词细分模式共用的角色顶部工具栏 + 自适应拖拽排序切槽网格。
 * 保持首行控件永不跳行，仅角色数量 >= 2 时展开等宽网格，并支持指针实时 FLIP 重排。
 */
export const CharacterSlotHeader: React.FC<CharacterSlotHeaderProps> = ({
  characters,
  activeCharacterId,
  onSelectCharacter,
  canEdit,
  useCoords,
  onUseCoordsChange,
  positionOpen,
  onTogglePosition,
  coordinateHint,
  showPositionControls = true,
  onAddCharacter,
  maxCharacters,
  onReorderCharacters,
  emptyExtraAction,
}) => {
  useLanguage();
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const prevRectsRef = useRef(new Map<string, DOMRect>());
  const dragSessionRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    active: boolean;
    didDrag: boolean;
    label: string;
    disabled: boolean;
  } | null>(null);

  const [dragState, setDragState] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    disabled: boolean;
  } | null>(null);

  const orderKey = characters.map(item => item.id).join('|');
  const charactersRef = useRef(characters);
  charactersRef.current = characters;
  const reorderRef = useRef(onReorderCharacters);
  reorderRef.current = onReorderCharacters;

  const captureTileRects = () => {
    const rects = new Map<string, DOMRect>();
    charactersRef.current.forEach(item => {
      const el = tileRefs.current.get(item.id);
      if (el) rects.set(item.id, el.getBoundingClientRect());
    });
    prevRectsRef.current = rects;
  };

  // FLIP 位移动画：顺序变更后将兄弟卡片从旧位置平滑滑入新网格位置。
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    if (!prevRects.size) return;
    prevRectsRef.current = new Map();
    const animated: HTMLButtonElement[] = [];
    characters.forEach(item => {
      const el = tileRefs.current.get(item.id);
      const oldRect = prevRects.get(item.id);
      if (!el || !oldRect) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      animated.push(el);
    });
    if (!animated.length) return;
    // 读取 layout 属性强制浏览器完成首帧提交，再开过渡动画。
    void gridRef.current?.offsetHeight;
    requestAnimationFrame(() => {
      animated.forEach(el => {
        el.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
      });
    });
  }, [orderKey]);

  useEffect(() => {
    const findHitIndex = (clientX: number, clientY: number, draggingId: string): number => {
      const grid = gridRef.current;
      if (!grid) return -1;
      const gridRect = grid.getBoundingClientRect();
      const localX = clientX - gridRect.left;
      const localY = clientY - gridRect.top;
      const list = charactersRef.current;
      // 使用与 CSS transform 无关的网格局部坐标 (offsetLeft / offsetTop) 命中测试，彻底消除 FLIP 过渡期抖动。
      for (let idx = 0; idx < list.length; idx += 1) {
        const el = tileRefs.current.get(list[idx].id);
        if (!el) continue;
        if (
          localX >= el.offsetLeft &&
          localX <= el.offsetLeft + el.offsetWidth &&
          localY >= el.offsetTop &&
          localY <= el.offsetTop + el.offsetHeight
        ) {
          return idx;
        }
      }
      // 落入行间缝隙时，找同一行内中心最近的兄弟项。
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let idx = 0; idx < list.length; idx += 1) {
        const item = list[idx];
        if (item.id === draggingId) continue;
        const el = tileRefs.current.get(item.id);
        if (!el) continue;
        const cx = el.offsetLeft + el.offsetWidth / 2;
        const cy = el.offsetTop + el.offsetHeight / 2;
        const dist = Math.hypot(localX - cx, localY - cy);
        if (dist < bestDist && dist < Math.max(el.offsetWidth, el.offsetHeight) * 1.1) {
          bestDist = dist;
          bestIdx = idx;
        }
      }
      return bestIdx;
    };

    const onPointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!session.active) {
        if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 5) return;
        session.active = true;
        session.didDrag = true;
      }
      setDragState({
        id: session.id,
        x: event.clientX - session.offsetX,
        y: event.clientY - session.offsetY,
        width: session.width,
        height: session.height,
        label: session.label,
        disabled: session.disabled,
      });

      const currentIdx = charactersRef.current.findIndex(item => item.id === session.id);
      if (currentIdx < 0) return;
      const targetIdx = findHitIndex(event.clientX, event.clientY, session.id);
      if (targetIdx >= 0 && targetIdx !== currentIdx && reorderRef.current) {
        captureTileRects();
        reorderRef.current(currentIdx, targetIdx);
      }
    };

    const finishDrag = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const didDrag = session.didDrag;
      dragSessionRef.current = null;
      setDragState(null);
      if (didDrag) {
        // 吞掉紧随 pointerup 之后同帧派发的 click，防止松手瞬间意外触发切角或失焦。
        const suppress = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        };
        window.addEventListener('click', suppress, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', suppress, { capture: true }), 0);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, []);

  const atLimit = Boolean(maxCharacters && characters.length >= maxCharacters);

  return (
    <div className="mb-3 flex min-w-0 flex-col gap-2">
      {/* Row 1：左侧构图开关与定位画布，右侧永远钉住添加角色按钮，绝不因角色数增长而跳行 */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {showPositionControls && characters.length > 0 && (
            <>
              <div
                role="group"
                aria-label={t('构图模式')}
                style={{ borderRadius: 'var(--workspace-control-radius, 0.5rem)' }}
                className="inline-flex h-8 shrink-0 items-stretch gap-0.5 overflow-hidden border border-gray-200/80 bg-gray-100/90 p-0.5 dark:border-gray-700 dark:bg-gray-800/90"
              >
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={!useCoords}
                  onClick={() => onUseCoordsChange(false)}
                  style={{ borderRadius: 'max(0.25rem, calc(var(--workspace-control-radius, 0.5rem) - 2px))', height: '100%', minHeight: 0 }}
                  className={`inline-flex shrink-0 items-center justify-center border-0 px-2.5 text-xs font-semibold leading-none transition-colors disabled:opacity-40 ${!useCoords
                    ? 'bg-white text-[var(--nai-accent)] shadow-xs dark:bg-gray-700'
                    : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                  {t('自动构图')}
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={useCoords}
                  onClick={() => {
                    onUseCoordsChange(true);
                    if (!positionOpen) onTogglePosition();
                  }}
                  style={{ borderRadius: 'max(0.25rem, calc(var(--workspace-control-radius, 0.5rem) - 2px))', height: '100%', minHeight: 0 }}
                  className={`inline-flex shrink-0 items-center justify-center border-0 px-2.5 text-xs font-semibold leading-none transition-colors disabled:opacity-40 ${useCoords
                    ? 'bg-white text-[var(--nai-accent)] shadow-xs dark:bg-gray-700'
                    : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                >
                  {t('手动定位')}
                </button>
              </div>
              <button
                type="button"
                aria-label={t('角色定位')}
                aria-expanded={positionOpen}
                title={coordinateHint || t('展开或收起角色定位画布')}
                onClick={onTogglePosition}
                style={{ borderRadius: 'var(--workspace-control-radius, 0.5rem)' }}
                className={`mobile-touch inline-flex h-8 shrink-0 items-center gap-1 border px-2.5 text-xs font-medium transition-colors ${positionOpen
                  ? 'border-[color-mix(in_srgb,var(--nai-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--nai-accent)_10%,transparent)] text-[var(--nai-accent)]'
                  : 'border-gray-200/80 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-800'}`}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('定位画布')}</span>
                {positionOpen
                  ? <ChevronUp className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />}
              </button>
            </>
          )}
          {characters.length === 0 && emptyExtraAction}
        </div>
        {canEdit && (
          <button
            type="button"
            disabled={atLimit}
            aria-label={t('添加角色')}
            title={atLimit && maxCharacters ? t('当前模型最多支持 {0} 个角色', [maxCharacters]) : t('添加角色')}
            onClick={onAddCharacter}
            style={{ borderRadius: 'var(--workspace-control-radius, 0.5rem)' }}
            className="mobile-touch ml-auto inline-flex h-8 shrink-0 items-center gap-1 border-0 bg-[#0d8bf2] px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0b7ad6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d8bf2] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{characters.length > 0 ? t('添加角色 ({0})', [characters.length]) : t('添加角色')}</span>
          </button>
        )}
      </div>

      {/* Row 2：仅当角色数量 >= 2 时展示自然流式等宽切换网格（无内滚动条、无常规绿点、拖拽实时重排） */}
      {characters.length >= 2 && (
        <div
          ref={gridRef}
          role="group"
          aria-label={t('角色切换')}
          className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-1.5 select-none"
        >
          {characters.map((character, index) => {
            const active = character.id === activeCharacterId;
            const disabled = character.enabled === false;
            const draggingSelf = dragState?.id === character.id;
            const label = characterTileLabel(character, index);
            return (
              <button
                key={character.id}
                ref={el => {
                  if (el) tileRefs.current.set(character.id, el);
                  else tileRefs.current.delete(character.id);
                }}
                type="button"
                aria-pressed={active}
                title={canEdit && onReorderCharacters ? t('{0} · 按住拖拽可调整顺序（或 Alt+方向键）', [label]) : label}
                onClick={() => onSelectCharacter(character.id)}
                onPointerDown={event => {
                  if (!canEdit || !onReorderCharacters || event.button !== 0) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  dragSessionRef.current = {
                    id: character.id,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    offsetX: event.clientX - rect.left,
                    offsetY: event.clientY - rect.top,
                    width: rect.width,
                    height: rect.height,
                    active: false,
                    didDrag: false,
                    label,
                    disabled,
                  };
                }}
                onKeyDown={event => {
                  if (!canEdit || !onReorderCharacters || !event.altKey) return;
                  if (event.key === 'ArrowLeft' && index > 0) {
                    event.preventDefault();
                    captureTileRects();
                    onReorderCharacters(index, index - 1);
                  } else if (event.key === 'ArrowRight' && index < characters.length - 1) {
                    event.preventDefault();
                    captureTileRects();
                    onReorderCharacters(index, index + 1);
                  }
                }}
                className={`mobile-touch inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs tabular-nums transition-colors ${canEdit && onReorderCharacters ? 'cursor-grab active:cursor-grabbing' : ''} ${draggingSelf ? 'opacity-0' : ''} ${active
                  ? disabled
                    ? 'border-dashed border-gray-400 bg-gray-100 font-semibold text-gray-500 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-300'
                    : 'border-[#0d8bf2] bg-[#0d8bf2]/10 font-semibold text-[#0d8bf2] dark:bg-[#0d8bf2]/20 dark:text-[#60b5ff]'
                  : disabled
                    ? 'border-dashed border-gray-300 bg-gray-50/70 text-gray-400 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-500'
                    : 'appearance-group border-gray-200 bg-white/80 font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-white'}`}
              >
                <span className={`min-w-0 truncate ${disabled ? 'line-through' : ''}`}>{label}</span>
                {disabled && (
                  <>
                    <EyeOff className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                    <span className="sr-only">{t('· 已停用')}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 跟随指针的悬浮克隆卡片 */}
      {dragState && createPortal(
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: dragState.x,
            top: dragState.y,
            width: dragState.width,
            height: dragState.height,
            zIndex: 2500,
            transform: 'scale(1.05)',
            pointerEvents: 'none',
          }}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#0d8bf2] bg-white px-2 text-xs font-semibold text-[#0d8bf2] shadow-xl ring-2 ring-[#0d8bf2]/20 dark:bg-gray-900 dark:text-[#60b5ff]"
        >
          <span className={`min-w-0 truncate ${dragState.disabled ? 'line-through opacity-65' : ''}`}>{dragState.label}</span>
          {dragState.disabled && <EyeOff className="h-3 w-3 shrink-0 opacity-60" />}
        </div>,
        document.body,
      )}
    </div>
  );
};
