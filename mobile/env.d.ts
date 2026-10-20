declare module 'mobile:gateway' {
  /** 公共队列任务记录：网关按 Key 指纹 + taskId 组合隔离，同一 taskId 跨 Key 互不覆盖。 */
  export interface CloudQueueTaskRecord {
    taskId: string;
    keyHash: string;
    phase: import('../services/cloudQueue').CloudQueueStatus['phase'];
    position?: number | null;
    queueSize?: number | null;
    greeting?: string | null;
    error?: string;
    cleanupError?: string;
    cancelable?: boolean;
    proxy?: boolean;
    controller?: AbortController | null;
  }
  export class CloudQueueCoordinator {
    constructor(requestRemote: (url: string, options?: RequestInit) => Promise<Response>, baseUrl?: string, options?: Record<string, unknown>);
    claim(keyHash: string, taskId: string, patch?: Partial<CloudQueueTaskRecord>): CloudQueueTaskRecord;
    update(keyHash: string, taskId: string, patch: Partial<CloudQueueTaskRecord>): CloudQueueTaskRecord;
    get(keyHash: string, taskId: string): CloudQueueTaskRecord | null;
  }
  export const getNaiRuntime: any, applyNaiRuntimeOverride: any, computeNaiRuntimeSync: any, fetchNaiRuntimeText: any,
    sanitizeNovelAiSubscription: any, cacheNovelAiSubscription: any,
    normalizeCloudQueuePreferences: any, keyHashFromAuthorization: any, handleGenerateRequest: any,
    handleGenerateStreamRequest: any, handleGenerationTaskRequest: any, handleVibeEncodeRequest: any, selectPreciseReferenceCanvas: any, recoverPendingVibeEncodings: any,
    sendJson: any, hasValidLanCookie: any;
  export const extractNaiRuntimeChunkPaths: (html: string) => string[];
  /** 订阅原始响应只在后台任务核实额度时使用；结果仍需 sanitize 后缓存。 */
  export const fetchNovelAiSubscription: (authorization: string, signal?: AbortSignal) => Promise<Response>;
  /** 与电脑网关同一份计费函数：payload、额度是否透支、是否活跃 Opus。 */
  export const estimateNovelAiGenerationCost: (payload: unknown, opusUsageExhausted?: boolean, opusSubscriber?: boolean) => number;
  export const isSubscriptionUnsupported: (gatewayUrl: string, status: number | string) => boolean;
}
/** 手机后台任务的成图解析与历史表单：与电脑共用同一份纯实现，不含 Node 图像库。 */
declare module 'mobile:generation-output' {
  export const generationImageBytes: (value: unknown) => { bytes: Uint8Array; mime: string };
  export const readGenerationResponse: (response: Response, onPreview?: (preview: { image: string; step?: number }) => void) =>
    Promise<{ bytes: Uint8Array; mime: string; seed?: number; estimatedCost?: number; accountingFailed?: boolean; cleanupError?: string }>;
  export const generationHistoryForm: (output: { bytes: Uint8Array; mime?: string }, metadata: import('../worker/generationJobs.mjs').GenerationJobHistoryMetadata, editMask?: string) => FormData;
}
declare module 'mobile:remote' { export const classifyAitagRemoteTarget: any, classifyDanbooruRemoteTarget: any, AITAG_BROWSER_HEADERS: any; }
declare module 'mobile:agent-sources' { const sources: Record<string, string>; export default sources; }
declare module 'mobile:agent-routes' { export const handleAgent: any; }
declare module 'mobile:pixiv-login' { export const PixivWebLoginOrchestrator: any; }
declare module 'mobile:dictionary-generator' { export const generate: any; }
