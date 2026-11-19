import { parsePromptTags } from './promptTags.mjs';
import { lookupTagDictionaryEntries, normalizeTagQuery, searchTagDictionary, type TagSuggestion } from './tagDictionary';

/**
 * 提示词校对：把词库里已有的 Tag 对齐成标准写法，词库没有的保持原样，最后把中文标点换成英文。
 *
 * 规则只做保守改写：命中词库才动，查不到的一律保留；中文写的自然语言不翻译、不换词，
 * 只在用户明确用中文标点分隔的地方换成 NAI 认的英文逗号。不删词、不重排、不调模型。
 */

export interface PromptProofreadDeps {
  /** 按规范化后的 Tag 精确查词库。 */
  lookup: (tags: string[]) => Promise<Map<string, TagSuggestion>>;
  /** 按前缀取候选，用于拼写纠错。 */
  search: (query: string) => Promise<TagSuggestion[]>;
}

export interface PromptProofreadCorrection {
  /** 原文里的写法（含 artist: 等前缀）。 */
  from: string;
  /** 词库里的标准写法。 */
  to: string;
}

export interface PromptProofreadResult {
  /** 校对后的完整提示词；没有改动时与原文相同。 */
  text: string;
  /** 被对齐的 Tag，按原文顺序。 */
  corrections: PromptProofreadCorrection[];
  /** 换成英文的中文标点个数。 */
  punctuation: number;
  /** 词库未就绪，只做了标点替换。 */
  dictionaryUnavailable: boolean;
}

const defaultDeps: PromptProofreadDeps = {
  lookup: tags => lookupTagDictionaryEntries(tags),
  search: query => searchTagDictionary(query, 200),
};

/** 分段标记是提示词结构，不是可校对内容。 */
const SECTION_MARKER = /^<\/?[a-zA-Z][\w-]*>$/;
/** 显式画师前缀原样保留，只校对后面的名字。 */
const ARTIST_PREFIX = /^(artist\s*:\s*|by\s+)/i;
/** 中文、日文、韩文属于自然语言，原样保留，不猜英文 Tag。 */
const EAST_ASIAN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
/** 中文标点到英文标点的固定映射；分隔用的标点额外补一个空格。 */
const PUNCTUATION: Readonly<Record<string, string>> = {
  '，': ', ', '、': ', ', '；': '; ', '：': ':', '。': '.', '！': '!', '？': '?',
  '（': '(', '）': ')', '【': '[', '】': ']', '“': '"', '”': '"', '‘': "'", '’': "'",
  '「': '"', '」': '"', '『': '"', '』': '"', '…': '...', '　': ' ', '～': '~',
};
const SEPARATORS = new Set(['，', '、', '；']);

/** 中文标点转英文；分隔标点后面补一个空格，原处已有空格就不重复。 */
export function normalizePromptPunctuation(value: string): { text: string; count: number } {
  const source = String(value ?? '');
  let text = '';
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const replacement = PUNCTUATION[char];
    if (replacement === undefined) { text += char; continue; }
    count += 1;
    const next = source[index + 1];
    text += SEPARATORS.has(char) && (next === undefined || next === ' ' || next === '\u3000') ? replacement.trimEnd() : replacement;
  }
  return { text, count };
}

const distance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
};

/**
 * 拼写纠正的保守阈值：词数必须相同、越长的词允许的编辑距离越大，
 * 四个字母以内的短词只认完全一致，避免把原创名改成相近的常用词。
 */
const isSpellingVariant = (source: string, candidate: string, edits: number): boolean => {
  if (!source || !candidate || source === candidate) return false;
  if (source.split(' ').length !== candidate.split(' ').length) return false;
  const longest = Math.max(source.length, candidate.length);
  if (longest <= 4) return false;
  return edits <= (longest >= 8 ? 2 : 1);
};

interface TokenCandidate {
  start: number;
  end: number;
  /** 原文里的完整片段（替换范围，不含权重包装）。 */
  display: string;
  /** 去掉 artist: 前缀后的名字。 */
  core: string;
  /** 保留原样的前缀（artist: 等）。 */
  prefix: string;
}

interface TokenRewrite {
  start: number;
  end: number;
  /** 替换后写回原文的完整片段（含 artist: 等前缀）。 */
  text: string;
}

const applyRewrites = (value: string, rewrites: readonly TokenRewrite[]): string => [...rewrites]
  .sort((left, right) => right.start - left.start)
  .reduce((text, rewrite) => text.slice(0, rewrite.start) + rewrite.text + text.slice(rewrite.end), value);

const tokenCandidates = (text: string): TokenCandidate[] => parsePromptTags(text).flatMap(token => {
  const display = token.displayTag.trim();
  if (!display || SECTION_MARKER.test(display)) return [];
  // 解析器会剥掉权重包装与成对括号；displayTag 在原文中的真实位置比 start／end 更可靠。
  const start = text.indexOf(display, token.start ?? 0);
  if (start < 0) return [];
  const core = display.replace(ARTIST_PREFIX, '').trim();
  if (!core || EAST_ASIAN.test(core)) return [];
  return [{ start, end: start + display.length, display, core, prefix: display.slice(0, display.length - core.length) }];
});

/** 校对整段提示词：先统一标点，再逐词对齐词库；词库不可用时只做标点部分。 */
export async function proofreadPrompt(value: string, deps: PromptProofreadDeps = defaultDeps): Promise<PromptProofreadResult> {
  const source = String(value ?? '');
  const punctuation = normalizePromptPunctuation(source);
  const text = punctuation.text;
  const candidates = tokenCandidates(text);
  let dictionaryUnavailable = false;
  let entries: Map<string, TagSuggestion> = new Map();
  if (candidates.length) {
    try { entries = await deps.lookup([...new Set(candidates.map(item => normalizeTagQuery(item.core)))]); }
    catch { dictionaryUnavailable = true; }
  }

  const rewrites: TokenRewrite[] = [];
  const corrections: PromptProofreadCorrection[] = [];
  const candidateCache = new Map<string, string | null>();

  for (const item of candidates) {
    const key = normalizeTagQuery(item.core);
    const entry = entries.get(key);
    if (entry) {
      if (entry.name === item.core) continue;
      const to = `${item.prefix}${entry.name}`;
      rewrites.push({ start: item.start, end: item.end, text: to });
      corrections.push({ from: item.display, to });
      continue;
    }
    // 词库不可用、或短词没有足够信息时保持原样。
    if (dictionaryUnavailable || key.length <= 4) continue;
    if (!candidateCache.has(key)) {
      try {
        const suggestions = await deps.search(key);
        const best = suggestions
          .map(suggestion => {
            const standard = normalizeTagQuery(suggestion.name);
            return { name: suggestion.name, edits: distance(key, standard) };
          })
          .filter(candidate => isSpellingVariant(key, normalizeTagQuery(candidate.name), candidate.edits))
          .sort((left, right) => left.edits - right.edits)[0];
        candidateCache.set(key, best?.name ?? null);
      } catch {
        // 候选查询失败只影响这一个词，不把整段结果作废。
        dictionaryUnavailable = true;
        candidateCache.set(key, null);
      }
    }
    const corrected = candidateCache.get(key);
    if (!corrected || corrected === item.core) continue;
    const to = `${item.prefix}${corrected}`;
    rewrites.push({ start: item.start, end: item.end, text: to });
    corrections.push({ from: item.display, to });
  }

  return {
    text: applyRewrites(text, rewrites),
    corrections,
    punctuation: punctuation.count,
    dictionaryUnavailable,
  };
}
