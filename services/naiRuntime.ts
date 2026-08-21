import { useEffect, useState } from 'react';

/**
 * NovelAI 运行时常量（模型清单、限额换算系数、免费档门槛、成本公式系数）。
 *
 * 这些规则官方没有查询接口，本地网关会定期从官方 Web 应用提取并缓存
 * （scripts/media-gateway.mjs 的 syncNaiRuntime），官方调整后无需改代码。
 * 此处默认值与网关 DEFAULT_NAI_RUNTIME 一致，作为网关不可用时的兜底。
 */
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
  syncedAt?: number;
}

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
};

let cachedConfig: NaiRuntimeConfig | null = null;
let pendingConfig: Promise<NaiRuntimeConfig> | null = null;

export const getNaiRuntimeConfig = async (): Promise<NaiRuntimeConfig> => {
  if (cachedConfig) return cachedConfig;
  if (!pendingConfig) {
    pendingConfig = (async () => {
      try {
        const res = await fetch('/api/novelai-runtime');
        if (res.ok) {
          const next = await res.json();
          if (next && Array.isArray(next.models) && next.models.length) {
            const resolved: NaiRuntimeConfig = { ...DEFAULT_NAI_RUNTIME, ...next };
            cachedConfig = resolved;
            return resolved;
          }
        }
      } catch {
        // 网关未启动或临时不可用时使用内置默认值。
      }
      cachedConfig = DEFAULT_NAI_RUNTIME;
      return DEFAULT_NAI_RUNTIME;
    })();
  }
  return pendingConfig;
};

/** 读取（必要时拉取一次）网关同步的运行时常量，供组件展示。 */
export const useNaiRuntime = () => {
  const [config, setConfig] = useState<NaiRuntimeConfig>(DEFAULT_NAI_RUNTIME);
  useEffect(() => {
    let active = true;
    void getNaiRuntimeConfig().then(next => {
      if (active) setConfig(next);
    });
    return () => { active = false; };
  }, []);
  return config;
};
