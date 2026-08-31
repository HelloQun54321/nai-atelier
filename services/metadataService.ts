
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
import { resolveNaiMetadataModel } from './naiModels';

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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const STEALTH_MAGIC = 'stealth_pngcomp';
const STEALTH_HEADER_BYTES = STEALTH_MAGIC.length + 4;
const MAX_STEALTH_COMPRESSED_BYTES = 1024 * 1024;
const MAX_STEALTH_DECOMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_STEALTH_IMAGE_PIXELS = 40_000_000;

interface PngTextEntry {
    keyword: string;
    text: string;
}

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
        const standardMetadata = await extractNovelAiMetadataFromPng(arrayBuffer);
        if (standardMetadata) return standardMetadata;

        return await extractStealthMetadataFromFile(file);
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
            if (json.prompt) prompt = json.prompt;
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

/**
 * 从标准 PNG 文本块提取 NovelAI 生成参数。
 * NovelAI 历史图片主要使用 tEXt，新格式也可能落在 iTXt / zTXt。
 */
export const extractNovelAiMetadataFromPng = async (buffer: ArrayBuffer): Promise<string | null> => {
    const entries = await readPngTextChunks(buffer);
    return selectNovelAiGenerationMetadata(entries);
};

/**
 * 按 NovelAI 官方顺序从 RGBA Alpha 通道最低位读取 stealth_pngcomp。
 * 官方实现先转置 Alpha 矩阵，因此位顺序是 x 优先、y 次之，而不是常规行优先。
 */
export const extractNovelAiStealthMetadataFromRgba = async (
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
): Promise<string | null> => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    const pixelCount = width * height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_STEALTH_IMAGE_PIXELS) return null;
    if (rgba.byteLength < pixelCount * 4 || pixelCount < STEALTH_HEADER_BYTES * 8) return null;

    const availableBytes = Math.floor(pixelCount / 8);
    const readByte = (byteOffset: number): number => {
        let value = 0;
        const firstBit = byteOffset * 8;
        for (let bit = 0; bit < 8; bit++) {
            const bitOffset = firstBit + bit;
            const x = Math.floor(bitOffset / height);
            const y = bitOffset % height;
            value = (value << 1) | (rgba[(y * width + x) * 4 + 3] & 1);
        }
        return value;
    };

    let magic = '';
    for (let i = 0; i < STEALTH_MAGIC.length; i++) magic += String.fromCharCode(readByte(i));
    if (magic !== STEALTH_MAGIC) return null;

    const lengthOffset = STEALTH_MAGIC.length;
    const payloadBits = (
        readByte(lengthOffset) * 0x1000000
        + readByte(lengthOffset + 1) * 0x10000
        + readByte(lengthOffset + 2) * 0x100
        + readByte(lengthOffset + 3)
    );
    if (payloadBits % 8 !== 0) return null;

    const payloadBytes = payloadBits / 8;
    if (
        payloadBytes <= 0
        || payloadBytes > MAX_STEALTH_COMPRESSED_BYTES
        || payloadBytes > availableBytes - STEALTH_HEADER_BYTES
    ) return null;

    const compressed = new Uint8Array(payloadBytes);
    for (let i = 0; i < payloadBytes; i++) compressed[i] = readByte(STEALTH_HEADER_BYTES + i);

    try {
        const jsonBytes = await decompressWithLimit(compressed, 'gzip', MAX_STEALTH_DECOMPRESSED_BYTES);
        const outerMetadata = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
        return selectNovelAiGenerationMetadata([{ keyword: 'Stealth', text: outerMetadata }]);
    } catch {
        return null;
    }
};

const extractStealthMetadataFromFile = async (file: File): Promise<string | null> => {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;

    const bitmap = await createImageBitmap(file);
    try {
        const pixelCount = bitmap.width * bitmap.height;
        if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_STEALTH_IMAGE_PIXELS) return null;

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
        return await extractNovelAiStealthMetadataFromRgba(imageData.data, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
};

const readPngTextChunks = async (buffer: ArrayBuffer): Promise<PngTextEntry[]> => {
    if (buffer.byteLength < PNG_SIGNATURE.length) return [];
    const bytes = new Uint8Array(buffer);
    if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return [];

    const view = new DataView(buffer);
    const typeDecoder = new TextDecoder('iso-8859-1');
    const entries: PngTextEntry[] = [];
    let offset: number = PNG_SIGNATURE.length;

    while (offset + 12 <= buffer.byteLength) {
        const length = view.getUint32(offset, false);
        const typeOffset = offset + 4;
        const dataOffset = typeOffset + 4;
        const dataEnd = dataOffset + length;
        const chunkEnd = dataEnd + 4;
        if (!Number.isSafeInteger(chunkEnd) || dataEnd < dataOffset || chunkEnd > buffer.byteLength) break;

        const type = typeDecoder.decode(bytes.subarray(typeOffset, dataOffset));
        const chunkData = bytes.subarray(dataOffset, dataEnd);
        try {
            const entry = await decodePngTextChunk(type, chunkData);
            if (entry) entries.push(entry);
        } catch {
            // 单个压缩文本块损坏时继续检查其他块与 Stealth 元数据。
        }

        offset = chunkEnd;
        if (type === 'IEND') break;
    }

    return entries;
};

const decodePngTextChunk = async (type: string, data: Uint8Array): Promise<PngTextEntry | null> => {
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') return null;
    const nullIndex = data.indexOf(0);
    if (nullIndex <= 0) return null;
    const keyword = new TextDecoder('iso-8859-1').decode(data.subarray(0, nullIndex));

    if (type === 'tEXt') {
        return { keyword, text: decodeUtf8OrLatin1(data.subarray(nullIndex + 1)) };
    }

    if (type === 'zTXt') {
        if (data[nullIndex + 1] !== 0) return null;
        const text = await decompressWithLimit(
            data.subarray(nullIndex + 2),
            'deflate',
            MAX_STEALTH_DECOMPRESSED_BYTES,
        );
        return { keyword, text: decodeUtf8OrLatin1(text) };
    }

    if (type !== 'iTXt' || nullIndex + 3 > data.length) return null;
    const compressionFlag = data[nullIndex + 1];
    const compressionMethod = data[nullIndex + 2];
    if ((compressionFlag !== 0 && compressionFlag !== 1) || compressionMethod !== 0) return null;

    const languageEnd = data.indexOf(0, nullIndex + 3);
    if (languageEnd < 0) return null;
    const translatedKeywordEnd = data.indexOf(0, languageEnd + 1);
    if (translatedKeywordEnd < 0) return null;
    const textBytes = data.subarray(translatedKeywordEnd + 1);
    const decoded = compressionFlag === 1
        ? await decompressWithLimit(textBytes, 'deflate', MAX_STEALTH_DECOMPRESSED_BYTES)
        : textBytes;
    return { keyword, text: new TextDecoder('utf-8').decode(decoded) };
};

const selectNovelAiGenerationMetadata = (entries: PngTextEntry[]): string | null => {
    const source = entries.find(entry => entry.keyword === 'Source')?.text.trim();
    const candidates = entries
        .filter(entry => ['Comment', 'Description', 'Stealth'].includes(entry.keyword))
        .sort((left, right) => metadataKeywordPriority(left.keyword) - metadataKeywordPriority(right.keyword));

    for (const candidate of candidates) {
        const normalized = normalizeNovelAiMetadataCandidate(candidate.text, source);
        if (normalized) return normalized;
    }
    return null;
};

const metadataKeywordPriority = (keyword: string): number => {
    if (keyword === 'Comment') return 0;
    if (keyword === 'Stealth') return 1;
    return 2;
};

const normalizeNovelAiMetadataCandidate = (text: string, inheritedSource?: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            if (!json || typeof json !== 'object' || Array.isArray(json)) return null;

            const source = typeof json.Source === 'string'
                ? json.Source.trim()
                : typeof json.source === 'string'
                    ? json.source.trim()
                    : inheritedSource;
            const withSource = (value: Record<string, unknown>) => JSON.stringify(
                source && typeof value.Source !== 'string' && typeof value.source !== 'string'
                    ? { ...value, Source: source }
                    : value,
            );
            const comment = json.Comment ?? json.comment;
            if (comment && typeof comment === 'object') {
                return hasNovelAiGenerationFields(comment) ? withSource(comment) : null;
            }
            if (typeof comment === 'string') {
                const normalizedComment = normalizeNovelAiMetadataCandidate(comment, source);
                if (normalizedComment) return normalizedComment;
            }
            if (hasNovelAiGenerationFields(json)) return withSource(json);
        } catch {
            return null;
        }
    }

    return trimmed.includes('Steps:') ? parseNaiGenerationData(trimmed) : null;
};

const hasNovelAiGenerationFields = (value: Record<string, unknown>): boolean => Boolean(
    value.prompt
    || value.steps
    || value.v4_prompt
    || value.v4_negative_prompt
    || value.uc
);

const decodeUtf8OrLatin1 = (bytes: Uint8Array): string => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('iso-8859-1').decode(bytes);
    }
};

const decompressWithLimit = async (
    bytes: Uint8Array,
    format: 'gzip' | 'deflate',
    maxBytes: number,
): Promise<Uint8Array> => {
    if (typeof DecompressionStream !== 'function') throw new Error('Browser does not support compressed metadata');
    const source = Uint8Array.from(bytes).buffer;
    const stream = new Blob([source]).stream().pipeThrough(new DecompressionStream(format));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error('Decompressed metadata is too large');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
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
