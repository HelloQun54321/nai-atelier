/**
 * 漫画「AI 整页锚点编排」提示词构建与结构化响应解析（前后端共用）。
 *
 * 严格编码 49 张 V5 实测铁律：
 * 1. 绝不在总词剧透单格细节，全部靠 (X, Y) 锚点驱动；
 * 2. 同一角色跨格出场必须拆为多个独立锚点槽；
 * 3. 有人格的格子禁止另建独立 no humans 纯背景槽（背景并入人物锚点）；
 * 4. 气泡锚点独立设槽（靠近说话人），支持空白气泡或锚点内短 Text:。
 */

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 1000) / 1000;
};

const VALID_KINDS = new Set(['character', 'scene', 'bubble', 'inset']);
const VALID_SHAPES = new Set(['oval', 'shout', 'thought', 'caption']);

export function buildComicStoryboardSystemPrompt() {
  return [
    '你是专业漫画分镜导演兼 NovelAI V5 空间锚点编排专家。',
    '请把用户的剧情大纲编排成一整页可视化分镜与 V5 自由坐标锚点 JSON，严禁输出除 JSON 以外的任何多余解释文字。',
    '',
    '必须遵守的 NovelAI V5 实测铁律：',
    '1. layoutHint（英文）只写极简分镜骨架壳（如 "4-panel manga page, 1-2-1 layout, crisp white gutters"），绝不剧透具体人物或剧情细节。',
    '2. guidePanels 定义半透明构图引导区（归一化坐标 x, y, width, height ∈ [0.02, 0.96]），互不重叠且留有漫画白边间距；横版画幅推荐左右双列，竖版画幅推荐 1-2-1、L型、2x2 或上下节奏排列。如果用户在消息中提供了「当前画布参考格坐标」，则必须严格沿用这些格子的位置与大小（不要覆盖改动坐标），只补充每格的 summary（中文镜头剧情）与 visualNote（纯英文机位/景别/光影环境词，如 "wide shot, rainy school gate, cool twilight lighting"）。',
    '3. anchors 定义整页所有空间锚点，每个锚点坐标 (x, y) 必须准确落在对应 guidePanel 内部：',
    '   - kind="character"：人物锚点。同一角色在不同格出场必须拆成多个独立锚点！每个角色锚点的英文 prompt 必须包含：外貌服饰一致性特征 + 本格动作表情 + 本格景别机位（如 close-up / low angle）+ 本格背景光影环境。',
    '   - kind="scene"：仅用于「完全无人的空镜/静物格」（可写 no humans），或在有人格中精准定位某件角落关键道具（如桌上蛋糕、宝箱；此时绝不能写 no humans！）。严禁在已有角色锚点的格子里另建 no humans 背景槽！',
    '   - kind="bubble"：仅在 dialogueMode 为 empty-bubble 或 ai-text 时生成；放置在说话人同格侧上方，指定 bubbleShape（oval / shout / thought / caption）与英文指向说明（如 tail pointing left），bubbleText 填中文/日文/英文短台词（ai-text 模式限 2~6 字）。若 dialogueMode 为 clean-vector，仍可在 guidePanel 留出气泡余白，但不要输出 kind="bubble" 锚点。',
    '   - kind="inset"：可选画中画特写叠框（眼眸/手部/物件特写）。',
    '4. 槽位预算：整页单区（≤4~5格）锚点总数尽量控制在 6~12 个；6~8 格页控制在 12~20 个（系统会自动拆双区，单区绝不超过 24 个）。',
    '',
    '输出严格遵循以下 JSON 结构：',
    '{',
    '  "title": "简短中文页标题",',
    '  "layoutHint": "4-panel manga page, 1-2-1 layout, clean white gutters",',
    '  "guidePanels": [',
    '    { "label": "第 1 格", "summary": "中文分镜剧情与镜头说明", "visualNote": "wide shot, rainy street, overcast sky, reflections on wet pavement", "x": 0.04, "y": 0.04, "width": 0.92, "height": 0.28 }',
    '  ],',
    '  "anchors": [',
    '    {',
    '      "kind": "character",',
    '      "label": "女主·雨中奔跑",',
    '      "prompt": "1girl, silver twintails, sailor uniform, holding schoolbag over head, running in heavy rain, street background, dynamic angle",',
    '      "negativePrompt": "",',
    '      "x": 0.50,',
    '      "y": 0.18,',
    '      "bubbleShape": "oval",',
    '      "bubbleText": ""',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

export function buildComicStoryboardUserMessage(input = {}) {
  const storyPrompt = String(input.storyPrompt || '').trim();
  const targetPanelCount = Math.max(2, Math.min(8, Math.round(Number(input.targetPanelCount) || 4)));
  const width = Math.round(Number(input.width) || 832);
  const height = Math.round(Number(input.height) || 1216);
  const orientation = width > height ? `横版跨页 (${width}x${height})` : width === height ? `方形 (${width}x${height})` : `竖版单页 (${width}x${height})`;
  const colorMode = input.colorMode === 'monochrome' ? '黑白网点日漫（角色与场景词避免强调彩色色相，多用光影、网点与线稿表现）' : '全彩漫画';
  const dialogueMode = input.dialogueMode === 'ai-text'
    ? 'ai-text（需要气泡锚点，并在 bubbleText 中填入 2~6 字短台词或拟声词）'
    : input.dialogueMode === 'empty-bubble'
      ? 'empty-bubble（需要空白气泡锚点定位，bubbleText 可记录对应中文台词供后期嵌字）'
      : 'clean-vector（无气泡纯画面，不要生成 kind="bubble" 锚点，把槽位留给人物、道具与特写）';

  const cast = Array.isArray(input.castCharacters)
    ? input.castCharacters
      .filter(c => c && typeof c.name === 'string')
      .slice(0, 8)
      .map((c, idx) => `  ${idx + 1}. ${c.name}: ${String(c.prompt || '').trim()}`)
    : [];

  const existingPanels = Array.isArray(input.existingGuidePanels)
    ? input.existingGuidePanels
      .filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .slice(0, 10)
    : [];

  const lines = [
    `画幅方向：${orientation}`,
    `目标分镜格数：${existingPanels.length > 0 && input.preserveExistingLayout !== false ? existingPanels.length : targetPanelCount} 格`,
    `色彩风格：${colorMode}`,
    `对白策略：${dialogueMode}`,
  ];
  if (existingPanels.length > 0 && input.preserveExistingLayout !== false) {
    lines.push(
      '当前画布参考格坐标（必须严格沿用以下各格的 x/y/width/height，并把每格锚点精准落在对应矩形内部）：',
      ...existingPanels.map((p, idx) =>
        `  格 ${idx + 1} (${String(p.label || `第 ${idx + 1} 格`)}): x=${Number(p.x).toFixed(3)}, y=${Number(p.y).toFixed(3)}, width=${Number(p.width).toFixed(3)}, height=${Number(p.height).toFixed(3)}`,
      ),
    );
  }
  if (cast.length > 0) {
    lines.push('参演角色库设定（跨格出场请保持以下外观特征一致）：', ...cast);
  }
  lines.push('', '剧情大纲 / 分镜台本：', storyPrompt || '校园天台夕阳下偶遇的温馨四格日常');
  lines.push('', '请直接输出 JSON 对象。');
  return lines.join('\n');
}

function extractJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseComicStoryboardResponse(rawText, options = {}) {
  const parsed = extractJsonObject(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 返回的分镜编排格式无法解析为有效 JSON，请重试');
  }

  const rawPanels = Array.isArray(parsed.guidePanels) ? parsed.guidePanels : [];
  const lockedPanels = options.preserveExistingLayout !== false && Array.isArray(options.existingGuidePanels) && options.existingGuidePanels.length > 0
    ? options.existingGuidePanels
    : null;
  const guidePanels = (lockedPanels && rawPanels.length === lockedPanels.length ? lockedPanels : rawPanels.slice(0, 10)).map((panel, idx) => {
    const aiPanel = rawPanels[idx] || panel;
    const x = clamp(panel?.x, 0.02, 0.90, 0.04);
    const y = clamp(panel?.y, 0.02, 0.90, 0.04);
    const width = clamp(panel?.width, 0.12, 1 - x - 0.02, 0.92);
    const height = clamp(panel?.height, 0.10, 1 - y - 0.02, 0.25);
    return {
      label: typeof aiPanel?.label === 'string' && aiPanel.label.trim() ? aiPanel.label.trim().slice(0, 32) : `第 ${idx + 1} 格`,
      summary: typeof aiPanel?.summary === 'string' ? aiPanel.summary.trim().slice(0, 160) : '',
      visualNote: typeof aiPanel?.visualNote === 'string' ? aiPanel.visualNote.trim().slice(0, 220) : '',
      x,
      y,
      width,
      height,
    };
  });

  if (guidePanels.length === 0) {
    throw new Error('AI 未返回任何有效分镜格，请补充更具体的剧情描述后重试');
  }

  const dialogueMode = options.dialogueMode || 'empty-bubble';
  const rawAnchors = Array.isArray(parsed.anchors) ? parsed.anchors : [];
  const anchors = rawAnchors
    .slice(0, 40)
    .map((anchor, idx) => {
      const kind = VALID_KINDS.has(anchor?.kind) ? anchor.kind : 'character';
      if (dialogueMode === 'clean-vector' && kind === 'bubble') return null;
      const bubbleShape = VALID_SHAPES.has(anchor?.bubbleShape) ? anchor.bubbleShape : 'oval';
      return {
        kind,
        label: typeof anchor?.label === 'string' && anchor.label.trim() ? anchor.label.trim().slice(0, 40) : `锚点 ${idx + 1}`,
        prompt: typeof anchor?.prompt === 'string' ? anchor.prompt.trim() : '',
        negativePrompt: typeof anchor?.negativePrompt === 'string' ? anchor.negativePrompt.trim() : '',
        x: clamp(anchor?.x, 0.04, 0.96, 0.5),
        y: clamp(anchor?.y, 0.04, 0.96, 0.5),
        enabled: true,
        ...(kind === 'bubble' ? {
          bubbleShape,
          bubbleText: typeof anchor?.bubbleText === 'string' ? anchor.bubbleText.trim().slice(0, 80) : '',
        } : {}),
      };
    })
    .filter(item => item !== null && (item.prompt || item.kind === 'bubble'));

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 40) : undefined,
    layoutHint: typeof parsed.layoutHint === 'string' && parsed.layoutHint.trim()
      ? parsed.layoutHint.trim().slice(0, 240)
      : `${guidePanels.length}-panel manga page, clean white gutters`,
    guidePanels,
    anchors,
  };
}
