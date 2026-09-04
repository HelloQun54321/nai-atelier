import { useEffect, useState } from 'react';
import { DEFAULT_NAI_METADATA_MODEL_MAPPINGS } from './naiModels';

/**
 * NovelAI 运行时常量（模型清单、限额换算系数、免费档门槛、成本公式系数）。
 *
 * 这些规则官方没有查询接口，本地网关会定期从官方 Web 应用提取并缓存
 * （scripts/media-gateway.mjs 的 syncNaiRuntime），官方调整后无需改代码。
 * 此处默认值与网关 DEFAULT_NAI_RUNTIME 一致，作为网关不可用时的兜底。
 */
export interface NaiRuntimeHealth {
  ok: boolean;
  extracted?: string[];
  missed?: string[];
  reason?: string;
  error?: string;
  attemptedAt?: number;
}

export interface NaiPromptPreset {
  id: string;
  name: string;
  category?: string;
  prefix?: string;
  suffix?: string;
}

/** 官方 Web 应用按模型提供的图片生成能力与提示词预设。 */
export interface NaiModelRuntimeCapability {
  supportsVibes: boolean;
  supportsCharacterReferences: boolean;
  supportsCharacterReferenceInpainting: boolean;
  supportsStreamedResponses: boolean;
  supportsTransparentBackground: boolean;
  maxCharacters: number;
  freeformCharacterPosition: boolean;
  qualityPresets: NaiPromptPreset[];
  ucPresets: NaiPromptPreset[];
}

export interface NaiRuntimeConfig {
  /** Opus 限额剩余张数换算系数（剩余张数 ≈ 系数 × 百分比）。 */
  imagesPerPercent: number;
  costCoefficientArea: number;
  costCoefficientSteps: number;
  /** Opus 免费档门槛：面积与步数上限。 */
  freeMaxArea: number;
  freeMaxSteps: number;
  models: string[];
  usageLimitedModels: string[];
  /** 官方能力表中 streamedResponses=true 的模型。 */
  streamedModels: string[];
  /** NovelAI PNG Source 文本到 API 模型标识的官方精确映射。 */
  metadataModelMappings: Record<string, string>;
  /** 官方 Web 应用中的模型能力与质量/UC 预设。 */
  modelCapabilities: Record<string, NaiModelRuntimeCapability>;
  syncedAt?: number;
  health?: NaiRuntimeHealth;
}

const qualityPresets = (items: NaiPromptPreset[]): NaiPromptPreset[] => items.map(item => ({ ...item }));
const ucPresets = (items: NaiPromptPreset[]): NaiPromptPreset[] => items.map(item => ({ ...item }));

const QUALITY_V5 = qualityPresets([
  { id: 'standard', name: 'standard', suffix: 'very aesthetic, masterpiece, no text' },
  { id: 'light', name: 'light', suffix: 'very aesthetic, amazing quality, no text' },
  { id: 'none', name: 'none' },
]);
const QUALITY_V45_FULL = qualityPresets([
  { id: 'standard', name: 'standard', suffix: 'very aesthetic, masterpiece, no text' },
  { id: 'none', name: 'none' },
]);
const QUALITY_V45_CURATED = qualityPresets([
  { id: 'standard', name: 'standard', suffix: 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' },
  { id: 'none', name: 'none' },
]);
const QUALITY_V4_FULL = qualityPresets([
  { id: 'standard', name: 'standard', suffix: 'no text, best quality, very aesthetic, absurdres' },
  { id: 'none', name: 'none' },
]);
const QUALITY_V4_CURATED = qualityPresets([
  { id: 'standard', name: 'standard', suffix: 'rating:general, best quality, very aesthetic, absurdres' },
  { id: 'none', name: 'none' },
]);

const UC_V5 = ucPresets([
  { id: 'heavy', name: 'heavy', category: 'heavy', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
  { id: 'light', name: 'light', category: 'light', prefix: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::' },
  { id: 'furryFocus', name: 'furryFocus', category: 'furry', prefix: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
  { id: 'humanFocus', name: 'humanFocus', category: 'human', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
  { id: 'none', name: 'none', category: 'none' },
]);
const UC_V45_FULL = ucPresets([
  { id: 'heavy', name: 'heavy', category: 'heavy', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
  { id: 'light', name: 'light', category: 'light', prefix: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page' },
  { id: 'furryFocus', name: 'furryFocus', category: 'furry', prefix: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
  { id: 'humanFocus', name: 'humanFocus', category: 'human', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
  { id: 'none', name: 'none', category: 'none' },
]);
const UC_V45_CURATED = ucPresets([
  { id: 'heavy', name: 'heavy', category: 'heavy', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page' },
  { id: 'light', name: 'light', category: 'light', prefix: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page' },
  { id: 'humanFocus', name: 'humanFocus', category: 'human', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page' },
  { id: 'none', name: 'none', category: 'none' },
]);
const UC_V4_FULL = ucPresets([
  { id: 'heavy', name: 'heavy', category: 'heavy', prefix: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page' },
  { id: 'light', name: 'light', category: 'light', prefix: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page' },
  { id: 'none', name: 'none', category: 'none' },
]);
const UC_V4_CURATED = ucPresets([
  { id: 'heavy', name: 'heavy', category: 'heavy', prefix: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page' },
  { id: 'light', name: 'light', category: 'light', prefix: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page' },
  { id: 'none', name: 'none', category: 'none' },
]);

const makeCapability = (
  overrides: Partial<NaiModelRuntimeCapability> & Pick<NaiModelRuntimeCapability, 'qualityPresets' | 'ucPresets'>,
): NaiModelRuntimeCapability => ({
  supportsVibes: false,
  supportsCharacterReferences: false,
  supportsCharacterReferenceInpainting: false,
  supportsStreamedResponses: true,
  supportsTransparentBackground: false,
  maxCharacters: 6,
  freeformCharacterPosition: false,
  ...overrides,
});

const V5_CAPABILITY = makeCapability({
  maxCharacters: 32,
  freeformCharacterPosition: true,
  supportsTransparentBackground: true,
  qualityPresets: QUALITY_V5,
  ucPresets: UC_V5,
});
const V45_FULL_CAPABILITY = makeCapability({
  supportsVibes: true,
  supportsCharacterReferences: true,
  supportsCharacterReferenceInpainting: true,
  qualityPresets: QUALITY_V45_FULL,
  ucPresets: UC_V45_FULL,
});
const V45_CURATED_CAPABILITY = makeCapability({
  supportsVibes: true,
  supportsCharacterReferences: true,
  supportsCharacterReferenceInpainting: true,
  qualityPresets: QUALITY_V45_CURATED,
  ucPresets: UC_V45_CURATED,
});
const V4_FULL_CAPABILITY = makeCapability({ qualityPresets: QUALITY_V4_FULL, ucPresets: UC_V4_FULL, supportsVibes: true });
const V4_CURATED_CAPABILITY = makeCapability({ qualityPresets: QUALITY_V4_CURATED, ucPresets: UC_V4_CURATED, supportsVibes: true });

const pairCapability = (id: string, capability: NaiModelRuntimeCapability) => ({
  [id]: capability,
  [`${id}-inpainting`]: capability,
});

export const DEFAULT_NAI_MODEL_CAPABILITIES: Record<string, NaiModelRuntimeCapability> = {
  ...pairCapability('nai-diffusion-5-full', V5_CAPABILITY),
  ...pairCapability('nai-diffusion-5-curated', V5_CAPABILITY),
  ...pairCapability('nai-diffusion-4-5-full', V45_FULL_CAPABILITY),
  ...pairCapability('nai-diffusion-4-5-curated', V45_CURATED_CAPABILITY),
  ...pairCapability('nai-diffusion-4-full', V4_FULL_CAPABILITY),
  'nai-diffusion-4-curated-preview': V4_CURATED_CAPABILITY,
  'nai-diffusion-4-curated-inpainting': V4_CURATED_CAPABILITY,
};

export const DEFAULT_NAI_RUNTIME: NaiRuntimeConfig = {
  imagesPerPercent: 17.3,
  costCoefficientArea: 2.951823174884865e-6,
  costCoefficientSteps: 5.753298233447344e-7,
  freeMaxArea: 1_048_576,
  freeMaxSteps: 28,
  models: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting',
    'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-full-inpainting',
    'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-curated-inpainting',
    'nai-diffusion-4-full', 'nai-diffusion-4-full-inpainting',
    'nai-diffusion-4-curated-preview',
  ],
  usageLimitedModels: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting',
    'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
  ],
  streamedModels: [
    'nai-diffusion-5-full', 'nai-diffusion-5-full-inpainting', 'nai-diffusion-5-curated', 'nai-diffusion-5-curated-inpainting',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-full-inpainting', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-5-curated-inpainting',
    'nai-diffusion-4-full', 'nai-diffusion-4-full-inpainting', 'nai-diffusion-4-curated-preview',
  ],
  metadataModelMappings: { ...DEFAULT_NAI_METADATA_MODEL_MAPPINGS },
  modelCapabilities: DEFAULT_NAI_MODEL_CAPABILITIES,
};

let cachedConfig: NaiRuntimeConfig | null = null;
let pendingConfig: Promise<NaiRuntimeConfig> | null = null;

/** 超过该时长未成功同步即视为“常量可能过期”，生成前需向用户示警。 */
export const NAI_RUNTIME_STALE_MS = 48 * 60 * 60 * 1000;
export const NAI_RUNTIME_REFRESH_EVENT = 'nai-runtime-refresh';
const NAI_RUNTIME_REFRESH_INTERVAL = 60 * 1000;

/**
 * 模块级共享订阅驱动：多个 keep-alive 页面各自 useNaiRuntime 时只维护
 * 一个 interval 与一份事件监听（引用计数：首个订阅启动、末个卸载停止），
 * 并遵循 document.hidden：页面隐藏暂停轮询，恢复可见立即刷新一次再重启。
 */
type RuntimeSubscriber = { poll: () => void };
const runtimeSubscribers = new Set<RuntimeSubscriber>();
let runtimeDriverAttached = false;
let runtimePollTimer: number | null = null;

const runtimePollAll = () => {
  runtimeSubscribers.forEach(subscriber => subscriber.poll());
};

const onRuntimeVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    if (runtimePollTimer !== null) {
      window.clearInterval(runtimePollTimer);
      runtimePollTimer = null;
    }
  } else {
    runtimePollAll();
    startRuntimePollTimer();
  }
};

const startRuntimePollTimer = () => {
  if (runtimePollTimer !== null) return;
  runtimePollTimer = window.setInterval(runtimePollAll, NAI_RUNTIME_REFRESH_INTERVAL);
};

const startRuntimeDriver = () => {
  if (runtimeDriverAttached) return;
  runtimeDriverAttached = true;
  window.addEventListener(NAI_RUNTIME_REFRESH_EVENT, runtimePollAll);
  window.addEventListener('focus', runtimePollAll);
  document.addEventListener('visibilitychange', onRuntimeVisibilityChange);
  if (document.visibilityState === 'hidden') return;
  startRuntimePollTimer();
};

const stopRuntimeDriver = () => {
  if (!runtimeDriverAttached) return;
  runtimeDriverAttached = false;
  window.removeEventListener(NAI_RUNTIME_REFRESH_EVENT, runtimePollAll);
  window.removeEventListener('focus', runtimePollAll);
  document.removeEventListener('visibilitychange', onRuntimeVisibilityChange);
  if (runtimePollTimer !== null) {
    window.clearInterval(runtimePollTimer);
    runtimePollTimer = null;
  }
};

// 网关 /api/novelai-runtime 正常与降级响应都可能携带完整运行时；
// 响应体只要带健康记录就视为可信任的状态，替换当前缓存（含同步失效状态）。
const resolveRuntimePayload = (payload: unknown): NaiRuntimeConfig | null => {
  const next = payload as NaiRuntimeConfig | null;
  if (!next || !Array.isArray(next.models) || !next.models.length || !next.health) return null;
  const resolved: NaiRuntimeConfig = {
    ...DEFAULT_NAI_RUNTIME,
    ...next,
    modelCapabilities: next.modelCapabilities && typeof next.modelCapabilities === 'object'
      ? { ...DEFAULT_NAI_RUNTIME.modelCapabilities, ...next.modelCapabilities }
      : DEFAULT_NAI_RUNTIME.modelCapabilities,
  };
  return resolved;
};

const requestNaiRuntimeConfig = async (): Promise<NaiRuntimeConfig> => {
  try {
    const res = await fetch(`/api/novelai-runtime?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok || res.status === 502 || res.status === 504) {
      // 网关降级（502/504）时响应体仍可能是网关代理转发的完整 runtime 状态，
      // 合并它而不是把上一次结果冻结在缓存里，保证下一轮成功刷新能替换缓存。
      const resolved = resolveRuntimePayload(await res.json());
      if (resolved) {
        cachedConfig = resolved;
        return resolved;
      }
    }
  } catch {
    // 网关未启动或临时不可用时保留上一次结果。
  }
  return cachedConfig || DEFAULT_NAI_RUNTIME;
};

const loadNaiRuntimeConfig = () => {
  if (pendingConfig) return pendingConfig;
  const request = requestNaiRuntimeConfig();
  pendingConfig = request;
  request.then(() => {
    if (pendingConfig === request) pendingConfig = null;
  });
  return request;
};

export const getNaiRuntimeConfig = async (): Promise<NaiRuntimeConfig> => {
  if (cachedConfig) return cachedConfig;
  return loadNaiRuntimeConfig();
};

/** 强制重新读取网关状态，避免页面永久使用第一次请求的旧健康记录。 */
export const refreshNaiRuntimeConfig = () => loadNaiRuntimeConfig();

/** 判断同步是否处于需要生成前示警的失效状态（提取全灭或超过 48 小时未更新）。 */
export const isNaiRuntimeSyncUnhealthy = (config: NaiRuntimeConfig | null | undefined): boolean => {
  if (!config) return false;
  if (config.health?.reason === 'pending') return false;
  if (config.health?.ok === false) return true;
  const syncedAt = config.syncedAt ?? 0;
  return syncedAt > 0 && Date.now() - syncedAt > NAI_RUNTIME_STALE_MS;
};

export const describeNaiRuntimeSyncProblem = (config: NaiRuntimeConfig): string => {
  if (config.health?.reason === 'pending') return '官方常量同步进行中，稍后会自动重试';
  if (config.health?.reason === 'partial') {
    return `官方常量同步部分失效（未命中 ${config.health.missed?.join('、') || '未知项目'}）`;
  }
  if (config.health?.ok === false) {
    const reason = config.health.reason === 'fetch'
      ? '无法访问官方页面'
      : config.health.reason === 'page'
        ? '官方页面结构变化'
        : '官方常量提取全部失效';
    return `官方常量同步失效（${reason}${config.health.error ? `：${config.health.error}` : ''}）`;
  }
  const hours = Math.floor((Date.now() - (config.syncedAt ?? 0)) / 3_600_000);
  return `官方常量已 ${hours} 小时未成功同步`;
};

export const getNaiRuntimeModelCapability = (config: NaiRuntimeConfig, model?: string): NaiModelRuntimeCapability | undefined => {
  const id = String(model || '').trim();
  if (!id) return undefined;
  return config.modelCapabilities?.[id]
    || (id.endsWith('-inpainting') ? config.modelCapabilities?.[id.slice(0, -'-inpainting'.length)] : undefined);
};

/** 读取（必要时拉取一次）网关同步的运行时常量，供组件展示。 */
export const useNaiRuntime = () => {
  const [config, setConfig] = useState<NaiRuntimeConfig>(DEFAULT_NAI_RUNTIME);
  useEffect(() => {
    let active = true;
    // 订阅共享驱动：force 刷新由驱动发起（共享一份请求 + 广播），实例只接收结果
    const subscriber: RuntimeSubscriber = {
      poll: () => {
        void refreshNaiRuntimeConfig().then(next => {
          if (active) setConfig(next);
        });
      },
    };
    runtimeSubscribers.add(subscriber);
    startRuntimeDriver();
    // 实例挂载时先取一次缓存（未取过则触发一次拉取）
    void getNaiRuntimeConfig().then(next => {
      if (active) setConfig(next);
    });
    return () => {
      active = false;
      runtimeSubscribers.delete(subscriber);
      if (runtimeSubscribers.size === 0) stopRuntimeDriver();
    };
  }, []);
  return config;
};
