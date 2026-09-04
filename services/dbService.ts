
import { PromptChain, Artist, Inspiration, InspirationBoard, User, ChainType } from '../types';
import { api } from './api';

/**
 * blob: URL 只在创建它的页面会话内有效，落库后重启即失效。
 * 历史缺陷曾把会话级 blob: 封面直接写入数据库；读取与写入两侧统一拦截：
 * 读取时视为无封面，写入时直接丢弃，防止再次出现“保存成功但刷新后封面空白”。
 */
const isSessionOnlyUrl = (url: unknown): url is string => typeof url === 'string' && url.startsWith('blob:');

const sanitizeChain = <T extends PromptChain>(chain: T): T =>
  isSessionOnlyUrl(chain.previewImage) ? { ...chain, previewImage: undefined } : chain;

class DBService {
  // Personal-mode local owner metadata.
  async getMe(): Promise<User> {
    return await api.get('/auth/me');
  }

  // --- Global Settings (Config) ---
  async getBenchmarkConfig(): Promise<any> {
    const res = await api.get('/config/benchmarks');
    return res.config;
  }

  async saveBenchmarkConfig(config: any): Promise<void> {
    await api.put('/config/benchmarks', { config });
  }


  // --- Chains ---
  async getAllChains(): Promise<PromptChain[]> {
    const chains: PromptChain[] = await api.get('/chains');
    return chains.map(sanitizeChain);
  }

  async createChain(name: string, description: string, copyFrom?: PromptChain, type: ChainType = 'style'): Promise<string> {
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
      payload.tags = copyFrom.tags || [];
    } else {
      // Create Default Modules for new chain
      payload.modules = [];

      // Default Subject for NEW chains is '1girl'.
      // User can clear this in editor (it will save as "" string), avoiding forced reset.
      payload.variableValues = { subject: '1girl' };
      // Initialize with empty tags
      payload.tags = [];
    }
    const res = await api.post('/chains', payload);
    return res.id;
  }

  async updateChain(id: string, updates: Partial<PromptChain>): Promise<void> {
    if (isSessionOnlyUrl(updates.previewImage)) delete updates.previewImage;
    await api.put(`/chains/${id}`, updates);
  }

  async deleteChain(id: string): Promise<void> {
    await api.delete(`/chains/${id}`);
  }

  // --- Artists ---
  async getAllArtists(): Promise<Artist[]> {
    return await api.get('/artists');
  }

  async saveArtist(artist: Artist): Promise<void> {
    await api.post('/artists', artist);
  }

  async deleteArtist(id: string): Promise<void> {
    await api.delete(`/artists/${id}`);
  }

  // --- Inspirations ---
  async getAllInspirations(): Promise<Inspiration[]> {
    return await api.get('/inspirations');
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
    await api.put(`/inspirations/${id}`, updates);
  }

  async deleteInspiration(id: string): Promise<void> {
    await api.delete(`/inspirations/${id}`);
  }

  async bulkDeleteInspirations(ids: string[]): Promise<void> {
    await api.post('/inspirations/bulk-delete', { ids });
  }

  async bulkUpdateInspirations(ids: string[], updates: Partial<Inspiration>): Promise<void> {
    await api.post('/inspirations/bulk-update', { ids, updates });
  }

  async markInspirationUsed(id: string): Promise<void> {
    await api.post(`/inspirations/${encodeURIComponent(id)}/use`, {});
  }

}

export const db = new DBService();
