const OFFICIAL_DOCS_ROOT = 'https://docs.novelai.net/en/image';
const V5_RELEASE_URL = 'https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/';

/**
 * Agent 使用的 NovelAI 官方知识摘要。
 *
 * 这里只保存可检索的结构化事实与来源，不镜像官方文档全文。release 条目优先于
 * docs 条目，避免 V5 发布后通用文档尚未更新时把旧版能力误套到新模型。
 */
export const NOVELAI_OFFICIAL_KNOWLEDGE = Object.freeze([
  {
    id: 'v5-release-capabilities',
    title: 'NovelAI Diffusion V5 发布能力',
    topic: 'models',
    appliesTo: ['v5'],
    sourceKind: 'official-release',
    authorityRank: 400,
    reviewedAt: '2026-08-23',
    sourceUrl: V5_RELEASE_URL,
    summary: 'V5 显著增强自然语言、多语言、长提示词、多角色定位、文字和透明背景能力。',
    facts: [
      'V5 Full 与 V5 Curated 已发布。',
      '自然语言理解比 V4.5 更强，同时继续完整支持 Tag 提示。',
      '官方支持英语与日语；中文等语言在测试中可用，但不是主要训练重点，效果可能波动。',
      'V5 可处理比 V4.5 更长的提示词；发布公告没有给出可安全写死的精确 Token 上限。',
      'V5 支持更多独立角色提示词；官方测试曾让最多 22 个不同角色同时出现，这不是成功保证。',
      'V5 角色定位由旧式小网格升级为画布自由定位，定位服从性明显增强。',
      'V5 支持用英语、日语、中文等语言渲染文字，并可通过带引号的自然语言描述文字样式和位置。',
      'V5 原生支持透明背景与 Alpha 透明效果。',
    ],
    caveats: [
      'V5 发布时 Precise Reference 与 Vibe Transfer 尚未开放。',
      '不要把 V4.5 的约 512 T5 Token、六角色或 5×5 定位当作 V5 的官方上限。',
    ],
  },
  {
    id: 'prompt-tags-basics',
    title: 'Tag 与提示词基础',
    topic: 'prompting',
    appliesTo: ['all'],
    sourceKind: 'official-docs',
    authorityRank: 200,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/tags/`,
    summary: '已知 Tag 有利于精确控制和跨生成一致性，但并非必须只使用 Tag。',
    facts: [
      'NovelAI 模型针对标签知识进行训练，已知 Tag 通常能提供更稳定、可控的结果。',
      'Tag 建议中的知识标记反映模型对该 Tag 的熟悉程度。',
      '提示词顺序可能影响结果，应把重要内容放在靠前位置并避免冗余。',
      '复杂或标签难以表达的概念可以使用自然语言；具体能力取决于模型代际。',
    ],
    caveats: ['V3 的靠前 Tag 权重行为不应直接推广为所有新模型的固定公式。'],
  },
  {
    id: 'prompt-emphasis',
    title: '提示词加强与减弱',
    topic: 'prompting',
    appliesTo: ['all'],
    sourceKind: 'official-docs',
    authorityRank: 220,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/strengthening-weakening/`,
    summary: '花括号、方括号与数值权重可调节提示词影响；不同数值能力有模型版本边界。',
    facts: [
      '`{}` 每层约乘以 1.05，`[]` 每层约除以 1.05；正面与 Undesired Content 均可使用。',
      'V4 及以上支持 `1.5::内容::` 一类数值权重。',
      'V4.5 及以上支持负数权重，可用于针对性移除或反转概念。',
      '负数权重适合针对性移除，不是 Undesired Content 的通用替代品。',
    ],
    caveats: ['不要使用 Stable Diffusion 常见的 `(tag:1.5)` 语法冒充 NovelAI 数值权重。'],
  },
  {
    id: 'multi-character-v4',
    title: 'V4/V4.5 多角色提示词',
    topic: 'characters',
    appliesTo: ['v4', 'v4.5'],
    sourceKind: 'official-docs',
    authorityRank: 260,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/multiplecharacters/`,
    summary: 'V4 系列把场景基础提示词与最多六个角色提示词分离，降低角色特征串位。',
    facts: [
      'V4 及以上支持基础提示词加独立角色提示词；V4/V4.5 官方文档给出的上限是六个角色。',
      '准确总人数标签放在基础提示词；各角色提示词使用不带数字的 girl、boy 或 other。',
      '角色提示词顺序通常按从上到下、从左到右影响角色排列。',
      'V4/V4.5 的位置选择是轻量提示，最好与角色顺序和自然语言位置描述保持一致。',
      '互动可使用 `source#`、`target#` 与 `mutual#` 前缀，但官方明确说明并非始终可靠。',
    ],
    caveats: ['不要把角色位置描述成像素级保证。'],
  },
  {
    id: 'multi-character-v5',
    title: 'V5 多角色与定位',
    topic: 'characters',
    appliesTo: ['v5'],
    sourceKind: 'official-release',
    authorityRank: 390,
    reviewedAt: '2026-08-23',
    sourceUrl: V5_RELEASE_URL,
    summary: 'V5 支持更多角色提示词和自由画布定位，角色一致性与互动能力优于 V4.5。',
    facts: [
      'V5 的独立角色提示词数量明显高于 V4.5，官方测试案例最高达到 22 个角色。',
      'V5 可在画布上自由设置角色位置，定位比 V4.5 的小网格更强。',
      '定位有助于构图、角色一致性、复杂互动并减少特征串位。',
      '基础提示词与角色专属提示词仍应按整图信息和角色独有信息分工。',
    ],
    caveats: ['22 是官方测试成果而不是每次生成的稳定保证；还需服从当前项目可提交的角色槽能力。'],
  },
  {
    id: 'undesired-content',
    title: 'Undesired Content',
    topic: 'negative-prompt',
    appliesTo: ['all'],
    sourceKind: 'official-docs',
    authorityRank: 200,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/undesiredcontent/`,
    summary: 'Undesired Content 用于描述不希望出现在图片中的元素，并可结合官方预设。',
    facts: [
      'Undesired Content 会引导模型避开其中的元素或概念。',
      '加强语法在 Undesired Content 中表示更强地避开，减弱语法表示较弱地避开。',
      '预设内容与自定义负面提示词应按当前模型和画面目标选择，不应机械堆叠互相冲突的词。',
    ],
    caveats: ['项目自定义的分级模板或固定负面词清单属于项目经验，不等同于官方规则。'],
  },
  {
    id: 'quality-tags-v45',
    title: 'V4.5 官方质量 Tag',
    topic: 'quality',
    appliesTo: ['v4.5'],
    sourceKind: 'official-docs',
    authorityRank: 250,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/qualitytags/`,
    summary: 'V4.5 的 Add Quality Tags 会在提示词末尾自动追加模型专用预设。',
    facts: [
      'V4.5 Full 的官方质量 Tag 为 `location, very aesthetic, masterpiece, no text`。',
      'V4.5 Curated 使用不同的官方质量 Tag，并含 `rating:general`。',
      '自动质量 Tag 会占用提示词上下文，并可能影响文字生成。',
    ],
    caveats: ['该文档当前没有给出 V5 的质量 Tag，不能把 V4.5 值冒充为 V5 官方值。'],
  },
  {
    id: 'text-rendering-v45',
    title: 'V4/V4.5 文字渲染',
    topic: 'text-rendering',
    appliesTo: ['v4', 'v4.5'],
    sourceKind: 'official-docs',
    authorityRank: 240,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/textrendering/`,
    summary: 'V4 系列使用 `Text:` 块描述画面文字，基础提示词通常最可靠。',
    facts: [
      '多个独立文本块可用空行分隔。',
      '把 `Text:` 放在基础提示词通常最可靠，角色提示词中也可使用。',
      '短文字难以出现时可尝试关闭含 `no text` 的质量 Tag。',
    ],
    caveats: ['V5 已新增引号自动准备 Text 块的能力，应优先读取 V5 发布条目。'],
  },
  {
    id: 'vibe-transfer',
    title: 'Vibe Transfer',
    topic: 'references',
    appliesTo: ['v4', 'v4.5'],
    sourceKind: 'official-docs',
    authorityRank: 240,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/vibetransfer/`,
    summary: 'Vibe Transfer 从图片提取风格与构图线索，可调整强度和信息提取量。',
    facts: [
      '多个 Vibe 的总强度通常建议不超过 1.0，V4 及以上可自动归一化。',
      'V4 及以上编码一个信息提取量变体一次性消耗 2 ImageAnlas，已编码变体可复用。',
      '最多可使用 16 个 Vibe；V4 及以上超过四个后，每多一个会增加 2 ImageAnlas。',
      '图片下载得到的 PNG 元数据可包含编码后的 Vibe，但不包含原始参考图片。',
    ],
    caveats: ['V5 当前仍未开放 Vibe Transfer；项目永久编码资产仍使用 V4.5 Full 编码管线，实际可用模型由官方运行时能力表决定。'],
  },
  {
    id: 'precise-reference-v45',
    title: 'V4.5 Precise Reference',
    topic: 'references',
    appliesTo: ['v4.5'],
    sourceKind: 'official-docs',
    authorityRank: 260,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/precisereference/`,
    summary: 'Precise Reference 可分别参考角色、风格或两者，Strength 与 Fidelity 控制影响程度。',
    facts: [
      '每张 Precise Reference 每次生成额外消耗 5 ImageAnlas，费用随参考图数量增加。',
      'Strength 控制参考图视觉线索的影响强度，Fidelity 控制参考被执行的严格程度。',
      '多张角色参考目前会互相混合，并不会自动对应为多个独立角色。',
      'Precise Reference 可用于 Inpainting。',
    ],
    caveats: ['官方文档限定为 V4.5；V5 发布时该功能尚未开放，并且与 Vibe Transfer 不兼容。'],
  },
  {
    id: 'sampling-guidance',
    title: '采样与 Prompt Guidance',
    topic: 'parameters',
    appliesTo: ['all'],
    sourceKind: 'official-docs',
    authorityRank: 180,
    reviewedAt: '2026-08-23',
    sourceUrl: `${OFFICIAL_DOCS_ROOT}/sampling/`,
    summary: 'Sampler、Steps 与 Prompt Guidance 共同影响速度、细节和提示词服从度，应按模型与画面试验。',
    facts: [
      '更高 Steps 通常增加计算时间，但并不保证始终带来更好的图片。',
      'Prompt Guidance 越高通常越贴近提示词，过高也可能造成伪影或降低自然度。',
      'Sampler 的效果依赖模型和其他参数，不应把单一采样器宣称为所有任务的官方最佳值。',
    ],
    caveats: ['具体可用采样器和参数边界应以项目当前模型选择器与官方运行时为准。'],
  },
]);

export const resolveNovelAiModelFamily = modelId => {
  const value = String(modelId || '').toLowerCase();
  if (/nai-diffusion-5(?:-|$)/.test(value)) return 'v5';
  if (/nai-diffusion-4-5(?:-|$)/.test(value)) return 'v4.5';
  if (/nai-diffusion-4(?:-|$)/.test(value)) return 'v4';
  if (/nai-diffusion-(?:furry-)?3(?:-|$)/.test(value)) return 'v3';
  return 'unknown';
};

export const getNovelAiModelProfile = modelId => {
  const id = String(modelId || 'nai-diffusion-4-5-full').trim() || 'nai-diffusion-4-5-full';
  const family = resolveNovelAiModelFamily(id);
  if (family === 'v5') return {
    id, family, label: /curated/.test(id) ? 'V5 Curated' : 'V5 Full',
    officialPrompting: 'Tag 与自然语言均完整支持；官方语言为英语、日语，中文可用但效果可能波动。',
    officialPromptCapacity: '长于 V4.5；官方发布公告未给出精确 Token 上限。',
    officialCharacterCapability: '高于 V4.5，官方测试最高展示 22 个角色；不是稳定保证。',
    officialPositioning: '画布自由定位，服从性比 V4.5 更强。',
    project: { maxCharacterPrompts: 32, supportsVibes: false, supportsPreciseReference: false, supportsAlphaTransparency: true, coordinateRange: '0..1' },
  };
  if (family === 'v4.5') return {
    id, family, label: /curated/.test(id) ? 'V4.5 Curated' : 'V4.5 Full',
    officialPrompting: '英文 Tag 优先，也支持英文自然语言。',
    officialPromptCapacity: '基础提示词与全部角色提示词合计约 512 T5 Token。',
    officialCharacterCapability: '最多六个独立角色提示词。',
    officialPositioning: '官方界面为 5×5 粗略位置提示，需与顺序和文字描述一致。',
    project: { maxCharacterPrompts: 6, supportsVibes: true, supportsPreciseReference: true, supportsAlphaTransparency: false, coordinateRange: '0..1' },
  };
  if (family === 'v4') return {
    id, family, label: /curated/.test(id) ? 'V4 Curated' : 'V4 Full',
    officialPrompting: '英文 Tag 优先，也支持英文自然语言。',
    officialPromptCapacity: '基础提示词与全部角色提示词合计约 512 T5 Token。',
    officialCharacterCapability: '最多六个独立角色提示词。',
    officialPositioning: '5×5 粗略位置提示。',
    project: { maxCharacterPrompts: 6, supportsVibes: true, supportsPreciseReference: false, supportsAlphaTransparency: false, coordinateRange: '0..1' },
  };
  return {
    id, family, label: id,
    officialPrompting: '模型能力未知；优先使用项目可验证的英文 Tag。',
    officialPromptCapacity: '未知，不套用其他代际的 Token 上限。',
    officialCharacterCapability: '未知，按项目保守上限处理。',
    officialPositioning: '未知，位置只视为粗略提示。',
    project: { maxCharacterPrompts: 6, supportsVibes: false, supportsPreciseReference: false, supportsAlphaTransparency: false, coordinateRange: '0..1' },
  };
};

const appliesToModel = (entry, family) => entry.appliesTo.includes('all') || entry.appliesTo.includes(family);
const searchTerms = value => String(value || '').normalize('NFKC').toLowerCase().split(/[\s,，/]+/).filter(Boolean);

export const searchNovelAiOfficialKnowledge = ({ query = '', modelId = '', topic = '', limit = 8, includeOtherModels = false } = {}) => {
  const family = resolveNovelAiModelFamily(modelId);
  const terms = searchTerms(query);
  return NOVELAI_OFFICIAL_KNOWLEDGE
    .flatMap(entry => {
      if (topic && entry.topic !== topic) return [];
      const applicable = appliesToModel(entry, family);
      if (!includeOtherModels && family !== 'unknown' && !applicable) return [];
      const haystack = [entry.id, entry.title, entry.topic, ...entry.appliesTo, entry.summary, ...entry.facts, ...entry.caveats].join(' ').toLowerCase();
      const matchedTerms = terms.filter(term => haystack.includes(term));
      if (terms.length && !matchedTerms.length) return [];
      const score = entry.authorityRank + (applicable ? 100 : 0)
        + matchedTerms.length * 20
        + matchedTerms.reduce((total, term) => total + (entry.title.toLowerCase().includes(term) ? 30 : 0), 0);
      return [{ entry, score, applicable }];
    })
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
    .map(({ entry, applicable }) => ({
      id: entry.id, title: entry.title, topic: entry.topic, appliesTo: entry.appliesTo,
      applicable, sourceKind: entry.sourceKind, reviewedAt: entry.reviewedAt,
      summary: entry.summary, sourceUrl: entry.sourceUrl,
    }));
};

export const readNovelAiOfficialKnowledge = id => NOVELAI_OFFICIAL_KNOWLEDGE.find(entry => entry.id === String(id || '').trim()) || null;
