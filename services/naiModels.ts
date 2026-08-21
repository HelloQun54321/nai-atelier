/**
 * NovelAI 生成模型注册表。
 *
 * 模型标识与能力均对照 2026-08-22 抓取的官方 Web 应用（novelai.net）模型注册表核对：
 * - V5 于 2026-08-21 发布，未引入 v5_prompt，继续使用 v4_prompt 结构与 params_version 3；
 * - V4 / V4.5 / V5 在官方成本计算中共用同一公式（见 services/anlasBudget.ts）；
 * - 官方无公开的“列出模型”接口，注册表同样打包在官方前端内，故此处内置同样清单。
 */
export interface NaiModelInfo {
  /** NovelAI API 的 model_version 标识。 */
  id: string;
  /** 中文界面显示名。 */
  label: string;
  /** 是否受 Opus 免费生成限额约束（官方仅对高于 V4.5 的模型启用限额）。 */
  opusUsageLimit: boolean;
  /**
   * 是否支持本项目的永久 Vibe Transfer 管线。本项目 Vibe 编码固定使用
   * V4.5 Full（网关校验），跨模型可用性未经官方确认，且官方公告 V5 暂未开放
   * Vibe Transfer，因此仅 V4.5 Full 开放。
   */
  supportsVibes: boolean;
  /** 是否支持 Precise/Character Reference（官方仅 V4.5 Full 支持）。 */
  supportsCharacterReferences: boolean;
}

export const NAI_MODELS: NaiModelInfo[] = [
  { id: 'nai-diffusion-5-full', label: 'V5 Full', opusUsageLimit: true, supportsVibes: false, supportsCharacterReferences: false },
  { id: 'nai-diffusion-5-curated', label: 'V5 Curated', opusUsageLimit: true, supportsVibes: false, supportsCharacterReferences: false },
  { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full', opusUsageLimit: false, supportsVibes: true, supportsCharacterReferences: true },
  { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated', opusUsageLimit: false, supportsVibes: false, supportsCharacterReferences: false },
  { id: 'nai-diffusion-4-full', label: 'V4 Full', opusUsageLimit: false, supportsVibes: false, supportsCharacterReferences: false },
  { id: 'nai-diffusion-4-curated-preview', label: 'V4 Curated', opusUsageLimit: false, supportsVibes: false, supportsCharacterReferences: false },
];

export const DEFAULT_NAI_MODEL = 'nai-diffusion-4-5-full';

/** 未知标识（例如导入的元数据）回退到默认模型信息，保证旧数据行为不变。 */
export const getNaiModelInfo = (model?: string): NaiModelInfo =>
  NAI_MODELS.find(item => item.id === model) || NAI_MODELS.find(item => item.id === DEFAULT_NAI_MODEL)!;

export const resolveNaiModelId = (model?: string): string => getNaiModelInfo(model).id;
