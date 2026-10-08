declare module 'mobile:gateway' {
  export const getNaiRuntime: any, applyNaiRuntimeOverride: any, computeNaiRuntimeSync: any, fetchNaiRuntimeText: any,
    sanitizeNovelAiSubscription: any, cacheNovelAiSubscription: any, CloudQueueCoordinator: any,
    normalizeCloudQueuePreferences: any, keyHashFromAuthorization: any, handleGenerateRequest: any,
    handleGenerateStreamRequest: any, handleVibeEncodeRequest: any, selectPreciseReferenceCanvas: any, recoverPendingVibeEncodings: any,
    sendJson: any, hasValidLanCookie: any;
}
declare module 'mobile:remote' { export const classifyAitagRemoteTarget: any, classifyDanbooruRemoteTarget: any, AITAG_BROWSER_HEADERS: any; }
declare module 'mobile:agent-sources' { const sources: Record<string, string>; export default sources; }
declare module 'mobile:agent-routes' { export const handleAgent: any; }
declare module 'mobile:pixiv-login' { export const PixivWebLoginOrchestrator: any; }
declare module 'mobile:dictionary-generator' { export const generate: any; }
