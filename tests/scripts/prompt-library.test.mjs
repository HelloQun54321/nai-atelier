import test from 'node:test';
import assert from 'node:assert/strict';
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
