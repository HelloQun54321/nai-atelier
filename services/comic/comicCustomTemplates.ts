import { createUuid } from '../id';
import type { ComicPanel, ComicPoint } from './comicTypes';

const CUSTOM_TEMPLATES_STORAGE_KEY = 'nai_comic_custom_templates_v1';

export interface ComicCustomTemplate {
  id: string;
  label: string;
  createdAt: number;
  panels: Array<{
    name: string;
    points: ComicPoint[];
    rotation: number;
    zIndex: number;
    borderWidth: number;
    bleed?: boolean;
    inset?: boolean;
  }>;
}

export const loadCustomComicTemplates = (): ComicCustomTemplate[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const text = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
    if (!text) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item.id === 'string' && Array.isArray(item.panels) && item.panels.length > 0);
  } catch {
    return [];
  }
};

export const saveCustomComicTemplate = (
  label: string,
  panels: ComicPanel[],
): ComicCustomTemplate[] => {
  const existing = loadCustomComicTemplates();
  const next: ComicCustomTemplate = {
    id: `custom_${createUuid().slice(0, 8)}`,
    label: label.trim() || `自定义模板 ${existing.length + 1}`,
    createdAt: Date.now(),
    panels: panels.map(p => ({
      name: p.name,
      points: p.points.map(pt => ({ x: pt.x, y: pt.y })),
      rotation: p.rotation || 0,
      zIndex: p.zIndex || 1,
      borderWidth: p.borderWidth ?? 3,
      ...(p.bleed ? { bleed: true } : {}),
      ...(p.inset ? { inset: true } : {}),
    })),
  };
  const updated = [next, ...existing].slice(0, 30);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // 忽略配额限制
  }
  return updated;
};

export const deleteCustomComicTemplate = (templateId: string): ComicCustomTemplate[] => {
  const updated = loadCustomComicTemplates().filter(item => item.id !== templateId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // 忽略配额限制
  }
  return updated;
};

export const instantiateCustomTemplatePanels = (template: ComicCustomTemplate): ComicPanel[] =>
  template.panels.map((item, idx) => ({
    id: createUuid(),
    name: item.name || `第 ${idx + 1} 格`,
    points: item.points.map(pt => ({ x: pt.x, y: pt.y })),
    rotation: item.rotation || 0,
    zIndex: item.zIndex || idx + 1,
    borderColor: '#111827',
    borderWidth: item.borderWidth ?? 3,
    backgroundColor: '#f8fafc',
    ...(item.bleed ? { bleed: true } : {}),
    ...(item.inset ? { inset: true } : {}),
    prompt: '',
    negativePrompt: '',
    anchors: [],
    useCoords: true,
  }));
