import type { LocalGenItem, ImageEditMetadata } from '../types';
import type { ImageEditFocusedGeometry } from '../services/imageEdit';
import type { GenerationTasks } from './generationTasks.mjs';
import type { CloudQueueStatus } from '../services/cloudQueue';

export type GenerationJobState = 'waiting' | 'preparing' | 'generating' | 'saving' | 'paused' | 'awaiting_confirmation' | 'succeeded' | 'cancelled' | 'failed';
export interface GenerationJobDescriptor {
  payload: { model: string; action: 'generate' | 'img2img' | 'infill'; parameters: Record<string, unknown>; input?: string };
  history: Pick<LocalGenItem, 'prompt' | 'negativePrompt' | 'params'> & Partial<Pick<LocalGenItem, 'basePrompt' | 'subjectPrompt' | 'modules' | 'sourceChainId' | 'sourceChainName' | 'sourceChainType'>> & { edit?: ImageEditMetadata };
  composition?: { originalImage: string; compositeMask: string; focusedGeometry?: ImageEditFocusedGeometry };
  editMask?: string;
  randomSeed: boolean;
  stream: boolean;
  approvedCost: number;
  /** 完全访问的 Agent 本轮已授权生图费用，费用上涨无需再次确认。 */
  autoApproveCost?: boolean;
  /** 同一次授权内逐张执行不同配方；数量必须与请求张数一致，不允许嵌套。 */
  sequence?: GenerationJobDescriptor[];
}
export interface GenerationJobSnapshot {
  token: string; state: GenerationJobState; completedCount: number; requestedCount: number;
  historyIds: string[]; position?: number; lastSavedItem?: LocalGenItem;
  preview?: { image: string; step?: number }; previewVersion?: number; cost?: number; error?: string; code?: string;
  accountingFailed?: boolean; accountingError?: string; cleanupError?: string;
  cloudQueue?: CloudQueueStatus | null;
}
export interface GenerationJobOutput {
  seed?: number; estimatedCost?: number; accountingFailed?: boolean; accountingError?: string; cleanupError?: string; queueTaskId?: string;
}
export type GenerationJobHistoryMetadata = Omit<LocalGenItem, 'imageUrl'>;
export interface GenerationJob<Context> {
  key: string; token: string; count: number; placement?: 'end' | 'next'; descriptor: GenerationJobDescriptor;
  context: Context; state: GenerationJobState; historyIds: string[]; approvedCost: number; cancelled: boolean;
  running: Promise<void>; lastSavedItem?: LocalGenItem; lastQueueTaskId?: string;
  sequence?: GenerationJobDescriptor[];
}
export class GenerationJobs<Context = unknown, Output extends GenerationJobOutput = GenerationJobOutput> {
  constructor(options: {
    tasks: GenerationTasks;
    generate: (job: GenerationJob<Context>, payload: GenerationJobDescriptor['payload'], onPreview: (preview: { image: string; step?: number }) => void, onFinal: (output: Output) => void) => Promise<Output>;
    save: (job: GenerationJob<Context>, output: Output, history: GenerationJobHistoryMetadata) => Promise<LocalGenItem>;
    estimate: (job: GenerationJob<Context>, fresh: boolean) => Promise<number>;
    validate: (descriptor: GenerationJobDescriptor) => void;
    readCleanup: (job: GenerationJob<Context>) => string | undefined;
    readQueue?: (job: GenerationJob<Context>) => CloudQueueStatus | null | undefined;
    now?: () => number; sleep?: (milliseconds: number) => Promise<void>; terminalMs?: number; terminalLimit?: number;
  });
  jobs: Map<string, GenerationJob<Context>>;
  has(key: string, token: string): boolean;
  get(key: string, token: string): GenerationJob<Context>;
  snapshot(job: GenerationJob<Context>, previewVersion?: number | string | null, observed?: boolean): GenerationJobSnapshot;
  subscribe(job: GenerationJob<Context>, listener: (snapshot: GenerationJobSnapshot) => void): () => void;
  start(key: string, token: string, count: number, placement: 'end' | 'next' | undefined, descriptor: GenerationJobDescriptor, context: Context): GenerationJobSnapshot;
  cancel(key: string, token: string): GenerationJobSnapshot;
  approve(key: string, token: string, approvedCost: number): GenerationJobSnapshot;
  close(): void;
}
export function generationJobEventResponse<Context, Output extends GenerationJobOutput>(jobs: Pick<GenerationJobs<Context, Output>, 'snapshot' | 'subscribe'>, job: GenerationJob<Context>, previewVersion?: number | string | null, signal?: AbortSignal): Response;
