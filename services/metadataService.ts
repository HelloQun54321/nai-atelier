
/**
 * NAI 图片元数据提取与解析服务
 *
 * 职责：
 * 1. 从 PNG 的 tEXt chunk 中读取原始元数据字符串
 * 2. 将原始字符串解析为结构化的 { prompt, negativePrompt, params } 对象
 *
 * 解析逻辑严格参照 NOVELAI_API_DOCS.md 与 promptUtils.ts 中的常量定义
 */

import { NAIParams, CharacterParams } from '../types';
import { NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

// ========== 类型定义 ==========

/** 用于跨组件传递待导入数据的 SessionStorage Key */
export const IMPORT_SESSION_KEY = 'nai_pending_import';

/** 安全的 ID 生成器回退 */
const safeUUID = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);

/** parseNovelAIMetadata 返回的结构化解析结果 */
export interface ParsedNAIData {
    /** 正面提示词（已剥离 Quality Tags 后缀） */
    prompt: string;
    /** 负面提示词（已剥离 UC Preset 前缀） */
    negativePrompt: string;
    /** 完整的生成参数（不含 Boilerplate 固定参数） */
    params: NAIParams;
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
 * 读取 tEXt chunk 中 Description / Comment 关键字的内容
 */
export const extractMetadata = async (file: File): Promise<string | null> => {
    if (file.type !== 'image/png') {
        console.warn('Only PNG metadata is supported currently.');
        return null;
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        const text = readPngTextChunks(arrayBuffer);
        if (!text) return null;
        return parseNaiGenerationData(text);
    } catch (e) {
        console.error('Failed to parse metadata', e);
        return null;
    }
};

// ========== 核心解析纯函数 ==========

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
    baseParams?: Partial<NAIParams>
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
    let newParams: NAIParams = { ...defaultParams };

    // ---- 格式分流 ----
    if (rawMetadata.trim().startsWith('{')) {
        // === JSON 路线（V3/V4/V4.5） ===
        try {
            const json = JSON.parse(rawMetadata);

            // 基础字段提取
            if (json.prompt) prompt = json.prompt;
            if (json.uc) negative = json.uc;
            if (json.steps != null) newParams.steps = json.steps;
            if (json.scale != null) newParams.scale = json.scale;
            if (json.seed != null && json.seed !== 0) newParams.seed = json.seed;
            if (json.sampler) newParams.sampler = json.sampler;
            if (json.width != null) newParams.width = json.width;
            if (json.height != null) newParams.height = json.height;

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
                if (v4.caption?.base_caption) {
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
                if (v4Neg.caption?.base_caption) {
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
    if (prompt.endsWith(NAI_QUALITY_TAGS)) {
        newParams.qualityToggle = true;
        prompt = prompt.substring(0, prompt.length - NAI_QUALITY_TAGS.length);
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

// ========== 内部工具函数 ==========

/** 读取 PNG 二进制流中的 tEXt chunk */
const readPngTextChunks = (buffer: ArrayBuffer): string | null => {
    const data = new DataView(buffer);

    // 校验 PNG 签名：89 50 4E 47 0D 0A 1A 0A
    if (data.getUint32(0) !== 0x89504E47 || data.getUint32(4) !== 0x0D0A1A0A) {
        return null;
    }

    let offset = 8;
    const decoder = new TextDecoder('iso-8859-1');

    while (offset < data.byteLength) {
        const length = data.getUint32(offset);
        offset += 4;

        const type = decoder.decode(new Uint8Array(buffer, offset, 4));
        offset += 4;

        if (type === 'tEXt') {
            const chunkData = new Uint8Array(buffer, offset, length);
            let nullIndex = -1;
            for (let i = 0; i < length; i++) {
                if (chunkData[i] === 0) {
                    nullIndex = i;
                    break;
                }
            }

            if (nullIndex > -1) {
                const keyword = decoder.decode(chunkData.slice(0, nullIndex));
                if (keyword === 'Description' || keyword === 'Comment') {
                    const content = decoder.decode(chunkData.slice(nullIndex + 1));
                    if (content.includes('Steps:') || content.includes('"prompt":') || content.includes('"steps":')) {
                        return content;
                    }
                }
            }
        }

        offset += length + 4; // 跳过数据 + CRC
    }

    return null;
};

/** 预处理 NAI 元数据文本（JSON 校验或原样返回） */
const parseNaiGenerationData = (text: string): string => {
    if (text.trim().startsWith('{')) {
        try {
            const json = JSON.parse(text);
            if (json.prompt || json.steps || json.v4_prompt) {
                return text;
            }
        } catch (e) {
            // JSON 解析失败，继续尝试文本模式
        }
    }
    return text;
};
