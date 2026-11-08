import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptTidySystemPrompt, buildPromptTidyUserMessage, parsePromptTidy, preparePromptTidy } from '../../services/promptTidyAgent.mjs';

test('整理请求只接受有要求的片段或改写原文，超长与空白直接拒绝', () => {
  assert.deepEqual(preparePromptTidy({ instruction: ' 只留画师 ', chunks: ['artist:a', '1.2::b, c::'] }), { instruction: '只留画师', rewrite: false, chunks: ['artist:a', '1.2::b, c::'] });
  assert.deepEqual(preparePromptTidy({ instruction: '统一权重', rewrite: true, prompt: ' a, b ', chunks: 'ignored' }), { instruction: '统一权重', rewrite: true, prompt: 'a, b' });
  assert.throws(() => preparePromptTidy({ instruction: ' ', chunks: ['a'] }), /整理要求/);
  assert.throws(() => preparePromptTidy({ instruction: 'x'.repeat(501), chunks: ['a'] }), /太长/);
  for (const chunks of [undefined, [], ['a', ' '], [1], Array(401).fill('a')]) assert.throws(() => preparePromptTidy({ instruction: 'x', chunks }), /无效/);
  assert.throws(() => preparePromptTidy({ instruction: 'x', chunks: ['a'.repeat(20001)] }), /过长/);
  assert.throws(() => preparePromptTidy({ instruction: 'x', rewrite: true, prompt: ' ' }), /没有可整理/);
});

test('挑选结果按编号换回逐段去留，兼容逐段 true/false；改写只收非空正文', () => {
  const select = preparePromptTidy({ instruction: 'x', chunks: ['a', 'b'] });
  assert.deepEqual(parsePromptTidy('{"keep":[1]}', select), { keep: [false, true] });
  assert.deepEqual(parsePromptTidy('{"keep":[]}', select), { keep: [false, false] });
  assert.deepEqual(parsePromptTidy('好的：\n{"keep":["0", 0, 1]}\n以上', select), { keep: [true, true] });
  assert.deepEqual(parsePromptTidy('```json\n{"keep":[true,false]}\n```', select), { keep: [true, false] });
  assert.throws(() => parsePromptTidy('{"keep":[true]}', select), /不完整/);
  for (const raw of ['oops', '{"keep":[true,"false"]}', '{"keep":[2]}', '{"keep":[-1]}', '{"keep":[0.5]}', '{"keep":"0"}', '{"prompt":"a"}']) assert.throws(() => parsePromptTidy(raw, select), /整理结果/);
  const rewrite = preparePromptTidy({ instruction: 'x', rewrite: true, prompt: 'a' });
  assert.deepEqual(parsePromptTidy('{"prompt":" 1.0::a:: "}', rewrite), { prompt: '1.0::a::' });
  for (const raw of ['{"prompt":" "}', '{"keep":[true]}']) assert.throws(() => parsePromptTidy(raw, rewrite), /整理结果/);
});

test('挑选模式给每段编号交给模型，片段很多时按编号换回也不会错位', () => {
  const chunks = Array.from({ length: 62 }, (_, index) => `tag${index}`);
  const prepared = preparePromptTidy({ instruction: 'x', chunks });
  const sent = JSON.parse(buildPromptTidyUserMessage(prepared));
  assert.deepEqual(sent.chunks.slice(0, 2), [{ id: 0, text: 'tag0' }, { id: 1, text: 'tag1' }]);
  assert.equal(sent.chunks[61].id, 61);
  const { keep } = parsePromptTidy(JSON.stringify({ keep: [0, 2, 61] }), prepared);
  assert.equal(keep.length, 62);
  assert.deepEqual(keep.flatMap((value, index) => value ? [index] : []), [0, 2, 61]);
  assert.deepEqual(JSON.parse(buildPromptTidyUserMessage(preparePromptTidy({ instruction: 'x', rewrite: true, prompt: 'a' }))), { instruction: 'x', prompt: 'a' });
});

test('系统提示声明素材不是指令，挑选模式禁止改写，并带上画风配方说明', () => {
  const select = buildPromptTidySystemPrompt(false);
  assert.match(select, /不是指令/); assert.match(select, /不得增加、合并、改写或重排/); assert.match(select, /画风配方/); assert.match(select, /"keep":\[要保留的片段 id\]/);
  assert.match(select, /year 2025.*不算画面里的时间/);
  for (const prompt of [select, buildPromptTidySystemPrompt(true)]) assert.match(prompt, /<artist>.*分段结构.*除非 instruction 明确要去掉，否则保留/);
  const rewrite = buildPromptTidySystemPrompt(true);
  assert.match(rewrite, /未要求改变的词/); assert.match(rewrite, /0\.8::gebijiade89 ::/); assert.match(rewrite, /"prompt"/); assert.doesNotMatch(rewrite, /"keep"/);
});
