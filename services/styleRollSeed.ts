import type { PromptChain } from '../types';
import { compilePrompt } from './promptUtils';
import { parsePromptTags, removePromptTagTokens } from './tagTranslations';
import { DEFAULT_ROLL_RULES, parseRollArtists, ROLL_MAX_ARTISTS, validateRollDrawPlan, validateRollTemplate, type RollArtist, type RollDrawPlan, type RollRules, type RollTemplate } from './styleRoll';
import { DEFAULT_NAI_MODEL } from './naiModels';

export interface RollChainSeed {
  template: RollTemplate;
  artists: RollArtist[];
  rules: RollRules;
  drawPlan: RollDrawPlan;
  /** 原权重超出 Roll 的 0.1～3.0 一位小数范围，导入时已取整。 */
  normalizedWeights: boolean;
  /** 语法异常、无法作为画师 Tag 使用的条目数。 */
  skippedArtists: number;
}

/** 词库匹配键：大小写、下划线与括号前空格不影响裸画师名识别。 */
export const normalizeRollArtistKey = (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s*\(/g, ' (').replace(/\s+/g, ' ').toLowerCase();
const normalizeImportWeight = (value: string | number | undefined) => {
  const number = Number(value);
  if (value === undefined || !Number.isFinite(number)) return 1;
  return Math.round(Math.min(3, Math.max(0.1, number)) * 10) / 10;
};
/** 导入时清理常见的分组／括号／残留冒号，并尝试从脏 Token 中取回画师名与权重。 */
const parseImportedArtistToken = (value: string, groupWeight?: string): { tag: string; weight: string | number } | null => {
  let tag = value.trim().replace(/[<>[\]{}]/g, '').trim();
  const byMatch = tag.match(/^by[\s:]+(.+)$/i);
  const atMatch = tag.match(/^@(.+)$/);
  if (byMatch || atMatch) {
    const rawName = (byMatch?.[1] ?? atMatch?.[1] ?? '').trim();
    const trailingWeight = rawName.match(/^(.*?):\s*(\d+(?:\.\d+)?)$/);
    const name = (trailingWeight ? trailingWeight[1] : rawName).replace(/^[\s:;|]+|[\s:;|]+$/g, '').trim();
    return name ? { tag: name, weight: trailingWeight?.[2] ?? groupWeight ?? 1 } : null;
  }
  const matches = [...tag.matchAll(/artists?\s*:/gi)];
  const last = matches.at(-1);
  let prefix = '';
  if (last?.index !== undefined) { prefix = tag.slice(0, last.index); tag = tag.slice(last.index + last[0].length); }
  const prefixedWeight = prefix.match(/(\d+(?:\.\d+)?)\s*:+\s*$/)?.[1];
  tag = tag.replace(/^[\s:;,|]+|[\s:;,|}>\]]+$/g, '');
  if (/^\(+/.test(value) && /\)$/.test(tag)) tag = tag.replace(/\)+$/, '');
  tag = tag.replace(/^artists?\s*:\s*/i, '').trim();
  if (!tag) return null;
  return { tag, weight: prefixedWeight ?? groupWeight ?? 1 };
};
const isArtistToken = (token: { start?: number; end?: number; displayTag: string }, prompt: string, knownArtists?: ReadonlySet<string>) => {
  if (token.start === undefined || token.end === undefined) return false;
  const raw = prompt.slice(token.start, token.end);
  if (/artists?\s*:/i.test(raw)) return true;
  const prefixed = raw.match(/^by[\s:]+(.+)$/i)?.[1] ?? raw.match(/^@(.+)$/)?.[1];
  if (prefixed) {
    const name = prefixed.replace(/:\s*\d+(?:\.\d+)?$/, '').trim();
    if (knownArtists?.has(normalizeRollArtistKey(name))) return true;
  }
  return Boolean(knownArtists?.has(normalizeRollArtistKey(token.displayTag)));
};

/** 列表预览用的画师数量；与真正导入使用同一套识别规则。 */
export function countRollChainArtists(chain: PromptChain, knownArtists?: ReadonlySet<string>): number {
  const prompt = compilePrompt(chain, chain.variableValues?.subject || '').trim();
  return parsePromptTags(prompt).filter(token => isArtistToken(token, prompt, knownArtists)).length;
}

const cleanRemainingPrompt = (value: string) => value
  .replace(/\s*[,，]\s*(?=[,，])/g, '')
  .replace(/^[\s,，|]+|[\s,，|]+$/g, '')
  .trim();

/**
 * 把已有风格串转成 Roll 起点：保留公共提示词、负面、参数、角色与固定 Seed，
 * 画师串改为占位符并作为固定画师组；首次保留原权重，由调用方决定何时重 roll。
 */
export function rollSeedFromChain(chain: PromptChain, fallbackSeed = 0, knownArtists?: ReadonlySet<string>): RollChainSeed {
  const prompt = compilePrompt(chain, chain.variableValues?.subject || '').trim();
  const tokens = parsePromptTags(prompt);
  const artistTokens = tokens.filter(token => isArtistToken(token, prompt, knownArtists));
  if (!artistTokens.length) throw new Error('该风格串没有可识别的画师 Tag；请使用 artist: 或 Artists: 前缀（大小写不限），或确认画师名已收录在词库');
  let normalizedWeights = false;
  let skippedArtists = 0;
  const seen = new Set<string>();
  const artists: RollArtist[] = [];
  for (const token of artistTokens) {
    const parsed = parseImportedArtistToken(token.displayTag, token.groupWeight);
    if (!parsed) { skippedArtists++; continue; }
    const weight = normalizeImportWeight(parsed.weight);
    if (Math.abs(Number(parsed.weight) - weight) > 1e-9) normalizedWeights = true;
    if (!parsed.tag) { skippedArtists++; continue; }
    try {
      const [artist] = parseRollArtists(`${weight.toFixed(1)}::${parsed.tag} ::`);
      if (!artist) { skippedArtists++; continue; }
      if (seen.has(normalizeRollArtistKey(artist.tag))) continue;
      seen.add(normalizeRollArtistKey(artist.tag));
      artists.push(artist);
    } catch { skippedArtists++; }
  }
  if (!artists.length) throw new Error('该风格串没有可用的画师 Tag');
  if (artists.length > ROLL_MAX_ARTISTS) throw new Error(`Roll 每串最多 ${ROLL_MAX_ARTISTS} 位画师，请先精简风格串`);
  const artistSet = new Set(artistTokens);
  const groups = new Map<string, typeof artistTokens>();
  tokens.forEach(token => {
    const groupKey = token.groupId || token.id;
    groups.set(groupKey, [...(groups.get(groupKey) || []), token]);
  });
  const artistGroups = [...groups.values()].filter(members => members.some(token => artistSet.has(token)));
  const hasMixedGroup = artistGroups.some(members => members.some(token => !artistSet.has(token)));
  let promptWithStyle = `{style}`;
  if (!hasMixedGroup) {
    // 画师全部位于独立分组时，把 {style} 放回原画师组的位置，保留其余提示词的顺序。
    let ordered = prompt;
    const replacements = artistGroups.map((members, index) => {
      const first = members[0];
      return { start: first.groupStart ?? first.start!, end: first.groupEnd ?? first.end!, replacement: index === 0 ? '{style}' : '' };
    }).sort((left, right) => right.start - left.start);
    for (const { start, end, replacement } of replacements) ordered = ordered.slice(0, start) + replacement + ordered.slice(end);
    promptWithStyle = cleanRemainingPrompt(ordered);
  } else {
    const common = cleanRemainingPrompt(removePromptTagTokens(prompt, artistTokens));
    promptWithStyle = `{style}${common ? `, ${common}` : ''}`;
  }
  const template: RollTemplate = {
    prompt: promptWithStyle,
    negativePrompt: chain.negativePrompt || '',
    params: structuredClone(chain.params),
  };
  const params = template.params;
  // 旧风格串可能没有记录模型；Roll 以当前默认文生图模型继续，其余参数保持原样。
  params.model = params.model || DEFAULT_NAI_MODEL;
  if (!/^nai-diffusion-(?:4|4-5|5)-/.test(params.model) || params.model.endsWith('-inpainting')) throw new Error('该风格串使用的不是文生图模型，无法作为 Roll 起点');
  const fallback = Number.isSafeInteger(fallbackSeed) && fallbackSeed >= 0 ? fallbackSeed : 0;
  const rawSeed = params.seed;
  params.seed = !Number.isSafeInteger(rawSeed) || rawSeed! < 0 ? fallback : rawSeed! > 4294967295 ? rawSeed! % 4294967296 : rawSeed!;
  validateRollTemplate(template);
  const rules: RollRules = { ...DEFAULT_ROLL_RULES, minArtists: artists.length, maxArtists: artists.length };
  const drawPlan: RollDrawPlan = { mode: 'pinnedArtists', pinnedArtists: artists.map(artist => artist.tag) };
  validateRollDrawPlan(drawPlan, rules);
  return {
    template,
    artists: artists.map(artist => ({ ...artist, locked: true })),
    rules,
    drawPlan,
    normalizedWeights,
    skippedArtists,
  };
}

/** 固定画师替换后同步覆盖项：移除旧画师，新画师继承被替换位置的权重与锁定状态。 */
export function replacePinnedArtistOverrides(overrides: RollArtist[], previousTags: readonly string[], nextTags: readonly string[]): RollArtist[] {
  const previousKeys = new Set(previousTags.map(normalizeRollArtistKey));
  const nextKeys = new Set(nextTags.map(normalizeRollArtistKey));
  const next = overrides.filter(artist => !previousKeys.has(normalizeRollArtistKey(artist.tag)) || nextKeys.has(normalizeRollArtistKey(artist.tag)));
  nextTags.forEach((tag, index) => {
    const replaced = previousTags[index];
    const old = replaced && normalizeRollArtistKey(replaced) !== normalizeRollArtistKey(tag) ? overrides.find(artist => normalizeRollArtistKey(artist.tag) === normalizeRollArtistKey(replaced)) : undefined;
    const existingIndex = next.findIndex(artist => normalizeRollArtistKey(artist.tag) === normalizeRollArtistKey(tag));
    if (existingIndex >= 0) {
      next[existingIndex] = { ...next[existingIndex], excluded: false, ...(old ? { weight: old.weight, locked: old.locked } : {}) };
      return;
    }
    next.push({ tag, weight: old?.weight ?? 1, locked: old?.locked ?? false, excluded: false });
  });
  return next;
}

/** 是否有固定画师仍保留原权重；决定「重roll权重」入口是否显示。 */
export function hasLockedPinnedArtists(overrides: RollArtist[], pinnedTags: readonly string[]): boolean {
  const keys = new Set(pinnedTags.map(normalizeRollArtistKey));
  return overrides.some(artist => artist.locked && keys.has(normalizeRollArtistKey(artist.tag)));
}

/** 解除固定画师的锁定，让后续 Roll 重新随机权重。 */
export function unlockPinnedArtists(overrides: RollArtist[], pinnedTags: readonly string[]): RollArtist[] {
  const keys = new Set(pinnedTags.map(normalizeRollArtistKey));
  return overrides.map(artist => keys.has(normalizeRollArtistKey(artist.tag)) ? { ...artist, locked: false } : artist);
}
