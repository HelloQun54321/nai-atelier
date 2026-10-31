import { purposeSectionKey } from './promptPurposes.mjs';
import { rollSectionKey, type RollRow } from './contentRoll';
import type { CharacterParams, NAIParams } from '../types';

const enabledCharacters = (params: NAIParams | null | undefined): CharacterParams[] =>
  (Array.isArray(params?.characters) ? params!.characters! : []).filter(item => item.enabled !== false);

/** 互动归属写入角色姿态栏，与助手约定的 source#／target#／mutual# 一致。 */
export const INTERACTION_POSE_KIND = purposeSectionKey('pose');

export type InteractionAttributionMode = 'directed' | 'mutual';

export interface InteractionAttribution {
  mode: InteractionAttributionMode;
  actionTag: string;
  sourceId: string;
  targetId: string;
  sourceIndex: number;
  targetIndex: number;
  sourceLabel: string;
  targetLabel: string;
  sourceBinding: string;
  targetBinding: string;
}

export interface InteractionCharacterWrite {
  characterId: string;
  label: string;
  kind: string;
  text: string;
}

const MUTUAL_RE = /\b(holding hands|eye contact|looking at each other|facing each other|side[- ]by[- ]side|hug each other|mutual)\b/i;
const DIRECTED_RE = /\b(kiss(?:ing)?|touch(?:ing)?|grab(?:bing)?|leaning|riding|penetrat\w*|pinning|feeding|carrying|pulling|pushing|hug(?:ging)?)\b/i;

const KNOWN_ACTIONS = [
  'holding hands', 'eye contact', 'looking at each other', 'facing each other',
  'kissing', 'kiss', 'hug', 'hugging', 'touching', 'grabbing', 'riding',
  'penetrating', 'pinning down', 'pinning', 'feeding', 'carrying', 'leaning',
] as const;

const splitTags = (value: string): string[] =>
  String(value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean);

const normalizeAction = (value: string): string =>
  value.trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');

/** 从互动正文取一个 NovelAI 熟悉的动作概念，供 source#／target#／mutual# 使用。 */
export function extractInteractionActionTag(text: string): string {
  const tags = splitTags(text).map(normalizeAction);
  for (const tag of tags) {
    for (const known of KNOWN_ACTIONS) {
      if (tag === known || tag.includes(known)) {
        if (known === 'kiss') return 'kissing';
        if (known === 'hugging') return 'hug';
        if (known === 'pinning') return 'pinning down';
        return known;
      }
    }
  }
  return tags[0] || 'interacting';
}

/** 对等互动用 mutual；明显单向用 directed；说不清时按单向处理。 */
export function classifyInteractionMode(text: string): InteractionAttributionMode {
  if (MUTUAL_RE.test(text)) return 'mutual';
  if (DIRECTED_RE.test(text)) return 'directed';
  return 'directed';
}

export function bindingTag(role: 'source' | 'target' | 'mutual', actionTag: string): string {
  return `${role}#${actionTag}`;
}

/** 简单可复现的伪随机，保证同一 seed／同一角色集合抽到同一对。 */
export function seededUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000003) / 1000003;
}

export function pickOrderedCharacterPair(ids: string[], seed: string): [string, string] | null {
  if (ids.length < 2) return null;
  const pool = [...ids];
  const firstIndex = Math.floor(seededUnit(`${seed}:a`) * pool.length) % pool.length;
  const sourceId = pool.splice(firstIndex, 1)[0];
  const secondIndex = Math.floor(seededUnit(`${seed}:b`) * pool.length) % pool.length;
  const targetId = pool[secondIndex];
  return [sourceId, targetId];
}

export function readInteractionPick(picks: Record<string, RollRow> | null | undefined): RollRow | null {
  if (!picks) return null;
  for (const [key, row] of Object.entries(picks)) {
    if (rollSectionKey(key) !== purposeSectionKey('interaction')) continue;
    if (!row?.filled || !String(row.text || '').trim()) continue;
    return row;
  }
  return null;
}

/**
 * 全局互动在启用角色≥2 时生成归属：
 * 单向 → 随机有序一对写 source#／target#；对等 → 同一对双方写 mutual#。
 * 不足两人或没有互动正文时返回 null。
 */
export function planInteractionAttribution(
  picks: Record<string, RollRow> | null | undefined,
  params: NAIParams | null | undefined,
  seed = 'interaction',
): InteractionAttribution | null {
  const row = readInteractionPick(picks);
  if (!row) return null;
  const characters = enabledCharacters(params);
  if (characters.length < 2) return null;
  const ids = characters.map(item => String(item.id));
  const pair = pickOrderedCharacterPair(ids, `${seed}:${row.id || row.text}`);
  if (!pair) return null;
  const [sourceId, targetId] = pair;
  const sourceIndex = characters.findIndex(item => String(item.id) === sourceId);
  const targetIndex = characters.findIndex(item => String(item.id) === targetId);
  const actionTag = extractInteractionActionTag(String(row.text || ''));
  const mode = classifyInteractionMode(String(row.text || ''));
  const sourceBinding = mode === 'mutual' ? bindingTag('mutual', actionTag) : bindingTag('source', actionTag);
  const targetBinding = mode === 'mutual' ? bindingTag('mutual', actionTag) : bindingTag('target', actionTag);
  return {
    mode,
    actionTag,
    sourceId,
    targetId,
    sourceIndex,
    targetIndex,
    sourceLabel: `角色 ${sourceIndex + 1}`,
    targetLabel: `角色 ${targetIndex + 1}`,
    sourceBinding,
    targetBinding,
  };
}

export function interactionAttributionWrites(attribution: InteractionAttribution | null | undefined): InteractionCharacterWrite[] {
  if (!attribution) return [];
  return [
    { characterId: attribution.sourceId, label: attribution.sourceLabel, kind: INTERACTION_POSE_KIND, text: attribution.sourceBinding },
    { characterId: attribution.targetId, label: attribution.targetLabel, kind: INTERACTION_POSE_KIND, text: attribution.targetBinding },
  ];
}

/** 把归属 Tag 追加进已有姿态／正文，已存在则不重复。 */
export function mergeAttributionText(current: string, binding: string): string {
  const probe = normalizeAction(binding);
  const existing = splitTags(current).map(normalizeAction);
  if (existing.includes(probe)) return current.trim();
  return [current.trim(), binding].filter(Boolean).join(', ');
}
