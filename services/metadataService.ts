
/**
 * NAI 图片元数据提取与解析服务
 *
 * 职责：
 * 1. 从 PNG 文本块或 NovelAI Stealth PNG 中读取原始元数据字符串
 * 2. 将原始字符串解析为结构化的 { prompt, negativePrompt, params } 对象
 *
 * 解析逻辑严格参照 NOVELAI_API_DOCS.md 与 promptUtils.ts 中的常量定义
 */

import { NAIParams, CharacterParams, ImageEditMetadata } from '../types';
import { NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';
import { createUuid } from './id';
import { joinNaiTextPrompt, resolveTransparentWeight, splitNaiTextPrompt } from './transparentBackground.mjs';
import { resolveNaiMetadataModel } from './naiModels';
import { extractPngMetadata } from './pngMetadata.mjs';
export { extractNovelAiMetadataFromPng, extractNovelAiStealthMetadataFromRgba } from './pngMetadata.mjs';

// ========== 类型定义 ==========

/** 用于跨组件传递待导入数据的 SessionStorage Key */
export const IMPORT_SESSION_KEY = 'nai_pending_import';

/** 安全的 ID 生成器回退 */
const safeUUID = createUuid;

/** parseNovelAIMetadata 返回的结构化解析结果 */
export interface ParsedNAIData {
    /** 正面提示词（已剥离 Quality Tags 后缀） */
    prompt: string;
    /** 负面提示词（已剥离 UC Preset 前缀） */
    negativePrompt: string;
    /** 完整的生成参数（不含 Boilerplate 固定参数） */
    params: NAIParams;
}

export type ImportMode = 'replace' | 'prompt-only' | 'negative-only' | 'params-only' | 'append-prompt' | 'image-edit';

export interface PendingImportData extends ParsedNAIData {
    mode?: ImportMode;
    /** 历史／灵感明确指定文生图；其他参数导入仍沿用当前模式。 */
    targetMode?: 'text-to-image';
    basePrompt?: string;
    subjectPrompt?: string;
    modules?: import('../types').PromptModule[];
  sourceInspirationId?: string;
  baseImageUrl?: string;
  parentHistoryId?: string;
  imageEditOperation?: import('../types').ImageEditOperation;
  editMetadata?: ImageEditMetadata;
  reuseEditMask?: boolean;
}

// ========== 常量 / 预编译正则 ==========
const COMPILED_REGEX = {
    Steps: /Steps:\s*([^,]+)/,
    Sampler: /Sampler:\s*([^,]+)/,
    'CFG scale': /CFG scale:\s*([^,]+)/,
    Seed: /Seed:\s*([^,]+)/,
    Size: /Size:\s*([^,]+)/
};

// ========== 文件级元数据提取 ==========

/**
 * 从 PNG 文件中提取元数据原始字符串
 * 优先读取标准文本块，未命中时回退到 NovelAI Alpha Stealth 元数据
 */
export const extractMetadata = async (file: File): Promise<string | null> => {
    if (file.type && file.type !== 'image/png') {
        return null;
    }

    try {
        const arrayBuffer = typeof file.arrayBuffer === 'function'
            ? await file.arrayBuffer()
            : await new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(file);
            });
        return await extractPngMetadata(new Uint8Array(arrayBuffer));
    } catch (e) {
        return null;
    }
};

// ========== 核心解析纯函数 ==========

/**
 * 从 JSON 文本中提取元数据原始字符串（ChainEditor 导入用）。
 * 优先级：Comment 为对象 → 序列化返回；Comment 为字符串 → 直接返回；
 * 本身就是生成参数 JSON（prompt/steps/v4_prompt/uc）→ 整体返回；
 * Description 字段 → 返回；都不是 → 原样返回（可能本身是纯文本元数据）。
 */
export const extractRawMetadataFromJsonText = (jsonText: string): string => {
    try {
        const json = JSON.parse(jsonText);
        const comment = json.Comment ?? json.comment;

        if (comment && typeof comment === 'object') {
            return JSON.stringify(comment);
        }

        if (typeof comment === 'string' && comment.trim()) {
            return comment;
        }

        if (json.prompt || json.steps || json.v4_prompt || json.uc) {
            return JSON.stringify(json);
        }

        if (typeof json.Description === 'string' && json.Description.trim()) {
            return json.Description;
        }
    } catch {
        // 非 JSON：原样返回，交给后续的纯文本元数据解析
    }

    return jsonText;
};

/**
 * 将 NovelAI 元数据原始字符串解析为结构化对象
 *
 * 支持两种输入格式：
 * - JSON 格式（V3/V4/V4.5 现代格式）
 * - Legacy 纯文本格式（旧版 "prompt... Negative prompt: ... Steps: ..." 格式）
 *
 * 解析完成后自动执行：
 * 1. Quality Tags 后缀侦测与剥离
 * 2. UC Preset 前缀降序严格匹配与剥离
 *
 * @param rawMetadata - 从 PNG tEXt chunk 读取的原始字符串
 * @param baseParams  - 可选的基础参数，用于合并缺省值
 * @returns 结构化的解析结果
 */
export const parseNovelAIMetadata = (
    rawMetadata: string,
    baseParams?: Partial<NAIParams>,
    metadataModelMappings?: Record<string, string>,
): ParsedNAIData => {
    // 默认参数基底
    const defaultParams: NAIParams = {
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        sampler: 'k_euler_ancestral',
        seed: undefined,
        qualityToggle: true,
        ucPreset: 4,
        characters: [],
        useCoords: false,
        variety: false,
        cfgRescale: 0,
        ...baseParams,
    };

    let prompt: string = rawMetadata;
    let negative: string = '';
    const newParams: NAIParams = { ...defaultParams };

    // ---- 格式分流 ----
    if (rawMetadata.trim().startsWith('{')) {
        // === JSON 路线（V3/V4/V4.5） ===
        try {
            const json = JSON.parse(rawMetadata);

            // 基础字段提取
            if (typeof json.prompt === 'string') prompt = json.prompt;
            if (json.uc) negative = json.uc;
            if (json.steps != null) newParams.steps = json.steps;
            if (json.scale != null) newParams.scale = json.scale;
            if (json.seed != null && json.seed !== 0) newParams.seed = json.seed;
            if (json.sampler) newParams.sampler = json.sampler;
            // 官方图片通常只记录模型展示名与哈希；精确映射由网关从官方前端同步。
            const importedModel = resolveNaiMetadataModel(json, metadataModelMappings);
            if (importedModel) newParams.model = importedModel;
            if (json.width != null) newParams.width = json.width;
            if (json.height != null) newParams.height = json.height;
            if (json.tag_hint_transparent_background === true || json.transparent === true) {
                newParams.transparent = true;
                newParams.alphaMode = json.straight_alpha === false ? 'premultiplied' : 'straight';
            } else {
                newParams.transparent = false;
                if (typeof json.straight_alpha === 'boolean') {
                    newParams.alphaMode = json.straight_alpha === false ? 'premultiplied' : 'straight';
                }
            }

            // Variety+ 开关（通过 skip_cfg_above_sigma 探测）
            if (json.skip_cfg_above_sigma !== undefined && json.skip_cfg_above_sigma !== null) {
                newParams.variety = true;
            } else {
                newParams.variety = false;
            }

            // CFG Rescale
            if (json.cfg_rescale !== undefined) {
                newParams.cfgRescale = json.cfg_rescale;
            }

            // V4 结构化 Prompt 解析
            if (json.v4_prompt) {
                const v4 = json.v4_prompt;

                // base_caption 覆盖顶层 prompt
                if (typeof v4.caption?.base_caption === 'string') {
                    prompt = v4.caption.base_caption;
                }

                // 手控坐标开关
                if (v4.use_coords !== undefined) {
                    newParams.useCoords = v4.use_coords;
                }

                // 角色列表提取
                newParams.characters = [];
                if (v4.caption?.char_captions && Array.isArray(v4.caption.char_captions)) {
                    newParams.characters = v4.caption.char_captions.map((cc: any): CharacterParams => ({
                        id: safeUUID(),
                        prompt: cc.char_caption || '',
                        x: cc.centers?.[0]?.x ?? 0.5,
                        y: cc.centers?.[0]?.y ?? 0.5,
                    }));
                }
            } else {
                newParams.characters = [];
            }

            // V4 负面提示词结构化解析
            if (json.v4_negative_prompt) {
                const v4Neg = json.v4_negative_prompt;

                // base_caption 覆盖全局负面
                if (typeof v4Neg.caption?.base_caption === 'string') {
                    negative = v4Neg.caption.base_caption;
                }

                // 角色专属负面配对（严格按索引下标）
                if (
                    newParams.characters &&
                    newParams.characters.length > 0 &&
                    v4Neg.caption?.char_captions &&
                    Array.isArray(v4Neg.caption.char_captions)
                ) {
                    newParams.characters.forEach((char, idx) => {
                        const negCharCap = v4Neg.caption.char_captions[idx];
                        if (negCharCap && negCharCap.char_caption) {
                            char.negativePrompt = negCharCap.char_caption;
                        }
                    });
                }
            }
            // 使用最终 base_caption 恢复权重，不继承导入前草稿的旧值或 Text: 中的字面标签。
            newParams.transparentWeight = resolveTransparentWeight(json.transparentWeight, prompt);
        } catch (e) {
            console.error('JSON 元数据解析失败，回退到原始字符串', e);
        }
    } else {
        // === Legacy 纯文本路线 ===
        const negIndex = rawMetadata.indexOf('Negative prompt:');
        const stepsIndex = rawMetadata.indexOf('Steps:');

        if (stepsIndex !== -1) {
            const paramStr = rawMetadata.substring(stepsIndex);
            const getVal = (key: keyof typeof COMPILED_REGEX): string | null => {
                const match = paramStr.match(COMPILED_REGEX[key]);
                return match ? match[1].trim() : null;
            };

            const steps = getVal('Steps');
            const sampler = getVal('Sampler');
            const scale = getVal('CFG scale');
            const seed = getVal('Seed');
            const size = getVal('Size');

            if (steps) newParams.steps = parseInt(steps);
            if (sampler) newParams.sampler = sampler.toLowerCase().replace(/ /g, '_');
            if (scale) newParams.scale = parseFloat(scale);
            if (seed) newParams.seed = parseInt(seed);
            if (size) {
                const [w, h] = size.split('x').map(Number);
                if (w && h) {
                    newParams.width = w;
                    newParams.height = h;
                }
            }

            if (negIndex !== -1 && negIndex < stepsIndex) {
                prompt = rawMetadata.substring(0, negIndex).trim();
                negative = rawMetadata.substring(negIndex + 16, stepsIndex).trim();
            } else {
                prompt = rawMetadata.substring(0, stepsIndex).trim();
            }
        }
        newParams.characters = [];
    }

    // ========== 后处理：隐式参数逆向反推 ==========

    // 1. Quality Tags 后缀侦测与剥离
    const promptParts = splitNaiTextPrompt(prompt);
    if (promptParts.description.endsWith(NAI_QUALITY_TAGS)) {
        newParams.qualityToggle = true;
        prompt = joinNaiTextPrompt(promptParts.description.slice(0, -NAI_QUALITY_TAGS.length), promptParts.text);
    } else {
        newParams.qualityToggle = false;
    }

    // 2. UC Preset 前缀降序严格匹配与剥离
    //    顺序关键：3(Human) -> 2(Furry) -> 1(Light) -> 0(Heavy)
    //    因为 Human(3) 的内容包含 Heavy(0) 的前缀，必须先检验长串
    newParams.ucPreset = 4; // 默认 None
    const checkOrder = [3, 2, 1, 0] as const;

    for (const id of checkOrder) {
        const presetStr = NAI_UC_PRESETS[id];
        if (negative.startsWith(presetStr)) {
            newParams.ucPreset = id;
            negative = negative.substring(presetStr.length);
            break;
        }
    }

    return { prompt, negativePrompt: negative, params: newParams };
};
