/*
 * 一键 Roll · 纯内容快照与四态约束派生（纯逻辑核）
 * ---------------------------------------------------------------------------
 * 从「一键 Roll」补丁片段原样移植的两块最需要契约保证的逻辑，不碰 DOM / React / 请求 / 存储：
 *   1) **纯内容快照**：保存参与的目录内容与自身的负面 / 缺席约束 / 备注 / 来源快照，
 *      明确排除画师串、风格配套负面、用户全局负面、模型与生图参数（白名单构造 + 白名单读取）；
 *   2) **四态约束派生**：把词库条目的 facets（自动搭配 / 明确没有 / 明确值 / 未知键）
 *      派生成「缺席约束、自动、明确定值、待确认」四类，并给出备注与 needsReview，
 *      原文副本保留、不猜测、不回写词库。
 *
 * 六库抽取、随机流、历史与证据部分见 tools/nai-roll/patches/roll/core.mjs（本文件暂不移植）。
 */

/**
 * 外部 JSON 边界（词库条目 / 快照 / 接口返回）。
 * 这些值的形状来自数据库与用户数据，内部逻辑在取值处已有显式判空与类型判断，
 * 因此统一用这个别名表达「尚未收窄的 JSON」，不在此层重复建模。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** 算法版本：同 seed 复现必须连算法版本一起限定。 */
export const ALGO = 'nai-roll-2';
/** 旧记录没有 algo 字段时按这一版解释。 */
export const LEGACY_ALGO = 'nai-roll-1';

/** 六类内容的库类型（沿用旧标识，不新增不改名）。 */
export type RollKind = 'appearance' | 'wardrobe' | 'pose' | 'expression' | 'scene' | 'camera';
/** 词库条目只读视图：只声明本模块真正读取的字段，且全部可选（旧条目可能缺字段）。 */
export type ChainLike = {
  id?: string; name?: string; description?: string; tags?: string[]; previewImage?: string;
  basePrompt?: string; negativePrompt?: string; updatedAt?: number; type?: string;
  params?: unknown;
};
/** 一次抽取记录（本文件只读它的 picks / checks）。 */
export type RollRecordLike = {
  seed?: string; seeds?: Record<string, string>; checks?: Record<string, boolean>;
  locks?: Record<string, string>; locked?: Record<string, string>;
  algo?: string; at?: number; chains?: ChainLike[];
  picks?: Record<string, Json>;
  roll?: { seed?: string; seeds?: Record<string, string>; checks?: Record<string, boolean>; locks?: Record<string, string> };
  /** 历史记录里还可能有其它字段（例如 summary / reasonText），按 JSON 处理 */
  [key: string]: Json;
};
/** 四态约束派生结果。 */
export interface ConstraintSummary {
  /** 条目声明的四态原文副本（数组/对象浅拷贝），用于「旧结构原样保留」 */
  facets: Record<string, Json>;
  /** 明确没有（缺席约束）：只取声明了 __none__ 的键 */
  absent: Array<{ key: string; label: string; known: boolean }>;
  /** 自动搭配：声明了 __auto__ 的键 */
  auto: Array<{ key: string; label: string; known: boolean }>;
  /** 明确定值；legacyShape=true 表示值来自旧结构 {value:'…'} */
  values: Array<{ key: string; label: string; known: boolean; value: string; legacyShape?: boolean }>;
  /** 四态键或形状不在已知表里的键名（原文保留、不猜测、不回写） */
  unknown: string[];
  notes: string;
  needsReview: boolean;
}
/** 纯内容快照读取结果（白名单读取之后）。 */
export interface RollUnit {
  id: string; directoryId: string; name: string; path: string[]; scope: 'global' | 'character';
}
export interface ContentItem {
  unitId: string; directoryId: string; directoryName: string; directoryPath: string[]; scope: 'global' | 'character';
  text: string; negative: string; constraintNotes: string; meta: Record<string, unknown> | null;
}
export interface ContentRead {
  items: ContentItem[];
  ok: boolean; reason?: string; warnings: string[];
  format?: string; version?: number; savedAt?: string; algo?: string;
  roll?: { seed: string; seeds: Record<string, string>; checks: Record<string, boolean>; locks: Record<string, string> } | null;
  roles: Array<{
    key: string; name: string; provided: Record<string, boolean>; sections: Record<string, string>;
    negatives: Record<string, { text: string; note: string; source: string }>; meta: Record<string, unknown>;
  }>;
  global: Record<string, { provided: boolean; text?: string; negative?: { text: string; note: string; source: string } | null; meta?: Record<string, unknown> | null }>;
  anyRole: boolean; anyGlobal: boolean;
}

/* ---- 四态约束派生 ---- */
/** 六个库 + 界面顺序（type 常量沿用旧标识，不新增、不改名）。 */
export const KINDS: string[] = ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera'];
/** 抽取输入：参与状态（checks）与固定项（locks），avoid 用于「排除当前条目」。 */
export interface RollDrawInput {
  units?: RollUnit[];
  directories?: import('./promptLibraryTree.mjs').PromptLibraryTreeState;
  chains?: ChainLike[] | null;
  seed?: string | number;
  checks?: Record<string, boolean>;
  locks?: Record<string, string>;
  /** 旧字段名（历史记录里出现过），与 locks 同义 */
  locked?: Record<string, string>;
  /** 上一版结果，用于「还原这组」与单栏重抽 */
  picks?: RollPicks;
  /** 每栏要排除的条目 id（单栏换一个 / 排除当前项） */
  avoid?: Record<string, string | undefined>;
}
/** 一栏的抽取结果行（派生出的纯数据副本，不含条目对象本身，避免被顺手改到词库）。 */
export interface RollRow {
  kind: string;
  scope?: 'global' | 'character'; label?: string; title?: string; key?: string;
  id?: string; name?: string; text?: string; negative?: string; bilingual?: string;
  description?: string; preview?: string; tags?: string[]; updatedAt?: number | null;
  summary?: string; summaryEnglishOnly?: boolean; constraints?: ConstraintSummary;
  filled?: boolean; reason?: string; poolSize?: number; locked?: unknown;
  code?: string; message?: string;
  [key: string]: Json;
}
export type RollPicks = Record<string, RollRow>;
export type RollRng = () => number;

export const META: Record<string, { short: string; title: string; scope: 'global' | 'character' }> = {
  appearance: { short: '形象', title: '人物形象', scope: 'character' },
  wardrobe: { short: '服饰', title: '服饰穿搭', scope: 'character' },
  pose: { short: '动作', title: '动作互动', scope: 'character' },
  expression: { short: '表情', title: '表情状态', scope: 'character' },
  scene: { short: '场景', title: '场景环境', scope: 'global' },
  camera: { short: '镜头', title: '镜头画面', scope: 'global' }
};
export const REASON: Record<string, string> = {
  ok: '抽中',
  locked: '固定保留',
  replay: '按上次记录还原',
  unchecked: '本次未参与（该栏留空）',
  empty: '该库当前 0 条，该栏留空',
  single: '候选只有 1 条，无法换'
};
/* 四态哨兵（与 WardrobeLibrary.js 的 FACET_* 字面量一致，不另造） */
export const FACET_AUTO = '__auto__';
export const FACET_NONE = '__none__';
export const FACET_AUTO_LABEL = '自动搭配';
export const FACET_NONE_LABEL = '明确没有';
/* 四态属性 → 中文标签。取自 WardrobeLibrary.js 六份配置的 facetLabels（104 项，抽取脚本一次性同步，不 import） */
export const FACET_LABELS: Record<string, string> = {
  accessory: '配饰', accessory_color: '配饰颜色', activity: '活动', age: '年龄阶段', angle: '俯仰角', arms: '手臂／手部',
  background_crowd: '背景人群', bangs: '刘海', blush: '脸红', body: '体型', bottom: '下装', bottom_color: '下装颜色',
  breasts: '胸部·大小', breasts_shape: '胸部·形态', brow: '眉部', clarity: '清晰度', composition: '构图', cut: '版型',
  direction: '方位（拍摄方向）', dof: '景深', effect: '成像效果', emotion: '情绪基调', env_event: '环境元素与事件', expression: '可见表情',
  expression_combo: '组合表情', eye_glow: '发光瞳', eye_left: '瞳色·左眼', eye_right: '瞳色·右眼', eye_tone: '瞳色构成', eyes: '瞳色',
  eyes_shape: '眼型', eyes_state: '眼睛状态（含眯眼／半睁眼）', facing: '身体朝向', facing_ref: '朝向参照', focus: '对焦对象', footwear: '鞋子',
  footwear_color: '鞋子颜色', gaze: '视线目标', gender: '穿着对象', gesture: '单人手势', hair: '发色', hair_cut: '发型·剪裁',
  hair_detail: '发型·细节', hair_length: '发型·长度', hair_second: '发色·副色', hair_texture: '发型·发质', hair_tone: '发色构成',
  hair_updo: '发型·扎发方式', head: '头部方向', height: '身高', hold: '手持物', hold_hand: '持握手（左右手）', interaction: '人与人互动',
  layering: '穿着层次', legs: '腿部动作', legwear: '袜饰', legwear_color: '袜饰颜色', length: '长度', light: '光源',
  light_dir: '光源方向', light_intensity: '光源强度', light_softness: '光源软硬', material: '材质', mood: '环境氛围', motion: '运动趋势',
  mouth: '嘴部', occasion: '场合（选衣条件）', onesie: '连体装／连衣裙', onesie_color: '连体装颜色', outer: '外套', outer_color: '外套颜色',
  outfit_scope: '生成范围', palette: '全图配色（旧·抽象色调）', pattern: '纹样', perspective: '透视', posture: '基础姿态',
  presentation: '外观呈现', props: '陈设与环境元素', roll: '画面倾斜', season: '季节（选衣条件）', season_signs: '季节标志物', shot: '景别（取景范围）',
  skin: '肤色', sleeve: '袖型', spot: '地点与室内外', style: '风格', subject: '角色数量（全局）', subject_gender: '性别组成',
  support: '接触／支撑物', sweat: '汗水', target: '作用角色', tears: '眼泪', temp_body: '身体与衣物的临时状态', temp_hair: '头发临时状态',
  tilt: '身体倾斜', time: '时间', top: '上装', top_color: '上装颜色', traits: '固有特征', translucency: '材质·透光', viewpoint: '视点',
  waist: '腰线', wear_state: '穿着状态', weather: '天气',
  hairstyle: '发型（整体）', view: '视角（取景）', scene: '场景地点', framing: '构图'
};
export const facetLabel = (key: string) => FACET_LABELS[String(key)] || String(key);
export const clip = (value: Json, max: Json) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const limit = Number(max) > 0 ? Number(max) : 96;
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
};
export const isObj = (value: Json): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const listOf = (value: Json) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
  const text = String(value).trim();
  return text ? [text] : [];
};
export const splitTags = (value: Json) => String(value == null ? '' : value).split(/[,，]/).map(x => String(x).trim()).filter(Boolean);
export const probeTag = (value: Json) => String(value == null ? '' : value).trim().toLowerCase().replace(/[_\s]+/g, ' ');
/* 去重合并（与实验室 negMerge 同一口径：按归一化 tag 去重、逗号连接） */
export const joinTags = (...lists: Json[]) => {
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

/* ---- 词库条目读取（只读派生，绝不改写条目） ---- */
/**
 * 词库条目元数据的**双格式读取**（本机旧格式与源码新条目并存）：
 * - `params._wardrobe`：本机部署版的词库条目（bilingual / facets / references / ...）；
 * - `params._promptLibrary`：源码管理页新建的条目（同一批字段）。
 * 读取顺序固定为 _wardrobe → _promptLibrary，写回仍由各自管理页负责，互不覆盖。
 */
export const metaOf = (chain: ChainLike | null | undefined): Record<string, Json> => {
  const params = chain?.params;
  if (!isObj(params)) return {};
  const local = params['_wardrobe'];
  if (isObj(local)) return local as Record<string, Json>;
  const library = params['_promptLibrary'];
  return isObj(library) ? (library as Record<string, Json>) : {};
};
export const idOf = (chain: ChainLike | null | undefined) => String((chain && chain.id) || '');
export const nameOf = (chain: ChainLike | null | undefined) => {
  const name = String((chain && chain.name) || '').trim();
  return name || '（未命名条目）';
};
/* 英文提示词 = 词库条目的 basePrompt（与库卡片、卡片摘要同一来源）。 */
export const textOf = (chain: ChainLike | null | undefined) => String((chain && chain.basePrompt) || '').replace(/\s+/g, ' ').trim();
export const negativeOf = (chain: ChainLike | null | undefined) => String((chain && chain.negativePrompt) || '').replace(/\s+/g, ' ').trim();
export const bilingualOf = (chain: ChainLike | null | undefined) => String(metaOf(chain).bilingual || '');
export const tagsOf = (chain: ChainLike | null | undefined) =>
  (Array.isArray(chain?.tags) ? chain.tags : []).map((t: string) => String(t || '').trim()).filter(Boolean);
export const descriptionOf = (chain: ChainLike | null | undefined) => String((chain && chain.description) || '');
export const previewOf = (chain: ChainLike | null | undefined) => String((chain && chain.previewImage) || '');
export const updatedAtOf = (chain: ChainLike | null | undefined) => {
  const at = Number(chain && chain.updatedAt);
  return Number.isFinite(at) && at > 0 ? at : null;
};
export const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/* 中英对照里挑出中文（与 WardrobeLibrary 卡片摘要同一套规则，不另造一套）。 */
export const chineseOf = (bilingual: Json) => String(bilingual == null ? '' : bilingual).split(/[,，]/).map(part => {
  const text = String(part).trim();
  if (!text) return '';
  const matched = text.match(/[（(]([^）)]*)[）)]\s*$/);
  if (matched) return CJK.test(matched[1]) ? String(matched[1]).trim() : '';
  return !/[a-z]/i.test(text) && CJK.test(text) ? text : '';
}).filter(Boolean);
/* 摘要：优先中文说明，其次中英对照里的中文，最后回落英文标签。 */
export const summaryOf = (chain: ChainLike | null | undefined) => {
  const chinese = chineseOf(bilingualOf(chain));
  if (chinese.length) return { text: clip(chinese.join('、'), 96), englishOnly: false };
  const english = String(bilingualOf(chain) || textOf(chain)).split(/[,，]/).map(p => p.trim()).filter(Boolean);
  if (!english.length) return { text: '', englishOnly: false };
  return { text: clip(english.slice(0, 6).join('、'), 96), englishOnly: true };
};

/* ---- 四态 → 约束/备注（不猜不编：只搬运条目已声明的状态） ----
 * 返回 { facets（原文副本，绝不回写）, absent[]（明确没有）, auto[]（自动搭配）, values[]（具体值）,
 *        unknown[]（读不懂的键或形状）, notes（中文说明）, needsReview }
 * 关键：**只读取**条目字段；读不懂的键/形状标 unknown，不猜成「不指定」，也不补写四态。
 */
export const constraintsOf = (chain: ChainLike | null | undefined) => {
  const raw = metaOf(chain).facets;
  const absent: Json[] = [];
  const auto: Json[] = [];
  const values: Json[] = [];
  const unknown = [];
  const facets: Record<string, Json> = {};
  if (isObj(raw)) {
    for (const key of Object.keys(raw)) {
      const value = raw[key];
      const known = Object.prototype.hasOwnProperty.call(FACET_LABELS, key);
      const label = facetLabel(key);
      /* 原文照抄（数组/对象浅拷贝一份），保证「旧结构原样保留」 */
      facets[key] = Array.isArray(value) ? value.slice() : (isObj(value) ? Object.assign({}, value) : value);
      const items = Array.isArray(value) ? value : [value];
      let classified = 0;
      for (const item of items) {
        if (item == null) continue;
        if (isObj(item)) {
          /* 旧形状：{value:'lace'} 这类结构化取值 —— 取出 value，但仍标记为旧结构 */
          const inner = String(item.value == null ? '' : item.value).trim();
          if (inner === FACET_NONE) { absent.push({ key, label, known }); classified++; continue; }
          if (inner === FACET_AUTO) { auto.push({ key, label, known }); classified++; continue; }
          if (inner) { values.push({ key, label, known, value: inner, legacyShape: true }); classified++; continue; }
          unknown.push(key);
          continue;
        }
        const text = String(item).trim();
        if (!text) continue;
        if (text === FACET_NONE) { absent.push({ key, label, known }); classified++; continue; }
        if (text === FACET_AUTO) { auto.push({ key, label, known }); classified++; continue; }
        values.push({ key, label, known, value: text });
        classified++;
      }
      if (!known || (!classified && items.length)) unknown.push(key);
    }
  }
  const unknownKeys = [...new Set(unknown)];
  const notes = [];
  if (absent.length) notes.push('明确没有：' + absent.map(a => (a.known ? a.label : a.key)).join('、') + '（条目声明的缺席约束）');
  if (auto.length) notes.push('自动搭配：' + auto.map(a => (a.known ? a.label : a.key)).join('、') + '（未指定具体值）');
  if (unknownKeys.length) notes.push('结构待确认：' + unknownKeys.join('、') + '（这条目的四态键或形状不在已知表里，原文原样保留，不猜测、不回写）');
  return {
    facets,
    absent,
    auto,
    values,
    unknown: unknownKeys,
    notes: notes.join('；'),
    needsReview: unknownKeys.length > 0
  };
};

/* ---- 池子 ---- */
/* 按 type 取池；按 id 排序 → 抽取结果与接口返回顺序无关（可复现的前提）。 */

/* ---- 纯内容快照（白名单构造 / 读取 / 摘要 / 从完整搭配提取） ---- */
export const CONTENT_FORMAT = 'nai-roll-content';
export const CONTENT_VERSION = 2;
export const isDirectorySectionKey = (key: string): boolean => key.startsWith('directory:') && key.length > 10;
export const ROLE_KEYS = ['appearance', 'wardrobe', 'pose', 'expression'];
export const GLOBAL_KEYS = ['scene', 'camera'];
/* 每个分类的「内容负面」白名单：只留文本/备注/来源/模式，不留任何参数 */
export const contentNegOf = (neg: Record<string, unknown> | null | undefined) => {
  if (!neg || typeof neg !== 'object') return null;
  const text = String(neg.text == null ? '' : neg.text).trim();
  const note = String(neg.note == null ? '' : neg.note).trim();
  if (!text && !note) return null;
  return { text, note, source: String(neg.source == null ? '' : neg.source).trim() };
};
/* 来源快照 meta 的白名单（与统一编辑面板的 meta 同形，但只留能公开的字段） */
export const contentMetaOf = (meta: Record<string, unknown> | null | undefined) => {
  if (!meta || typeof meta !== 'object') return null;
  const out: Record<string, Json> = {};
  const textKeys = ['directoryId', 'directoryName', 'source', 'entryId', 'entryType', 'entryName', 'entryBasePrompt', 'entryBilingual', 'entryDescription', 'entryPreviewImage'];
  for (const k of textKeys) if (meta[k] != null) out[k] = String(meta[k]);
  const updatedAt = Number(meta['entryUpdatedAt']);
    if (Number.isFinite(updatedAt) && updatedAt > 0) out['entryUpdatedAt'] = updatedAt;
  if (Array.isArray(meta['directoryPath'])) out['directoryPath'] = meta['directoryPath'].filter((part: unknown) => typeof part === 'string');
  const entryTags = meta['entryTags'];
    if (Array.isArray(entryTags)) out['entryTags'] = entryTags.map((t: Json) => String(t || '').trim()).filter(Boolean).slice(0, 24);
  if (isObj(meta['entryFacets'])) out['entryFacets'] = JSON.parse(JSON.stringify(meta['entryFacets']));
  if (isObj(meta['entryConstraints'])) out['entryConstraints'] = JSON.parse(JSON.stringify(meta['entryConstraints']));
  out['needsReview'] = !!meta['needsReview'];
  return Object.keys(out).length ? out : null;
};
/* 构造内容快照：目录结果走 items，旧六类仍保留 roles/global，不复制生成配置。 */
export const contentSnapshotOf = (record: RollRecordLike | null | undefined, savedAt: string | undefined) => {
  const picks = (record && record.picks) || {};
  const checks = (record && record.checks) || {};
  const items: ContentItem[] = Object.entries(picks).flatMap(([key, row]) => {
    if (!isDirectorySectionKey(key) || checks[key] === false || !row?.filled || !String(row.text || '').trim()) return [];
    return [{ unitId: key, directoryId: key.slice(10), directoryName: String(row.directoryName || row.title || row.label || key.slice(10)),
      directoryPath: Array.isArray(row.directoryPath) ? row.directoryPath.filter((part: unknown) => typeof part === 'string') : [],
      scope: row.scope === 'character' ? 'character' as const : 'global' as const, text: String(row.text).trim(), negative: String(row.negative || '').trim(),
      constraintNotes: String(row.constraintNotes || row.constraints?.notes || ''), meta: contentMetaOf(row.meta || { entryId: row.id, entryName: row.name }) }];
  });
  const roles: Json[] = [];
  const global: Record<string, Json> = {};
  const provided: Record<string, Json> = {};
  const sections: Record<string, Json> = {};
  const negatives: Record<string, Json> = {};
  const meta: Record<string, Json> = {};
  let any = false;
  for (const kind of ROLE_KEYS) {
    const row = picks[kind];
    const on = checks[kind] !== false;
    if (!on || !row || !row.filled) { provided[kind] = false; continue; }
    const text = String(row.text || '').trim();
    if (!text) { provided[kind] = false; continue; }
    provided[kind] = true;
    sections[kind] = text;
    const neg = contentNegOf({
      text: row.negative || '',
      note: row.constraintNotes || (row.constraints && row.constraints.notes) || '',
      source: row.name || ''
    });
    if (neg) negatives[kind] = neg;
    const m = contentMetaOf(row.meta || null);
    if (m) meta[kind] = m;
    any = true;
  }
  if (any) roles.push({ key: 'role-1', name: '角色 1', provided, sections, negatives, meta });
  for (const kind of GLOBAL_KEYS) {
    const row = picks[kind];
    const on = checks[kind] !== false;
    if (!on || !row || !row.filled) { global[kind] = { provided: false }; continue; }
    const text = String(row.text || '').trim();
    if (!text) { global[kind] = { provided: false }; continue; }
    const neg = contentNegOf({
      text: row.negative || '',
      note: row.constraintNotes || (row.constraints && row.constraints.notes) || '',
      source: row.name || ''
    });
    global[kind] = { provided: true, text, negative: neg || null, meta: contentMetaOf(row.meta || null) || null };
    any = true;
  }
  if (!any && !items.length) return null;
  const evidence = record && record.roll ? record.roll : {
    seed: String((record && record.seed) || ''),
    seeds: Object.assign({}, (record && record.seeds) || {}),
    checks: Object.assign({}, checks),
    locks: Object.assign({}, (record && (record.locked || record.locks)) || {})
  };
  return {
    format: CONTENT_FORMAT,
    version: CONTENT_VERSION,
    savedAt: String(savedAt || ''),
    algo: ALGO,
    roll: {
      seed: String(evidence.seed || ''),
      seeds: Object.assign({}, evidence.seeds || {}),
      checks: Object.assign({}, evidence.checks || checks),
      locks: Object.assign({}, evidence.locks || {})
    },
    roles,
    global,
    ...(items.length ? { items } : {})
  };
};
/* 白名单读取：只接受 format/version 正确的记录；字段缺失按「未提供」处理，不猜、不清空 */
export const contentRead = (raw: Json): ContentRead => {
  const warnings: Json[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'empty', warnings: ['记录里没有内容快照'], items: [], roles: [], global: {}, anyRole: false, anyGlobal: false };
  const format = String(raw.format || '');
  if (format !== CONTENT_FORMAT) {
    return { ok: false, reason: 'not_content', warnings: ['这条记录不是纯内容格式（' + (format || '无标识') + '），不走纯内容载入'], items: [], roles: [], global: {}, anyRole: false, anyGlobal: false };
  }
  const version = Number(raw.version) || 0;
  if (version !== 1 && version !== CONTENT_VERSION) warnings.push('结构版本 ' + String(version) + ' 与当前载入器（' + String(CONTENT_VERSION) + '）不同：只按已知字段读取，未知字段不应用');
  const items: ContentItem[] = (Array.isArray(raw.items) ? raw.items : []).flatMap((item: Json) => {
    const key = String(item?.unitId || '');
    if (!isDirectorySectionKey(key) || !String(item?.text || '').trim()) return [];
    return [{ unitId: key, directoryId: key.slice(10), directoryName: String(item.directoryName || key.slice(10)),
      directoryPath: Array.isArray(item.directoryPath) ? item.directoryPath.filter((part: unknown) => typeof part === 'string') : [],
      scope: item.scope === 'character' ? 'character' as const : 'global' as const, text: String(item.text).trim(), negative: String(item.negative || '').trim(),
      constraintNotes: String(item.constraintNotes || ''), meta: contentMetaOf(item.meta) }];
  });
  const rolesIn = Array.isArray(raw.roles) ? raw.roles : [];
  const roles = (rolesIn as Json[]).map((r: Json, i: number) => {
    const sections: Record<string, Json> = {};
    const negatives: Record<string, Json> = {};
    const meta: Record<string, Json> = {};
    const provided: Record<string, Json> = {};
    for (const kind of ROLE_KEYS) {
      const text = String((r && r.sections && r.sections[kind]) || '').trim();
      provided[kind] = !!(r && r.provided && r.provided[kind] === true && text);
      if (!provided[kind]) continue;
      sections[kind] = text;
      const neg = contentNegOf(r && r.negatives && r.negatives[kind]);
      if (neg) negatives[kind] = neg;
      const m = contentMetaOf(r && r.meta && r.meta[kind]);
      if (m) meta[kind] = m;
    }
    return { key: String((r && r.key) || ('role-' + String(i + 1))), name: String((r && r.name) || ('角色 ' + String(i + 1))), provided, sections, negatives, meta };
  }).filter((r: Json) => ROLE_KEYS.some((k: string) => r.provided[k]));
  const global: Record<string, Json> = {};
  for (const kind of GLOBAL_KEYS) {
    const g = raw.global && raw.global[kind];
    const text = String((g && g.text) || '').trim();
    const ok = !!(g && g.provided === true && text);
    global[kind] = ok ? { provided: true, text, negative: contentNegOf(g && g.negative), meta: contentMetaOf(g && g.meta) } : { provided: false };
  }
  const anyRole = roles.length > 0 || items.some(item => item.scope === 'character');
  const anyGlobal = items.some(item => item.scope === 'global') || GLOBAL_KEYS.some((k: string) => global[k]['provided'] as boolean);
  if (!anyRole && !anyGlobal) return { ok: false, reason: 'no_content', warnings: warnings.concat(['这条记录里没有可载入的内容']), items: [], roles: [], global, anyRole, anyGlobal };
  return {
    ok: true,
    format,
    version,
    savedAt: String(raw.savedAt || ''),
    algo: String(raw.algo || ''),
    roll: raw.roll && typeof raw.roll === 'object' ? {
      seed: String(raw.roll.seed || ''),
      seeds: Object.assign({}, raw.roll.seeds || {}),
      checks: Object.assign({}, raw.roll.checks || {}),
      locks: Object.assign({}, raw.roll.locks || {})
    } : null,
    items,
    roles,
    global,
    anyRole,
    anyGlobal,
    warnings
  };
};
export const isContentRecord = (chain: ChainLike | null | undefined) => {
  const params = chain?.params as Record<string, Json> | undefined;
  const snapshot = params?._rollContentSnapshot;
  return isObj(snapshot) && String(snapshot['format'] || '') === CONTENT_FORMAT;
};
export const contentOfChain = (chain: ChainLike | null | undefined) => {
  const params = chain?.params as Record<string, Json> | undefined;
  return isContentRecord(chain) ? contentRead(params?._rollContentSnapshot) : { ok: false, reason: 'not_content', warnings: [] };
};
/* 卡片/预览用：这条记录实际包含哪些分类（不把空库/未参与显示成已有内容） */
export const contentScopeOf = (readData: ContentRead | null | undefined) => {
  const out: { roleKinds: string[]; globalKinds: string[]; roleCount: number; label: string } = { roleKinds: [], globalKinds: [], roleCount: 0, label: '' };
  if (!readData || !readData.ok) return out;
  out.roleCount = readData.roles.length || (readData.items?.some(item => item.scope === 'character') ? 1 : 0);
  if (readData.roles[0]) out.roleKinds = ROLE_KEYS.filter((k: string) => readData.roles[0].provided[k]);
  out.globalKinds = GLOBAL_KEYS.filter((k: string) => readData.global[k] && readData.global[k].provided);
  out.roleKinds.push(...(readData.items || []).filter(item => item.scope === 'character').map(item => item.unitId));
  out.globalKinds.push(...(readData.items || []).filter(item => item.scope === 'global').map(item => item.unitId));
  const labelOf = (k: string) => (META[k] ? META[k].short : readData.items?.find(item => item.unitId === k)?.directoryName || k);
  const parts: Json[] = [];
  if (out.roleKinds.length) parts.push('角色：' + out.roleKinds.map(labelOf).join(' / '));
  if (out.globalKinds.length) parts.push('全局：' + out.globalKinds.map(labelOf).join(' / '));
  out.label = parts.join('；');
  return out;
};
/* 从旧「完整搭配」快照里提取六类内容（人工提取另存用；排除风格、风格负面与参数） */
export const contentFromPresetSnapshot = (snap: Record<string, unknown> | null | undefined, savedAt: string | undefined) => {
  if (!snap || typeof snap !== 'object') return null;
  const sp: Record<string, Json> = isObj(snap.params) ? snap.params : {};
  const sec: Record<string, Json> = isObj(sp['_promptSections']) ? (sp['_promptSections'] as Record<string, Json>) : {};
  const secNeg: Record<string, Json> = isObj(sp['_promptSectionsNegatives']) ? (sp['_promptSectionsNegatives'] as Record<string, Json>) : {};
  const chars = Array.isArray(sp.characters) ? sp.characters : [];
  const cneg = (sp._characterSectionsNegatives && typeof sp._characterSectionsNegatives === 'object') ? sp._characterSectionsNegatives : {};
  const cmeta = (sp._characterSectionsMeta && typeof sp._characterSectionsMeta === 'object') ? sp._characterSectionsMeta : {};
  const roles: Json[] = [];
  for (const c of chars) {
    const id = String((c && c.id) || '');
    const s = (c && c.sections && typeof c.sections === 'object') ? c.sections : {};
    const provided: Record<string, Json> = {};
    const sections: Record<string, Json> = {};
    const negatives: Record<string, Json> = {};
    const meta: Record<string, Json> = {};
    let any = false;
    for (const kind of ROLE_KEYS) {
      const text = String(s[kind] || '').trim();
      provided[kind] = !!text;
      if (!text) continue;
      sections[kind] = text;
      const neg = contentNegOf(cneg[id + '::' + kind]);
      if (neg) negatives[kind] = neg;
      const m = contentMetaOf(cmeta[id + '::' + kind]);
      if (m) meta[kind] = m;
      any = true;
    }
    if (any) roles.push({ key: id || ('role-' + String(roles.length + 1)), name: String((c && c.name) || ('角色 ' + String(roles.length + 1))), provided, sections, negatives, meta });
  }
  const global: Record<string, Json> = {};
  for (const kind of GLOBAL_KEYS) {
    const text = String(sec[kind] == null ? (kind === 'scene' ? (sec.extra || '') : '') : sec[kind]).trim();
    global[kind] = text ? { provided: true, text, negative: contentNegOf(secNeg[kind]), meta: null } : { provided: false };
  }
  const anyGlobal = GLOBAL_KEYS.some(k => global[k].provided);
  if (!roles.length && !anyGlobal) return null;
  return {
    format: CONTENT_FORMAT, version: CONTENT_VERSION, savedAt: String(savedAt || ''), algo: ALGO,
    roll: { seed: '', seeds: {}, checks: {}, locks: {}, extractedFrom: 'preset' },
    roles, global,
    extracted: {
      excluded: ['画师串（basePrompt）', '风格配套全局负面', '用户手填全局负面', '模型 / 采样器 / 步数 / CFG / 尺寸 / 张数 / 生图 seed'],
      mixedNegativeWarning: (() => {
        const legacyScan = [String((snap && snap.basePrompt) || ''), String((snap && snap.negativePrompt) || '')].filter(Boolean).length;
        return legacyScan > 0;
      })()
    }
  };
};
