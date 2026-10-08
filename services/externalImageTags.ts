import type { Inspiration } from '../types';
import type { ImageTaggerResult } from './imageTaggerService';

export interface ExternalImageTags {
  result: ImageTaggerResult;
  prompt: string;
  createdAt: number;
}

/** 局域网 HTTP 可能没有 Clipboard API，保留主动点击复制的浏览器回退。 */
export const copyTagText = async (text: string) => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = text; input.readOnly = true;
  input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.appendChild(input); input.select();
  try { if (!document.execCommand('copy')) throw new Error('复制失败'); }
  finally { input.remove(); previous?.focus({ preventScroll: true }); }
};

/** 来源标注和模型预测分别保存在既有灵感分析字段，无需迁移私人资料。 */
export const externalImageAnalysis = (sourceTags: string[], page: number, reverse?: ExternalImageTags, previous?: Inspiration) => ({
  ...previous?.analysis,
  externalSourceTags: sourceTags,
  externalSourcePage: page,
  ...(reverse ? { imageTagger: reverse } : {}),
});

export const readExternalImageTags = (inspiration?: Inspiration): ExternalImageTags | undefined => {
  const saved = inspiration?.analysis?.imageTagger as ExternalImageTags | undefined;
  if (!saved || typeof saved.prompt !== 'string' || !Number.isFinite(saved.createdAt)
    || !saved.result || !Array.isArray(saved.result.tags)
    || !saved.result.tags.every(tag => typeof tag.name === 'string' && typeof tag.confidence === 'number')
    || !Array.isArray(saved.result.character) || !Array.isArray(saved.result.general)) return undefined;
  return saved;
};

// 未保存结果只保留在当前浏览会话；长期资产由用户明确保存到收藏库。
const drafts = new Map<string, ExternalImageTags>();
export const externalImageDrafts = {
  get: (key: string) => drafts.get(key),
  set: (key: string, draft: ExternalImageTags) => {
    drafts.delete(key); drafts.set(key, draft);
    if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
  },
};
