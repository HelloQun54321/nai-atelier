import { isPromptLibraryFragmentEntry } from './promptLibraryTree.mjs';
/** 用途 Tag 描述正文内容；目录、自由标签、正负极性和本次目标均不决定用途。 */
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
  ['lighting', '光照与阴影', '光源、照明方式、光线方向及阴影'],
  ['color', '色彩与色调', '独立的配色、主色、饱和度及整体色调要求'],
  ['artist', '画师引用', '明确引用画师的名字或画师 Tag'],
  ['style', '画风与技法', '绘画媒介、表现风格及渲染技法'],
  ['texture', '线条与质感', '线条特征、表面材质及画面纹理'],
  ['effect', '特效与成像', '视觉特效、景深、散景、模糊及成像效果'],
  ['quality', '质量与细节', '整体质量描述、清晰度及精细程度'],
  ['text', '文字与标识', '画面中的文字、字幕、标志及图形标识'],
].map(([id, label, description]) => Object.freeze({ id, label, description })));
/** 界面分组只组织用途，不改变已有用途 ID、编译顺序或全局／角色落点。 */
export const PROMPT_PURPOSE_GROUPS = Object.freeze([
  ['subject', '主体与外观', ['identity', 'appearance', 'clothing', 'creature', 'object', 'vehicle']],
  ['action', '动作与关系', ['pose', 'expression', 'interaction']],
  ['environment', '场景与环境', ['place', 'nature', 'time']],
  ['camera-light', '镜头与光影', ['camera', 'composition', 'lighting', 'color']],
  ['style', '画风与表现', ['artist', 'style', 'texture', 'effect', 'quality', 'text']],
].map(([id, label, purposes]) => Object.freeze({ id, label, purposes: Object.freeze(purposes) })));
export const PROMPT_PURPOSE_IDS = Object.freeze(PROMPT_PURPOSES.map(item => item.id));
export const PROMPT_PURPOSES_KEY = '_promptLibraryPurposes';
export const promptPurposeLabel = id => PROMPT_PURPOSES.find(item => item.id === id)?.label || id;
export const purposeSectionKey = id => `purpose:${id}`;
export const isPurposeSectionKey = key => typeof key === 'string' && key.startsWith('purpose:') && PROMPT_PURPOSE_IDS.includes(key.slice(8));
export const isCreativeSectionKey = key => isPurposeSectionKey(key) || typeof key === 'string' && /^directory:[\w-]{1,120}$/.test(key);

/** 写入与模型返回必须校验白名单；未提供表示未标注，不从目录名或旧自由标签猜测。 */
export function readPromptPurposes(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => !PROMPT_PURPOSE_IDS.includes(id))) throw new Error('用途 Tag 无效，请从固定列表选择');
  return PROMPT_PURPOSE_IDS.filter(id => value.includes(id));
}

const entryParams = entry => {
  if (typeof entry?.params === 'string') { try { return JSON.parse(entry.params); } catch { return {}; } }
  return entry?.params || {};
};

export function getEntryPurposes(entry) {
  const params = entryParams(entry);
  const value = params?.[PROMPT_PURPOSES_KEY];
  return Array.isArray(value) ? PROMPT_PURPOSE_IDS.filter(id => value.includes(id)) : [];
}

export function selectPurposeEntries(entries, purposeId, pure = false) {
  return entries.filter(entry => {
    if (pure && (!isPromptLibraryFragmentEntry(entry) || entryParams(entry)._promptLibraryPolarity === 'negative')) return false;
    const purposes = getEntryPurposes(entry);
    return purposes.includes(purposeId) && (!pure || purposes.length === 1);
  });
}

export const PROMPT_PURPOSE_INSTRUCTION = `用途 Tag 只标记正文实际包含的内容，可多选；不要按目录、标题或自由标签猜测，不因白衬衫等物件颜色自动增加整体色调标记。混合片段保留整体内容并标记全部涉及用途，不强拆、不暗删原词。无法判断时返回空数组。purposes 只能使用以下固定 ID：${JSON.stringify(PROMPT_PURPOSES)}。用途 Tag 是元数据，不得追加进 prompt。`;
