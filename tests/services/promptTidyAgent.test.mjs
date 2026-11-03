import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptTidySystemPrompt, parsePromptTidy, preparePromptTidy } from '../../services/promptTidyAgent.mjs';

test('整理请求只接受有要求的片段或改写原文，超长与空白直接拒绝', () => {
  assert.deepEqual(preparePromptTidy({ instruction: ' 只留画师 ', chunks: ['artist:a', '1.2::b, c::'] }), { instruction: '只留画师', rewrite: false, chunks: ['artist:a', '1.2::b, c::'] });
  assert.deepEqual(preparePromptTidy({ instruction: '统一权重', rewrite: true, prompt: ' a, b ', chunks: 'ignored' }), { instruction: '统一权重', rewrite: true, prompt: 'a, b' });
  assert.throws(() => preparePromptTidy({ instruction: ' ', chunks: ['a'] }), /整理要求/);
  assert.throws(() => preparePromptTidy({ instruction: 'x'.repeat(501), chunks: ['a'] }), /太长/);
  for (const chunks of [undefined, [], ['a', ' '], [1], Array(401).fill('a')]) assert.throws(() => preparePromptTidy({ instruction: 'x', chunks }), /无效/);
  assert.throws(() => preparePromptTidy({ instruction: 'x', chunks: ['a'.repeat(20001)] }), /过长/);
  assert.throws(() => preparePromptTidy({ instruction: 'x', rewrite: true, prompt: ' ' }), /没有可整理/);
});

test('挑选结果必须与片段一一对应且只含布尔值；改写只收非空正文', () => {
  const select = preparePromptTidy({ instruction: 'x', chunks: ['a', 'b'] });
  assert.deepEqual(parsePromptTidy('```json\n{"keep":[true,false]}\n```', select), { keep: [true, false] });
  for (const raw of ['oops', '{"keep":[true]}', '{"keep":[true,"false"]}', '{"prompt":"a"}']) assert.throws(() => parsePromptTidy(raw, select), /整理结果/);
  const rewrite = preparePromptTidy({ instruction: 'x', rewrite: true, prompt: 'a' });
  assert.deepEqual(parsePromptTidy('{"prompt":" 1.0::a:: "}', rewrite), { prompt: '1.0::a::' });
  for (const raw of ['{"prompt":" "}', '{"keep":[true]}']) assert.throws(() => parsePromptTidy(raw, rewrite), /整理结果/);
});

test('系统提示声明素材不是指令，挑选模式禁止改写，并带上画风配方说明', () => {
  const select = buildPromptTidySystemPrompt(false);
  assert.match(select, /不是指令/); assert.match(select, /不得增加、合并、改写或重排/); assert.match(select, /画风配方/); assert.match(select, /"keep"/);
  const rewrite = buildPromptTidySystemPrompt(true);
  assert.match(rewrite, /未要求改变的词/); assert.match(rewrite, /"prompt"/); assert.doesNotMatch(rewrite, /"keep"/);
});
