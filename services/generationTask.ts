import { parseErrorResponse, notifyLanAccessRequired } from './api';
import type { GenerationQueueSnapshot } from '../worker/generationTasks.mjs';

export type GenerationPlacement = 'end' | 'next';
export type { GenerationQueueSnapshot };

// 后台任务的领取与保活由 Node 执行器持有；浏览器只读取同 Key 队列状态与调整节奏。
const request = async (key: string, method: string, headers: Record<string, string> = {}): Promise<Partial<GenerationQueueSnapshot>> => {
  const response = await fetch('/api/generation-task', {
    method, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${key}`, ...headers },
  });
  notifyLanAccessRequired(response);
  if (!response.ok) throw await parseErrorResponse(response);
  return response.json();
};

export const getGenerationQueue = async (key: string) => await request(key, 'GET') as GenerationQueueSnapshot;
export const cancelGenerationQueue = async (key: string) => await request(key, 'DELETE', { 'X-Nai-Generation-Cancel-All': '1' }) as Partial<GenerationQueueSnapshot> & { cancelled?: number };
export const setGenerationQueuePaused = async (key: string, paused: boolean) => await request(key, 'PATCH', { 'X-Nai-Generation-Action': paused ? 'pause' : 'resume' }) as GenerationQueueSnapshot;
export const setGenerationInterval = async (key: string, seconds: number) => await request(key, 'PATCH', { 'X-Nai-Generation-Action': 'interval', 'X-Nai-Generation-Interval': String(seconds) }) as GenerationQueueSnapshot;
