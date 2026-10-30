import { isPromptLibraryFragmentEntry } from './promptLibraryTree.mjs';

/**
 * 用途 Tag 描述正文内容；目录、自由标签、正负极性和本次目标均不决定用途。
 * 画风类细项（画师、画风、质感、特效、质量、光照、色彩）已合并为「画风配方」，
 * 正负配对整段使用，不参与随机组合。
 */
export const PROMPT_PURPOSES = Object.freeze([
  ['identity', '人物设定', '人物身份、年龄段、职业及明确角色身份'],
  ['appearance', '外貌与身体', '发型、发色、眼睛、脸部、体型及身体特征'],
  ['clothing', '服饰与配件', '穿戴的衣服、鞋袜、首饰和配件'],
  ['pose', '动作与姿态', '主体动作、身体姿势及朝向'],
  ['expression', '表情与情绪', '面部表情、情绪及相关表现'],
  ['creature', '动物与生物', '作为主体出现的动物、幻想生物'],
  ['object', '物品与道具', '普通物件、手持道具和装饰物'],
  ['vehicle', '载具与机械', '交通工具、机械设备及机体'],
  ['place', '地点与布景', '地点、室内外场所和背景布置'],
  ['nature', '自然与天气', '自然环境、地貌、植被及天气'],
  ['time', '时间与季节', '时段、季节及时间环境'],
  ['interaction', '互动与关系', '两个或多个对象之间的动作、接触和关系'],
  ['camera', '视角与景别', '观察方向、镜头距离及取景范围'],
  ['composition', '构图与布局', '主体数量、位置、大小关系及排列'],
  ['text', '文字与标识', '画面中的文字、字幕、标志及图形标识'],
  ['style', '画风配方', '画师、画风、质感、特效、质量、光照与色彩的整段配方，正负配对使用'],
].map(([id, label, description]) => Object.freeze({ id, label, description })));

/** 界面分组只组织用途，不改变已有用途 ID、编译顺序或全局／角色落点。 */
export const PROMPT_PURPOSE_GROUPS = Object.freeze([
  ['subject', '主体与外观', ['identity', 'appearance', 'clothing', 'creature', 'object', 'vehicle']],
  ['action', '动作与关系', ['pose', 'expression', 'interaction']],
  ['environment', '场景与环境', ['place', 'nature', 'time']],
  ['camera-light', '镜头、构图与文字', ['camera', 'composition', 'text']],
  ['style', '画风与成像', ['style']],
].map(([id, label, purposes]) => Object.freeze({ id, label, purposes: Object.freeze(purposes) })));

export const PROMPT_PURPOSE_IDS = Object.freeze(PROMPT_PURPOSES.map(item => item.id));

/** 旧版画风细项只读映射到「画风配方」；用户资料不批量改写，读取时归并。 */
export const LEGACY_PROMPT_PURPOSE_MAP = Object.freeze({
  artist: 'style',
  texture: 'style',
  effect: 'style',
  quality: 'style',
  lighting: 'style',
  color: 'style',
});

export const normalizePromptPurposeId = id => LEGACY_PROMPT_PURPOSE_MAP[id] || id;
export const PROMPT_PURPOSES_KEY = '_promptLibraryPurposes';
export const promptPurposeLabel = id => PROMPT_PURPOSES.find(item => item.id === normalizePromptPurposeId(id))?.label || id;
export const purposeSectionKey = id => `purpose:${normalizePromptPurposeId(id)}`;
export const normalizePromptPurposeSectionKey = key => typeof key === 'string' && key.startsWith('purpose:') ? purposeSectionKey(key.slice(8)) : key;
export const isPurposeSectionKey = key => typeof key === 'string' && key.startsWith('purpose:')
  && (PROMPT_PURPOSE_IDS.includes(key.slice(8)) || Object.hasOwn(LEGACY_PROMPT_PURPOSE_MAP, key.slice(8)));
export const isCreativeSectionKey = key => isPurposeSectionKey(key) || typeof key === 'string' && /^directory:[\w-]{1,120}$/.test(key);

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

export function getEntryPurposes(entry) {
  const params = entryParams(entry);
  const value = params?.[PROMPT_PURPOSES_KEY];
  if (!Array.isArray(value)) return [];
  const normalized = new Set(value.map(id => normalizePromptPurposeId(String(id))));
  return PROMPT_PURPOSE_IDS.filter(id => normalized.has(id));
}

/** 只判断已保存标注能否进入单用途池，不把标注视为正文语义已经核验。 */
export function getPromptPurposeCandidateStatus(entry, purposeId) {
  const purposes = getEntryPurposes(entry);
  let reason = 'eligible';
  if (!entry || !isPromptLibraryFragmentEntry(entry)) reason = 'non_fragment';
  else if (entryParams(entry)?._promptLibraryPolarity === 'negative') reason = 'negative_only';
  else if (typeof entry?.basePrompt !== 'string' || !entry.basePrompt.trim()) reason = 'empty_prompt';
  else if (!purposes.length) reason = 'unmarked';
  else if (purposes.length > 1) reason = 'mixed';
  else if (purposeId !== undefined && !purposes.includes(normalizePromptPurposeId(purposeId))) reason = 'purpose_mismatch';
  return { eligible: reason === 'eligible', reason, purposes };
}

export function selectPurposeEntries(entries, purposeId, pure = false) {
  const normalized = normalizePromptPurposeId(purposeId);
  return entries.filter(entry => {
    if (pure) return getPromptPurposeCandidateStatus(entry, normalized).eligible;
    const purposes = getEntryPurposes(entry);
    return purposes.includes(normalized);
  });
}

export const PROMPT_PURPOSE_INSTRUCTION = `用途 Tag 只标记正文实际包含的内容，可多选；不要按目录、标题或自由标签猜测，不因白衬衫等物件颜色自动增加整体色调标记。混合片段保留整体内容并标记全部涉及用途，不强拆、不暗删原词。画师、画风、质感、特效、质量、光照、色彩统一标记为 style（画风配方），不再拆成细项；画风配方的正负词属于同一片段。无法判断时返回空数组。purposes 只能使用以下固定 ID：${JSON.stringify(PROMPT_PURPOSES)}。用途 Tag 是元数据，不得追加进 prompt。`;
