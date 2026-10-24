import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EXTRACTION_PROMPT,
  MAX_EXTRACTION_TEXT,
  assembleTextExtraction,
  fallbackExtractionName,
  hasChineseText,
  parseStoredGenerationMetadata,
  parseTextExtractionResponse,
  parseVisionExtractionResponse,
  prepareExtractionChunks,
  splitExtractionSources,
} from '../../services/promptExtraction.mjs';

const chunksOf = value => prepareExtractionChunks(value).chunks;
const assemble = (value, response) => {
  const chunks = chunksOf(value);
  return assembleTextExtraction(chunks, parseTextExtractionResponse(JSON.stringify(response), chunks));
};

test('负面提示词与生成参数被剥离，正文保持原样', () => {
  const sources = splitExtractionSources('1girl, red eyes\nNegative prompt: bad hands, extra fingers\nSteps: 28, Sampler: Euler a');
  assert.equal(sources.positive, '1girl, red eyes');
  assert.equal(sources.negative, 'bad hands, extra fingers');
  assert.equal(sources.parameters, 'Steps: 28, Sampler: Euler a');
  const onlyParameters = splitExtractionSources('大树下, 白色连衣裙\nSeed: 123456, CFG scale: 5');
  assert.equal(onlyParameters.positive, '大树下, 白色连衣裙');
  assert.equal(onlyParameters.negative, '');
  assert.match(onlyParameters.parameters, /Seed/);
});

test('中英文负面标题都能剥离，且剥离内容仍会展示', () => {
  for (const [raw, expected] of [
    ['red hair\nNegative: bad hands, blurry', 'bad hands, blurry'],
    ['red hair, 负面：bad hands, blurry', 'bad hands, blurry'],
    ['red hair\n负面提示词: bad hands', 'bad hands'],
    ['red hair\nUC: bad hands', 'bad hands'],
    ['red hair\n反向提示词：bad hands', 'bad hands'],
  ]) {
    const sources = splitExtractionSources(raw);
    assert.equal(sources.positive, 'red hair');
    assert.equal(sources.negative, expected);
  }
  // 普通 Tag 里出现 negative 不算标题，不能被误伤。
  assert.equal(splitExtractionSources('negative space, red hair').positive, 'negative space, red hair');
  // 被剥离的内容通过 prepareExtractionChunks 的 excluded 交给界面展示，不静默删除。
  const prepared = prepareExtractionChunks('red hair\n负面：bad hands, blurry');
  assert.deepEqual(prepared.chunks.map(chunk => chunk.text), ['red hair']);
  assert.equal(prepared.excluded.negative, 'bad hands, blurry');
});

test('切片保留原词、权重、括号组、加权组与重复项', () => {
  const chunks = chunksOf('1.3::blue hair, blue eyes::, (red dress, hat), blue eyes, blue eyes, [[smile]]');
  assert.deepEqual(chunks.map(chunk => chunk.text),
    ['1.3::blue hair, blue eyes::', '(red dress, hat)', 'blue eyes', 'blue eyes', '[[smile]]']);
  assert.deepEqual(chunks.map(chunk => chunk.id), ['s0', 's1', 's2', 's3', 's4']);
  // Tag 片段不是自然语言，不能交给模型拆写。
  assert.deepEqual(chunks.map(chunk => chunk.natural), [false, false, false, false, false]);
});

test('空输入与超长输入明确报错，不静默截断', () => {
  assert.throws(() => prepareExtractionChunks('  \n '), error => error.status === 400 && /请先粘贴提示词/.test(error.message));
  assert.throws(() => prepareExtractionChunks('a'.repeat(MAX_EXTRACTION_TEXT + 1)), /过长/);
  assert.throws(() => prepareExtractionChunks('\nNegative prompt: bad hands'), /请先粘贴提示词/);
});

test('分类结果按原片段重组：同类别连成一条，重复项不去重，未归类单独保留', () => {
  const chunks = chunksOf('1.3::blue hair, blue eyes::, (red dress, hat), blue eyes, blue eyes, masterpiece, 樱花树下, from above');
  const parsed = parseTextExtractionResponse(JSON.stringify({
    assignments: [
      { id: 's0', category: 'appearance' },
      { id: 's1', category: 'wardrobe' },
      { id: 's2', category: 'appearance' },
      { id: 's3', category: 'appearance' },
      { id: 's4', category: 'extra' },
      { id: 's5', category: 'scene' },
      { id: 's6', category: 'camera' },
    ],
    translations: [{ id: 's5', english: 'under a cherry blossom tree' }],
    names: [{ category: 'appearance', name: '蓝发蓝瞳少女' }],
  }), chunks);
  const { items, unclassified } = assembleTextExtraction(chunks, parsed);
  assert.deepEqual(items.map(item => item.kind), ['appearance', 'wardrobe', 'scene', 'camera']);
  const appearance = items[0];
  assert.equal(appearance.prompt, '1.3::blue hair, blue eyes::, blue eyes, blue eyes');
  assert.equal(appearance.name, '蓝发蓝瞳少女');
  assert.equal(items[1].prompt, '(red dress, hat)');
  assert.equal(items[2].prompt, 'under a cherry blossom tree');
  assert.equal(items[2].original, '樱花树下');
  assert.equal(items[3].name, '镜头画面：from above');
  assert.equal(unclassified.prompt, 'masterpiece');
});

test('中文加权组保留权重：译法放回 :: 外壳，不丢 3::，也不能冒充已完成', () => {
  const { items } = assemble('3::白色长发, 红色眼睛::', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair, red eyes' }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].prompt, '3::long white hair, red eyes::');
  assert.equal(items[0].original, '3::白色长发, 红色眼睛::');
  assert.equal(items[0].needsTranslation, false);
  // 括号组同样保留外壳，只替换内部内容。
  const nested = assemble('(白色长发:1.2)', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(nested.items[0].prompt, '(long white hair:1.2)');
});

/*
 * 权重与括号是源文本的结构，必须由本地程序保留：模型只回译法时也不能丢权重。
 * `1.2::…::` 是 NovelAI 原生的数值权重组；`(tag:1.2)` 与成对括号属于项目兼容的导入写法。
 */
test('中文括号数值权重由本地程序保留，不依赖模型复述权重', () => {
  const { items } = assemble('(白色长发:1.2)', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(items.length, 1);
  // 修复前是 (long white hair)：模型的纯英文译法把 1.2 吃掉了。
  assert.equal(items[0].prompt, '(long white hair:1.2)');
  assert.equal(items[0].original, '(白色长发:1.2)');
  assert.equal(items[0].needsReview, false);
});

test('中文数值加权组保留 3::，模型重复套用外层权重时不叠加', () => {
  const plain = assemble('3::白色长发, 红色眼睛::', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair, red eyes' }],
  });
  assert.equal(plain.items[0].prompt, '3::long white hair, red eyes::');
  // 模型把外层权重也复述了一遍：修复前会变成 3::3::long white hair::::。
  const echoed = assemble('3::白色长发::', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: '3::long white hair::' }],
  });
  assert.equal(echoed.items[0].prompt, '3::long white hair::');
  assert.doesNotMatch(echoed.items[0].prompt, /3::3::/);
  // 模型只复述了尾部权重、没带括号：仍按源结构还原成一整组。
  const weightOnly = assemble('(白色长发:1.2)', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair:1.2' }],
  });
  assert.equal(weightOnly.items[0].prompt, '(long white hair:1.2)');
});

test('嵌套成对括号在翻译后保持结构', () => {
  const nested = assemble('((白色长发))', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(nested.items[0].prompt, '((long white hair))');
  const brackets = assemble('[[白色长发]]', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(brackets.items[0].prompt, '[[long white hair]]');
  const mixed = assemble('({白色长发})', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(mixed.items[0].prompt, '({long white hair})');
  // 模型自己套了一层括号：只按源文本的层数还原，不叠加成三层。
  const echoed = assemble('((白色长发))', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: '(long white hair)' }],
  });
  assert.equal(echoed.items[0].prompt, '((long white hair))');
});

test('英文原词与已有权重不被翻译或重写', () => {
  const { items } = assemble('1.3::blue hair, blue eyes::, white hair', {
    assignments: [{ id: 's0', category: 'appearance' }, { id: 's1', category: 'appearance' }],
    translations: [{ id: 's0', english: '蓝色头发' }, { id: 's1', english: 'rewritten tag' }],
  });
  assert.equal(items[0].prompt, '1.3::blue hair, blue eyes::, white hair');
  assert.equal(items[0].original, '');
  assert.equal(items[0].needsReview, false);
});

test('无法可靠还原的权重结构给出明确结果，不静默输出错误提示词', () => {
  const mismatched = assemble('(白色长发]', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(mismatched.items[0].needsReview, true);
  assert.match(mismatched.items[0].reviewNote, /括号/);
  const unclosed = assemble('3::白色长发', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(unclosed.items[0].needsReview, true);
  assert.match(unclosed.items[0].reviewNote, /::/);
});

test('内层还嵌着权重或括号时标为待处理，不静默删掉内层结构', () => {
  // 1) 括号里还裹着数值权重组：修复前输出 {long white hair}、needsReview=false，内层 3:: 被静默删除。
  const innerGroup = assemble('{3::白色长发::}', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(innerGroup.items[0].needsReview, true);
  assert.match(innerGroup.items[0].reviewNote, /数值权重组/);
  assert.equal(innerGroup.items[0].original, '{3::白色长发::}');
  // 待处理的候选不该带着「看起来已经还原」的权重结构出现。
  assert.doesNotMatch(innerGroup.items[0].prompt, /::/);

  // 2) 数值权重组里还嵌套一层权重：修复前输出 1.5::long white hair::、needsReview=false。
  const nested = assemble('1.5::3::白色长发::::', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(nested.items[0].needsReview, true);
  assert.match(nested.items[0].reviewNote, /数值权重组/);
  assert.equal(nested.items[0].original, '1.5::3::白色长发::::');
  assert.doesNotMatch(nested.items[0].prompt, /1\.5::/);

  // 3) 没有外壳但内容里留着括号：同样不能当正常候选静默入库。
  const strayBracket = assemble('白色(长发', {
    assignments: [{ id: 's0', category: 'appearance' }],
    translations: [{ id: 's0', english: 'long white hair' }],
  });
  assert.equal(strayBracket.items[0].needsReview, true);
  assert.match(strayBracket.items[0].reviewNote, /括号/);
});

test('中文片段没有译文时标记待处理，不把中文当英文入库', () => {
  const { items } = assemble('白发少女, 站在窗边', {
    assignments: [{ id: 's0', category: 'appearance' }, { id: 's1', category: 'scene' }],
  });
  assert.equal(items[0].prompt, '白发少女');
  assert.equal(items[0].needsTranslation, true);
  assert.equal(items[1].prompt, '站在窗边');
  assert.equal(items[1].needsTranslation, true);
});

test('自然语言叙述可以拆出多个类别，已有 Tag 不受影响', () => {
  const { items } = assemble('粉色长发女孩穿白色连衣裙，坐在海边微笑，夕阳下的半身画面。', {
    assignments: [
      { id: 's0', category: 'extra' },
      { id: 's1', category: 'pose' },
      { id: 's2', category: 'extra' },
    ],
    translations: [{ id: 's1', english: 'smiling' }],
    expansions: [
      { id: 's0', parts: [{ category: 'appearance', english: 'long pink hair' }, { category: 'wardrobe', english: 'white dress' }] },
      { id: 's2', parts: [{ category: 'scene', english: 'seaside' }, { category: 'camera', english: 'half body' }] },
    ],
    names: [{ category: 'appearance', name: '粉发少女' }, { category: 'camera', name: '夕阳半身' }],
  });
  assert.deepEqual(items.map(item => item.kind), ['appearance', 'wardrobe', 'pose', 'scene', 'camera']);
  assert.equal(items[0].prompt, 'long pink hair');
  assert.equal(items[0].name, '粉发少女');
  assert.equal(items[1].prompt, 'white dress');
  assert.equal(items[2].prompt, 'smiling');
  assert.equal(items[4].prompt, 'half body');
  assert.equal(items[4].name, '夕阳半身');
  // 自然语言的原文留在候选上，便于对照审阅。
  assert.match(items[0].original, /粉色长发女孩/);

  // 英文 Tag 片段不给 expansions 机会：模型即使返回也只按类别走原文。
  const tagOnly = assembleTextExtraction(chunksOf('red eyes, blue hair'), parseTextExtractionResponse(JSON.stringify({
    assignments: [{ id: 's0', category: 'appearance' }, { id: 's1', category: 'appearance' }],
    expansions: [{ id: 's0', parts: [{ category: 'scene', english: 'beach' }] }],
  }), chunksOf('red eyes, blue hair')));
  assert.deepEqual(tagOnly.items.map(item => item.prompt), ['red eyes, blue hair']);
});

test('缺词、重复分类、非法分类与坏 JSON 一律拒绝，不能只入库一部分', () => {
  const chunks = chunksOf('red eyes, blue hair');
  for (const raw of [
    'oops',
    '{"assignments":[{"id":"s0","category":"appearance"}]}',
    '{"assignments":[{"id":"s0","category":"appearance"},{"id":"s1","category":"appearance"},{"id":"s1","category":"scene"}]}',
    '{"assignments":[{"id":"s0","category":"style"},{"id":"s1","category":"appearance"}]}',
    '{"assignments":[{"id":"s0","category":"appearance"},{"id":"s1","category":"appearance"},{"id":"s9","category":"scene"}]}',
  ]) {
    assert.throws(() => parseTextExtractionResponse(raw, chunks), error => error.status === 502);
  }
  const fenced = '```json\n{"assignments":[{"id":"s0","category":"appearance"},{"id":"s1","category":"appearance"}]}\n```';
  assert.deepEqual(parseTextExtractionResponse(fenced, chunks).categories, ['appearance', 'appearance']);
});

test('图片元数据：全局与角色正向都读到，角色负面单独保存，顶层拼接不重复', () => {
  const raw = JSON.stringify({
    prompt: 'classroom, sunset, red hair, red eyes, blue hair, blue eyes',
    v4_prompt: { caption: {
      base_caption: 'classroom, sunset',
      char_captions: [{ char_caption: 'red hair, red eyes' }, { char_caption: 'blue hair, blue eyes' }],
    } },
    v4_negative_prompt: { caption: {
      base_caption: 'bad quality',
      char_captions: [{ char_caption: 'bad hands' }, { char_caption: '' }],
    } },
  });
  const stored = parseStoredGenerationMetadata(raw);
  assert.equal(stored.globalPrompt, 'classroom, sunset');
  assert.deepEqual(stored.characters.map(entry => [entry.label, entry.prompt, entry.negative]),
    [['人物 A', 'red hair, red eyes', 'bad hands'], ['人物 B', 'blue hair, blue eyes', '']]);
  assert.equal(stored.negative, 'bad quality');

  // 只有角色提示词、全局为空也要能提取，且角色内容不并进全局。
  const characterOnly = parseStoredGenerationMetadata(JSON.stringify({
    prompt: 'classroom, sunset',
    v4_prompt: { caption: { char_captions: [{ char_caption: 'red hair, red eyes' }] } },
  }));
  assert.equal(characterOnly.globalPrompt, '');
  assert.equal(characterOnly.characters[0].prompt, 'red hair, red eyes');

  // 旧式纯文本参数：退回到文本剥离，不丢正向内容。
  const legacy = parseStoredGenerationMetadata('red hair\nNegative prompt: bad hands\nSteps: 28');
  assert.equal(legacy.globalPrompt, 'red hair');
  assert.equal(legacy.negative, 'bad hands');
  assert.deepEqual(legacy.characters, []);
  assert.deepEqual(parseStoredGenerationMetadata(''), { globalPrompt: '', characters: [], negative: '' });
});

test('角色分栏参与分类时保留归属，角色负面不进入正向片段', () => {
  const prepared = prepareExtractionChunks({
    text: 'classroom, sunset\nNegative prompt: bad quality',
    characters: [{ label: '人物 A', prompt: 'red hair, red eyes' }, { label: '人物 B', prompt: 'blue hair, blue eyes' }],
  });
  assert.deepEqual(prepared.chunks.map(chunk => [chunk.text, chunk.subject]), [
    ['classroom', ''], ['sunset', ''], ['red hair', '人物 A'], ['red eyes', '人物 A'],
    ['blue hair', '人物 B'], ['blue eyes', '人物 B'],
  ]);
  assert.deepEqual(prepared.characters, ['人物 A', '人物 B']);
  assert.equal(prepared.excluded.negative, 'bad quality');
  const result = assembleTextExtraction(prepared.chunks, parseTextExtractionResponse(JSON.stringify({
    assignments: prepared.chunks.map(chunk => ({ id: chunk.id, category: chunk.subject ? 'appearance' : 'scene' })),
  }), prepared.chunks));
  // 不同角色的同类内容各自成条，名称带角色标记，不混成一条。
  const appearance = result.items.filter(item => item.kind === 'appearance');
  assert.deepEqual(appearance.map(item => item.prompt), ['red hair, red eyes', 'blue hair, blue eyes']);
  assert.deepEqual(appearance.map(item => item.name), ['人物 A · 人物形象', '人物 B · 人物形象']);
});

test('长正文不被截断：超过 1200 字的视觉提示词完整返回', () => {
  const long = Array.from({ length: 120 }, (_, index) => `tag_${index}_detail`).join(', ');
  assert.ok(long.length > 1_200 && long.length < MAX_EXTRACTION_PROMPT);
  const result = parseVisionExtractionResponse(JSON.stringify({
    items: [{ category: 'appearance', name: '长描述', prompt: long }],
  }));
  assert.equal(result.items[0].prompt.length, long.length);
  assert.equal(result.items[0].prompt, long);
  // 名称是标题，可以短；正文超过上限时明确报错，不切断 Tag 冒充正常候选。
  assert.ok(result.items[0].name.length <= 60);
  assert.throws(() => parseVisionExtractionResponse(JSON.stringify({
    items: [{ category: 'appearance', prompt: 'a'.repeat(MAX_EXTRACTION_PROMPT + 1) }],
  })), error => error.status === 502 && /过长/.test(error.message));
});

test('看图提取：六类候选按模型输出保留，多人物分开，未归类不静默丢弃', () => {
  const result = parseVisionExtractionResponse(JSON.stringify({
    items: [
      { category: 'appearance', name: '人物 A · 白发少女', prompt: 'long_white_hair, red_eyes' },
      { category: 'appearance', name: '人物 B · 黑发少年', prompt: 'black_hair, yellow_eyes' },
      { category: 'pose', name: '人物 A · 站姿', prompt: 'standing' },
      { category: 'unknown', prompt: 'watermark' },
      { category: 'camera', prompt: '   ' },
    ],
    unclassified: [{ name: '画面文字', prompt: 'text' }],
  }));
  assert.deepEqual(result.items.map(item => item.name), ['人物 A · 白发少女', '人物 B · 黑发少年', '人物 A · 站姿']);
  assert.equal(result.items[1].prompt, 'black_hair, yellow_eyes');
  assert.equal(result.ignored, 1);
  assert.equal(result.unclassified.prompt, 'watermark, text');
});

test('看图提取没有可用内容时报错，不返回空结果冒充成功', () => {
  assert.throws(() => parseVisionExtractionResponse('{"items":[]}'), error => error.status === 502);
  assert.throws(() => parseVisionExtractionResponse('not json'), error => error.status === 502);
  const onlyExtra = parseVisionExtractionResponse('{"unclassified":[{"prompt":"signature"}]}');
  assert.equal(onlyExtra.items.length, 0);
  assert.equal(onlyExtra.unclassified.prompt, 'signature');
});

test('中文检测与名称兜底', () => {
  assert.equal(hasChineseText('白发少女'), true);
  assert.equal(hasChineseText('long hair'), false);
  assert.equal(fallbackExtractionName('appearance', 'long hair, red eyes'), '人物形象：long hair、red eyes');
  assert.equal(fallbackExtractionName('extra', ''), '未归类');
});
