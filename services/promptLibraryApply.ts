import { getEntryPurposes, normalizePromptPurposeId, normalizePromptPurposeSectionKey, purposeSectionKey } from './promptPurposes.mjs';
import type { NAIParams, PromptChain, PromptSections } from '../types';
import { applyContentRollToParams, planContentRollApply, type ContentRollTarget } from './contentRollApply';
import {
  interactionAttributionWrites,
  mergeAttributionText,
  planInteractionAttribution,
  readInteractionPick,
  INTERACTION_POSE_KIND,
} from './contentRollInteraction';

const interactionSeedOf = (picks: Record<string, RollRow>) => {
  const row = readInteractionPick(picks);
  return String(row?.id || row?.text || 'interaction');
};
import { combinationPicks, applyLibraryText, fragmentKindOf, type PromptLibraryField } from './promptLibraryEntries';
import { mergePromptSections, resolvePromptSections } from './labWorkspace';
import { isStyleSectionKey, projectSectionedNegative, projectSectionedPrompt, readLabSectionLayout, subjectFromSections } from './labSections';
import { CHARACTER_SECTION_KEYS, compileCharacterContent } from './characterPrompts';
import { getEditableGlobalNegative, getEditableGlobalPrompt, mergePromptFields } from './promptUtils';
import type { PromptApplyMode } from './promptApply';
import { rollSectionKey, META, type RollRow } from './contentRoll';
import { createUuid } from './id';
import { getRuntimeNaiModelInfo } from './naiModels';
import { parsePromptTags } from './tagTranslations';
import { type PromptLibraryTreeState } from './promptLibraryTree.mjs';

export interface PromptLibraryWorkspaceState {
  params: NAIParams;
  base: string;
  subject: string;
  negative: string;
  classified: boolean;
  /** 分类编辑：画面和角色按栏写入，全局画风保持整段。 */
  sectioned?: boolean;
  maxCharacters?: number;
}

/** 名称补全的范围仅在确认取用后删除；用户后来改过文本时拒绝应用。 */
export interface LibraryCompletionEdit {
  value: string; start: number; end: number; field: PromptLibraryField;
}

export function removeLibraryCompletion(state: PromptLibraryWorkspaceState, edit?: LibraryCompletionEdit): PromptLibraryWorkspaceState {
  if (!edit) return state;
  if (parsePromptTags(edit.value).some(token => token.groupKind && token.groupStart !== undefined && token.groupEnd !== undefined && token.groupStart <= edit.start && token.groupEnd >= edit.end)) {
    throw new Error('分栏组合请在权重组外取用；片段补全仍保留权重');
  }
  const next = { ...state, params: { ...state.params } };
  const { field } = edit;
  const role = next.params.characters?.find(item => item.id === field.roleId);
  const sectionKey = field.purposeId ? purposeSectionKey(field.purposeId) : field.directoryId ? 'directory:' + field.directoryId : field.kind === 'general' ? 'extra' : field.kind;
  const sections = resolvePromptSections(next.params._promptSections, next.subject);
  const current = role ? sectionKey ? role.sections?.[sectionKey as keyof typeof role.sections] || '' : role.prompt || ''
    : sectionKey ? String((sections as Record<string, unknown>)[sectionKey] || '') : getEditableGlobalPrompt(next.base, next.subject);
  if (current !== edit.value) throw new Error('提示词已改变，请重新选择组合');
  const value = current.slice(0, edit.start) + current.slice(edit.end);
  if (role) next.params.characters = next.params.characters!.map(item => item.id !== role.id ? item : sectionKey
    ? { ...item, sections: { ...item.sections, [sectionKey]: value } } : { ...item, prompt: value });
  else if (sectionKey) {
    next.params._promptSections = { ...sections, [sectionKey]: value };
    next.subject = mergePromptSections(next.params._promptSections);
  } else { next.base = value; next.subject = ''; next.params._promptSections = {}; }
  return next;
}

export function planLibrarySelection(state: PromptLibraryWorkspaceState, entry: PromptChain, target: ContentRollTarget,
  mode: PromptApplyMode, field: PromptLibraryField = {}, roleIndex = 0, completion?: LibraryCompletionEdit, directories?: PromptLibraryTreeState) {
  const before = removeLibraryCompletion(state, completion);
  const kind = fragmentKindOf(entry);
  let picks: Record<string, RollRow> = kind ? {} : combinationPicks(entry, roleIndex);
  const purposes = getEntryPurposes(entry);
  if (field.purposeId && kind && (purposes.length !== 1 || purposes[0] !== normalizePromptPurposeId(field.purposeId))) throw new Error('此栏位只接受对应的单一用途片段');
  if (kind && purposes.length === 1) {
    const key = purposeSectionKey(purposes[0]);
    picks = { [key]: { kind: key, scope: target.mode === 'global' ? 'global' : 'character',
      filled: !!entry.basePrompt.trim(), text: entry.basePrompt, negative: entry.negativePrompt || '', id: entry.id, name: entry.name } };
  } else if (kind) picks = {};
  if (field.purposeId) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => normalizePromptPurposeSectionKey(rollSectionKey(key)) === purposeSectionKey(field.purposeId!))
    .map(([key, row]) => [key, { ...row, scope: target.mode === 'global' ? 'global' : 'character' }]));
  else if (field.directoryId) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => rollSectionKey(key) === 'directory:' + field.directoryId));
  else if (field.kind) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => key === field.kind));
  else if (field.roleId && !kind) picks = Object.fromEntries(Object.entries(picks).filter(([key, row]) => (row.scope || META[key]?.scope) === 'character'));
  const params = { ...before.params, _promptSections: resolvePromptSections(before.params._promptSections, before.subject) };
  const plan = planContentRollApply(picks, params, target);
  for (const row of plan.rows) {
    if (row.action !== 'replace') continue;
    if (mode === 'fill-missing' && row.current.trim()) {
      row.action = 'keep';
      if (row.targetScope === 'global') { delete plan.globalSections[row.kind]; delete plan.globalNegatives[row.kind]; }
      else plan.roleWrites = plan.roleWrites.filter(write => write.kind !== row.kind);
      plan.written = plan.written.filter(key => key !== (row.itemId || row.kind));
      continue;
    }
    row.next = applyLibraryText(row.current, row.next, mode);
    const roleWrite = row.targetScope === 'global' ? undefined : plan.roleWrites.find(write => write.kind === row.kind);
    if (roleWrite) {
      roleWrite.text = row.next;
      const old = params.characters?.find(role => role.id === plan.roleId)?.sectionNegatives?.[roleWrite.kind] || '';
      roleWrite.negative = mode === 'append' ? applyLibraryText(old, roleWrite.negative, mode) : roleWrite.negative;
      roleWrite.meta.source = 'library';
    } else {
      plan.globalSections[row.kind] = row.next;
      const old = params._promptSections.sectionNegatives?.[row.kind] || '';
      plan.globalNegatives[row.kind] = mode === 'append' ? applyLibraryText(old, plan.globalNegatives[row.kind] || '', mode) : plan.globalNegatives[row.kind] || '';
      plan.globalMeta[row.kind].source = 'library';
    }
  }
  return { before, params, plan };
}

export function applyLibrarySelection(selection: ReturnType<typeof planLibrarySelection>): PromptLibraryWorkspaceState {
  const { before, params, plan } = selection;
  if (plan.target.mode === 'new' && plan.roleWrites.length && (params.characters?.length || 0) >= (before.maxCharacters ?? getRuntimeNaiModelInfo(params.model).maxCharacters)) throw new Error('当前模型的角色数量已达上限');
  const result = applyContentRollToParams(params, plan, createUuid);
  const writesGlobal = Object.keys(plan.globalSections).length > 0;
  if (!writesGlobal) result.params._promptSections = before.params._promptSections;
  const next = { ...before, params: result.params, subject: writesGlobal ? mergePromptSections(result.params._promptSections) : before.subject };
  if (before.sectioned) {
    const projected = projectSectionedPrompt(next.base, next.params._promptSections);
    const folded = projectSectionedNegative(next.negative, projected.sections);
    next.base = projected.base;
    next.negative = folded.negative;
    next.params = { ...next.params, _promptSections: folded.sections };
    next.subject = writesGlobal || Object.keys(plan.globalSections).length ? subjectFromSections(folded.sections, readLabSectionLayout(next.params._labSectionLayout)) : next.subject;
  } else if (!before.classified) {
    if (writesGlobal) {
      next.base = mergePromptFields(next.base, next.subject);
      next.negative = Object.entries(next.params._promptSections?.sectionNegatives || {}).reduce((text, [kind, negative]) =>
      (next.params._promptSections as Record<string, unknown>)[kind] ? mergePromptFields(text, negative) : text, next.negative);
      next.subject = ''; next.params._promptSections = {};
    }
    next.params = { ...next.params, characters: next.params.characters?.map(role => {
      if (!plan.roleWrites.length || plan.target.mode === 'existing' && role.id !== plan.roleId || plan.target.mode === 'new' && role.id !== result.createdRoleId || plan.target.mode === 'all-enabled' && role.enabled === false) return role;
      const compiled = compileCharacterContent(role, (params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives);
      return { ...role, prompt: compiled.prompt, negativePrompt: compiled.negativePrompt, sections: undefined, sectionNegatives: undefined, sectionMeta: Object.fromEntries(CHARACTER_SECTION_KEYS.map(kind => [kind, { source: 'manual' }])) };
    }) };
  }
  return next;
}

/** 仅当前工作区会话使用；不从正文猜测来源，不持久化到配方。 */
export interface RollApplyReceipt {
  newRoleId?: string;
  fields: Record<string, { before: string; after: string; parts: Record<string, string> }>;
}

const facetField = (roleId: string | undefined, kind: string, negative: boolean) =>
  `${roleId ? `character:${roleId}:facet:` : 'picture:'}${kind}${negative ? ':negative' : ''}`;

/**
 * 分类编辑下的 Roll：每个用途写回自己的栏，重抽只换这一栏里本次抽到的部分。
 * 全局画风（base / 全局负面 / 画风用途）保持原样。
 */
export function applySectionedRoll(
  state: PromptLibraryWorkspaceState,
  picks: Record<string, RollRow>,
  target: ContentRollTarget,
  previousReceipt?: RollApplyReceipt,
): { state: PromptLibraryWorkspaceState; receipt: RollApplyReceipt; conflicts: string[] } {
  const roles = state.params.characters || [];
  if (target.mode === 'existing' && !roles.some(role => role.id === target.id)) throw new Error('目标角色已不存在，请重新打开随机搭配');
  const incoming = new Map<string, { roleId?: string; negative: boolean; kind: string; parts: Record<string, string> }>();
  for (const [key, row] of Object.entries(picks)) {
    if (!row.filled) continue;
    const kind = rollSectionKey(key);
    if (isStyleSectionKey(kind) || isStyleSectionKey(key)) continue;
    const picture = target.mode === 'global' || kind === 'presentation' || (row.scope || META[kind]?.scope) === 'global';
    const ids = picture ? [undefined] : target.mode === 'existing' ? [target.id] : target.mode === 'all-enabled' ? roles.filter(role => role.enabled !== false).map(role => role.id) : [];
    for (const id of ids) {
      for (const negative of [false, true]) {
        const field = facetField(id, kind, negative);
        const data = incoming.get(field) || { roleId: id, negative, kind, parts: {} };
        data.parts[kind] = [data.parts[kind], negative ? row.negative || '' : row.text || ''].filter(part => part !== undefined).join(', ');
        incoming.set(field, data);
      }
    }
  }
  const next = { ...state, sectioned: true, params: { ...state.params, _promptSections: { ...(state.params._promptSections || {}) } } };
  const sections = { ...(next.params._promptSections || {}) } as PromptSections;
  const sectionNegatives = { ...(sections.sectionNegatives || {}) };
  const characters = roles.map(role => ({ ...role, sections: { ...(role.sections || {}) }, sectionNegatives: { ...(role.sectionNegatives || {}) } }));
  const receipt: RollApplyReceipt = { fields: { ...previousReceipt?.fields } };
  const conflicts: string[] = [];
  let pictureChanged = false;
  for (const [field, data] of incoming) {
    const role = data.roleId ? characters.find(item => item.id === data.roleId) : undefined;
    const current = role
      ? textOf(data.negative ? (role.sectionNegatives as Record<string, string> | undefined)?.[data.kind] : role.sections?.[data.kind as keyof typeof role.sections])
      : textOf(data.negative ? sectionNegatives[data.kind] : (sections as Record<string, unknown>)[data.kind]);
    const previous = previousReceipt?.fields[field];
    if (previous && current !== previous.after) { conflicts.push(field); continue; }
    const before = previous ? previous.before : current;
    const parts = { ...previous?.parts, ...data.parts };
    const after = mergePromptFields(before, Object.values(parts).filter(part => part.trim()).join(', '));
    receipt.fields[field] = { before, after, parts };
    if (role) {
      if (data.negative) role.sectionNegatives = { ...role.sectionNegatives, [data.kind]: after };
      else role.sections = { ...role.sections, [data.kind]: after };
      if (!after.trim()) {
        if (data.negative) delete (role.sectionNegatives as Record<string, string>)[data.kind];
        else delete role.sections[data.kind as keyof typeof role.sections];
      }
    } else if (data.negative) {
      if (after.trim()) sectionNegatives[data.kind] = after; else delete sectionNegatives[data.kind];
      pictureChanged = true;
    } else {
      (sections as Record<string, string>)[data.kind] = after;
      if (!after.trim()) delete (sections as Record<string, unknown>)[data.kind];
      pictureChanged = true;
    }
  }
  if (target.mode === 'global' || target.mode === 'all-enabled') {
    const attribution = planInteractionAttribution(picks, state.params, interactionSeedOf(picks));
    for (const write of interactionAttributionWrites(attribution)) {
      const role = characters.find(item => item.id === write.characterId);
      if (!role) continue;
      const field = facetField(role.id, write.kind, false);
      const current = textOf((role.sections as Record<string, string> | undefined)?.[write.kind]);
      const previous = previousReceipt?.fields[field];
      if (previous && current !== previous.after) { conflicts.push(field); continue; }
      const before = previous ? previous.before : current;
      const after = mergeAttributionText(before, write.text);
      receipt.fields[field] = { before, after, parts: { ...(previous?.parts || {}), [write.kind]: write.text } };
      role.sections = { ...role.sections, [write.kind]: after };
    }
  }
  sections.sectionNegatives = sectionNegatives;
  next.params = { ...next.params, _promptSections: sections, characters };
  if (pictureChanged) next.subject = subjectFromSections(sections, readLabSectionLayout(next.params._labSectionLayout));
  return { state: next, receipt, conflicts };
}

const textOf = (value: unknown) => String(value ?? '');

/** 纯规划也用于预览；调用方成功应用state后才接受receipt，撤销时一并恢复。 */
export function applyRollSelection(
  state: PromptLibraryWorkspaceState,
  picks: Record<string, RollRow>,
  target: ContentRollTarget,
  previousReceipt?: RollApplyReceipt,
): { state: PromptLibraryWorkspaceState; receipt: RollApplyReceipt; conflicts: string[] } {
  if (state.sectioned) return applySectionedRoll(state, picks, target, previousReceipt);
  const roles = state.params.characters || [];
  if (target.mode === 'existing' && !roles.some(role => role.id === target.id)) throw new Error('目标角色已不存在，请重新打开随机搭配');
  const hasRoleContent = Object.entries(picks).some(([key, row]) => row.filled && (row.text?.trim() || row.negative?.trim()) && (row.scope || META[rollSectionKey(key)]?.scope) !== 'global' && rollSectionKey(key) !== 'presentation');
  const newId = target.mode === 'new' && hasRoleContent ? previousReceipt?.newRoleId && roles.some(role => role.id === previousReceipt.newRoleId) ? previousReceipt.newRoleId : createUuid() : '';
  const creatingRole = !!newId && !roles.some(role => role.id === newId);
  if (creatingRole && roles.length >= (state.maxCharacters ?? getRuntimeNaiModelInfo(state.params.model).maxCharacters)) throw new Error('当前模型的角色数量已达上限');
  const targetIds = target.mode === 'existing' ? [target.id] : target.mode === 'all-enabled' ? roles.filter(role => role.enabled !== false).map(role => role.id) : newId ? [newId] : [];
  const incoming = new Map<string, { roleId?: string; negative: boolean; parts: Record<string, string> }>();
  const add = (roleId: string | undefined, negative: boolean, kind: string, text: string) => {
    const field = (roleId ? 'character:' + roleId : 'global') + (negative ? ':negative' : ':positive');
    const data = incoming.get(field) || { roleId, negative, parts: {} };
    data.parts[kind] = [data.parts[kind], text].filter(Boolean).join(', ');
    incoming.set(field, data);
  };
  for (const [key, row] of Object.entries(picks)) {
    if (!row.filled) continue;
    const kind = rollSectionKey(key);
    const ids = target.mode === 'global' || kind === 'presentation' || (row.scope || META[kind]?.scope) === 'global' ? [undefined] : targetIds;
    for (const id of ids) {
      add(id, false, kind, row.text || '');
      add(id, true, kind, row.negative || '');
    }
  }
  if (target.mode === 'global' || target.mode === 'all-enabled') {
    const attribution = planInteractionAttribution(picks, state.params, interactionSeedOf(picks));
    for (const write of interactionAttributionWrites(attribution)) {
      add(write.characterId, false, INTERACTION_POSE_KIND, write.text);
    }
  }
  const next = { ...state, classified: false, params: { ...state.params } };
  let characters = roles.map(role => ({ ...role }));
  if (creatingRole) characters.push({ id: newId, prompt: '', x: 0.5, y: 0.5 });
  const receipt: RollApplyReceipt = { ...(newId || previousReceipt?.newRoleId ? { newRoleId: newId || previousReceipt?.newRoleId } : {}), fields: { ...previousReceipt?.fields } };
  const conflicts: string[] = [];
  const changedRoles = new Set<string>();
  let globalPositive = false, globalNegative = false;
  const legacyNegatives = (state.params as NAIParams & { _characterSectionsNegatives?: Record<string, unknown> })._characterSectionsNegatives;
  for (const [field, data] of incoming) {
    const role = data.roleId ? characters.find(role => role.id === data.roleId) : undefined;
    const compiled = role ? compileCharacterContent(roles.find(original => original.id === role.id) || role, legacyNegatives) : undefined;
    const current = role ? data.negative ? compiled?.negativePrompt || '' : compiled?.prompt || ''
      : data.negative ? getEditableGlobalNegative(state.negative, state.params._promptSections) : getEditableGlobalPrompt(state.base, state.subject);
    const previous = previousReceipt?.fields[field];
    if (previous && current !== previous.after) { conflicts.push(field); continue; }
    const before = previous ? previous.before : current;
    const parts = { ...previous?.parts, ...data.parts };
    const after = [before, ...Object.values(parts)].filter(value => value.trim()).join(', ');
    receipt.fields[field] = { before, after, parts };
    if (role) {
      if (data.negative) role.negativePrompt = after; else role.prompt = after;
      changedRoles.add(role.id);
    } else if (data.negative) { next.negative = after; globalNegative = true; }
    else { next.base = after; next.subject = ''; globalPositive = true; }
  }
  // 两个方向独立处理；未改方向先合并旧分类，防止清分栏时丢失旧词。
  if (globalPositive || globalNegative) {
    if (!globalPositive) { next.base = getEditableGlobalPrompt(state.base, state.subject); next.subject = ''; }
    if (!globalNegative) next.negative = getEditableGlobalNegative(state.negative, state.params._promptSections);
    next.params._promptSections = undefined;
  }
  if (changedRoles.size) {
    characters = characters.map(role => {
      if (!changedRoles.has(role.id)) return role;
      const original = roles.find(item => item.id === role.id);
      const compiled = original ? compileCharacterContent(original, legacyNegatives) : undefined;
      const positiveUpdated = incoming.has('character:' + role.id + ':positive') && !conflicts.includes('character:' + role.id + ':positive');
      const negativeUpdated = incoming.has('character:' + role.id + ':negative') && !conflicts.includes('character:' + role.id + ':negative');
      return { ...role, prompt: positiveUpdated ? role.prompt : compiled?.prompt || role.prompt,
        negativePrompt: negativeUpdated ? role.negativePrompt : compiled?.negativePrompt || role.negativePrompt,
        sections: undefined, sectionNegatives: undefined };
    });
    next.params.characters = characters;
  }
  return { state: next, receipt, conflicts };
}
