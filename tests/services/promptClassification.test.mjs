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
