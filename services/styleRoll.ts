import type { NAIParams, PromptChain } from '../types';
import { createUuid } from './id';

export interface RollArtist { tag: string; weight: number; locked: boolean; excluded: boolean }
/** 候选只记录本次抽到的画师与权重，不保存来源关系或代数。 */
export interface RollTag { tag: string; weight: number }
export interface RollRules { minArtists: number; maxArtists: number; minWeight: number; maxWeight: number }
export interface RollTemplate { prompt: string; negativePrompt: string; characterPrompt?: string; params: NAIParams }
/** 本轮随机哪些维度；固定权重用 rules.minWeight === maxWeight 表达，不另存数值。 */
export type RollDrawMode = 'random' | 'pinnedArtists' | 'fixedWeight';
export interface RollDrawPlan {
  mode: RollDrawMode;
  /** 仅固定画师模式：这组 Tag 每轮必用，权重仍按范围随机。 */
  pinnedArtists?: string[];
}
export interface RollRoundSnapshot {
  rules: RollRules;
  mode: RollDrawMode;
  pinnedArtists?: string[];
  sampledOnly?: boolean;
}
export interface RollCandidate {
  id: string;
  tags: RollTag[];
  createdAt: number;
  archived: boolean;
  savedChainId?: string;
}
export interface RollRound {
  id: string; candidateIds: string[]; createdAt: number; closedAt?: number;
  /** 这一轮实际使用的抽取条件，用于回看与复现。 */
  snapshot?: RollRoundSnapshot;
}
export interface RollExperiment {
  version: 1;
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  template: RollTemplate;
  artists: RollArtist[];
  rules: RollRules;
  drawPlan?: RollDrawPlan;
  /** 只从有样张的画师中抽取；不影响已锁定的覆盖项。 */
  sampledOnly?: boolean;
  candidates: RollCandidate[];
  rounds: RollRound[];
  archived?: boolean;
}

export const DEFAULT_ROLL_RULES: RollRules = { minArtists: 3, maxArtists: 6, minWeight: 0.7, maxWeight: 1.4 };
/** 新建记录的公共提示词：质量词包围画师串，主体固定，细节与光影修饰，年份收尾。 */
export const DEFAULT_ROLL_PROMPT = 'masterpiece, very aesthetic, best quality, absurdres, highres, no text, {style}, 1girl, solo, upper body, looking at viewer, intricate details, ultra-detailed, depth of field, shiny skin, realistic skin surface, cinematic lighting, simple background, year 2025';
export const DEFAULT_ROLL_NEGATIVE = 'worst quality, lowres, bad quality, jpeg artifacts, very displeasing, logo, chromatic aberration, scan artifacts, film grain, artistic error, multiple views, dithering, halftone, too many watermarks, blank page, screentone, negative space, watermark, signature, bad anatomy, bad hands, blurry';
/** 历史默认模板：仍原样保存且没有候选时升级为新默认，用户改过的内容不动。 */
export const LEGACY_ROLL_PROMPTS = ['{style}, 1girl, solo, upper body, simple background, looking at viewer'];
export const ROLL_CANDIDATE_LIMIT = 240;
/** 单条 Roll 配方最多包含的画师数；足够覆盖较长的风格串，同时保留数据与界面安全边界。 */
export const ROLL_MAX_ARTISTS = 64;
const tenth = (value: number) => Math.round(value * 10) / 10;
const tagKey = (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s+/g, ' ').toLowerCase();
const validTag = (tag: unknown): tag is string => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 200 && !/[,\n\r:{}\[\]<>]/.test(tag);
const validWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 3 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;

/** 指定画师只覆盖抽取规则，数值权重作为锁定时的初始值，不混入主体提示词。 */
export function parseRollArtists(text: string): RollArtist[] {
  const result: RollArtist[] = [], seen = new Set<string>();
  for (const part of text.split(/[,，\n\r]+/).map(value => value.trim()).filter(Boolean)) {
    const weighted = part.match(/^([\d.]+)::\s*(.*?)\s*::$/);
    const tag = (weighted ? weighted[2] : part).replace(/^artists?\s*:\s*/i, '').trim();
    const weight = weighted ? Number(weighted[1]) : 1;
    if (!validTag(tag) || !validWeight(weight)) throw new Error('请填写画师 Tag，权重使用 0.1～3.0 的一位小数');
    if (!seen.has(tagKey(tag))) { seen.add(tagKey(tag)); result.push({ tag, weight, locked: false, excluded: false }); }
  }
  if (result.length > 1000) throw new Error('每个画风记录最多指定 1000 位画师');
  return result;
}

export function mergeRollArtists(current: RollArtist[], incoming: RollArtist[]): RollArtist[] {
  const keys = new Set(current.map(artist => tagKey(artist.tag)));
  const added = incoming.filter(artist => { const key = tagKey(artist.tag); if (keys.has(key)) return false; keys.add(key); return true; });
  if (current.length + added.length > 1000) throw new Error('每个画风记录最多指定 1000 位画师');
  return [...current, ...added];
}

/** 直接从完整画师词库抽取；实验只保存锁定／排除等覆盖项，不复制整份词库。 */
export function resolveRollArtists(library: string[], overrides: RollArtist[]): RollArtist[] {
  const artists = new Map<string, RollArtist>();
  for (const tag of library) if (validTag(tag) && !artists.has(tagKey(tag))) artists.set(tagKey(tag), { tag, weight: 1, locked: false, excluded: false });
  for (const artist of overrides) artists.set(tagKey(artist.tag), artist);
  return [...artists.values()];
}

export const formatRollStyle = (tags: RollTag[]) => tags.map(item => `${item.weight.toFixed(1)}::artist:${item.tag} ::`).join(', ');
export const rollSignature = (tags: RollTag[]) => JSON.stringify(tags.map(item => [tagKey(item.tag), tenth(item.weight)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
export const rollSourceId = (experimentId: string) => `style-roll:${experimentId}`;
export const rollCandidateModuleId = (candidateId: string) => `style-roll:${candidateId}`;
/** 画师串后紧跟独立的角色提示词；模板可用 {character} 指定位置。 */
export const rollPrompt = (template: RollTemplate, tags: RollTag[]) => {
  const style = formatRollStyle(tags), character = template.characterPrompt?.trim() || '';
  if (template.prompt.includes('{character}')) return template.prompt.replace('{character}', character).replace('{style}', style);
  if (!character) return template.prompt.replace('{style}', style);
  return template.prompt.replace('{style}', `${style}, ${character}`);
};

export function validateRollTemplate(template: RollTemplate): void {
  const character = template?.characterPrompt;
  if (!template || typeof template.prompt !== 'string' || template.prompt.length > 32000 || template.prompt.split('{style}').length !== 2 ||
    template.prompt.split('{character}').length > 2 ||
    (character !== undefined && typeof character !== 'string') || (typeof character === 'string' && character.length > 32000) ||
    typeof template.negativePrompt !== 'string' || template.negativePrompt.length > 32000) throw new Error('公共提示词需要且只能包含一个 {style} 占位符');
  const p = template.params;
  if (!p || typeof p.model !== 'string' || !/^nai-diffusion-(?:4|4-5|5)-/.test(p.model) || p.model.endsWith('-inpainting') ||
    !Number.isSafeInteger(p.seed) || p.seed! < 0 || p.seed! > 4294967295 ||
    ![p.width, p.height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096 && value % 64 === 0) ||
    !Number.isSafeInteger(p.steps) || p.steps < 1 || p.steps > 50 || !Number.isFinite(p.scale) || p.scale < 0 || p.scale > 10 ||
    typeof p.sampler !== 'string' || p.sampler.length > 100) throw new Error('请设置有效的文生图参数与固定 Seed');
}

function validateRuleRanges(rules: RollRules): void {
  if (!rules || !Number.isSafeInteger(rules.minArtists) || !Number.isSafeInteger(rules.maxArtists) ||
    rules.minArtists < 1 || rules.maxArtists > ROLL_MAX_ARTISTS || rules.minArtists > rules.maxArtists ||
    !validWeight(rules.minWeight) || !validWeight(rules.maxWeight) || rules.minWeight > rules.maxWeight) throw new Error('请检查画师数量和权重范围');
}

export function validateRollRules(artists: RollArtist[], rules: RollRules): void {
  validateRuleRanges(rules);
  const usable = artists.filter(artist => !artist.excluded), locked = usable.filter(artist => artist.locked);
  if (usable.length < rules.minArtists) throw new Error('可用画师不足，请调整锁定／排除项或降低最少画师数');
  if (locked.length > rules.maxArtists) throw new Error('锁定画师数量超过每串上限');
}

export function validateRollDrawPlan(plan: RollDrawPlan | undefined, rules: RollRules): void {
  if (plan === undefined) return;
  if (!plan || !['random', 'pinnedArtists', 'fixedWeight'].includes(plan.mode)) throw new Error('抽取方式无效');
  if (plan.mode === 'pinnedArtists') {
    if (!Array.isArray(plan.pinnedArtists) || !plan.pinnedArtists.length || plan.pinnedArtists.length > ROLL_MAX_ARTISTS ||
      plan.pinnedArtists.some(tag => !validTag(tag)) ||
      new Set(plan.pinnedArtists.map(tagKey)).size !== plan.pinnedArtists.length) throw new Error(`固定画师需要 1～${ROLL_MAX_ARTISTS} 个不重复的画师 Tag`);
  } else if (plan.pinnedArtists !== undefined) throw new Error('当前抽取方式不接受固定画师');
  if (plan.mode === 'fixedWeight' && rules.minWeight !== rules.maxWeight) throw new Error('固定权重需要最低与最高权重相同');
}

/** 全局屏蔽名单：所有记录抽取时都不会抽到这些画师。 */
export function validateRollBlocklist(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some(tag => !validTag(tag))) throw new Error('屏蔽画师列表无效');
}

/** 保存／导入是信任边界，资料读坏时停止，不能用空数据覆盖。 */
export function validateRollExperiment(value: unknown): asserts value is RollExperiment {
  const e = value as RollExperiment;
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  if (!e || e.version !== 1 || !validId(e.id) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 120 ||
    !Number.isSafeInteger(e.revision) || e.revision < 0 || ![e.createdAt, e.updatedAt].every(Number.isFinite) ||
    !Array.isArray(e.artists) || e.artists.length > 1000 || !Array.isArray(e.candidates) || e.candidates.length > ROLL_CANDIDATE_LIMIT ||
    (e.archived !== undefined && typeof e.archived !== 'boolean') || (e.sampledOnly !== undefined && typeof e.sampledOnly !== 'boolean')) throw new Error('Roll 串画风记录资料无效');
  validateRollTemplate(e.template);
  const keys = new Set<string>();
  for (const artist of e.artists) {
    if (!artist || !validTag(artist.tag) || !validWeight(artist.weight) || typeof artist.locked !== 'boolean' || typeof artist.excluded !== 'boolean' ||
      keys.has(tagKey(artist.tag))) throw new Error('指定画师包含无效或重复条目');
    keys.add(tagKey(artist.tag));
  }
  // 未指定覆盖项时直接使用画师库；实际组串时再检查可用数量。
  validateRuleRanges(e.rules);
  validateRollDrawPlan(e.drawPlan, e.rules);
  const ids = new Set<string>();
  for (const candidate of e.candidates) {
    if (!candidate || !validId(candidate.id) || ids.has(candidate.id) || !Array.isArray(candidate.tags) || !candidate.tags.length || candidate.tags.length > ROLL_MAX_ARTISTS ||
      !candidate.tags.every(tag => tag && validTag(tag.tag) && validWeight(tag.weight)) || new Set(candidate.tags.map(tag => tagKey(tag.tag))).size !== candidate.tags.length ||
      !Number.isFinite(candidate.createdAt) || typeof candidate.archived !== 'boolean' ||
      (candidate.savedChainId !== undefined && !validId(candidate.savedChainId))) throw new Error('候选串资料无效');
    ids.add(candidate.id);
  }
  const rounds = new Set<string>();
  if (!Array.isArray(e.rounds) || e.rounds.length > ROLL_CANDIDATE_LIMIT) throw new Error('画风轮次资料无效');
  for (const round of e.rounds) {
    if (!round || !validId(round.id) || rounds.has(round.id) ||
      !Number.isFinite(round.createdAt) || (round.closedAt !== undefined && !Number.isFinite(round.closedAt)) ||
      !Array.isArray(round.candidateIds) || !round.candidateIds.length || round.candidateIds.length > 24 || new Set(round.candidateIds).size !== round.candidateIds.length || round.candidateIds.some(id => !ids.has(id))) throw new Error('画风轮次资料无效');
    if (round.snapshot !== undefined) {
      const snapshot = round.snapshot as RollRoundSnapshot;
      if (!snapshot || typeof snapshot !== 'object') throw new Error('画风轮次资料无效');
      validateRuleRanges(snapshot.rules);
      validateRollDrawPlan({ mode: snapshot.mode, pinnedArtists: snapshot.pinnedArtists }, snapshot.rules);
      if (snapshot.sampledOnly !== undefined && typeof snapshot.sampledOnly !== 'boolean') throw new Error('画风轮次资料无效');
    }
    rounds.add(round.id);
  }
}

export function rollCandidates(experiment: RollExperiment, count: number, options: { random?: () => number; plan?: RollDrawPlan; blockedTags?: string[] } = {}): RollCandidate[] {
  validateRollRules(experiment.artists, experiment.rules);
  const plan = options.plan;
  validateRollDrawPlan(plan, experiment.rules);
  if (!Number.isSafeInteger(count) || count < 1 || count > 24 || experiment.candidates.length + count > ROLL_CANDIDATE_LIMIT) {
    const remaining = Math.max(0, ROLL_CANDIDATE_LIMIT - experiment.candidates.length);
    throw new Error(`本记录最多保留 ${ROLL_CANDIDATE_LIMIT} 个候选，当前还可 Roll ${remaining} 串；可在回收站永久清理旧候选后继续`);
  }
  const random = options.random || Math.random, rules = experiment.rules;
  const blocked = new Set((options.blockedTags || []).map(tagKey));
  const pool = experiment.artists.filter(artist => !artist.excluded && !blocked.has(tagKey(artist.tag)));
  const locked = pool.filter(artist => artist.locked);
  const pinnedTags = plan?.mode === 'pinnedArtists' ? plan.pinnedArtists! : null;
  if (!pinnedTags && pool.length < rules.minArtists) throw new Error('可用画师不足（已扣除屏蔽项），请调整屏蔽名单或降低最少画师数');
  if (pinnedTags) {
    const pinned = pinnedTags.map(tag => {
      const artist = pool.find(item => tagKey(item.tag) === tagKey(tag));
      if (!artist) throw new Error(`固定画师不可用：${tag}（可能被排除或屏蔽）`);
      return artist;
    });
    const missingLocked = locked.find(artist => !pinned.some(item => tagKey(item.tag) === tagKey(artist.tag)));
    if (missingLocked) throw new Error(`固定画师需要包含已锁定的画师：${missingLocked.tag}`);
  }
  const choose = <T,>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  const integer = (min: number, max: number) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
  const weight = () => plan?.mode === 'fixedWeight' ? rules.minWeight : integer(Math.round(rules.minWeight * 10), Math.round(rules.maxWeight * 10)) / 10;
  const signatures = new Set(experiment.candidates.map(candidate => rollSignature(candidate.tags))), result: RollCandidate[] = [];
  for (let attempts = 0; result.length < count && attempts < count * 100; attempts++) {
    let tags: RollTag[];
    if (pinnedTags) {
      tags = pinnedTags.map(tag => {
        const artist = pool.find(item => tagKey(item.tag) === tagKey(tag))!;
        return { tag: artist.tag, weight: artist.locked ? artist.weight : weight() };
      });
    } else {
      tags = locked.map(({ tag, weight: lockedWeight }) => ({ tag, weight: lockedWeight }));
      const target = integer(Math.max(rules.minArtists, locked.length), Math.min(rules.maxArtists, pool.length));
      const unused = pool.filter(artist => !tags.some(item => tagKey(item.tag) === tagKey(artist.tag)));
      while (tags.length < target && unused.length) { const artist = choose(unused); tags.push({ tag: artist.tag, weight: weight() }); unused.splice(unused.indexOf(artist), 1); }
    }
    const signature = rollSignature(tags);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    result.push({ id: createUuid(), tags, createdAt: Date.now() + result.length, archived: false });
  }
  if (!result.length) throw new Error('当前规则下没有新的组合，请调整画师数量、锁定项或权重范围');
  return result;
}

/** 记录容量：候选上限只约束实际配方，不把已归档项藏成另一套计数。 */
export const rollCandidateCapacity = (experiment: RollExperiment) => Math.max(0, ROLL_CANDIDATE_LIMIT - experiment.candidates.length);

/**
 * 永久清理已归档候选；轮次引用同步移除，空轮删除。
 * 只接受已归档项，避免用户误删仍在挑选的候选。
 */
export function removeRollCandidates(experiment: RollExperiment, ids: readonly string[]): RollExperiment {
  const remove = new Set(ids);
  if (!remove.size) return experiment;
  const candidates = experiment.candidates.filter(candidate => {
    if (!remove.has(candidate.id)) return true;
    if (!candidate.archived) throw new Error('只能永久清理已归档的候选');
    return false;
  });
  const rounds = experiment.rounds
    .map(round => ({ ...round, candidateIds: round.candidateIds.filter(id => !remove.has(id)) }))
    .filter(round => round.candidateIds.length > 0);
  return { ...experiment, candidates, rounds };
}

/** 保存后的风格串名带 1～2 位主权重画师，便于在风格串列表里回想配方。 */
export function rollCandidateToChain(experiment: RollExperiment, candidate: RollCandidate, imageUrl?: string): PromptChain {
  const index = experiment.candidates.indexOf(candidate) + 1;
  const leadArtists = [...candidate.tags].sort((a, b) => b.weight - a.weight).slice(0, 2).map(item => item.tag).join(' / ');
  const name = `${experiment.name} · ${index}${leadArtists ? ` · ${leadArtists}` : ''}`.slice(0, 120);
  return {
    id: '', userId: '', name, description: 'Roll 串',
    type: 'style', basePrompt: rollPrompt(experiment.template, candidate.tags), negativePrompt: experiment.template.negativePrompt,
    params: structuredClone(experiment.template.params), modules: [], variableValues: { subject: '' }, tags: [],
    previewImage: imageUrl, createdAt: Date.now(), updatedAt: Date.now(),
  };
}
