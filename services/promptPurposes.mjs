import { getPromptLibraryEntryDirectoryIds, inferPurposesFromDirectoryIds, isPromptLibraryFragmentEntry } from './promptLibraryTree.mjs';

/**
 * 用途 Tag 描述正文内容；目录、自由标签、正负极性和本次目标均不决定用途。
 * 光影与氛围（时段、天气、光照方向、氛围色调）独立于画风，参与随机组合；
 * 画师、画风、质感、质量保留为「画风配方」，正负配对整段使用，不参与随机组合。
 */
export const PROMPT_PURPOSES = Object.freeze([
  ['appearance', '外貌与设定', '人物身份、种族特征、发型、发色、瞳色、脸部与体型等外观设定'],
  ['clothing', '服饰穿搭', '穿戴的衣服、鞋袜、首饰、包袋和随身配饰'],
  ['pose', '动作姿态', '单人动作、身体姿势、手势、朝向以及手持或骑乘道具等带物动作'],
  ['expression', '表情神态', '面部表情、视线、情绪及相关表现'],
  ['interaction', '多人互动', '两个或多个角色之间的动作、接触和关系'],
  ['place', '场景地点', '室内外地点、建筑布景、自然地貌、环境摆件与背景生物载具'],
  ['atmosphere', '光影与氛围', '时段、季节、天气、光照方向、氛围色调与环境粒子特效'],
  ['camera', '镜头与构图', '观察视角、景别、构图布局、主体排列与景深'],
  ['format', '版式与特效', '分镜框、拍立得、杂志排版、画面文字与特殊视觉形式'],
  ['style', '画风配方', '画师、画风、质感与质量的整段画风配方，正负配对使用'],
].map(([id, label, description]) => Object.freeze({ id, label, description })));

/** 界面分组只组织用途，不改变已有用途 ID、编译顺序或全局／角色落点。 */
export const PROMPT_PURPOSE_GROUPS = Object.freeze([
  ['character', '人物', ['appearance', 'clothing', 'pose', 'expression', 'interaction']],
  ['scene', '画面与场景', ['place', 'atmosphere', 'camera']],
  ['special', '其他与辅助', ['format', 'style']],
].map(([id, label, purposes]) => Object.freeze({ id, label, purposes: Object.freeze(purposes) })));

export const PROMPT_PURPOSE_IDS = Object.freeze(PROMPT_PURPOSES.map(item => item.id));

/** 旧版细项与旧版画风细分只读归并到当前用途；用户资料不批量改写，读取时无损兼容。 */
export const LEGACY_PROMPT_PURPOSE_MAP = Object.freeze({
  identity: 'appearance',
  object: 'place',
  creature: 'place',
  vehicle: 'place',
  nature: 'atmosphere',
  time: 'atmosphere',
  lighting: 'atmosphere',
  color: 'atmosphere',
  composition: 'camera',
  text: 'format',
  effect: 'format',
  artist: 'style',
  texture: 'style',
  quality: 'style',
});

export const normalizePromptPurposeId = id => LEGACY_PROMPT_PURPOSE_MAP[id] || id;
export const PROMPT_PURPOSES_KEY = '_promptLibraryPurposes';
export const promptPurposeLabel = id => PROMPT_PURPOSES.find(item => item.id === normalizePromptPurposeId(id))?.label || id;
export const purposeSectionKey = id => `purpose:${normalizePromptPurposeId(id)}`;
export const normalizePromptPurposeSectionKey = key => typeof key === 'string' && key.startsWith('purpose:') ? purposeSectionKey(key.slice(8)) : key;
export const isPurposeSectionKey = key => typeof key === 'string' && key.startsWith('purpose:')
  && (PROMPT_PURPOSE_IDS.includes(key.slice(8)) || Object.hasOwn(LEGACY_PROMPT_PURPOSE_MAP, key.slice(8)));
/** 用户在分类编辑里追加的栏位。不占用用途 ID，编译时接在固定栏之后。 */
export const isCustomSectionKey = key => typeof key === 'string' && /^custom:[\w-]{1,80}$/.test(key);
export const isCreativeSectionKey = key => isPurposeSectionKey(key) || typeof key === 'string' && /^directory:[\w-]{1,120}$/.test(key) || isCustomSectionKey(key);

/** 写入与模型返回必须校验白名单；旧版画风细项会归并到「画风配方」。 */
export function readPromptPurposes(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => !PROMPT_PURPOSE_IDS.includes(normalizePromptPurposeId(id)))) throw new Error('用途 Tag 无效，请从固定列表选择');
  const normalized = new Set(value.map(normalizePromptPurposeId));
  return PROMPT_PURPOSE_IDS.filter(id => normalized.has(id));
}

const entryParams = entry => {
  if (typeof entry?.params === 'string') { try { return JSON.parse(entry.params); } catch { return {}; } }
  return entry?.params || {};
};

export function getExplicitEntryPurposes(entry) {
  const params = entryParams(entry);
  const value = params?.[PROMPT_PURPOSES_KEY];
  if (!Array.isArray(value)) return [];
  const normalized = new Set(value.map(id => normalizePromptPurposeId(String(id))));
  return PROMPT_PURPOSE_IDS.filter(id => normalized.has(id));
}

export function getEntryPurposes(entry, directories) {
  const explicit = getExplicitEntryPurposes(entry);
  if (explicit.length) return explicit;
  if (!directories || !entry || !isPromptLibraryFragmentEntry(entry)) return [];
  const inferred = inferPurposesFromDirectoryIds(getPromptLibraryEntryDirectoryIds(entry, directories), directories);
  const normalized = new Set(inferred.map(id => normalizePromptPurposeId(String(id))));
  return PROMPT_PURPOSE_IDS.filter(id => normalized.has(id));
}

/** 只判断已保存或目录继承标注能否进入单用途池，不把标注视为正文语义已经核验。 */
export function getPromptPurposeCandidateStatus(entry, purposeId, directories) {
  const purposes = getEntryPurposes(entry, directories);
  let reason = 'eligible';
  if (!entry || !isPromptLibraryFragmentEntry(entry)) reason = 'non_fragment';
  else if (entryParams(entry)?._promptLibraryPolarity === 'negative') reason = 'negative_only';
  else if (typeof entry?.basePrompt !== 'string' || !entry.basePrompt.trim()) reason = 'empty_prompt';
  else if (!purposes.length) reason = 'unmarked';
  else if (purposes.length > 1) reason = 'mixed';
  else if (purposeId !== undefined && !purposes.includes(normalizePromptPurposeId(purposeId))) reason = 'purpose_mismatch';
  return { eligible: reason === 'eligible', reason, purposes };
}

export function selectPurposeEntries(entries, purposeId, pure = false, directories) {
  const normalized = normalizePromptPurposeId(purposeId);
  return entries.filter(entry => {
    if (pure) return getPromptPurposeCandidateStatus(entry, normalized, directories).eligible;
    const purposes = getEntryPurposes(entry, directories);
    return purposes.includes(normalized);
  });
}

export const PROMPT_PURPOSE_INSTRUCTION = `用途 Tag 只标记正文实际包含的内容，可多选；不要按目录、标题或自由标签猜测，不因白衬衫等物件颜色自动增加整体氛围标记。混合片段保留整体内容并标记全部涉及用途，不强拆、不暗删原词。时段、天气、光照方向与整体氛围标记为 atmosphere（光影与氛围）；画师、画风、质感、质量统一标记为 style（画风配方），正负词属于同一片段。无法判断时返回空数组。purposes 只能使用以下固定 ID：${JSON.stringify(PROMPT_PURPOSES)}。用途 Tag 是元数据，不得追加进 prompt。`;
