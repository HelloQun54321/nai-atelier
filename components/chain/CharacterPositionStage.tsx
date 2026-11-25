import { t, useLanguage } from '../../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
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

const CoordinateInput: React.FC<{ value: number; freeform: boolean; disabled: boolean; label: string; onCommit: (value: number) => void }> = ({ value, freeform, disabled, label, onCommit }) => {
  useLanguage();
  const coordinate = normalizeCharacterCoordinate(value, freeform);
  const [draft, setDraft] = useState(String(coordinate));
  useEffect(() => setDraft(String(coordinate)), [coordinate]);
  return <input type="number" step={freeform ? '0.01' : '0.2'} min={freeform ? '0' : '0.1'} max={freeform ? '1' : '0.9'}
    aria-label={t(label)} disabled={disabled} value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      if (disabled) { setDraft(String(coordinate)); return; }
      const next = normalizeCharacterCoordinate(draft.trim() ? Number(draft) : NaN, freeform);
      setDraft(String(next)); onCommit(next);
    }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
    className="w-full rounded border bg-white p-1.5 text-xs disabled:opacity-40 dark:border-gray-600 dark:bg-gray-900 dark:text-white" />;
};

/** 使用真实画布比例；编辑模式传入原图，坐标转换仍由请求层负责。拖点与数字框共用同一套坐标。 */
export const CharacterPositionStage: React.FC<CharacterPositionStageProps> = ({ characters, freeform, width, height, image, canEdit, useCoords, onPosition }) => {
  useLanguage();
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
  const commitAxis = (axis: 'x' | 'y', value: number) => {
    if (!selected || !canEdit) return;
    // 只改当前轴，另一轴保留草稿原值，避免格点模式下改 X 把自由坐标 Y 一并吸附。
    onPosition(selected.index, {
      x: axis === 'x' ? value : selected.character.x,
      y: axis === 'y' ? value : selected.character.y,
    });
  };

  return <div className="appearance-group mb-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
    <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-gray-500 dark:text-gray-400">
      <span>{freeform ? t("自由定位") : t("5 × 5 格点")} · {width} × {height}</span>
    </div>
    <div className="flex flex-wrap items-start justify-center gap-3">
      <div
        role="group" aria-label={t("角色定位画布")} title={useCoords ? t("拖动定位 · 方向键微调") : t("拖动切换手动定位")}
        className="appearance-media relative isolate touch-none overflow-hidden rounded border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
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
        {image && <img src={image} alt={t("角色定位底图")} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-60" />}
        {!freeform && <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-5 grid-rows-5">
          {Array.from({ length: 25 }, (_, index) => <div key={index} className="border border-gray-400/20 dark:border-gray-400/25" />)}
        </div>}
        {available.map(({ character, index }) => {
          const displayName = character.name?.trim() || t('角色 {0}', [index + 1]);
          return <button
            key={character.id} type="button" data-character-id={character.id}
            aria-label={t("定位角色 {0}", [index + 1])} aria-pressed={selected?.character.id === character.id} disabled={!canEdit}
            title={character.prompt ? t("{0} · {1}（方向键微调）", [displayName, character.prompt]) : t("{0}（方向键微调）", [displayName])}
            className={`appearance-media absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-xs font-bold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed ${selected?.character.id === character.id ? 'z-10 border-indigo-500 bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 text-white' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100'}`}
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
          >{index + 1}</button>;
        })}
      </div>
      <div className="flex min-w-24 max-w-56 flex-1 flex-col gap-2">
        <div className="flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto">
          {available.map(({ character, index }) => {
            const defaultLabel = t('角色 {0}', [index + 1]);
            const displayName = character.name?.trim() || defaultLabel;
            const buttonLabel = displayName === defaultLabel ? displayName : `${index + 1} · ${displayName}`;
            return <button key={character.id} type="button" disabled={!canEdit}
              aria-label={t("选择角色 {0}", [index + 1])} aria-pressed={selected?.character.id === character.id}
              onClick={() => setSelectedId(character.id)} title={character.prompt ? `${displayName} · ${character.prompt}` : displayName}
              className={`max-w-full truncate rounded border px-2 py-1 text-xs disabled:opacity-50 ${selected?.character.id === character.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'appearance-group border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
            >{buttonLabel}</button>;
          })}
          {!available.length && <span className="text-xs text-gray-400">{t("没有已启用的角色")}</span>}
        </div>
        {selected && <div role="group" className="grid grid-cols-2 gap-2" aria-label={t('角色 {0} 坐标', [selected.index + 1])}>
          <label className="text-micro font-bold text-gray-500 dark:text-gray-400">
            <span className="mb-1 block">{t('水平位置 (X)')}</span>
            <CoordinateInput label={t('角色 {0} 水平位置', [selected.index + 1])} value={selected.character.x} freeform={freeform}
              disabled={!canEdit} onCommit={value => commitAxis('x', value)} />
          </label>
          <label className="text-micro font-bold text-gray-500 dark:text-gray-400">
            <span className="mb-1 block">{t('垂直位置 (Y)')}</span>
            <CoordinateInput label={t('角色 {0} 垂直位置', [selected.index + 1])} value={selected.character.y} freeform={freeform}
              disabled={!canEdit} onCommit={value => commitAxis('y', value)} />
          </label>
        </div>}
      </div>
    </div>
  </div>;
};
