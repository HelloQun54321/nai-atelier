// AITag 图片元数据的纯读取规则。
// 前端卡片筛选与 Worker 列表派生结论共用这一份实现，避免两端各写一套后逐渐漂移。
// 本文件不得依赖 DOM、Node 或前端服务，只能使用标准 JS。

export type AitagJsonValue = string | Record<string, any> | null | undefined;

export const AITAG_METADATA_MIN_BYTES = 30;

export const parseAitagJsonValue = (value: AitagJsonValue): Record<string, any> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** Comment 既可能是对象，也可能是被再次字符串化后的 JSON 文本。 */
const readCommentObject = (parsed: Record<string, any> | null) => {
  if (!parsed) return null;
  const comment = parsed.Comment ?? parsed.comment;
  if (!comment) return null;
  if (typeof comment === 'object') return comment as Record<string, any>;
  if (typeof comment === 'string' && comment.trim()) {
    try {
      const decoded = JSON.parse(comment);
      return decoded && typeof decoded === 'object' ? decoded : null;
    } catch {
      return null;
    }
  }
  return null;
};

const pickText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

export const hasAitagMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.some(hasAitagMeaningfulValue);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasAitagMeaningfulValue);
  return Boolean(value);
};

export const hasAitagMeaningfulKey = (value: unknown, patterns: RegExp[], depth = 0): boolean => {
  if (!value || depth > 5 || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (patterns.some(pattern => pattern.test(key)) && hasAitagMeaningfulValue(child)) return true;
    return hasAitagMeaningfulKey(child, patterns, depth + 1);
  });
};

const AITAG_INPAINT_PATTERNS = [/inpaint/i, /infill/i, /mask/i];
const AITAG_IMG2IMG_PATTERNS = [/img2img/i, /image2image/i, /init_?image/i, /initial_?image/i, /source_?image/i];
const AITAG_VIBE_PATTERNS = [/^vibe_?transfer$/i, /^reference_?image/i, /^reference_?strength/i, /^reference_?information_?extracted/i];
const AITAG_PRECISE_PATTERNS = [/character_?reference/i, /char_?ref/i, /^reference_?character/i, /director_?reference/i];

/** 首图正向提示词的基础部分（不含角色词），顺序与既有提取规则一致。 */
export const extractAitagPromptBase = (image: any): string => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  const comment = parsed?.Comment;
  if (comment && typeof comment === 'object') {
    const prompt = comment.v4_prompt?.caption?.base_caption || comment.prompt;
    if (typeof prompt === 'string' && prompt.trim()) return prompt;
  }
  const v4Prompt = parsed?.v4_prompt?.caption?.base_caption;
  if (typeof v4Prompt === 'string' && v4Prompt.trim()) return v4Prompt;
  if (typeof parsed?.prompt === 'string' && parsed.prompt.trim()) return parsed.prompt;
  if (typeof parsed?.Description === 'string' && parsed.Description.trim()) return parsed.Description;
  return typeof image?.prompt_text === 'string' ? image.prompt_text : '';
};

/** 首图正向提示词全文：基础词 + 角色词，去重后按逗号连接。 */
export const getAitagPositivePromptText = (image: any): string => {
  if (!image) return '';
  const parsed = parseAitagJsonValue(image.ai_json);
  const comment = readCommentObject(parsed);
  const parts = [extractAitagPromptBase(image)];
  for (const source of [comment?.v4_prompt, parsed?.v4_prompt]) {
    const characters = source?.caption?.char_captions;
    if (!Array.isArray(characters)) continue;
    for (const character of characters) {
      if (typeof character?.char_caption === 'string' && character.char_caption.trim()) parts.push(character.char_caption.trim());
    }
  }
  return Array.from(new Set(parts.map(part => part.trim()).filter(Boolean))).join(', ');
};

/** 生成方式判定：只看元数据里有没有对应键，与详情标签使用同一套规则。 */
export const getAitagGenerationFlags = (image: any) => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  const comment = readCommentObject(parsed);
  const parameters = parsed?.parameters;
  const sources = { image, parsed, comment, parameters };
  return {
    inpaint: hasAitagMeaningfulKey(sources, AITAG_INPAINT_PATTERNS),
    img2img: hasAitagMeaningfulKey(sources, AITAG_IMG2IMG_PATTERNS),
    vibe: hasAitagMeaningfulKey(sources, AITAG_VIBE_PATTERNS),
    precise: hasAitagMeaningfulKey(sources, AITAG_PRECISE_PATTERNS),
    hasPrompt: Boolean(parsed?.prompt || parsed?.v4_prompt || comment?.prompt || comment?.v4_prompt || image?.prompt_text),
  };
};

export const formatAitagMetadataJson = (image: any): string => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  if (parsed) return JSON.stringify(parsed, null, 2);
  return typeof image?.ai_json === 'string' ? image.ai_json : '';
};

/** 可用于导入/展示的元数据文本；不足最小字节数视为没有可用资料。 */
export const getAitagMetadataText = (image: any): string => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  const comment = parsed?.Comment ?? parsed?.comment;
  let text: string;
  if (comment && typeof comment === 'object') text = JSON.stringify(comment);
  else if (typeof comment === 'string' && comment.trim()) text = comment;
  else text = formatAitagMetadataJson(image);
  const trimmed = String(text || '').trim();
  return new TextEncoder().encode(trimmed).byteLength < AITAG_METADATA_MIN_BYTES ? '' : text;
};

export const pickAitagModelName = (image: any): string => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  const comment = readCommentObject(parsed);
  const parameters = parsed?.parameters;
  return pickText(
    image?.model,
    parsed?.model,
    parsed?.Model,
    parameters?.model,
    comment?.model,
    comment?.Model,
  );
};

export const getAitagImageDimensions = (image: any) => {
  const parsed = parseAitagJsonValue(image?.ai_json);
  const comment = readCommentObject(parsed);
  const parameters = parsed?.parameters;
  return {
    width: Number(comment?.width ?? parameters?.width ?? parsed?.width ?? 0) || 0,
    height: Number(comment?.height ?? parameters?.height ?? parsed?.height ?? 0) || 0,
  };
};

export interface AitagFirstImageMetaCore {
  model: string;
  promptText: string;
  width: number;
  height: number;
  hasVibe: boolean;
  hasPrecise: boolean;
  hasMetadata: boolean;
}

/** 列表下发用的派生结论：卡片筛选与展示所需的全部信息，不再携带整份 ai_json。 */
export const buildAitagFirstImageMeta = (image: any): AitagFirstImageMetaCore | null => {
  if (!image) return null;
  const flags = getAitagGenerationFlags(image);
  const { width, height } = getAitagImageDimensions(image);
  return {
    model: pickAitagModelName(image),
    promptText: getAitagPositivePromptText(image),
    width,
    height,
    hasVibe: flags.vibe,
    hasPrecise: flags.precise,
    hasMetadata: Boolean(getAitagMetadataText(image)),
  };
};
