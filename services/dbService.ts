
import { PromptChain, Inspiration, InspirationBoard, User, ChainType } from '../types';
import { api } from './api';
import { normalizeChainTags } from './chainTags';
import { normalizeCollectionTagNames } from './inspirationUtils';
import { loadCollection, updateCollection, removeCollection, markCollectionUsed } from './collectionFavorites';
import { getMobileOriginalUrl } from './mobileImageCache';
import { blobToDataUrl } from './labWorkspace';

/**
 * blob: URL 只在创建它的页面会话内有效，落库后重启即失效。
 * 历史缺陷曾把会话级 blob: 封面直接写入数据库；读取与写入两侧统一拦截：
 * 读取时视为无封面，写入时直接丢弃，防止再次出现“保存成功但刷新后封面空白”。
 */
const isSessionOnlyUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith('blob:');

const sanitizeChain = <T extends PromptChain>(chain: T): T => ({
  ...chain,
  tags: normalizeChainTags(chain.tags),
  ...(isSessionOnlyUrl(chain.previewImage) ? { previewImage: undefined } : {}),
});

class DBService {
  // Personal-mode local owner metadata.
  async getMe(): Promise<User> {
    return await api.get('/auth/me');
  }

  // --- Chains ---
  async getAllChains(): Promise<PromptChain[]> {
    const chains: PromptChain[] = await api.get('/chains');
    return chains.map(sanitizeChain);
  }

  private async postChain(name: string, description: string, copyFrom?: Partial<PromptChain>, type: ChainType = 'style'): Promise<{ id: string; chain?: PromptChain }> {
    const payload: any = { name, description, type };
    if (copyFrom) {
      payload.basePrompt = copyFrom.basePrompt;
      payload.negativePrompt = copyFrom.negativePrompt;
      payload.modules = copyFrom.modules;
      payload.params = copyFrom.params;
      payload.previewImage = isSessionOnlyUrl(copyFrom.previewImage) ? undefined : copyFrom.previewImage;
      // Don't copy type if it's explicitly passed, otherwise assume same type
      if (!type && copyFrom.type) payload.type = copyFrom.type;

      // Copy variable values as well to preserve the subject
      payload.variableValues = copyFrom.variableValues;
      // Copy tags from the source chain
      payload.tags = normalizeChainTags(copyFrom.tags);
    } else {
      // Create Default Modules for new chain
      payload.modules = [];

      // Default Subject for NEW chains is '1girl'.
      // User can clear this in editor (it will save as "" string), avoiding forced reset.
      payload.variableValues = { subject: type === 'style' || type === 'character' ? '1girl' : '' };
      // Initialize with empty tags
      payload.tags = [];
    }
    if (typeof payload.previewImage === 'string' && /^(?:\/api\/assets\/aitag-(?:covers|images)\/|https:\/\/ai-img\.10118899\.xyz\/)/i.test(payload.previewImage)) {
      // 与详情原图使用同一 URL 和浏览器缓存，把已有原始字节交给本地保存，避免 Worker 再次向图床取图。
      try {
        const response = await fetch(getMobileOriginalUrl(payload.previewImage), { cache: 'force-cache', credentials: 'same-origin', signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const image = await response.blob();
        if (!/^image\/(?:png|jpeg|webp)$/i.test(image.type)) throw new Error('返回内容不是支持的图片');
        payload.previewImage = await blobToDataUrl(image);
      } catch (error) {
        throw new Error(`读取 AITag 封面失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return api.post('/chains', payload);
  }

  async createChain(name: string, description: string, copyFrom?: PromptChain, type: ChainType = 'style'): Promise<string> {
    return (await this.postChain(name, description, copyFrom, type)).id;
  }

  async createChainWithData(name: string, description: string, copyFrom?: Partial<PromptChain>, type: ChainType = 'style'): Promise<PromptChain> {
    const result = await this.postChain(name, description, copyFrom, type);
    // 兼容尚未重启的旧 Worker：只读新条目，仍不等待整份列表。
    const chain: PromptChain = result.chain || await api.get(`/chains/${encodeURIComponent(result.id)}`);
    return sanitizeChain(chain);
  }

  async updateChain(id: string, updates: Partial<PromptChain>): Promise<void> {
    if (isSessionOnlyUrl(updates.previewImage)) delete updates.previewImage;
    if (updates.tags !== undefined) updates = { ...updates, tags: normalizeChainTags(updates.tags) };
    await api.put(`/chains/${id}`, updates);
  }

  async deleteChain(id: string): Promise<void> {
    await api.delete(`/chains/${id}`);
  }

  // --- Inspirations ---
  async getCollectionTagNames(): Promise<string[]> {
    const result = await api.get('/collection-tags');
    if (!Array.isArray(result?.tags) || result.tags.some((tag: unknown) => typeof tag !== 'string')) throw new Error('标签目录响应无效');
    return normalizeCollectionTagNames(result.tags);
  }

  async saveCollectionTagNames(tags: string[]): Promise<string[]> {
    const result = await api.put('/collection-tags', { tags: normalizeCollectionTagNames(tags) });
    if (!Array.isArray(result?.tags) || result.tags.some((tag: unknown) => typeof tag !== 'string')) throw new Error('标签目录响应无效');
    return normalizeCollectionTagNames(result.tags);
  }

  async getAllInspirations(user?: User): Promise<Inspiration[]> {
    return user ? loadCollection(user) : api.get('/inspirations');
  }

  async getInspirationsBySource(sourceType: 'danbooru' | 'pixiv', sourceId: string): Promise<Inspiration[]> {
    return await api.get(`/inspirations?${new URLSearchParams({ sourceType, sourceId })}`);
  }

  async getInspirationBoards(): Promise<InspirationBoard[]> {
    const result = await api.get('/inspiration-boards');
    return result.items || [];
  }

  async createInspirationBoard(board: InspirationBoard): Promise<InspirationBoard> {
    const result = await api.post('/inspiration-boards', board);
    return result.item;
  }

  async updateInspirationBoard(id: string, updates: Partial<InspirationBoard>): Promise<void> {
    await api.put(`/inspiration-boards/${encodeURIComponent(id)}`, updates);
  }

  async deleteInspirationBoard(id: string): Promise<void> {
    await api.delete(`/inspiration-boards/${encodeURIComponent(id)}`);
  }

  async saveInspiration(inspiration: Inspiration): Promise<void> {
    await api.post('/inspirations', inspiration);
  }

  async updateInspiration(id: string, updates: Partial<Inspiration>): Promise<void> {
    await updateCollection([id], updates);
  }

  async deleteInspiration(id: string): Promise<void> {
    await removeCollection([id]);
  }

  async bulkDeleteInspirations(ids: string[]): Promise<void> {
    await removeCollection(ids);
  }

  async bulkUpdateInspirations(ids: string[], updates: Partial<Inspiration>): Promise<void> {
    await updateCollection(ids, updates);
  }

  async markInspirationUsed(id: string): Promise<void> {
    await markCollectionUsed(id);
  }

}

export const db = new DBService();
