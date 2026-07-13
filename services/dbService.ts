
import { PromptChain, Artist, Inspiration, User, ChainType, UsageStats, SystemLogQuery, SystemLogResponse } from '../types';
import { api } from './api';

class DBService {
  // --- Auth ---
  async login(username: string, password: string): Promise<{ success: boolean, user: User }> {
    return await api.post('/auth/login', { username, password });
  }

  async guestLogin(passcode: string): Promise<{ success: boolean, user: User }> {
    return await api.post('/auth/guest-login', { passcode });
  }

  async logout(): Promise<void> {
    await api.post('/auth/logout', {});
  }

  async getMe(): Promise<User> {
    return await api.get('/auth/me');
  }

  async updatePassword(password: string): Promise<void> {
    await api.put('/users/password', { password });
  }

  // --- Global Settings (Config) ---
  async getBenchmarkConfig(): Promise<any> {
    const res = await api.get('/config/benchmarks');
    return res.config;
  }

  async saveBenchmarkConfig(config: any): Promise<void> {
    await api.put('/config/benchmarks', { config });
  }

  // --- Users (Admin) ---
  async createUser(username: string, password: string): Promise<void> {
    await api.post('/users', { username, password });
  }

  async getUsers(): Promise<User[]> {
    const res = await api.get('/users');
    // 兼容后端返回的分页格式 {data: [...], pagination: {...}}
    return Array.isArray(res) ? res : (res.data || []);
  }

  async deleteUser(id: string): Promise<void> {
    await api.delete(`/users/${id}`);
  }

  async updateUserQuota(userId: string, maxStorage: number): Promise<void> {
    await api.put(`/users/${userId}/quota`, { maxStorage });
  }

  async updateUserRole(userId: string, role: string, resetQuota = false): Promise<{ success: boolean; role: string; maxStorage: number }> {
    return await api.put(`/users/${userId}/role`, { role, resetQuota });
  }

  // --- Admin: Guest Settings & Import ---
  async getGuestCode(): Promise<string> {
    const res = await api.get('/admin/guest-setting');
    return res.passcode;
  }

  async updateGuestCode(passcode: string): Promise<void> {
    await api.put('/admin/guest-setting', { passcode });
  }

  async importArtistFromGithub(name: string, url: string): Promise<void> {
    await api.post('/admin/import-github', { name, url });
  }

  async logClientEvent(event: {
    category: string;
    action: string;
    status?: 'success' | 'error' | 'warning';
    resourceType?: string;
    resourceId?: string | number;
    message?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await api.post('/client-logs', event);
  }

  // --- Chains ---
  async getAllChains(): Promise<PromptChain[]> {
    return await api.get('/chains');
  }

  async createChain(name: string, description: string, copyFrom?: PromptChain, type: ChainType = 'style'): Promise<string> {
    const payload: any = { name, description, type };
    if (copyFrom) {
      payload.basePrompt = copyFrom.basePrompt;
      payload.negativePrompt = copyFrom.negativePrompt;
      payload.modules = copyFrom.modules;
      payload.params = copyFrom.params;
      payload.previewImage = copyFrom.previewImage;
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

  // --- Admin: Usage Statistics ---
  async getUsageStats(): Promise<UsageStats> {
    return await api.get('/admin/stats');
  }

  async getSystemLogs(query: SystemLogQuery = {}): Promise<SystemLogResponse> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    if (query.category) params.set('category', query.category);
    if (query.status) params.set('status', query.status);
    if (query.q) params.set('q', query.q);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return await api.get(`/admin/logs${suffix}`);
  }

  async clearOldLogs(): Promise<void> {
    await api.post('/admin/clear-logs', {});
  }
}

export const db = new DBService();
