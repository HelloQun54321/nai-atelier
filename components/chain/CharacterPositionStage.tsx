import React, { useRef, useState } from 'react';
import type { CharacterParams } from '../../types';
import { normalizeCharacterCoordinate } from '../../services/characterPrompts';

interface CharacterPositionStageProps {
  characters: CharacterParams[];
  freeform: boolean;
  width: number;
  height: number;
  image?: string | null;
  canEdit: boolean;
  useCoords: boolean;
  onPosition: (index: number, position: { x: number; y: number }) => void;
}

/** 使用真实画布比例；编辑模式传入原图，坐标转换仍由请求层负责。 */
export const CharacterPositionStage: React.FC<CharacterPositionStageProps> = ({ characters, freeform, width, height, image, canEdit, useCoords, onPosition }) => {
  const [selectedId, setSelectedId] = useState('');
  const dragging = useRef<{ id: string; pointerId: number } | null>(null);
  const available = characters.map((character, index) => ({ character, index })).filter(({ character }) => character.enabled !== false);
  const selected = available.find(({ character }) => character.id === selectedId) || available[0];
  const ratio = Math.max(1, width) / Math.max(1, height);
  const place = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const index = characters.findIndex(character => character.id === id && character.enabled !== false);
    const rect = event.currentTarget.getBoundingClientRect();
    if (!canEdit || index < 0 || !rect.width || !rect.height) return;
    onPosition(index, {
      x: normalizeCharacterCoordinate(Math.round((event.clientX - rect.left) / rect.width * 1000) / 1000, freeform),
      y: normalizeCharacterCoordinate(Math.round((event.clientY - rect.top) / rect.height * 1000) / 1000, freeform),
    });
  };
  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId === event.pointerId) dragging.current = null;
  };

  return <div className="mb-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
    <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-gray-500 dark:text-gray-400">
      <span>{freeform ? '自由定位' : '5 × 5 格点'} · {width} × {height}</span>
      <span>{useCoords ? '选择角色后点击或拖动，方向键微调' : '点击或拖动将切换为手动定位'}</span>
    </div>
    <div className="flex flex-wrap items-start justify-center gap-3">
      <div
        role="group" aria-label="角色定位画布"
        className="relative isolate touch-none overflow-hidden rounded border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
        style={{ width: Math.min(320, 224 * ratio), maxWidth: '100%', aspectRatio: `${ratio}` }}
        onPointerDown={event => {
          if (!canEdit || !selected || event.button !== 0) return;
          const id = (event.target as HTMLElement).closest<HTMLElement>('[data-character-id]')?.dataset.characterId || selected.character.id;
          setSelectedId(id);
          dragging.current = { id, pointerId: event.pointerId };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.preventDefault();
          place(event, id);
        }}
        onPointerMove={event => { if (dragging.current?.pointerId === event.pointerId) place(event, dragging.current.id); }}
        onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
      >
        {image && <img src={image} alt="角色定位底图" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-60" />}
        {!freeform && <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-5 grid-rows-5">
          {Array.from({ length: 25 }, (_, index) => <div key={index} className="border border-gray-400/20 dark:border-gray-400/25" />)}
        </div>}
        {available.map(({ character, index }) => <button
          key={character.id} type="button" data-character-id={character.id}
          aria-label={`定位角色 ${index + 1}`} aria-pressed={selected?.character.id === character.id} disabled={!canEdit}
          title={`角色 ${index + 1} · ${character.prompt || '尚未填写'}（方向键微调）`}
          className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-xs font-bold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed ${selected?.character.id === character.id ? 'z-10 border-indigo-500 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100'}`}
          style={{ left: `clamp(14px, ${normalizeCharacterCoordinate(character.x, freeform) * 100}%, calc(100% - 14px))`, top: `clamp(14px, ${normalizeCharacterCoordinate(character.y, freeform) * 100}%, calc(100% - 14px))` }}
          onClick={() => setSelectedId(character.id)}
          onKeyDown={event => {
            if (!canEdit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const step = freeform ? 0.01 : 0.2;
            const x = normalizeCharacterCoordinate(character.x, freeform), y = normalizeCharacterCoordinate(character.y, freeform);
            onPosition(index, {
              x: normalizeCharacterCoordinate(Number((x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)).toFixed(3)), freeform),
              y: normalizeCharacterCoordinate(Number((y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)).toFixed(3)), freeform),
            });
          }}
        >{index + 1}</button>)}
      </div>
      <div className="flex max-h-56 min-w-24 max-w-56 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto">
        {available.map(({ character, index }) => <button key={character.id} type="button" disabled={!canEdit}
          aria-label={`选择角色 ${index + 1}`} aria-pressed={selected?.character.id === character.id}
          onClick={() => setSelectedId(character.id)} title={character.prompt}
          className={`max-w-full truncate rounded border px-2 py-1 text-xs disabled:opacity-50 ${selected?.character.id === character.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
        >{index + 1} · {character.prompt || '尚未填写'}</button>)}
        {!available.length && <span className="text-xs text-gray-400">没有已启用的角色</span>}
      </div>
    </div>
  </div>;
};
