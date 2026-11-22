import type { CharacterParams, NAIParams } from '../../types';
import { getDefaultStepsForModel, isNaiMediumModel } from '../naiModels';
import { joinNaiTextPrompt, splitNaiTextPrompt } from '../transparentBackground.mjs';
import { clampAnchorCoord, getPanelTargetResolution } from './comicGeometry';
import type {
  ComicAnchor,
  ComicBubbleShape,
  ComicDialogueMode,
  ComicPageDraft,
  ComicPanel,
  ComicV5ModelId,
} from './comicTypes';

/** 全精画质单次生图推荐锚点上限（实测 4~12 槽为全精甜点区）。 */
export const COMIC_ANCHOR_SOFT_LIMIT = 12;

/** 网关单次生图锚点硬红线（实测 24 槽全中，32 槽触发 422 拒收）。 */
export const COMIC_ANCHOR_HARD_LIMIT = 24;

export const COMIC_V5_MODELS: Array<{ id: ComicV5ModelId; label: string; badge: string }> = [
  { id: 'nai-diffusion-5-full', label: 'V5 Full (High)', badge: '全精 23 步' },
  { id: 'nai-diffusion-5-full-medium', label: 'V5 Full (Medium)', badge: '快速 14 步' },
  { id: 'nai-diffusion-5-curated', label: 'V5 Curated', badge: '精选 23 步' },
];

const MONOCHROME_HUE_WORDS = [
  'red', 'crimson', 'scarlet', 'vermilion', 'burgundy', 'maroon',
  'blue', 'navy', 'azure', 'cobalt', 'cyan', 'turquoise', 'teal', 'indigo', 'sky blue', 'light blue', 'dark blue', 'aqua',
  'green', 'emerald', 'lime', 'olive', 'mint', 'dark green', 'light green',
  'yellow', 'gold', 'golden', 'amber', 'blonde', 'blond',
  'orange', 'peach', 'coral', 'ginger', 'auburn',
  'purple', 'violet', 'lavender', 'lilac', 'magenta', 'plum',
  'pink', 'rose', 'salmon',
  'brown', 'beige', 'tan', 'chestnut', 'khaki', 'cream', 'caramel',
  'rainbow', 'multicolored', 'colorful', 'vibrant colors', 'full color', 'colored',
];

const MONOCHROME_HUE_REGEX = new RegExp(
  `\\b(?:${MONOCHROME_HUE_WORDS.sort((a, b) => b.length - a.length).join('|')})\\b`,
  'gi',
);

const MONOCHROME_NEGATIVE_TAGS = 'color, colored, colorful, vibrant colors, full color, chromatic, red, blue, green, yellow, pink, purple, orange';

const COMIC_CONFLICT_NEGATIVE_PATTERNS = [
  /\bscreentone\b/gi,
  /\bhalftone\b/gi,
  /\bmultiple views\b/gi,
  /\bmanga\b/gi,
  /\bcomic\b/gi,
  /\bmonochrome\b/gi,
  /\bgreyscale\b/gi,
  /\bgrayscale\b/gi,
];

const cleanCommaList = (text: string): string => text
  .split(',')
  .map(part => part.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join(', ');

/**
 * 黑白网点漫发送副本净色：剥离纯色相词（保留 black / white / grey / silver 等明度词），
 * 仅作用于发送给 V5 的临时副本，绝不修改用户角色库或草稿原词。
 */
export const stripColorTagsForMonochrome = (text: string): string => {
  if (!text.trim()) return '';
  const stripped = text
    .split(',')
    .map(segment => {
      const cleaned = segment
        .replace(MONOCHROME_HUE_REGEX, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // 去掉剥色后只剩孤立连词/符号的碎片
      if (!cleaned || /^[-_:/\\|&+\s{}[\]]+$/.test(cleaned)) return '';
      return cleaned;
    })
    .filter(Boolean)
    .join(', ');
  return cleanCommaList(stripped);
};

/** 清理负面提示词中会压制漫画网点与分镜表现的冲突词。 */
export const sanitizeComicNegativeConflicts = (negative: string, monochrome: boolean): string => {
  let result = negative;
  for (const pattern of COMIC_CONFLICT_NEGATIVE_PATTERNS) {
    if (!monochrome && (pattern.source.includes('monochrome') || pattern.source.includes('greyscale') || pattern.source.includes('grayscale'))) {
      continue;
    }
    result = result.replace(pattern, '');
  }
  return cleanCommaList(result);
};

const bubbleShapeTags = (shape: ComicBubbleShape | undefined): string => {
  switch (shape) {
    case 'shout':
      return 'jagged speech bubble, spiky shout bubble, white opaque bubble';
    case 'thought':
      return 'cloud thought bubble, fluffy thought bubble, white opaque bubble';
    case 'caption':
      return 'rectangular narration box, white caption box';
    case 'oval':
    default:
      return 'oval speech bubble, white opaque speech bubble';
  }
};

/**
 * V5 `Text:` 提示词语法硬约束：
 * 使用 `splitNaiTextPrompt` / `joinNaiTextPrompt` 拆分所有片段中的 `Text:` 画面字，
 * 确保任意普通 Tag（含 monochrome / greyscale / 氛围词）永远拼在描述区，
 * `Text: ...` 永远位于整段 caption 绝对末尾，绝不被 V5 当成画面字原样印出。
 */
export const assembleV5TextSafePrompt = (
  parts: Array<string | undefined | null>,
  options?: { monochrome?: boolean; explicitText?: string },
): string => {
  const descriptions: string[] = [];
  const textClauses: string[] = [];
  for (const raw of parts) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const { description, text } = splitNaiTextPrompt(trimmed);
    const cleanedDesc = options?.monochrome ? stripColorTagsForMonochrome(description) : description.trim();
    if (cleanedDesc) descriptions.push(cleanedDesc);
    if (text.trim()) textClauses.push(text.trim());
  }
  if (options?.explicitText?.trim()) {
    const rawExplicit = options.explicitText.trim();
    const clause = /^text:/i.test(rawExplicit) ? rawExplicit : `Text: ${rawExplicit}`;
    if (!textClauses.includes(clause)) textClauses.push(clause);
  }
  const mergedDesc = cleanCommaList(descriptions.join(', '));
  if (!textClauses.length) return mergedDesc;
  const mergedText = textClauses.join('\n');
  return mergedDesc ? joinNaiTextPrompt(mergedDesc, mergedText) : mergedText;
};

const compileAnchorCaption = (
  anchor: ComicAnchor,
  dialogueMode: ComicDialogueMode,
  monochrome: boolean,
): { prompt: string; negative: string } => {
  const baseNeg = anchor.negativePrompt.trim();

  if (anchor.kind === 'bubble') {
    const shape = bubbleShapeTags(anchor.bubbleShape);
    if (dialogueMode === 'ai-text' && anchor.bubbleText?.trim()) {
      return {
        prompt: assembleV5TextSafePrompt([shape, anchor.prompt], {
          monochrome,
          explicitText: anchor.bubbleText.trim(),
        }),
        negative: baseNeg,
      };
    }
    return {
      prompt: assembleV5TextSafePrompt(
        [shape, 'empty speech bubble, blank speech bubble, no text inside bubble', anchor.prompt],
        { monochrome },
      ),
      negative: cleanCommaList([baseNeg, 'text, letters, gibberish, watermark'].filter(Boolean).join(', ')),
    };
  }

  if (anchor.kind === 'inset') {
    return {
      prompt: assembleV5TextSafePrompt(
        ['inset panel, white bordered close-up box, picture-in-picture', anchor.prompt],
        { monochrome },
      ),
      negative: monochrome ? cleanCommaList([baseNeg, MONOCHROME_NEGATIVE_TAGS].filter(Boolean).join(', ')) : baseNeg,
    };
  }

  if (anchor.kind === 'scene') {
    return {
      prompt: assembleV5TextSafePrompt([anchor.prompt], { monochrome }),
      negative: monochrome ? cleanCommaList([baseNeg, MONOCHROME_NEGATIVE_TAGS].filter(Boolean).join(', ')) : baseNeg,
    };
  }

  // character
  return {
    prompt: assembleV5TextSafePrompt([anchor.prompt], { monochrome }),
    negative: monochrome ? cleanCommaList([baseNeg, MONOCHROME_NEGATIVE_TAGS].filter(Boolean).join(', ')) : baseNeg,
  };
};

export interface ComicAnchorGuardSummary {
  activeCount: number;
  softLimit: number;
  hardLimit: number;
  level: 'ok' | 'soft-warning' | 'hard-exceeded';
  mergedGhostBgCount: number;
}

export const evaluateAnchorGuard = (anchors: ComicAnchor[]): ComicAnchorGuardSummary => {
  const enabled = anchors.filter(item => item.enabled);
  const hasCharacter = enabled.some(item => item.kind === 'character');
  const mergedGhostBgCount = hasCharacter
    ? enabled.filter(item => item.kind === 'scene' && /\bno\s+humans\b/i.test(item.prompt)).length
    : 0;
  const activeCount = enabled.length - mergedGhostBgCount;
  const level = activeCount > COMIC_ANCHOR_HARD_LIMIT
    ? 'hard-exceeded'
    : activeCount > COMIC_ANCHOR_SOFT_LIMIT
      ? 'soft-warning'
      : 'ok';
  return {
    activeCount,
    softLimit: COMIC_ANCHOR_SOFT_LIMIT,
    hardLimit: COMIC_ANCHOR_HARD_LIMIT,
    level,
    mergedGhostBgCount,
  };
};

export interface CompiledComicPanelRequest {
  prompt: string;
  negative: string;
  params: NAIParams;
  guard: ComicAnchorGuardSummary;
  warnings: string[];
}

/**
 * 编译单格手动精控 V5 生成请求（应用全部实测避坑铁律，绝不改写原草稿或角色库）。
 */
export const buildComicPanelGenerationInput = (
  page: ComicPageDraft,
  panel: ComicPanel,
): CompiledComicPanelRequest => {
  const warnings: string[] = [];
  const monochrome = page.colorMode === 'monochrome';
  const resolution = getPanelTargetResolution(panel, page.width, page.height);
  const enabledAnchors = panel.anchors.filter(item => item.enabled);
  const hasCharacter = enabledAnchors.some(item => item.kind === 'character');

  // 铁律 ① 防幽灵克隆：有人格的格子禁止另发独立 no humans 纯背景槽，自动并入该格总描述。
  const mergedSceneNotes: string[] = [];
  const keptAnchors: ComicAnchor[] = [];
  for (const anchor of enabledAnchors) {
    if (hasCharacter && anchor.kind === 'scene' && /\bno\s+humans\b/i.test(anchor.prompt)) {
      const cleanedScene = anchor.prompt.replace(/\bno\s+humans\b/gi, '').trim();
      if (cleanedScene) mergedSceneNotes.push(cleanedScene);
      continue;
    }
    // 无气泡纯画面模式下忽略气泡锚点，省出槽位名额
    if (page.dialogueMode === 'clean-vector' && anchor.kind === 'bubble') {
      continue;
    }
    keptAnchors.push(anchor);
  }

  if (mergedSceneNotes.length > 0) {
    warnings.push('已自动将有人格内的纯背景描述合并，避免幽灵克隆');
  }

  const guard = evaluateAnchorGuard(panel.anchors);
  const cappedAnchors = keptAnchors.slice(0, COMIC_ANCHOR_HARD_LIMIT);

  const modeFramingTags: string[] = [];
  if (monochrome) {
    modeFramingTags.push('monochrome, greyscale, manga, screentone, crisp ink lineart');
  }
  if (page.dialogueMode === 'clean-vector') {
    modeFramingTags.push('no speech bubbles, no text');
  }

  const promptParts = [
    page.globalBasePrompt,
    ...modeFramingTags,
    panel.prompt,
    ...mergedSceneNotes,
  ];

  const globalNeg = sanitizeComicNegativeConflicts(page.globalNegativePrompt, monochrome);
  const panelNeg = sanitizeComicNegativeConflicts(panel.negativePrompt, monochrome);
  const negParts = [globalNeg, panelNeg];
  if (monochrome) negParts.push(MONOCHROME_NEGATIVE_TAGS);
  if (page.dialogueMode === 'clean-vector') negParts.push('speech bubble, dialogue, text, watermark, caption');
  if (page.dialogueMode === 'empty-bubble') negParts.push('text, letters, gibberish, speech text');

  const characters: CharacterParams[] = cappedAnchors
    .map(anchor => {
      const compiled = compileAnchorCaption(anchor, page.dialogueMode, monochrome);
      if (!compiled.prompt) return null;
      return {
        id: anchor.id,
        name: anchor.label,
        enabled: true,
        prompt: compiled.prompt,
        negativePrompt: compiled.negative,
        x: clampAnchorCoord(anchor.x),
        y: clampAnchorCoord(anchor.y),
      } satisfies CharacterParams;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const isMedium = isNaiMediumModel(page.v5Model);
  const steps = isMedium ? 14 : (page.steps || getDefaultStepsForModel(page.v5Model));

  const params: NAIParams = {
    model: page.v5Model,
    width: resolution.width,
    height: resolution.height,
    steps,
    scale: page.scale || 5,
    sampler: isMedium ? 'k_euler_ancestral' : (page.sampler || 'k_euler_ancestral'),
    noiseSchedule: page.noiseSchedule || 'karras',
    cfgRescale: isMedium ? 0 : (page.cfgRescale ?? 0),
    variety: page.variety === true,
    qualityPresetId: page.qualityPresetId || 'standard',
    ucPresetId: isMedium ? 'heavy' : (page.ucPresetId || 'light'),
    ...(page.seed !== undefined ? { seed: page.seed } : {}),
    useCoords: panel.useCoords && characters.length > 0,
    characters,
  };

  return {
    prompt: assembleV5TextSafePrompt(promptParts, { monochrome }),
    negative: cleanCommaList(negParts.filter(Boolean).join(', ')),
    params,
    guard,
    warnings,
  };
};

const DANBOORU_CAST_PREFIX = 'danbooru:';

/** 将 Danbooru 词库角色编码为稳定的 castCharacterIds 项。 */
export const encodeDanbooruCastId = (tagName: string, chineseLabel?: string): string => {
  const cleanTag = tagName.trim();
  const cleanLabel = (chineseLabel || '').trim();
  return cleanLabel ? `${DANBOORU_CAST_PREFIX}${cleanTag}|${cleanLabel}` : `${DANBOORU_CAST_PREFIX}${cleanTag}`;
};

/** 解析 castCharacterIds 中的 Danbooru 词库角色项；非词库项返回 null。 */
export const parseDanbooruCastId = (id: string): { tag: string; label: string; prompt: string } | null => {
  if (!id.startsWith(DANBOORU_CAST_PREFIX)) return null;
  const rest = id.slice(DANBOORU_CAST_PREFIX.length);
  const sep = rest.indexOf('|');
  const tag = (sep >= 0 ? rest.slice(0, sep) : rest).trim();
  if (!tag) return null;
  const label = (sep >= 0 ? rest.slice(sep + 1) : '').trim() || tag.replace(/_/g, ' ');
  return {
    tag,
    label,
    prompt: tag.replace(/_/g, ' '),
  };
};
