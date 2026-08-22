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

/**
 * NovelAI PNG 的 Source / model_name + model_hash 与 API model_version 的对应关系。
 * 精确哈希会由网关从官方 Web 应用同步；这里保留当前官方映射作为离线回退。
 */
export const DEFAULT_NAI_METADATA_MODEL_MAPPINGS: Record<string, string> = {
  'NovelAI Diffusion V5 657484A5': 'nai-diffusion-5-full',
  'NovelAI Diffusion V5 0ADF9AB7': 'nai-diffusion-5-full',
  'NovelAI Diffusion V4.5 4BDE2A90': 'nai-diffusion-4-5-full',
  'NovelAI Diffusion V4.5 1229B44F': 'nai-diffusion-4-5-full',
  'NovelAI Diffusion V4.5 B9F340FD': 'nai-diffusion-4-5-full',
  'NovelAI Diffusion V4.5 F3D95188': 'nai-diffusion-4-5-full',
  'NovelAI Diffusion V4.5 C02D4F98': 'nai-diffusion-4-5-curated',
  'NovelAI Diffusion V4.5 5AB81C7C': 'nai-diffusion-4-5-curated',
  'NovelAI Diffusion V4.5 B5A2A797': 'nai-diffusion-4-5-curated',
  'NovelAI Diffusion V4 5AB81C7C': 'nai-diffusion-4-5-curated',
  'NovelAI Diffusion V4 B5A2A797': 'nai-diffusion-4-5-curated',
  'NovelAI Diffusion V4 37442FCA': 'nai-diffusion-4-full',
  'NovelAI Diffusion V4 4F49EC75': 'nai-diffusion-4-full',
  'NovelAI Diffusion V4 CA4B7203': 'nai-diffusion-4-full',
  'NovelAI Diffusion V4 79F47848': 'nai-diffusion-4-full',
  'NovelAI Diffusion V4 F6302A9D': 'nai-diffusion-4-full',
  'NovelAI Diffusion V4 7ABFFA2A': 'nai-diffusion-4-curated-preview',
  'NovelAI Diffusion V4 C1CCBA86': 'nai-diffusion-4-curated-preview',
  'NovelAI Diffusion V4 770A9E12': 'nai-diffusion-4-curated-preview',
};

export interface NaiMetadataModelFields {
  model?: unknown;
  Source?: unknown;
  source?: unknown;
  model_name?: unknown;
  model_hash?: unknown;
}

/** 从 NovelAI 图片元数据识别 API 模型；未知哈希按官方各代默认分支回退。 */
export const resolveNaiMetadataModel = (
  metadata: NaiMetadataModelFields,
  runtimeMappings: Record<string, string> = {},
): string | undefined => {
  if (typeof metadata.model === 'string' && metadata.model.startsWith('nai-diffusion-')) {
    return metadata.model;
  }

  const source = typeof metadata.Source === 'string'
    ? metadata.Source.trim()
    : typeof metadata.source === 'string'
      ? metadata.source.trim()
      : '';
  const modelName = typeof metadata.model_name === 'string' ? metadata.model_name.trim() : '';
  const modelHash = typeof metadata.model_hash === 'string' ? metadata.model_hash.trim().toUpperCase() : '';
  const generatedSource = [modelName, modelHash].filter(Boolean).join(' ');
  const mappings = { ...DEFAULT_NAI_METADATA_MODEL_MAPPINGS, ...runtimeMappings };
  const exact = mappings[source] || mappings[generatedSource];
  if (exact) return exact;

  const family = `${source} ${modelName}`.toLowerCase();
  if (/novelai diffusion v5(?:\s|$)/.test(family)) return 'nai-diffusion-5-curated';
  if (/novelai diffusion v4\.5(?:\s|$)/.test(family)) return 'nai-diffusion-4-5-curated';
  if (/novelai diffusion v4(?:\s|$)/.test(family)) return 'nai-diffusion-4-curated-preview';
  return undefined;
};

/** 未知标识（例如导入的元数据）回退到默认模型信息，保证旧数据行为不变。 */
export const getNaiModelInfo = (model?: string): NaiModelInfo =>
  NAI_MODELS.find(item => item.id === model) || NAI_MODELS.find(item => item.id === DEFAULT_NAI_MODEL)!;

export const resolveNaiModelId = (model?: string): string => getNaiModelInfo(model).id;

/** 显示用标签：注册表已知模型返回注册表标签，未知标识（如导入的未来新模型）推导显示名。 */
export const getNaiModelDisplayLabel = (model?: string): string => {
  const known = NAI_MODELS.find(item => item.id === model);
  if (known) return known.label;
  if (model && model.trim()) return deriveModelLabel(model.trim());
  return NAI_MODELS.find(item => item.id === DEFAULT_NAI_MODEL)!.label;
};

/** 由模型标识推导显示名：nai-diffusion-4-5-curated-preview → 4.5 Curated Preview。 */
const deriveModelLabel = (id: string) => id
  .replace(/^nai-diffusion-/, '')
  .replace(/-inpainting$/, '')
  .replace(/^(\d+)-(\d+)-/, '$1.$2 ')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, char => char.toUpperCase());

/**
 * 选择器可用的模型列表：内置注册表优先，网关从官方 Web 应用同步到的新模型
 * （例如未来发布的 V6）自动追加到末尾，能力标志按保守值处理。
 */
export const getSelectableNaiModels = (runtime?: { models: string[]; usageLimitedModels: string[] }): NaiModelInfo[] => {
  if (!runtime?.models?.length) return NAI_MODELS;
  // 官方运行时 bundle 还会带出旧版短名、Furry/Anime 旧模型和 inpainting
  // 变体；它们不是本项目当前生图模型选择器应展示的独立选项。保留数字版本
  // 的 Full/Curated 形态，未来新增 V6 等模型时仍可自动进入列表。
  const selectableModelId = /^nai-diffusion-\d+(?:-\d+)?-(?:full|curated)(?:-preview)?$/;
  const extras = runtime.models
    .filter(id => selectableModelId.test(id) && !NAI_MODELS.some(model => model.id === id))
    .map(id => ({
      id,
      label: deriveModelLabel(id),
      opusUsageLimit: runtime.usageLimitedModels.includes(id),
      supportsVibes: false,
      supportsCharacterReferences: false,
    }));
  return [...NAI_MODELS, ...extras];
};
