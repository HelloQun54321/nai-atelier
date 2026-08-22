import { lookupTagTranslations, normalizeTagQuery, TagSuggestion } from './tagDictionary';

export interface PromptImportSplit {
  basePrompt: string;
  subjectPrompt: string;
  styleSegmentCount: number;
  subjectSegmentCount: number;
}

const STYLE_EXACT = new Set([
  'masterpiece', 'best quality', 'amazing quality', 'great quality', 'normal quality',
  'very aesthetic', 'aesthetic', 'absurdres', 'highres', 'highly detailed',
  'highly finished', 'no text', 'ai-generated', 'artist collaboration',
  'digital illustration', 'digital art', 'character study', 'complex shading',
  'simple background', 'transparent background', 'white background',
]);

const STYLE_PATTERNS = [
  /^artist\s*:/,
  /^(?:year\s+)?20\d{2}(?:\s*\(style\))?$/,
  /(?:^|\s)(?:quality|aesthetic|resolution)(?:$|\s)/,
  /^(?:oil painting|watercolor|gouache|pastel|charcoal|pencil|sketch|lineart|line art|ink|pixel art|3d|cgi|photorealistic|realistic|anime|manga)$/,
  /^(?:cel shading|soft shading|flat color|impasto|chiaroscuro|cinematic lighting|dramatic lighting)$/,
  /^(?:by\s+).+/,
];

/** 按 NovelAI 的数值权重 `1.2::a, b::` 分组，组内逗号不会被误切开。 */
export const tokenizeNovelAiPrompt = (prompt: string): string[] => {
  const segments: string[] = [];
  let buffer = '';
  let weighted = false;
  let bracketDepth = 0;

  const push = () => {
    const value = buffer.trim();
    if (value) segments.push(value);
    buffer = '';
  };

  for (let index = 0; index < prompt.length; index += 1) {
    const char = prompt[index];
    const next = prompt[index + 1];
    if (char === ':' && next === ':') {
      if (weighted) {
        weighted = false;
      } else if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(buffer.trim())) {
        weighted = true;
      }
      buffer += '::';
      index += 1;
      continue;
    }
    if (!weighted) {
      if ('{[('.includes(char)) bracketDepth += 1;
      if ('}])'.includes(char)) bracketDepth = Math.max(0, bracketDepth - 1);
      if (char === ',' && bracketDepth === 0) {
        push();
        continue;
      }
    }
    buffer += char;
  }
  push();
  return segments;
};

const unwrapSegment = (segment: string): string => {
  const weighted = segment.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::([\s\S]*)::$/);
  return weighted ? weighted[1] : segment;
};

const atomicTags = (segment: string): string[] => unwrapSegment(segment)
  .split(',')
  .map(tag => normalizeTagQuery(tag.replace(/^[{}[\]()]+|[{}[\]()]+$/g, '')))
  .filter(Boolean);

const isStyleTag = (tag: string, categories: ReadonlyMap<string, TagSuggestion>): boolean => {
  if (categories.get(tag)?.category === 1) return true;
  return STYLE_EXACT.has(tag) || STYLE_PATTERNS.some(pattern => pattern.test(tag));
};

/**
 * 高置信度拆分：画师、质量、年代、媒介和渲染词进入基础画风；人物、场景及
 * 无法确定的词保留在主体。一个权重组只要含歧义词就整体留在主体，避免破坏权重。
 */
export const splitNovelAiPromptWithCategories = (
  prompt: string,
  categories: ReadonlyMap<string, TagSuggestion>,
): PromptImportSplit => {
  const styleSegments: string[] = [];
  const subjectSegments: string[] = [];
  for (const segment of tokenizeNovelAiPrompt(prompt)) {
    const tags = atomicTags(segment);
    (tags.length > 0 && tags.every(tag => isStyleTag(tag, categories))
      ? styleSegments
      : subjectSegments).push(segment);
  }
  return {
    basePrompt: styleSegments.join(', '),
    subjectPrompt: subjectSegments.join(', '),
    styleSegmentCount: styleSegments.length,
    subjectSegmentCount: subjectSegments.length,
  };
};

export const splitNovelAiPrompt = async (prompt: string): Promise<PromptImportSplit> => {
  const tags = tokenizeNovelAiPrompt(prompt).flatMap(atomicTags);
  try {
    return splitNovelAiPromptWithCategories(prompt, await lookupTagTranslations(tags));
  } catch {
    // 离线或词典尚未加载时仍使用内置高置信规则，未知内容继续留在主体。
    return splitNovelAiPromptWithCategories(prompt, new Map());
  }
};
