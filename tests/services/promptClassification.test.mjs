import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePromptClassification, parsePromptClassification } from '../../services/promptClassification.mjs';

test('分类保留重复词、自然语言及完整权重组，只重排类别', () => {
  const documents = preparePromptClassification({ documents: [{ id: 'global', kind: 'global', prompt: 'artist:test, 1.3::blue hair, blue eyes::, (red dress, hat), A girl looks at the sky., blue eyes, blue eyes' }] });
  assert.deepEqual(documents[0].chunks, ['artist:test', '1.3::blue hair, blue eyes::', '(red dress, hat)', 'A girl looks at the sky.', 'blue eyes', 'blue eyes']);
  const items = parsePromptClassification(JSON.stringify([{ id: 'global', categories: ['style', 'appearance', 'wardrobe', 'extra', 'appearance', 'appearance'] }]), documents);
  assert.equal(items[0].sections.appearance, '1.3::blue hair, blue eyes::, blue eyes, blue eyes');
  assert.equal(items[0].sections.wardrobe, '(red dress, hat)');
  assert.equal(items[0].sections.extra, 'A girl looks at the sky.');
});

test('缺词、重复文档、非法分类和坏 JSON 均拒绝，不能部分写入', () => {
  const documents = preparePromptClassification({ documents: [{ id: 'role', kind: 'character', prompt: 'smile, hat' }] });
  for (const raw of ['oops', '[]', '[{"id":"role","categories":["expression"]}]', '[{"id":"role","categories":["style","wardrobe"]}]', '[{"id":"other","categories":["expression","wardrobe"]}]']) {
    assert.throws(() => parsePromptClassification(raw, documents), /分类结果/);
  }
  assert.throws(() => preparePromptClassification({ documents: [{ id: 'a', kind: 'character', prompt: 'x' }, { id: 'a', kind: 'global', prompt: 'y' }] }), /分类文本无效/);
  assert.throws(() => preparePromptClassification({ documents: [{ id: 'a', kind: 'global', prompt: 'x'.repeat(100001) }] }), /过长/);
  assert.deepEqual(preparePromptClassification({ documents: [{ id: 'a', kind: 'global', prompt: ' ' }] }), []);
});

test('当前目录决定分类keys与路径，改名及自定义层级无需固定六类', () => {
  const directories = { revision: 7, nodes: [
    { id: 'person', parentId: null, name: '我的人物', target: 'character' },
    { id: 'custom', parentId: 'person', name: '特殊装备' },
    { id: 'light', parentId: null, name: '自定环境光', target: 'global' },
  ] };
  const documents = preparePromptClassification({ directories, documents: [
    { id: 'global', kind: 'global', prompt: 'artist:test, {{golden light}}, shiny armor, shiny armor' },
    { id: 'role', kind: 'character', prompt: '1.2::silver armor, blue eyes::, smile' },
  ] });
  assert.deepEqual(documents[0].categories, ['style', 'directory:person', 'directory:custom', 'directory:light', 'extra']);
  assert.deepEqual(documents[1].categories, ['directory:person', 'directory:custom', 'extra']);
  assert.deepEqual(documents[1].directoryCategories[1], { key: 'directory:custom', directoryId: 'custom', directoryName: '特殊装备', directoryPath: ['我的人物', '特殊装备'], scope: 'character' });
  const items = parsePromptClassification(JSON.stringify([
    { id: 'global', categories: ['style', 'directory:light', 'directory:custom', 'directory:custom'] },
    { id: 'role', categories: ['directory:custom', 'extra'] },
  ]), documents);
  assert.equal(items[0].sections['directory:custom'], 'shiny armor, shiny armor');
  assert.equal(items[1].sections['directory:custom'], '1.2::silver armor, blue eyes::');
  assert.deepEqual(items[1].sectionMeta['directory:custom'], { source: 'ai', directoryId: 'custom', directoryName: '特殊装备', directoryPath: ['我的人物', '特殊装备'] });
  assert.throws(() => parsePromptClassification(JSON.stringify([
    { id: 'global', categories: ['style', 'directory:light', 'directory:custom', 'directory:custom'] },
    { id: 'role', categories: ['directory:light', 'extra'] },
  ]), documents), /分类结果/);
});

test('空目录保留补充兜底，不复活六类；损坏目录不降级猜分类', () => {
  const documents = preparePromptClassification({ directories: { revision: 1, nodes: [] }, documents: [
    { id: 'global', kind: 'global', prompt: 'artist:test, landscape' },
    { id: 'role', kind: 'character', prompt: 'blue hair' },
  ] });
  assert.deepEqual(documents.map(document => document.categories), [['style', 'extra'], ['extra']]);
  const parsed = parsePromptClassification(JSON.stringify([{ id: 'global', categories: ['style', 'extra'] }, { id: 'role', categories: ['extra'] }]), documents);
  assert.equal(parsed[1].sections.extra, 'blue hair');
  assert.throws(() => preparePromptClassification({ documents: [], directories: { revision: 0 } }), /目录数据无效/);
});
