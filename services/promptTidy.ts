import { promptAgentService } from './promptAgent';
import { isNovelAiStyleTag } from './promptImport';
import { lookupTagDictionaryEntries, normalizeTagQuery, type TagSuggestion } from './tagDictionary';

export type PromptTidyMethod = 'rules' | 'ai';
/** style＝画风配方（画师、画风、质量词等整段）；all 只整理格式；custom 交给模型按用户要求处理。 */
export type PromptTidyKeep = 'style' | 'artists' | 'content' | 'all' | 'custom';
export interface PromptTidySettings {
  method: PromptTidyMethod;
  keep: PromptTidyKeep;
  /** 自定义要求，只在 keep 为 custom 时使用。 */
  instruction: string;
  /** 允许模型改写词句；关闭时模型只决定每段去留，原词一字不改。 */
  rewrite: boolean;
  dedupe: boolean;
  artistPrefix: boolean;
  /** 整理后接着出一张样张，只在编辑器提供出图通道时生效。 */
  sample: boolean;
}
/** 被去掉的一段，原文照录；duplicate 表示和前面保留的段重复。 */
export interface PromptTidyDropped { text: string; duplicate: boolean }
/** dropped 按原文顺序列出去掉的段，模型改写时为空。 */
export interface PromptTidyResult { text: string; kept: number; removed: number; rewritten: boolean; dropped: PromptTidyDropped[] }
type PromptTidyService = Pick<typeof promptAgentService, 'tidyPrompt'>;

export const PROMPT_TIDY_INSTRUCTION_LIMIT = 500;
export const DEFAULT_PROMPT_TIDY_SETTINGS: Readonly<PromptTidySettings> = Object.freeze<PromptTidySettings>({ method: 'rules', keep: 'style', instruction: '', rewrite: false, dedupe: true, artistPrefix: false, sample: false });
const KEEPS: readonly PromptTidyKeep[] = ['style', 'artists', 'content', 'all', 'custom'];
const AI_INSTRUCTIONS: Record<'style' | 'content', string> = {
  style: '只保留画风配方：画师、画风、媒介、线条、明暗、质感、特效、质量词（含拼错的 masterpice 等，以及 year 2025、2020s (style) 这类年份年代词）与色彩，以及由这些词组成的权重组；去掉人物、外貌、服饰、动作、表情、构图、镜头、文字、光照与光色（如 orange lighting、sunlight），以及地点、自然、花草与时间天气（如 flower field、day、sunset）等画面内容。',
  content: '去掉画风配方（画师、画风、媒介、线条、明暗、质感、特效、质量词、year 2025 这类年份年代词与色彩），只保留人物、外貌、服饰、动作、表情、构图、镜头、文字、光照、地点、自然与时间天气等画面内容。',
};
const WEIGHTED = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)::)([\s\S]*?)(\s*::)$/;
const WEIGHT_HEAD = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::/;
/** 权重前多写的 `::`（`::0.5::cloudyman::`）：不去掉的话认不出权重，词库也查不到里面的画师。 */
const STRAY_COLONS = /^:+\s*(?=[+-]?(?:\d+(?:\.\d+)?|\.\d+)::)/;
/** 词库里没有、但写法本身就说明是画风的描述：…style／illustration／lineart／shading 等；orange lighting 这类光照按画面内容处理。 */
const TIDY_STYLE_PATTERNS = [
  /(?:^|\s)(?:style|illustration|lineart|line art|linework|shading|chiaroscuro|brushstrokes?|rendering)$/,
  /\((?:medium|style)\)$/,
  /^(?:official art|newest|traditional media|hyperrealistic|hyperrealism|depth of field|bokeh|film grain|chromatic aberration|lens flare|bloom|cinematic|monochrome|greyscale|high contrast|limited palette|vibrant colors|pastel colors|muted colors)$/,
];
const QUALITY_WORDS = ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres', 'highres'];
const BRACKETS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

export function normalizePromptTidySettings(value: unknown): PromptTidySettings {
  const input = value && typeof value === 'object' ? value as Partial<Record<keyof PromptTidySettings, unknown>> : {};
  return {
    method: input.method === 'ai' ? 'ai' : 'rules',
    keep: KEEPS.includes(input.keep as PromptTidyKeep) ? input.keep as PromptTidyKeep : DEFAULT_PROMPT_TIDY_SETTINGS.keep,
    instruction: typeof input.instruction === 'string' ? input.instruction.slice(0, PROMPT_TIDY_INSTRUCTION_LIMIT) : '',
    rewrite: input.rewrite === true,
    dedupe: input.dedupe !== false,
    artistPrefix: input.artistPrefix === true,
    sample: input.sample === true,
  };
}

/** 只留画师与只整理格式靠词库就够；自定义要求只能交给模型。 */
export const resolvePromptTidyMethod = (settings: PromptTidySettings): PromptTidyMethod =>
  settings.keep === 'custom' ? 'ai' : settings.keep === 'artists' || settings.keep === 'all' ? 'rules' : settings.method;

/** 模型改写时以用户要求为准，不再套用去重与补前缀。 */
export const isPromptTidyRewrite = (settings: PromptTidySettings) => settings.keep === 'custom' && settings.rewrite;

const CLOSERS: Record<string, string> = { '[': ']', '{': '}' };
const OPENERS: Record<string, string> = { ']': '[', '}': '{' };
/**
 * 笔误切开的一截补齐强调括号：`[a, b]` 被切成 `[a`、`b]` 后各自补成 `[a]`、`[b]`，降权／加权不丢；
 * 组内类型对不上的闭括号当笔误去掉，补出的空括号对一并清掉（`[[x][` → `[[x]]`）。
 */
const completeBrackets = (piece: string) => {
  const stack: string[] = [];
  let prefix = '', body = '';
  for (const char of piece) {
    if (CLOSERS[char]) { stack.push(char); body += char; }
    else if (OPENERS[char]) {
      if (!stack.length) { prefix = OPENERS[char] + prefix; body += char; }
      else if (stack[stack.length - 1] === OPENERS[char]) { stack.pop(); body += char; }
    } else body += char;
  }
  let text = prefix + body + stack.reverse().map(open => CLOSERS[open]).join(''), previous = '';
  while (previous !== text) { previous = text; text = text.replace(/\[\s*\]|\{\s*\}/g, ''); }
  return text.replace(/([[{])\s+/g, '$1').replace(/\s+([\]}])/g, '$1').trim();
};

/**
 * 按顶层逗号与换行切段，`1.2::a, b::` 权重组与括号内的逗号保持原样。
 * 括号或权重到行尾仍未闭合多半是笔误，这一截改按逗号逐个切开并补齐括号，避免一处笔误把后面整段并成一块。
 */
export function splitPromptTidySegments(prompt: string): string[] {
  const segments: string[] = [];
  let buffer = '', weighted = false, depth = 0;
  const push = () => {
    const runaway = depth > 0 || weighted;
    for (const piece of runaway ? buffer.split(/[,，]/) : [buffer]) {
      const value = (runaway ? completeBrackets(piece) : piece.trim()).replace(STRAY_COLONS, '');
      if (value) segments.push(value);
    }
    buffer = '';
  };
  for (let index = 0; index < prompt.length; index += 1) {
    const char = prompt[index];
    if (char === '\n' || char === '\r') { push(); weighted = false; depth = 0; continue; }
    if (char === ':' && prompt[index + 1] === ':') {
      if (weighted) weighted = false;
      else if (/^(?::+\s*)?[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(buffer.trim())) weighted = true;
      buffer += '::';
      index += 1;
      continue;
    }
    // 两组强调括号之间没写逗号（`[a] [b]`）也拆开，免得一组里的生词连累另一组。
    if (!weighted && depth === 0 && (char === '[' || char === '{') && /[\]}]\s*$/.test(buffer)) push();
    if (!weighted) {
      if ('{[(（'.includes(char)) depth += 1;
      else if ('}])）'.includes(char)) depth = Math.max(0, depth - 1);
      if (depth === 0 && (char === ',' || char === '，')) { push(); continue; }
    }
    buffer += char;
  }
  push();
  return segments;
}

/** 只剥成对的外层强调括号，`ashima_(roro046)` 这类名字自带的括号保留。 */
const splitBrackets = (piece: string) => {
  const [, lead, rawCore, trail] = piece.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  let core = rawCore, open = '', close = '';
  while (core.length > 1 && BRACKETS[core[0]] === core[core.length - 1]) { open += core[0]; close = core[core.length - 1] + close; core = core.slice(1, -1).trim(); }
  return { lead, open, core, close, trail };
};
const segmentPieces = (segment: string) => {
  const text = segment.replace(STRAY_COLONS, ''), weighted = text.match(WEIGHTED);
  return { head: weighted?.[1] ?? '', body: weighted?.[2] ?? text, tail: weighted?.[3] ?? '' };
};
const parenBalanced = (text: string) => {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')' && --depth < 0) return false;
  }
  return depth === 0;
};
/** 识别用：剥掉权重头、成对或落单的强调括号与多余冒号；名字自带的圆括号保留，多出来的才剥。 */
const cleanTag = (piece: string) => {
  let core = piece.replace(/^[\s{}[\]]+/, '').replace(WEIGHT_HEAD, '').replace(/^[\s{}[\]:]+|[\s{}[\]:]+$/g, '');
  while (core.startsWith('(') && core.endsWith(')') && parenBalanced(core.slice(1, -1))) core = core.slice(1, -1).trim();
  while (!parenBalanced(core) && (core.startsWith('(') || core.endsWith(')'))) core = (core.startsWith('(') ? core.slice(1) : core.slice(0, -1)).trim();
  return normalizeTagQuery(core);
};
const segmentTags = (segment: string) => segmentPieces(segment).body.split(/[,，]/).map(cleanTag).filter(Boolean);
const isArtistTag = (tag: string, categories: ReadonlyMap<string, TagSuggestion>) => /^(?:artist\s*:|by\s+)/.test(tag) || categories.get(tag)?.category === 1;
const withinOneEdit = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i += 1;
    if (a.length <= b.length) j += 1;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
/** 词库元信息（absurdres 等）、写法明显的画风描述，以及拼错一个字母的常见质量词也算画风。 */
const isStyleTag = (tag: string, categories: ReadonlyMap<string, TagSuggestion>) => isNovelAiStyleTag(tag, categories)
  || categories.get(tag)?.category === 5 || TIDY_STYLE_PATTERNS.some(pattern => pattern.test(tag))
  || (tag.length >= 7 && QUALITY_WORDS.some(word => withinOneEdit(tag, word)));

export type PromptTidySegmentKind = 'artist' | 'style' | 'content';
/** 一段里只要混入画面内容就整段算内容，不拆开权重组。 */
export function classifyPromptTidySegment(segment: string, categories: ReadonlyMap<string, TagSuggestion>): PromptTidySegmentKind {
  const tags = segmentTags(segment);
  if (!tags.length) return 'content';
  if (tags.every(tag => isArtistTag(tag, categories))) return 'artist';
  return tags.every(tag => isStyleTag(tag, categories)) ? 'style' : 'content';
}

/** 给词库认得的裸画师名补上 `artist:`，原拼写、括号与权重保持不变。 */
export function addPromptArtistPrefix(segment: string, categories: ReadonlyMap<string, TagSuggestion>): string {
  const { head, body, tail } = segmentPieces(segment);
  return head + body.split(/([,，])/).map((piece, index) => {
    if (index % 2) return piece;
    const { lead, open, core, close, trail } = splitBrackets(piece);
    const tag = normalizeTagQuery(core);
    if (!tag || /^(?:artist\s*:|by\s+)/.test(tag) || categories.get(tag)?.category !== 1) return piece;
    return `${lead}${open}artist:${core}${close}${trail}`;
  }).join('') + tail;
}

/**
 * 输出用：去掉配不上对的 {} []、括号内侧多出的逗号与空格（`[x,]` → `[x]`）、段首段尾多余的冒号与连续空格。原文笔误或相邻段被删后，
 * 落单的强调括号会影响后面所有词；圆括号在 NovelAI 里是普通字符，不动。
 */
export function repairPromptTidySegment(segment: string): string {
  const chars = [...segment], stack: number[] = [], drop = new Set<number>();
  chars.forEach((char, index) => {
    if (char === '{' || char === '[') stack.push(index);
    else if (char === '}' || char === ']') {
      if (stack.length && chars[stack[stack.length - 1]] === (char === '}' ? '{' : '[')) stack.pop();
      else drop.add(index);
    }
  });
  stack.forEach(index => drop.add(index));
  const text = chars.filter((_, index) => !drop.has(index)).join('').replace(/[ \t]{2,}/g, ' ')
    .replace(/([[{])[\s,，]+/g, '$1').replace(/[\s,，]+([\]}])/g, '$1').trim().replace(STRAY_COLONS, '');
  // 权重组内侧多出的逗号与空格一并去掉：`0.8::artist:kieed,::` → `0.8::artist:kieed::`。
  // 以数字结尾时收尾 :: 前必须留空格：`gebijiade89::` 会被 NovelAI 读成权重 89 的新组，出图直接坏掉。
  const weighted = text.match(WEIGHTED);
  if (weighted) {
    const body = weighted[2].replace(/^[\s,，]+|[\s,，]+$/g, '');
    return body ? `${weighted[1]}${body}${/[\d.]$/.test(body) ? ' ' : ''}::` : '';
  }
  return (WEIGHT_HEAD.test(text) ? text : text.replace(/^:+\s*/, '').replace(/\s*:+$/, '')).trim();
}

const dedupeKey = (segment: string) => normalizeTagQuery(segment).replace(/\s*::\s*/g, '::').replace(/\s*,\s*/g, ',');
const keepByRules = (kind: PromptTidySegmentKind, keep: PromptTidyKeep) =>
  keep === 'all' || (keep === 'artists' ? kind === 'artist' : keep === 'content' ? kind === 'content' : kind !== 'content');
const lookupCategories = async (segments: readonly string[]) => {
  try { return await lookupTagDictionaryEntries(segments.flatMap(segmentTags)); }
  // 词库未就绪时只靠 `artist:` 前缀与内置画风词判断，未知内容按画面内容处理。
  catch { return new Map<string, TagSuggestion>(); }
};

/** 结果统一用「, 」连成一行；模型改写时原样采用模型给出的正文。 */
export async function tidyPrompt(prompt: string, input: PromptTidySettings, service: PromptTidyService = promptAgentService): Promise<PromptTidyResult> {
  const settings = normalizePromptTidySettings(input);
  const method = resolvePromptTidyMethod(settings);
  const instruction = settings.keep === 'custom' ? settings.instruction.trim() : '';
  if (settings.keep === 'custom' && !instruction) throw new Error('请先写好整理要求');
  const segments = splitPromptTidySegments(prompt);
  if (!segments.length) throw new Error('没有可整理的提示词');
  if (isPromptTidyRewrite(settings)) {
    const text = (await service.tidyPrompt({ instruction, rewrite: true, prompt: prompt.trim() })).prompt?.trim();
    if (!text) throw new Error('助手返回的整理结果无效');
    return { text, kept: 0, removed: 0, rewritten: true, dropped: [] };
  }
  const categories = method === 'rules' || settings.artistPrefix ? await lookupCategories(segments) : new Map<string, TagSuggestion>();
  let keep: readonly boolean[];
  if (method === 'ai') {
    const result = await service.tidyPrompt({ instruction: instruction || AI_INSTRUCTIONS[settings.keep as 'style' | 'content'], chunks: segments });
    if (!Array.isArray(result.keep) || result.keep.length !== segments.length) throw new Error('助手返回的整理结果不完整');
    keep = result.keep;
  } else keep = segments.map(segment => keepByRules(classifyPromptTidySegment(segment, categories), settings.keep));
  const seen = new Set<string>();
  const kept: string[] = [], dropped: PromptTidyDropped[] = [];
  segments.forEach((segment, index) => {
    // 修完只剩空括号、冒号的笔误段也算去掉，列表条数与「去掉 N 段」一致。
    const repaired = keep[index] ? repairPromptTidySegment(segment) : '';
    if (!repaired) { dropped.push({ text: segment, duplicate: false }); return; }
    if (settings.dedupe) {
      const key = dedupeKey(repaired);
      if (seen.has(key)) { dropped.push({ text: segment, duplicate: true }); return; }
      seen.add(key);
    }
    kept.push(settings.artistPrefix ? addPromptArtistPrefix(repaired, categories) : repaired);
  });
  return { text: kept.join(', '), kept: kept.length, removed: dropped.length, rewritten: false, dropped };
}
