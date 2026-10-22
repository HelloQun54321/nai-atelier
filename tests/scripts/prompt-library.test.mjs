import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';
import * as library from '../../scripts/prompt-agent.mjs';

test('四库白名单与最终提示词预览支持场景', () => {
  assert.equal(library.isLibraryKind('scene'), true);
  assert.equal(library.isLibraryKind('__proto__'), false);
  assert.equal(library.isLibraryKind('unknown'), false);
  assert.match(library.buildLibrarySystemPrompt('scene', {spec: '自定义规范', extra: '附加要求'}), /场景|画面补充/);
});

test('服饰库过滤越界词并同步中英对照，保留独立的 hairband', () => {
  const item = {prompt: 'long_hair, hairband, white_dress, boots', bilingual: 'long_hair（长发）, hairband（发带）, white_dress（白裙）, boots（靴子）'};
  const result = library.filterLibraryItems([item], 'wardrobe');
  assert.equal(result.items[0].prompt, 'hairband, white_dress, boots');
  assert.equal(result.items[0].bilingual, 'hairband（发带）, white_dress（白裙）, boots（靴子）');
  assert.deepEqual(result.items[0].filtered, ['long_hair']);
  assert.equal(result.filteredCount, 1);
  assert.equal(item.prompt, 'long_hair, hairband, white_dress, boots');
});

test('过滤后不足三个词保留原文并警告，不计入实际删除数量', () => {
  const item = {prompt: 'long_hair, white_dress, boots', bilingual: ''};
  const result = library.filterLibraryItems([item], 'wardrobe');
  assert.equal(result.items[0].prompt, item.prompt);
  assert.equal(result.items[0].filteredWarning, true);
  assert.equal(result.filteredCount, 0);
});

test('场景库允许情境化动作，按词边界过滤外貌及服饰', () => {
  const result = library.filterLibraryItems([{prompt: 'sitting_at_cafe_table, rainy_street, neon_lights, blue_eyes, school_uniform'}], 'scene');
  assert.equal(result.items[0].prompt, 'sitting_at_cafe_table, rainy_street, neon_lights');
  assert.equal(result.filteredCount, 2);
});

test('库生成设置复用原子配置队列，与权限并发保存不互相覆盖，写入失败不发布', async t => {
  const root = createWorkspace('prompt-library-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  await Promise.all([service.saveLibraryPrompts({ spec: 'synthetic format', extra: 'synthetic extra' }), service.setPermissionMode('read_only')]);
  const stored = JSON.parse(await readFile(service.configFilePath(), 'utf8'));
  assert.deepEqual(stored.libraryPrompts, service.getLibraryPrompts()); assert.equal(stored.permissionMode, 'read_only');
  service.configFileOverride = root;
  await assert.rejects(service.saveLibraryPrompts({ spec: 'must not publish' }));
  assert.equal(service.getLibraryPrompts().spec, 'synthetic format');
  await assert.rejects(service.generateLibraryPrompt({ kind: '__proto__', brief: 'synthetic' }), /分类无效/);
});

test('Android 共用的真实路由无需额外全局函数，设置读取、保存和未保存预览可用', async t => {
  const root = createWorkspace('prompt-library-route-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  const source = await readFile(join(projectRoot, 'scripts/media-gateway.mjs'), 'utf8');
  const tree = ts.createSourceFile('gateway.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let branch;
  const visit = node => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "url.pathname.startsWith('/api/prompt-agent/')") branch = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(branch);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const handler = new AsyncFunction('req', 'res', 'url', 'promptAgent', 'sendJson', 'hasValidLanCookie', 'readRequestBody', `const lanSecret=''; ${branch}`);
  const invoke = (path, method, body) => handler({ method, headers: {} }, {}, { pathname: path }, service,
    (_res, status, value) => ({ status, value }), () => true, async () => Buffer.from(JSON.stringify(body || {})));
  const endpoint = '/api/prompt-agent/library-prompts';
  assert.deepEqual((await invoke(endpoint, 'GET')).value, { spec: '', extra: '' });
  assert.equal((await invoke(endpoint, 'PUT', { spec: 'saved spec', extra: 'saved extra' })).status, 200);
  const preview = await invoke(endpoint + '/preview', 'POST', { kind: 'scene', spec: 'unsaved spec', extra: '' });
  assert.equal(preview.status, 200); assert.match(preview.value.systemPrompt, /unsaved spec/);
  assert.doesNotMatch(preview.value.systemPrompt, /saved extra/);
  assert.equal(service.getLibraryPrompts().spec, 'saved spec');
  assert.equal((await invoke(endpoint + '/preview', 'POST', { kind: 'unknown' })).status, 400);
  const classified = [{ id: 'global', kind: 'global', sections: { style: 'artist:synthetic' } }];
  service.classifyPrompts = async input => { assert.deepEqual(input.documents, [{ id: 'global', kind: 'global', prompt: 'artist:synthetic' }]); return { items: classified }; };
  assert.deepEqual((await invoke('/api/prompt-agent/classify-prompts', 'POST', { documents: [{ id: 'global', kind: 'global', prompt: 'artist:synthetic' }] })).value, { items: classified });
  assert.equal((await invoke('/api/prompt-agent/classify-prompts', 'GET')).status, 405);
  const directEndpoint = '/api/prompt-agent/creative-direct';
  assert.equal(service.publicConfig().creativeDirect, true);
  assert.equal((await invoke(directEndpoint, 'PUT', { enabled: false })).value.creativeDirect, false);
  assert.equal((await invoke(directEndpoint, 'PUT', { enabled: 'true' })).status, 400);
  assert.equal((await invoke(directEndpoint, 'POST', { enabled: true })).status, 405);
  assert.equal(service.publicConfig().creativeDirect, false);
  const rulesEndpoint = '/api/prompt-agent/creative-direct-rules';
  const rulesDefault = service.publicConfig().creativeDirectRules;
  assert.equal(service.publicConfig().creativeDirectRulesCustom, false);
  assert.equal((await invoke(rulesEndpoint, 'PUT', { rules: '自定义规则正文' })).value.creativeDirectRules, '自定义规则正文');
  assert.equal(service.publicConfig().creativeDirectRulesCustom, true);
  assert.equal((await invoke(rulesEndpoint, 'PUT', { rules: '' })).value.creativeDirectRules, rulesDefault);
  assert.equal((await invoke(rulesEndpoint, 'PUT', { rules: 1 })).status, 400);
  assert.equal((await invoke(rulesEndpoint, 'POST', { rules: 'x' })).status, 405);
  const searchEndpoint = '/api/prompt-agent/search-api';
  assert.equal(service.publicConfig().searchEnabled, false);
  assert.equal((await invoke(searchEndpoint, 'PUT', { enabled: true, baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic' })).value.searchEnabled, true);
  assert.equal((await invoke(searchEndpoint, 'PUT', { enabled: 'true' })).status, 400);
  assert.equal((await invoke(searchEndpoint, 'POST', { enabled: true })).status, 405);
});

test('六类库分类都可生成系统提示（表情状态 / 镜头画面不再被拒）', async t => {
  const root = createWorkspace('prompt-library-kinds-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  for (const kind of ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera']) {
    const preview = service.previewLibrarySystemPrompt({ kind });
    assert.equal(preview.kind, kind);
    assert.ok(preview.systemPrompt.length > 200, kind + ' 的系统提示过短');
  }
  /* previewLibrarySystemPrompt 是同步方法：用 throws 断言，而不是 rejects */
  assert.throws(() => service.previewLibrarySystemPrompt({ kind: 'not-a-kind' }), /分类无效/);
});

test('自动分类空文本不请求模型，未配置助手时明确失败且不写入会话', async t => {
  const root = createWorkspace('prompt-classification-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  assert.deepEqual(await service.classifyPrompts({ documents: [] }), { items: [] });
  await assert.rejects(service.classifyPrompts({ documents: [{ id: 'global', kind: 'global', prompt: 'artist:synthetic' }] }), /配置创作助手/);
});

test('详细补全三档与「保持留空」进入系统提示，未指定时默认详细', async () => {
  const strict = library.buildLibraryDetailInstruction('strict');
  const moderate = library.buildLibraryDetailInstruction('moderate');
  const detailed = library.buildLibraryDetailInstruction('detailed');
  assert.match(strict, /严格/);
  assert.match(moderate, /适度/);
  assert.match(detailed, /详细/);
  /* 非法/缺省值回落到详细 */
  assert.equal(library.buildLibraryDetailInstruction(undefined), detailed);
  assert.equal(library.buildLibraryDetailInstruction('whatever'), detailed);
  /* 默认是「未提到也尽量补全」（用户确认的口径）；明确要求留空时才排除 */
  assert.match(detailed, /按常见搭配补全/);
  assert.doesNotMatch(detailed, /保持留空/);
  assert.match(library.buildLibraryDetailInstruction('detailed', true), /保持留空/);
  assert.match(detailed, /单色依赖/);
  assert.doesNotMatch(library.buildLibraryDetailInstruction('detailed', false, false), /单色依赖/);

  /* 三档同时进入预览与实际请求共用的系统提示 */
  for (const detail of ['strict', 'moderate', 'detailed']) {
    const prompt = library.buildLibrarySystemPrompt('expression', { detail });
    assert.match(prompt, /【详细补全】/);
    assert.ok(prompt.includes(library.buildLibraryDetailInstruction(detail)), detail + ' 的指令没有进入系统提示');
  }
  assert.match(library.buildLibrarySystemPrompt('camera', { detail: 'strict' }), /严格/);
});

/* ---------- 一段话 → 六库提示词（bundle） ---------- */

test('六库合一的系统提示列出六个 kind 与六个中文 label，并带上自定义规范与附加指令', () => {
  const prompt = library.buildLibraryBundleSystemPrompt({ spec: '自定义输出规范', extra: '附加指令正文', detail: 'strict' });
  for (const kind of library.PROMPT_LIBRARY_BUNDLE_ORDER) {
    /* 每个 kind 都要以「英文键（中文 label）」的形式出现在职责清单里 */
    assert.match(prompt, new RegExp(`${kind}（[^）]+）`), kind + ' 没有出现在六库职责清单');
  }
  for (const label of ['人物形象', '服饰穿搭', '人物姿势', '表情状态', '场景及补充', '镜头画面']) {
    assert.match(prompt, new RegExp(label), '缺中文 label：' + label);
  }
  /* 输出规范 / 附加指令 / 详细补全三段与单库同构 */
  assert.match(prompt, /自定义输出规范/);
  assert.match(prompt, /附加指令正文/);
  assert.match(prompt, /【详细补全】/);
  assert.match(prompt, /严格/);
  /* JSON 契约：六键对象、每条五个字段都要写进提示 */
  assert.match(prompt, /\{"items":\{"appearance":\{"name":"","prompt":"","bilingual":"","tags":\[\],"note":""\}/);
  for (const kind of library.PROMPT_LIBRARY_BUNDLE_ORDER) assert.match(prompt, new RegExp(`"${kind}":\\{"name"`), kind + ' 的 JSON 契约缺失');
  /* 一致性约束与写法要求 */
  assert.match(prompt, /下划线/);
  assert.match(prompt, /不要留空/);
  assert.match(prompt, /不能互相矛盾/);
  /* 未填内容时不应凭空多出空段 */
  const plain = library.buildLibraryBundleSystemPrompt();
  assert.doesNotMatch(plain, /【输出规范】/);
  assert.doesNotMatch(plain, /【附加指令】/);
  assert.match(plain, /【详细补全】/);
  assert.ok(library.buildLibraryBundleSystemPrompt({ keepEmpty: true, singleColor: false }).includes(library.buildLibraryDetailInstruction('detailed', true, false)));
});

test('六库结果解析支持 items 对象、数组带 kind、中文 label 键与代码围栏', () => {
  const item = { name: '白发少女', prompt: 'silver_hair, long_hair', bilingual: 'silver_hair（银发）, long_hair（长发）', tags: ['发色'], note: '银白长发' };
  /* 形状一：{items:{kind:...}} */
  assert.deepEqual(library.parseLibraryBundleResponse(JSON.stringify({ items: { appearance: item } })), { appearance: item });
  /* 形状二：{kind:...} 直接挂在顶层 */
  assert.deepEqual(library.parseLibraryBundleResponse(JSON.stringify({ wardrobe: item })), { wardrobe: item });
  /* 形状三：带 kind 字段的数组 */
  assert.deepEqual(library.parseLibraryBundleResponse(JSON.stringify([{ kind: 'pose', ...item }])), { pose: item });
  /* 中文 label 当键（模型偶尔按界面标题回） */
  assert.deepEqual(library.parseLibraryBundleResponse(JSON.stringify({ items: { 人物形象: item } })), { appearance: item });
  /* 代码围栏 + 前后噪声 */
  const fenced = '```json\n' + JSON.stringify({ items: { camera: item } }) + '\n```';
  assert.deepEqual(library.parseLibraryBundleResponse(fenced), { camera: item });
  const noisy = '好的，结果如下：' + JSON.stringify({ items: { scene: item } }) + ' 希望有用';
  assert.deepEqual(library.parseLibraryBundleResponse(noisy), { scene: item });
  /* 结果顺序固定为六库顺序，与模型返回顺序无关 */
  const many = library.parseLibraryBundleResponse(JSON.stringify({ items: { camera: item, appearance: item } }));
  assert.deepEqual(Object.keys(many), ['appearance', 'camera']);
});

test('六库结果缺项只返回存在的 kind，坏 JSON 抛 502 而不是静默返回空', () => {
  const only = library.parseLibraryBundleResponse(JSON.stringify({ items: { pose: { prompt: 'standing, arms_behind_back' } } }));
  assert.deepEqual(Object.keys(only), ['pose']);
  assert.equal(only.wardrobe, undefined);
  /* 空对象、空数组、非 JSON 文本都不应该凭空造条目 */
  assert.deepEqual(library.parseLibraryBundleResponse('{}'), {});
  assert.deepEqual(library.parseLibraryBundleResponse('[]'), {});
  /* 不认识的键与不像条目的值一律忽略（防止把 {"error":"..."} 当成一条提示词） */
  assert.deepEqual(library.parseLibraryBundleResponse(JSON.stringify({ items: { unknown: { prompt: 'x' }, scene: { error: '失败' } } })), {});
  assert.throws(() => library.parseLibraryBundleResponse('没有任何 JSON 的正文'), error => error.status === 502 && /模型没有返回有效的提示词 JSON/.test(error.message));
  assert.throws(() => library.parseLibraryBundleResponse('{ 坏的 JSON '), error => error.status === 502);
});

test('bundle 里的条目照样过越界词校验：服饰库剔除 long_hair 且中英对照同步', () => {
  const bundle = library.parseLibraryBundleResponse(JSON.stringify({
    items: {
      wardrobe: {
        name: '白裙少女',
        prompt: 'long_hair, white_dress, pleated_skirt, boots',
        bilingual: 'long_hair（长发）, white_dress（白裙）, pleated_skirt（百褶裙）, boots（靴子）',
        tags: ['连衣裙', '白色'],
        note: '白色连衣裙配长靴',
      },
      appearance: { name: '银发少女', prompt: 'silver_hair, long_hair, red_eyes', bilingual: 'silver_hair（银发）, long_hair（长发）, red_eyes（红瞳）', tags: ['发色'], note: '银发红瞳' },
    },
  }));
  /* 服饰库剔除 long_hair（外貌越界），其余三条保留 */
  const wardrobe = library.filterLibraryItems([bundle.wardrobe], 'wardrobe');
  assert.equal(wardrobe.items[0].prompt, 'white_dress, pleated_skirt, boots');
  assert.equal(wardrobe.items[0].bilingual, 'white_dress（白裙）, pleated_skirt（百褶裙）, boots（靴子）');
  assert.deepEqual(wardrobe.items[0].filtered, ['long_hair']);
  assert.equal(wardrobe.filteredCount, 1);
  /* 形象库不该被动到：同一个 long_hair 在那边是合法内容 */
  const appearance = library.filterLibraryItems([bundle.appearance], 'appearance');
  assert.equal(appearance.items[0].prompt, 'silver_hair, long_hair, red_eyes');
  assert.equal(appearance.filteredCount, 0);
  /* 原始解析结果不被就地改写 */
  assert.equal(bundle.wardrobe.prompt, 'long_hair, white_dress, pleated_skirt, boots');
});

test('六库预览（dryRun）不查凭据、不调模型，只回系统提示与待填清单', async t => {
  const root = createWorkspace('prompt-library-bundle-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  /* 没有任何凭据也必须成功：这正是 dryRun 的意义 */
  assert.equal(service.publicConfig().configured, false);
  const preview = await service.generateLibraryBundle({ brief: '雨夜霓虹街道上的银发少女', dryRun: true, detail: 'moderate' });
  assert.deepEqual(preview.items, []);
  assert.equal(preview.dryRun, true);
  assert.deepEqual(preview.missing, library.PROMPT_LIBRARY_BUNDLE_ORDER.slice());
  assert.equal(preview.missing.length, 6);
  assert.equal(preview.provider, service.publicConfig().provider);
  assert.equal(preview.model, service.publicConfig().model);
  assert.match(preview.systemPrompt, /雨夜|六库|场景及补充/);
  assert.match(preview.systemPrompt, /【详细补全】/);
  /* 入参为空或全空白都按 400 处理，文案面向用户 */
  await assert.rejects(service.generateLibraryBundle({ brief: '   ', dryRun: true }), error => error.status === 400 && /请先用一段话描述你想要的画面/.test(error.message));
  await assert.rejects(service.generateLibraryBundle({} ), error => error.status === 400);
  /* 非 dryRun 且没配凭据时仍然是凭据错误（400），不会静默走预览分支 */
  await assert.rejects(service.generateLibraryBundle({ brief: '雨夜街道' }), error => error.status === 400 && /请先在设置中配置创作助手的模型服务/.test(error.message));
});

test('六库路由接在 prompt-agent 分支里，dryRun 可预览且只接受 POST', async t => {
  const root = createWorkspace('prompt-library-bundle-route-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  const source = await readFile(join(projectRoot, 'scripts/media-gateway.mjs'), 'utf8');
  const tree = ts.createSourceFile('gateway.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let branch;
  const visit = node => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "url.pathname.startsWith('/api/prompt-agent/')") branch = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(branch);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const handler = new AsyncFunction('req', 'res', 'url', 'promptAgent', 'sendJson', 'hasValidLanCookie', 'readRequestBody', `const lanSecret=''; ${branch}`);
  const invoke = (path, method, body) => handler({ method, headers: {} }, {}, { pathname: path }, service,
    (_res, status, value) => ({ status, value }), () => true, async () => Buffer.from(JSON.stringify(body || {})));
  const endpoint = '/api/prompt-agent/library-bundle';
  const preview = await invoke(endpoint, 'POST', { brief: '雨夜霓虹街道上的银发少女', dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.value.dryRun, true);
  assert.deepEqual(preview.value.missing, library.PROMPT_LIBRARY_BUNDLE_ORDER.slice());
  assert.match(preview.value.systemPrompt, /镜头画面/);
  /* 空描述与错误方法都走既有错误约定 */
  assert.equal((await invoke(endpoint, 'POST', { brief: '' })).status, 400);
  assert.equal((await invoke(endpoint, 'GET')).status, 405);
});

test('界面上的六类字段都能到达模型（后端 facets 清单与前端一致，不按数量验收）', async t => {
  /* 逐库列出「界面有、后端也必须读」的代表性新字段，全部走 collectLibraryFacets */
  const cases = [
    ['appearance', 'hair_length', '发型长度', '超长发'],
    ['appearance', 'bangs', '刘海', '空气刘海'],
    ['wardrobe', 'top_color', '上装颜色', '白色'],
    ['wardrobe', 'wear_state', '穿着状态', '半脱'],
    ['pose', 'hold_hand', '持握手', '左手'],
    ['pose', 'gaze', '视线目标', '看镜头'],
    ['scene', 'light_dir', '光源方向', '逆光'],
    ['scene', 'env_event', '环境事件', '下雨'],
    ['expression', 'eye_glow', '发光瞳', '强烈'],
    ['camera', 'motion', '运动趋势', '运动模糊'],
    /* 本轮按本机字段名补齐的项 */
    ['appearance', 'hair_detail', '发型细节', '层次'],
    ['appearance', 'eye_left', '左眼瞳色', '红色'],
    ['appearance', 'breasts_shape', '胸部·形态', '圆润'],
    ['appearance', 'hair_detail', '发型细节', '层次'],
    ['wardrobe', 'outfit_scope', '生成范围', '完整穿搭'],
    ['scene', 'light_intensity', '光源强度', '柔和'],
    ['scene', 'light_softness', '光源软硬', '软光'],
    ['pose', 'facing', '身体朝向', '侧面'],
  ];
  for (const [kind, key, label, value] of cases) {
    const facets = library.collectLibraryFacets(kind, { [key]: value });
    assert.deepEqual(facets, [[label, value]], kind + '.' + key + ' 没有到达模型');
  }
  /* 全量核对：六库字段数与本机对齐（23/29/14/15/10/11 = 102；职责划分也按本机调整） */
  const counts = { appearance: 23, wardrobe: 29, pose: 14, scene: 15, expression: 10, camera: 11 };
  for (const [kind, expected] of Object.entries(counts)) {
    const spec = library.PROMPT_LIBRARY_KIND_FACETS(kind);
    assert.equal(spec.length, expected, kind + ' 的后端字段数不对');
  }
});
