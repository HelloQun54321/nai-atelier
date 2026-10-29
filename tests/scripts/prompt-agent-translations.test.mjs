import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rmdir } from 'node:fs/promises';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';

const translationHint = result => result.content.flatMap(block => {
  if (block.type !== 'text') return [];
  try { return [JSON.parse(block.text).tagTranslations].filter(Boolean); } catch { return []; }
})[0];

const translationTools = (service, draft, events = [], project = {}) => {
  const tools = service.createTools(draft, {}, event => events.push(event), project);
  return (name, args) => {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, `缺少工具 ${name}`);
    return tool.execute('synthetic-call', args);
  };
};

test('翻译串行保存不丢项、不覆盖已有译文，重启后可复用', async () => {
  const root = createWorkspace('agent-translations-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    await service.saveTagTranslations(new Map([['existing_tag', '原有译文']]), { provider: 'synthetic', model: 'test' });
    await Promise.all([
      service.saveTagTranslations(new Map([['existing tag', '不应覆盖'], ['first tag', '第一项']])),
      service.saveTagTranslations(new Map([['second tag', '第二项']])),
    ]);
    const stored = JSON.parse(await readFile(service.tagTranslationFilePath(), 'utf8'));
    assert.deepEqual(Object.keys(stored.items).sort(), ['existing tag', 'first tag', 'second tag']);
    assert.equal(stored.items['existing tag'].chinese, '原有译文');
    assert.equal(stored.items['existing tag'].provider, 'synthetic');
    const restored = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await restored.init();
    assert.deepEqual(restored.tagTranslations, stored.items);
    assert.equal(restored.lookupTagTranslations(['SECOND_tag'])[0].chinese, '第二项');
  } finally {
    removeWorkspace(root);
  }
});

test('翻译写入失败不污染内存，失败后可继续保存', async () => {
  const root = createWorkspace('agent-translations-failure-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    await service.saveTagTranslations(new Map([['existing', '已有']]));
    const before = service.tagTranslations;
    const file = service.tagTranslationFilePath();
    service.tagTranslationFileOverride = `${root}/blocked`;
    await mkdir(service.tagTranslationFilePath());
    await assert.rejects(service.saveTagTranslations(new Map([['missing', '未保存']])));
    assert.equal(service.tagTranslations, before);
    assert.deepEqual(service.lookupTagTranslations(['missing']), []);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).items, before);
    await rmdir(service.tagTranslationFilePath());
    service.tagTranslationFileOverride = file;
    await service.saveTagTranslations(new Map([['missing', '已保存']]));
    assert.equal(JSON.parse(await readFile(file, 'utf8')).items.missing.chinese, '已保存');
  } finally {
    removeWorkspace(root);
  }
});

test('助手只改全局一处仍补齐原有全局、分类、模块和全部角色的正负 Tag', async () => {
  const root = createWorkspace('agent-translations-draft-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    await service.saveTagTranslations(new Map([['cached tag', '已有译文']]));
    const queries = [];
    service.searchTags = async (tag, limit) => {
      queries.push([tag, limit]);
      if (tag === 'dictionary tag') return [{ tag, chinese: '词库译文' }];
      return [{ tag: `${tag} extra`, chinese: '前缀候选不算翻译' }];
    };
    const draft = {
      basePrompt: 'old global, dictionary tag, cached_tag', subjectPrompt: 'old subject', negativePrompt: 'old negative',
      modules: [{ id: 'm', name: '模块名称不翻译', content: 'module tag', isActive: true, position: 'post' }],
      params: {
        _promptSections: { scene: 'section tag', sectionNegatives: { scene: 'section negative' }, sectionMeta: { scene: { entryName: '不应翻译的来源名称' } } },
        characters: [{ id: 'c', name: '不应翻译的角色名称', prompt: 'character tag, old subject', negativePrompt: 'character negative', sections: { appearance: 'character section' }, sectionNegatives: { appearance: 'character section negative' } }],
      },
    };
    const events = [], call = translationTools(service, draft, events);
    const hint = translationHint(await call('update_prompts', { basePrompt: 'old global, new global, dictionary tag, cached_tag' }));
    const expected = ['old global', 'new global', 'old subject', 'old negative', 'module tag', 'section tag', 'section negative', 'character tag', 'character negative', 'character section', 'character section negative'];
    assert.deepEqual([...hint.missingTags].sort(), expected.sort());
    assert.equal(hint.remaining, expected.length);
    assert.ok(hint.instruction);
    assert.ok(queries.every(([, limit]) => limit === 30));
    assert.equal(events.some(event => event.type === 'tag_translations'), false);
    const saved = translationHint(await call('save_tag_translations', { items: hint.missingTags.map(tag => ({ tag, chinese: `译文：${tag}` })) }));
    assert.equal(saved.remaining, 0);
    assert.deepEqual(saved.missingTags, []);
    const emitted = events.filter(event => event.type === 'tag_translations').flatMap(event => event.items);
    assert.deepEqual(emitted.map(item => item.tag).sort(), expected);
    const restored = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await restored.init();
    for (const tag of expected) assert.equal(restored.lookupTagTranslations([tag])[0].chinese, `译文：${tag}`);
  } finally {
    removeWorkspace(root);
  }
});

test('助手补译按20项分页，拒绝写入本轮提示词以外的词', async () => {
  const root = createWorkspace('agent-translations-pages-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    service.searchTags = async () => [];
    const tags = Array.from({ length: 41 }, (_, index) => `synthetic tag ${index}`);
    const call = translationTools(service, { basePrompt: '', modules: [], params: {} });
    let hint = translationHint(await call('update_prompts', { basePrompt: tags.join(', ') }));
    assert.equal(hint.remaining, 41);
    assert.equal(hint.missingTags.length, 20);
    try { await call('save_tag_translations', { items: [{ tag: 'unrelated tag', chinese: '不可保存' }] }); } catch { /* 明确拒绝或忽略均不能落盘。 */ }
    assert.deepEqual(service.lookupTagTranslations(['unrelated tag']), []);
    const seen = [];
    for (const remaining of [21, 1, 0]) {
      seen.push(...hint.missingTags);
      hint = translationHint(await call('save_tag_translations', { items: hint.missingTags.map(tag => ({ tag, chinese: `译文：${tag}` })) }));
      assert.equal(hint.remaining, remaining);
      assert.equal(hint.missingTags.length, Math.min(20, remaining));
    }
    assert.deepEqual(seen.sort(), tags.sort());
    assert.equal(Object.keys(service.tagTranslations).length, 41);
  } finally {
    removeWorkspace(root);
  }
});

for (const name of ['set_characters', 'set_prompt_modules']) {
  test(`${name} 修改也补齐未改动的全局负面词`, async () => {
    const root = createWorkspace('agent-translations-entry-');
    try {
      const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
      await service.init();
      service.searchTags = async () => [];
      const call = translationTools(service, { basePrompt: 'existing global', negativePrompt: 'existing negative', modules: [], params: {} });
      const args = name === 'set_characters'
        ? { characters: [{ id: 'c', prompt: 'new character', negativePrompt: 'new negative' }] }
        : { modules: [{ name: '模块', content: 'new module', isActive: true, position: 'post' }] };
      const hint = translationHint(await call(name, args));
      assert.deepEqual([...hint.missingTags].sort(), ['existing global', 'existing negative', ...(name === 'set_characters' ? ['new character', 'new negative'] : ['new module'])].sort());
    } finally {
      removeWorkspace(root);
    }
  });
}

test('只读禁止保存译文，无提示词变化不触发补译', async () => {
  const root = createWorkspace('agent-translations-permissions-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    let searches = 0;
    service.searchTags = async () => { searches++; return []; };
    const call = translationTools(service, { basePrompt: 'untouched tag', subjectPrompt: '', negativePrompt: '', modules: [], params: {} });
    assert.equal(translationHint(await call('update_prompts', {})), undefined);
    assert.equal(translationHint(await call('update_prompts', { basePrompt: 'untouched tag' })), undefined);
    assert.equal(translationHint(await call('set_generation_params', { seed: 123 })), undefined);
    assert.equal(searches, 0);
    const hint = translationHint(await call('update_prompts', { basePrompt: 'changed tag' }));
    service.config.permissionMode = 'read_only';
    await assert.rejects(call('save_tag_translations', { items: hint.missingTags.map(tag => ({ tag, chinese: '译文' })) }), /只读/);
    assert.deepEqual(service.lookupTagTranslations(hint.missingTags), []);
  } finally {
    removeWorkspace(root);
  }
});

for (const library of [false, true]) {
  test(`${library ? '提示词库' : '风格串'}创建及局部更新补齐完整正文，仅改名不补译`, async () => {
    const root = createWorkspace('agent-translations-assets-');
    try {
      const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
      await service.init();
      service.searchTags = async () => [];
      let current;
      const project = { requestJson: async (path, options) => {
        assert.match(path, /^\/api\/chains(?:\/[^/]+)?$/);
        if (options?.method === 'POST') { current = { ...options.body, id: 'synthetic-asset' }; return { id: current.id }; }
        if (options?.method === 'PUT') { current = { ...current, ...options.body }; return { id: current.id }; }
        return { item: structuredClone(current) };
      } };
      const call = translationTools(service, { params: {} }, [], project);
      const created = await call(library ? 'create_prompt_library_item' : 'create_chain', library
        ? { name: '素材', prompt: 'old positive', negativePrompt: 'old negative', purposes: [] }
        : { type: 'style', name: '素材', basePrompt: 'old positive', subjectPrompt: 'old subject', negativePrompt: 'old negative' });
      assert.deepEqual(translationHint(created).missingTags.sort(), ['old positive', 'old negative', ...(!library ? ['old subject'] : [])].sort());
      const updated = await call(library ? 'update_prompt_library_item' : 'update_chain', { id: current.id, negativePrompt: 'new negative' });
      assert.deepEqual(translationHint(updated).missingTags.sort(), ['old positive', 'new negative', ...(!library ? ['old subject'] : [])].sort());
      assert.equal(translationHint(await call(library ? 'update_prompt_library_item' : 'update_chain', { id: current.id, name: '改名' })), undefined);
    } finally {
      removeWorkspace(root);
    }
  });
}

test('词库不可用仍能补译长Tag，后续草稿修改清除已删除的待补词', async () => {
  const root = createWorkspace('agent-translations-long-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    service.searchTags = async () => { throw new Error('synthetic dictionary unavailable'); };
    const call = translationTools(service, { basePrompt: '', modules: [], params: {} });
    const raw = `LONG_${'phrase_'.repeat(24)}END`;
    const normalized = raw.toLowerCase().replaceAll('_', ' ');
    let hint = translationHint(await call('update_prompts', { basePrompt: `${raw}, removed tag` }));
    assert.ok(hint.missingTags.includes(normalized));
    hint = translationHint(await call('update_prompts', { basePrompt: `${raw}, current tag` }));
    assert.deepEqual(hint.missingTags.sort(), [normalized, 'current tag'].sort());
    await assert.rejects(call('save_tag_translations', { items: [{ tag: 'removed tag', chinese: '不应保存' }] }), /待补齐|有效/);
    const saved = translationHint(await call('save_tag_translations', { items: [{ tag: raw, chinese: '长词译文' }, { tag: 'current tag', chinese: '当前词' }] }));
    assert.equal(saved.remaining, 0);
    const restored = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await restored.init();
    assert.equal(restored.lookupTagTranslations([raw])[0].tag, normalized);
    assert.equal(restored.lookupTagTranslations([raw])[0].chinese, '长词译文');
    assert.deepEqual(restored.lookupTagTranslations(['removed tag']), []);
  } finally {
    removeWorkspace(root);
  }
});

test('页面提交同步草稿后补齐完整提示词，纯浏览和未提交编辑不触发', async () => {
  const root = createWorkspace('agent-translations-page-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();
    let queries = 0;
    service.searchTags = async () => { queries++; return []; };
    const draft = { basePrompt: 'user original', negativePrompt: 'global negative', modules: [], target: { chainId: 'same', mode: 'text-to-image', fingerprint: 'before' }, params: { characters: [{ id: 'c', prompt: 'character original', negativePrompt: 'old negative' }] } };
    const call = translationTools(service, draft, [], { requestUI: async operation => {
      // 与协调器约定一致：页面提交先同步完整草稿，再交付页面回执。
      if (operation.action === 'press' && operation.key === 'Enter') {
        draft.basePrompt = 'user original, added tag';
        draft.params.characters[0].negativePrompt = 'old negative, added negative';
        draft.target.fingerprint = 'after-text-edit';
      }
      if (operation.action === 'click' && operation.controlId === 'other-work') { draft.target.chainId = 'other'; draft.basePrompt = 'other work tag'; }
      if (operation.action === 'click' && operation.controlId === 'other-mode') { draft.target.mode = 'inpaint'; draft.basePrompt = 'other mode tag'; }
      return { snapshotId: 'synthetic-page', view: 'playground', title: '实验室', capturedAt: 1, commands: [], controls: [], totalControls: 0, text: '', viewport: { width: 1200, height: 800 }, scroll: { top: 0, left: 0, height: 800, clientHeight: 800 } };
    } });
    for (const args of [{ action: 'double_click', controlId: 'tag' }, { action: 'fill', controlId: 'tag', value: 'added tag' }, { action: 'scroll', direction: 'down' }]) {
      assert.equal(translationHint(await call('operate_current_page', { snapshotId: 'synthetic-page', ...args })), undefined);
    }
    assert.equal(queries, 0);
    const receipt = await call('operate_current_page', { action: 'press', snapshotId: 'synthetic-page', controlId: 'tag', key: 'Enter' });
    const hint = translationHint(receipt);
    assert.deepEqual(hint.missingTags.sort(), ['user original', 'added tag', 'global negative', 'character original', 'old negative', 'added negative'].sort());
    assert.equal(receipt.content.some(block => block.text?.includes('"staged":true')), false);
    assert.equal(JSON.parse(receipt.content[0].text).snapshotId, 'synthetic-page');
    const saved = translationHint(await call('save_tag_translations', { items: hint.missingTags.map(tag => ({ tag, chinese: `译文：${tag}` })) }));
    assert.equal(saved.remaining, 0);
    assert.equal(service.lookupTagTranslations(['added negative'])[0].chinese, '译文：added negative');
    const queryCount = queries;
    for (const controlId of ['other-work', 'other-mode']) assert.equal(translationHint(await call('operate_current_page', { action: 'click', snapshotId: 'synthetic-page', controlId })), undefined);
    assert.equal(queries, queryCount, '切换作品或模式只同步现场，不把另一份正文当作本次编辑');
  } finally { removeWorkspace(root); }
});
