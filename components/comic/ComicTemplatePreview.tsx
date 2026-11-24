import React from 'react';
import type { ComicLayoutTemplate } from '../../services/comic/comicLayoutTemplates';
import type { ComicPanel, ComicPoint } from '../../services/comic/comicTypes';

export interface ComicTemplatePreviewPanel {
  points: ComicPoint[];
  borderWidth: number;
  inset?: boolean;
  bleed?: boolean;
}

const previewPanelCache = new Map<string, ComicTemplatePreviewPanel[]>();

/** 缓存内置模板在标准 2:3 竖页下的预览几何，避免每次打开模板弹窗重复计算。 */
export const getBuiltinTemplatePreviewPanels = (
  template: ComicLayoutTemplate,
): ComicTemplatePreviewPanel[] => {
  const cached = previewPanelCache.get(template.id);
  if (cached) return cached;
  const gx = 14 / 832;
  const gy = 14 / 1216;
  const panels = template.buildPanels(gx, gy).map(panel => ({
    points: panel.points,
    borderWidth: panel.borderWidth,
    ...(panel.inset ? { inset: true } : {}),
    ...(panel.bleed ? { bleed: true } : {}),
  }));
  previewPanelCache.set(template.id, panels);
  return panels;
};

interface ComicTemplatePreviewProps {
  panels: ComicTemplatePreviewPanel[];
  className?: string;
}

const VIEW_W = 60;
const VIEW_H = 84;

/** 渲染分镜布局的微缩 SVG 纸张预览图（常规格、叠框画中画、无框格区分展示）。 */
export const ComicTemplatePreview: React.FC<ComicTemplatePreviewProps> = ({
  panels,
  className = 'h-14 w-auto',
}) => {
  const ordered = [
    ...panels.filter(p => !p.inset),
    ...panels.filter(p => p.inset),
  ];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      aria-hidden="true"
      className={`${className} shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.08)]`}
    >
      <rect
        x={0.75}
        y={0.75}
        width={VIEW_W - 1.5}
        height={VIEW_H - 1.5}
        rx={3}
        className="fill-white stroke-slate-300 dark:fill-slate-900 dark:stroke-slate-600"
        strokeWidth={1.1}
      />
      {ordered.map((panel, idx) => {
        if (!panel.points.length) return null;
        const ptsAttr = panel.points
          .map(pt => `${(pt.x * VIEW_W).toFixed(1)},${(pt.y * VIEW_H).toFixed(1)}`)
          .join(' ');
        const isBorderless = panel.borderWidth === 0;
        if (panel.inset) {
          return (
            <polygon
              key={idx}
              points={ptsAttr}
              className="fill-white stroke-slate-900 dark:fill-slate-800 dark:stroke-white"
              strokeWidth={1.9}
              strokeLinejoin="miter"
            />
          );
        }
        if (isBorderless) {
          return (
            <polygon
              key={idx}
              points={ptsAttr}
              className="fill-slate-100/85 stroke-slate-400 dark:fill-slate-700/60 dark:stroke-slate-400"
              strokeWidth={1.1}
              strokeDasharray="3 2"
              strokeLinejoin="miter"
            />
          );
        }
        return (
          <polygon
            key={idx}
            points={ptsAttr}
            className="fill-slate-100 stroke-slate-800 dark:fill-slate-700/80 dark:stroke-slate-200"
            strokeWidth={1.55}
            strokeLinejoin="miter"
          />
        );
      })}
    </svg>
  );
};

export const toPreviewPanelsFromCustom = (
  panels: Array<Pick<ComicPanel, 'points' | 'borderWidth' | 'inset' | 'bleed'>>,
): ComicTemplatePreviewPanel[] =>
  panels.map(panel => ({
    points: panel.points,
    borderWidth: panel.borderWidth,
    ...(panel.inset ? { inset: true } : {}),
    ...(panel.bleed ? { bleed: true } : {}),
  }));
