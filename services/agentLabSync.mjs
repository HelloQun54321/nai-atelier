import { isCreativeSectionKey } from './promptPurposes.mjs';
import { splitPromptSegments } from './promptSegments.mjs';

const GLOBAL_SECTION_KEYS = ['appearance', 'wardrobe', 'pose', 'scene', 'camera', 'extra'];
/** 旧栏顺序保留，目录片段按保存时的顺序编译；来源等对象不属于正文。 */
export const getGlobalPromptSectionKeys = (sections) => [
  ...GLOBAL_SECTION_KEYS,
  ...Object.keys(sections || {}).filter((key) => isCreativeSectionKey(key)),
  ...(typeof sections?.presentation === 'string' ? ['presentation'] : []),
];

/** 将原本分开的画风与主体内容合并为一个可编辑的全局提示词。 */
export const mergePromptFields = (basePrompt, subjectPrompt) =>
  [basePrompt.trim(), subjectPrompt.trim()]
    .filter(Boolean)
    .join(', ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '');

/**
 * 单字段编辑模式只在仍有旧主体字段时执行一次合并；合并完成后直接返回原始输入。
 * 这样用户正在键入的末尾逗号、空格和换行不会被受控输入框的下一次渲染清理掉。
 */
export const getEditableGlobalPrompt = (basePrompt, subjectPrompt) =>
  subjectPrompt.trim() ? mergePromptFields(basePrompt, subjectPrompt) : basePrompt;

/** 整段编辑也显示参与生成的分类负面，编辑后即可完整保留。 */
export const getEditableGlobalNegative = (negative, sections) =>
  getGlobalPromptSectionKeys(sections).reduce((value, key) =>
    sections?.[key]?.trim() && sections.sectionNegatives?.[key]?.trim()
      ? mergePromptFields(value, sections.sectionNegatives[key]) : value, negative);

/** 角色分栏的固定顺序：编译与展示都用这一份，避免各处顺序漂移。 */
export const CHARACTER_SECTION_KEYS = ['appearance', 'wardrobe', 'pose', 'expression'];

export const getCharacterSectionKeys = (character) => [
  ...CHARACTER_SECTION_KEYS,
  ...Object.keys(character.sections || {}).filter((key) => isCreativeSectionKey(key)),
];

const splitTags = (value) =>
  splitPromptSegments(String(value ?? ''));

const probeTag = (value) => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** 按归一化 tag 去重合并（与实验室其它合并口径一致）。 */
const joinTags = (lists) => {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const tag of splitTags(list)) {
      const probe = probeTag(tag);
      if (!probe || seen.has(probe)) continue;
      seen.add(probe);
      out.push(tag);
    }
  }
  return out.join(', ');
};

/** 角色是否写了任一栏内容（决定它是否算「有内容的角色」）。 */
export const hasCharacterSections = (character) =>
  getCharacterSectionKeys(character).some(key => Boolean(String(character.sections?.[key] || '').trim()));

/**
 * 把分栏内容编译进**实际请求**：正文 = 四栏按固定顺序 + 手动补充正文；负面 = 四栏内容负面 + 角色负面。
 * 旧资料（没有 sections）原样返回，纯正文角色的行为完全不变。
 */
export const compileCharacterContent = (
  character,
  legacyNegatives,
) => {
  if (!hasCharacterSections(character)) return character;
  const sectionKeys = getCharacterSectionKeys(character);
  /* 旧格式：params._characterSectionsNegatives['角色id::分类']，新代码没读之前它会被静默丢掉 */
  const legacyOf = (key) => {
    if (!legacyNegatives) return '';
    const scoped = legacyNegatives[String(character.id) + '::' + key];
    const direct = legacyNegatives[key];
    const value = scoped != null ? scoped : direct;
    if (value == null) return '';
    /* 旧数据里这一格可能是 { text, note } 这类对象，直接 String() 会变成 [object Object] */
    if (typeof value === 'object') {
      const record = value;
      const text = record.text ?? record.negative ?? '';
      return String(text || '').trim() || String(record.note || '').trim();
    }
    return String(value).trim();
  };
  return {
    ...character,
    // 动态目录和 AI 分类保留原文，重复词也属于原配方。
    prompt: sectionKeys.some(isCreativeSectionKey) || Object.values(character.sectionMeta || {}).some(meta => meta?.source === 'ai')
      ? [...sectionKeys.map(key => character.sections?.[key]), character.prompt].map(value => value?.trim()).filter(Boolean).join(', ')
      : joinTags([...sectionKeys.map(key => character.sections?.[key]), character.prompt]),
    ...(() => {
      /* 没有负面时保持 undefined，不要把空串写进负数提示词字段 */
      const merged = joinTags([
        // 新分栏来源表示该栏已替换，缺少负面也不能复活旧格式负面。
        ...sectionKeys.map(key => character.sections?.[key]?.trim()
          ? character.sectionNegatives?.[key] ?? (character.sectionMeta?.[key] ? '' : legacyOf(key)) : ''),
        character.negativePrompt,
      ]);
      return merged ? { negativePrompt: merged } : {};
    })(),
  };
};


// 页面已提交的改动按字段合并到工作草稿，保留业务工具尚未应用的其他改动。
const fields = new Set(['basePrompt', 'subjectPrompt', 'negativePrompt', 'modules', 'params', 'editContext']);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const diffAgentClientDraft = (before, after) => {
  const changes = [];
  const visit = (a, b, path) => {
    if (same(a, b)) return;
    if (object(a) && object(b) && path.length < 8) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (!reserved.has(key)) visit(a[key], b[key], [...path, key]);
    } else changes.push({ path, before: a, after: b });
  };
  for (const field of fields) visit(before?.[field], after?.[field], [field]);
  return changes;
};
export const applyAgentClientChanges = (draft, changes) => {
  if (!Array.isArray(changes) || changes.length > 300 || JSON.stringify(changes).length > 500_000) throw new Error('页面草稿改动过大，请使用对应业务工具');
  const conflicts = [];
  // 先完整校验，拒绝时不留下部分写入。
  for (const change of changes) if (!Array.isArray(change.path) || !fields.has(change.path[0]) || change.path.length > 8 || change.path.some(key => typeof key !== 'string' || reserved.has(key))) throw new Error('无效的页面草稿字段');
  for (const { path, before, after } of changes) {
    let parent = draft;
    for (const key of path.slice(0, -1)) {
      if (!object(parent[key])) { if (parent[key] !== undefined) { parent = null; break; } parent[key] = {}; }
      parent = parent[key];
    }
    const key = path.at(-1);
    if (!parent) { conflicts.push(path.join('.')); continue; }
    if (!same(parent[key], before) && !same(parent[key], after)) conflicts.push(path.join('.'));
    // 页面已经提交的选择优先于尚未应用的工作草稿；同级其他字段保持原样。
    if (after === undefined) delete parent[key]; else parent[key] = structuredClone(after);
  }
  return conflicts;
};

/** 模型与整段输入框共用正文视图；仅转换副本，不回写旧资料。 */
export const normalizeAgentLabDraft = draft => {
  const params = { ...draft.params };
  const sections = params._promptSections;
  if (params.characters) params.characters = params.characters.map(character => {
    const compiled = { ...compileCharacterContent(character, params._characterSectionsNegatives) };
    delete compiled.sections; delete compiled.sectionNegatives; delete compiled.sectionMeta;
    return compiled;
  });
  delete params._promptSections; delete params._characterSectionsNegatives;
  return { ...draft, negativePrompt: getEditableGlobalNegative(draft.negativePrompt || '', sections), params };
};

/** 未改正文沿用原存储；真正编辑的整段按手工输入去除旧分栏。 */
export const restoreUnchangedAgentLabFields = (stored, proposed) => {
  const before = normalizeAgentLabDraft(stored), after = normalizeAgentLabDraft(proposed);
  const result = { ...after, params: { ...after.params } };
  const positiveUnchanged = before.basePrompt === after.basePrompt && before.subjectPrompt === after.subjectPrompt;
  const negativeUnchanged = before.negativePrompt === after.negativePrompt;
  if (positiveUnchanged) {
    result.basePrompt = stored.basePrompt; result.subjectPrompt = stored.subjectPrompt;
    if (stored.params._promptSections) result.params._promptSections = { ...stored.params._promptSections };
  }
  if (negativeUnchanged) {
    result.negativePrompt = stored.negativePrompt;
    if (!positiveUnchanged && stored.params._promptSections?.sectionNegatives) result.negativePrompt = before.negativePrompt;
  } else if (result.params._promptSections) delete result.params._promptSections.sectionNegatives;
  if (stored.params._characterSectionsNegatives) result.params._characterSectionsNegatives = stored.params._characterSectionsNegatives;
  if (result.params.characters) result.params.characters = result.params.characters.map(character => {
    const original = stored.params.characters?.find(item => item.id === character.id);
    const previous = before.params.characters?.find(item => item.id === character.id);
    return original && previous && character.prompt === previous.prompt && character.negativePrompt === previous.negativePrompt
      ? { ...character, prompt: original.prompt, negativePrompt: original.negativePrompt, sections: original.sections, sectionNegatives: original.sectionNegatives, sectionMeta: original.sectionMeta }
      : original && (original.sections || stored.params._characterSectionsNegatives)
        ? { ...character, sectionMeta: Object.fromEntries(getCharacterSectionKeys(original).map(key => [key, { source: 'manual' }])) } : original?.sectionMeta ? { ...character, sectionMeta: original.sectionMeta } : character;
  });
  return result;
};

/**
 * Compiles the final prompt string by combining parts in a fixed order:
 * 1. Base Prompt
 * 2. Pre-Modules (isActive & position='pre')
 * 3. Subject/Variable Prompt (User Input)
 * 4. Post-Modules (isActive & position='post' or undefined)
 */
export const compilePrompt = (
  chain,
  subjectPrompt = '',
  activeModulesOnly = true
) => {
  const promptParts = [];

  // 1. Add Base Prompt
  if (chain.basePrompt && chain.basePrompt.trim()) {
      promptParts.push(chain.basePrompt.trim());
  }

  // 2. Add Pre-Modules
  if (chain.modules) {
      const preModules = chain.modules.filter(m => {
          const isActive = !activeModulesOnly || m.isActive;
          return isActive && m.position === 'pre';
      });
      preModules.forEach(m => {
          if (m.content.trim()) promptParts.push(m.content.trim());
      });
  }

  // 3. Add Subject/Variable Prompt
  if (subjectPrompt && subjectPrompt.trim()) {
      promptParts.push(subjectPrompt.trim());
  }

  // 4. Add Post-Modules (Default to post if position is missing)
  if (chain.modules) {
      const postModules = chain.modules.filter(m => {
          const isActive = !activeModulesOnly || m.isActive;
          return isActive && (m.position === 'post' || !m.position);
      });
      postModules.forEach(m => {
          if (m.content.trim()) promptParts.push(m.content.trim());
      });
  }

  // 5. Join with commas and clean up
  // NAI generally prefers comma separation.
  // We join with ", " then clean up potential double commas.
  let fullPrompt = promptParts.join(', ');

  // Cleanup: remove double commas, leading/trailing commas/spaces
  fullPrompt = fullPrompt
      .replace(/,\s*,/g, ',')
      .replace(/^,\s*/, '')
      .replace(/,\s*$/, '');

  return fullPrompt;
};
