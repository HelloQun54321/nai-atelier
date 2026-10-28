import { getEntryPurposes, purposeSectionKey } from './promptPurposes.mjs';
import type { NAIParams, PromptChain } from '../types';
import { applyContentRollToParams, planContentRollApply, type ContentRollTarget } from './contentRollApply';
import { combinationPicks, applyLibraryText, fragmentKindOf, type PromptLibraryField } from './promptLibraryEntries';
import { mergePromptSections, resolvePromptSections } from './labWorkspace';
import { CHARACTER_SECTION_KEYS, compileCharacterContent } from './characterPrompts';
import { getEditableGlobalPrompt, mergePromptFields } from './promptUtils';
import type { PromptApplyMode } from './promptApply';
import { META, type RollRow } from './contentRoll';
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
  if (field.purposeId && kind && (purposes.length !== 1 || purposes[0] !== field.purposeId)) throw new Error('此栏位只接受对应的单一用途片段');
  if (kind && purposes.length === 1) {
    const key = purposeSectionKey(purposes[0]);
    picks = { [key]: { kind: key, scope: target.mode === 'global' ? 'global' : 'character',
      filled: !!entry.basePrompt.trim(), text: entry.basePrompt, negative: entry.negativePrompt || '', id: entry.id, name: entry.name } };
  } else if (kind) picks = {};
  if (field.purposeId) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => key === purposeSectionKey(field.purposeId!))
    .map(([key, row]) => [key, { ...row, scope: target.mode === 'global' ? 'global' : 'character' }]));
  else if (field.directoryId) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => key === 'directory:' + field.directoryId));
  else if (field.kind) picks = Object.fromEntries(Object.entries(picks).filter(([key]) => key === field.kind));
  else if (field.roleId && !kind) picks = Object.fromEntries(Object.entries(picks).filter(([key, row]) => (row.scope || META[key]?.scope) === 'character'));
  const params = { ...before.params, _promptSections: resolvePromptSections(before.params._promptSections, before.subject) };
  const plan = planContentRollApply(picks, params, target);
  for (const row of plan.rows) {
    if (row.action !== 'replace') continue;
    if (mode === 'fill-missing' && row.current.trim()) {
      row.action = 'keep'; delete plan.globalSections[row.kind]; delete plan.globalNegatives[row.kind];
      plan.roleWrites = plan.roleWrites.filter(write => write.kind !== row.kind);
      plan.written = plan.written.filter(key => key !== row.kind);
      continue;
    }
    row.next = applyLibraryText(row.current, row.next, mode);
    const roleWrite = plan.roleWrites.find(write => write.kind === row.kind);
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
  if (!before.classified) {
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
