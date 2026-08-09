
// Core Data Models

export type UserRole = 'admin' | 'vip' | 'user' | 'guest';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  lastLogin?: number; // 最后登录时间
  storageUsage?: number; // Bytes used
  maxStorage?: number; // 最大存储配额（字节）
}

export interface PromptModule {
  id: string;
  name: string;
  content: string;
  isActive: boolean; // For testing toggle
  position?: 'pre' | 'post'; // New: Order control
  group?: string; // New: Group for mutual exclusion (N choose 1)
}

export interface CharacterParams {
  id: string;
  prompt: string;
  negativePrompt?: string; // New: Per-character negative prompt
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

export interface VibeEncodingVariant {
  id: string;
  /** Unknown imported model identifiers are retained for future compatibility. */
  model: 'nai-diffusion-4-5-full' | (string & {});
  modelKey: 'v4-5full' | (string & {});
  informationExtracted: number;
  encodingHash: string;
  createdAt: number;
}

export interface VibeSelection {
  vibeId: string;
  vibeName?: string;
  encodingId: string;
  informationExtracted: number;
  strength: number;
  effectiveStrength?: number;
}

export interface VibeAsset {
  id: string;
  name: string;
  sourceHash: string;
  originalImageUrl?: string;
  thumbnailUrl?: string;
  hasOriginal: boolean;
  defaultStrength: number;
  encodings: VibeEncodingVariant[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VibeGroup {
  id: string;
  name: string;
  slots: VibeSelection[];
  normalizeStrengths: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A reusable source image for NovelAI Precise/Character Reference. */
export interface CharacterReferenceAsset {
  id: string;
  name: string;
  sourceHash: string;
  originalImageUrl: string;
  thumbnailUrl: string;
  defaultStrength: number;
  defaultFidelity: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterReferenceSelection {
  assetId: string;
  assetName?: string;
  type: 'character' | 'style' | 'character_style';
  strength: number;
  fidelity: number;
  informationExtracted?: number;
}

export interface NAIParams {
  width: number;
  height: number;
  steps: number;
  scale: number; // CFG Scale
  sampler: string;
  seed?: number;
  // V4.5 Specifics
  qualityToggle?: boolean; // Default true
  ucPreset?: number; // 0: Heavy, 1: Light, 2: Furry, 3: Human, 4: None
  characters?: CharacterParams[]; // Multi-character support

  // New Features
  useCoords?: boolean; // true = Manual Coords, false = AI's Choice
  variety?: boolean; // Variety+ (controlled via skip_cfg_above_sigma)
  cfgRescale?: number; // Prompt Guidance Rescale (0.0 - 1.0)
  vibes?: {
    enabled: boolean;
    sourceGroupId?: string;
    sourceGroupName?: string;
    normalizeStrengths: boolean;
    slots: VibeSelection[];
  };
  characterReferences?: {
    enabled: boolean;
    slots: CharacterReferenceSelection[];
  };
}

export interface PromptAgentDraft {
  basePrompt: string;
  subjectPrompt: string;
  negativePrompt: string;
  modules: PromptModule[];
  params: NAIParams;
}

export type PromptAgentAction =
  | { kind: 'update_prompts'; patch: Partial<Pick<PromptAgentDraft, 'basePrompt' | 'subjectPrompt' | 'negativePrompt'>> }
  | { kind: 'set_modules'; patch: { modules: PromptModule[] } }
  | { kind: 'set_characters'; patch: { characters: CharacterParams[] } }
  | { kind: 'set_character_references'; patch: { characterReferences: NAIParams['characterReferences']; vibes?: NAIParams['vibes'] } }
  | { kind: 'set_params'; patch: { params: NAIParams } }
  | { kind: 'set_vibes'; patch: { vibes: NAIParams['vibes'] } }
  | { kind: 'request_generation'; patch: { reason?: string; requestId?: string } }
  | { kind: 'set_client_preferences'; patch: { themeMode?: 'light' | 'dark' | 'system'; safeMode?: boolean; imageLayout?: 'masonry' | 'portrait' | 'square'; imageColumns?: 'auto' | 1 | 2 | 3; mobileCacheLimit?: 0 | 25 | 50 | 100 } }
  | { kind: 'manage_artist_favorite'; patch: { name: string; favorite: boolean } }
  | { kind: 'navigate_view'; patch: { view: 'list' | 'characters' | 'library' | 'aitag' | 'inspiration' | 'history' | 'playground'; id?: string } }
  | { kind: 'request_project_action'; patch: { action: string; resourceId?: string; title: string; consequence: string; payload?: Record<string, unknown>; requestId?: string } };

export type ChainType = 'style' | 'character';

// Flattened Chain Structure (No more separate versions table)
export interface PromptChain {
  id: string;
  userId: string; // Owner
  username?: string; // Owner display name
  type: ChainType; // New: Distinguish between Style (Artist) and Character chains
  name: string;
  description: string;
  tags: string[];
  previewImage?: string; // Base64 or URL

  // Prompt Data (Formerly in Version)
  basePrompt: string;
  negativePrompt: string;
  modules: PromptModule[];
  params: NAIParams;

  // New: Persist variable inputs (Now used for the single Subject/Variable prompt)
  variableValues?: Record<string, string>;

  guestHidden?: boolean; // 游客不可见标记，默认 false

  createdAt: number;
  updatedAt: number;
}

// Artist Library Types
export interface Artist {
  id: string;
  name: string;
  imageUrl: string; // Original (Danbooru) image
  previewUrl?: string; // Legacy: Single benchmark
  benchmarks?: string[]; // New: Array of 3 benchmark images [Face, Body, Scene]
  chineseName?: string; // Local bilingual tag catalog label
  postCount?: number; // Danbooru usage count for catalog ranking
  catalogOnly?: boolean; // Not persisted until a local preview is generated
}

// Inspiration Gallery Types
export type InspirationSourceType = 'history' | 'aitag' | 'upload' | 'agent' | 'other';

export interface InspirationBoard {
  id: string;
  userId: string;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Inspiration {
  id: string;
  userId: string; // Owner
  username?: string;
  title: string;
  imageUrl: string; // Base64 Data URI
  prompt: string;
  negativePrompt?: string;
  params?: NAIParams; // 完整生成参数（含 characters），可选字段兼容旧数据
  boardId?: string;
  notes?: string;
  tags?: string[];
  sourceType?: InspirationSourceType;
  sourceId?: string;
  sourceUrl?: string;
  rating?: number;
  isPinned?: boolean;
  archived?: boolean;
  lastUsedAt?: number;
  useCount?: number;
  parentId?: string;
  analysis?: Record<string, unknown>;
  createdAt: number;
  updatedAt?: number;
}

// Local Generation History Item
export interface LocalGenItem {
  id: string;
  imageUrl: string; // Base64
  isFavorite?: boolean;
  favoriteAt?: number;
  prompt: string;
  negativePrompt?: string;
  params: NAIParams;
  /** Generation-time prompt structure, used to restore a history image without mixing style and subject text. */
  basePrompt?: string;
  subjectPrompt?: string;
  modules?: PromptModule[];
  sourceChainId?: string;
  sourceChainName?: string;
  sourceChainType?: ChainType | 'playground';
  createdAt: number;
}

// --- 使用统计相关类型 ---

// 访问日志
export interface AccessLog {
  id: number;
  userId: string;
  username: string;
  role: string;
  ip: string;
  userAgent: string;
  action: string;
  category?: string;
  status?: 'success' | 'error' | 'warning' | string;
  method?: string;
  path?: string;
  resourceType?: string;
  resourceId?: string;
  message?: string;
  metadata?: Record<string, any> | string | null;
  durationMs?: number;
  createdAt: number;
}

export interface SystemLogQuery {
  page?: number;
  pageSize?: number;
  category?: string;
  status?: string;
  q?: string;
}

export interface SystemLogResponse {
  data: AccessLog[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// 每日统计
export interface DailyStat {
  date: string;
  totalRequests: number;
  apiRequests: number;
  guestLogins: number;
  userLogins: number;
  generateRequests: number;
}

// 存储统计
export interface StorageStats {
  totalUserStorage: number;
  userCount: number;
  chainsCount: number;
  inspirationsCount: number;
  artistsCount: number;
}

// 完整统计响应
export interface UsageStats {
  dailyStats: DailyStat[];
  recentLogs: AccessLog[];
  storage: StorageStats;
}

// Global Env Type for Cloudflare/Runtime injection
declare global {
  interface Window {
    ENV?: {
      MASTER_KEY?: string; // Legacy, kept for typing compatibility if needed
    };
  }
}
