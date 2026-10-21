/**
 * 提示词库 ↔ 生成图（图墙）的数据读取。
 *
 * 接口契约（后端已实现，前端不改形状）：
 *   GET /api/prompt-library-links/summary                → { items: [{ chainId, kind, name, count, lastAt }], linkedImages, entries }
 *   GET /api/prompt-library-links/images?chainId&limit&offset → { items: [{ ...历史条目, linkKind, linkChainName }], count, limit, offset }
 *
 * 关联来自提示词文本匹配推断，不是精确来源记录，界面文案保持中性（「生成记录」「N 图」）。
 * 读取失败一律抛可读 Error，交给调用方显示「读取失败，请重试」并允许重试。
 */
import type { LocalGenItem } from '../types';

/** 单条提示词条目的生成图计数。 */
export interface PromptLibraryUsageSummaryItem {
  chainId: string;
  kind: string;
  name: string;
  count: number;
  lastAt: number;
}

export interface PromptLibraryUsageSummary {
  items: PromptLibraryUsageSummaryItem[];
  /** 已建立关联的图片总数（按图片去重）。 */
  linkedImages: number;
  /** 有关联图片的提示词条目数。 */
  entries: number;
}

/** 历史条目本体沿用 mapLocalHistoryRow 的形状，只是额外带上匹配到的提示词信息。 */
export type PromptLibraryUsageImage = LocalGenItem & {
  linkKind?: string;
  linkChainName?: string;
};

export interface PromptLibraryUsageImagePage {
  items: PromptLibraryUsageImage[];
  /** 该链条目的图片总数，用于判断是否还能「加载更多」。 */
  count: number;
  limit: number;
  offset: number;
}

/** 详情区首屏数量；「加载更多」按同一页大小追加。 */
export const PROMPT_LIBRARY_USAGE_PAGE_SIZE = 12;
/** 紧凑预览态（卡片内嵌）只取一屏，不提供翻页。 */
export const PROMPT_LIBRARY_USAGE_PREVIEW_SIZE = 6;

const readJson = async <T,>(path: string, what: string): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(`读取${what}失败：无法连接本地服务，请确认工坊服务已启动后重试`);
  }
  if (!response.ok) {
    const detail = await response.clone().json().catch(() => null) as { error?: unknown; message?: unknown } | null;
    const text = String(detail?.error || detail?.message || '').trim();
    throw new Error(`读取${what}失败：${text || `服务返回 HTTP ${response.status}`}`);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`读取${what}失败：返回内容不是可解析的 JSON`);
  }
};

const toCount = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/** 汇总：chainId → 图片数。调用方据此渲染卡片右下角的「N 图」。 */
export const fetchPromptLibraryUsageSummary = async (): Promise<PromptLibraryUsageSummary> => {
  const payload = await readJson<{
    items?: unknown;
    linkedImages?: unknown;
    entries?: unknown;
  }>('/api/prompt-library-links/summary', '生成图汇总');
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(row => ({
      chainId: String(row.chainId || ''),
      kind: String(row.kind || ''),
      name: String(row.name || ''),
      count: toCount(row.count),
      lastAt: toCount(row.lastAt),
    }))
    .filter(row => row.chainId && row.count > 0);
  return {
    items,
    linkedImages: toCount(payload?.linkedImages),
    entries: toCount(payload?.entries),
  };
};

/** 某条提示词的生成图分页；空 chainId 直接返回空页，不发请求。 */
export const fetchPromptLibraryUsageImages = async (
  chainId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<PromptLibraryUsageImagePage> => {
  const id = String(chainId || '').trim();
  const limit = Math.min(Math.max(Math.floor(Number(options.limit) || PROMPT_LIBRARY_USAGE_PAGE_SIZE), 1), 60);
  const offset = Math.max(Math.floor(Number(options.offset) || 0), 0);
  if (!id) return { items: [], count: 0, limit, offset };
  const query = `chainId=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`;
  const payload = await readJson<{
    items?: unknown;
    count?: unknown;
    limit?: unknown;
    offset?: unknown;
  }>(`/api/prompt-library-links/images?${query}`, '生成图记录');
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(row => ({
      ...(row as unknown as LocalGenItem),
      id: String(row.id || ''),
      imageUrl: String(row.imageUrl || ''),
      linkKind: row.linkKind === undefined ? undefined : String(row.linkKind),
      linkChainName: row.linkChainName === undefined ? undefined : String(row.linkChainName),
    }))
    .filter(row => row.id && row.imageUrl);
  return {
    items,
    count: toCount(payload?.count),
    limit: toCount(payload?.limit) || limit,
    offset,
  };
};
