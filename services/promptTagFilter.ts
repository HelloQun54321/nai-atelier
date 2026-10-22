import { splitPromptSegments } from './promptSegments.mjs';
/**
 * 提示词候选的**逐标签筛选**（对齐中英删除、保护带权重标签组）。
 *
 * 生成候选是一行逗号分隔的 Tag；编辑时常常只想删掉其中一个。
 * 直接字符串替换会踩三个坑：
 *   1. `blue_eyes` 与 `yellow_eyes` 互相包含；`hair` 命中 `blonde_hair`；
 *   2. 中英对照是按顺序一一对应的，只删英文会让中文错位；
 *   3. `(blonde_hair:1.2)` 或 `1.2::blonde_hair::` 这类带权重写法，删掉内容会留下残骸。
 * 因此这里按 token 解析后再删：只删完整 Tag、双语同步删、带权重组默认不拆。
 */

export interface PromptTagToken {
  /** 原始片段（含权重语法），用于展示 */
  raw: string;
  /** 归一化后的 Tag 正文，用于匹配与删除 */
  tag: string;
  /** 权重（`(tag:1.2)` / `1.2::tag::`），无权重时为 1 */
  weight: number;
  /** 带权重组：默认不允许单标签删除，避免破坏语法 */
  weighted: boolean;
  /** 该 Tag 在 bilingual 里对应的中文（没有则为空串） */
  bilingual: string;
}

export interface PromptTagRemoval {
  prompt: string;
  bilingual: string;
  /** 是否真的删掉了（未命中 / 受保护时为 false） */
  removed: boolean;
  /** 未删除原因，界面可直接提示 */
  reason?: 'not-found' | 'weighted';
}

/**
 * 按逗号拆分，但**跳过** `::…::` 权重组内部与括号内部的逗号。
 * 例：`1.3::silver hair, long hair::, blue eyes` → 两段（而不是三段）。
 * 直接按逗号拆会把权重组拆坏，删一个标签就留下未配对的 `::`。
 */
export { splitPromptSegments } from './promptSegments.mjs';

const splitParts = (value: string): string[] => splitPromptSegments(value);

const probe = (value: string): string => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** 解析双语对照里每个 Tag 的中文：优先取全角括号里的释义，其次取纯中文片段。 */
export const parseBilingualMap = (bilingual: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const part of splitParts(bilingual)) {
    const paren = part.match(/^([\s\S]*?)[（(]([^）)]*)[）)]\s*$/);
    if (paren) {
      map.set(probe(paren[1]), String(paren[2]).trim());
      continue;
    }
    /* 没有括号时：整段是中文就按顺序占位，交给调用方按位置对齐 */
    map.set(probe(part), '');
  }
  return map;
};

/** 解析一行提示词为 Tag 列表，识别两种带权重写法。 */
export const parsePromptTags = (prompt: string, bilingual = ''): PromptTagToken[] => {
  const map = parseBilingualMap(bilingual);
  return splitParts(prompt).map(raw => {
    /* (tag:1.2) / (tag:1.2, other) 只取最外层的一个 tag */
    const parenWeighted = raw.match(/^\(\s*([^:()]+?)\s*:\s*([0-9.]+)\s*\)$/);
    if (parenWeighted) {
      const tag = parenWeighted[1].trim();
      return { raw, tag, weight: Number(parenWeighted[2]) || 1, weighted: true, bilingual: map.get(probe(tag)) || '' };
    }
    /* 1.2::tag:: 或 1.2::tag, tag2:: （整组视为带权重，默认不拆） */
    const dblWeighted = raw.match(/^([0-9.]+)\s*::\s*([\s\S]+?)\s*::$/);
    if (dblWeighted) {
      const tag = dblWeighted[2].trim();
      return { raw, tag, weight: Number(dblWeighted[1]) || 1, weighted: true, bilingual: map.get(probe(tag)) || '' };
    }
    return { raw, tag: raw, weight: 1, weighted: false, bilingual: map.get(probe(raw)) || '' };
  });
};

/** 界面用的逐标签明细：原文、归一化 Tag、中文对照、是否带权重。 */
export const tagDetails = (prompt: string, bilingual = ''): PromptTagToken[] =>
  parsePromptTags(prompt, bilingual).map(token => ({
    ...token,
    bilingual: token.bilingual || parseBilingualMap(bilingual).get(probe(token.tag)) || '',
  }));

/**
 * 删除**一个完整 Tag**：按归一化 Tag 精确匹配，不做子串替换；
 * 中英对照里对应的那一条一起删（按同一个归一化 Tag 匹配，不用位置猜）。
 * 带权重组默认拒绝（weighted: true 由调用方显式允许时才拆）。
 * 同一归一化 Tag 出现多次时**一并删除**（界面上它们是同一枚标签，删两次没有意义）。
 */
export const removePromptTag = (
  prompt: string,
  bilingual: string,
  tag: string,
  options: { allowWeighted?: boolean } = {},
): PromptTagRemoval => {
  const target = probe(tag);
  const tokens = parsePromptTags(prompt, bilingual);
  const hit = tokens.find(token => probe(token.tag) === target);
  if (!hit) {
    /* 目标标签在某个带权重组的内部：不是「找不到」，而是「受保护」——必须给用户明确原因 */
    const insideGroup = tokens.some(token => token.weighted
      && splitPromptSegments(token.tag).some(inner => probe(inner) === target));
    return { prompt, bilingual, removed: false, reason: insideGroup ? 'weighted' : 'not-found' };
  }
  if (hit.weighted && !options.allowWeighted) return { prompt, bilingual, removed: false, reason: 'weighted' };
  const keptPrompt = splitParts(prompt).filter((raw, index) => tokens[index].raw !== hit.raw || probe(tokens[index].tag) !== target);
  const keptBilingual = splitParts(bilingual).filter(part => {
    const paren = part.match(/^([\s\S]*?)[（(]([^）)]*)[）)]\s*$/);
    const rawTag = paren ? paren[1] : part;
    return probe(rawTag) !== target;
  });
  return { prompt: keptPrompt.join(', '), bilingual: keptBilingual.join(', '), removed: true };
};
