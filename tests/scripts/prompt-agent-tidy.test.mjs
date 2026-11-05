import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';

const isolated = async (t, fn) => {
  const root = createWorkspace('agent-tidy-');
  t.after(() => removeWorkspace(root));
  const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  service.appendAuditLog = async () => {};
  await fn(service);
};
const reply = content => new Response('data: ' + JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: 'a', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

test('整理只调用一次当前模型：挑选模式交编号片段、改写模式交原文，未配置模型直接说明', t => isolated(t, async service => {
  await assert.rejects(service.tidyPrompt({ instruction: '只留画师', chunks: ['a'] }), /请先在设置中配置创作助手的模型服务/);
  await service.saveCustomProvider({ id: 'custom-tidy-test', name: 'synthetic', baseUrl: 'http://127.0.0.1:1234/v1', models: [{ id: 'a' }], apiKey: 'synthetic', select: true });
  const previousFetch = globalThis.fetch, requests = [];
  const replies = [JSON.stringify({ keep: [0] }), JSON.stringify({ prompt: '1.0::artist:a::' }), JSON.stringify({ keep: [true] })];
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return reply(replies.shift()); };
  const sent = index => {
    const content = requests[index].messages.find(message => message.role === 'user').content;
    return JSON.parse(typeof content === 'string' ? content : content.map(part => part.text || '').join(''));
  };
  try {
    const picked = await service.tidyPrompt({ instruction: '只留画师', chunks: ['artist:a', '1girl'] });
    assert.deepEqual(picked.keep, [true, false]);
    assert.deepEqual(sent(0), { instruction: '只留画师', chunks: [{ id: 0, text: 'artist:a' }, { id: 1, text: '1girl' }] });
    assert.match(requests[0].messages.find(message => message.role === 'system').content, /不得增加、合并、改写或重排/);
    const rewritten = await service.tidyPrompt({ instruction: '统一权重', rewrite: true, prompt: 'artist:a' });
    assert.equal(rewritten.prompt, '1.0::artist:a::');
    assert.deepEqual(sent(1), { instruction: '统一权重', prompt: 'artist:a' });
    await assert.rejects(service.tidyPrompt({ instruction: '只留画师', chunks: ['a', 'b'] }), /整理结果不完整/);
    await assert.rejects(service.tidyPrompt({ instruction: ' ', chunks: ['a'] }), /整理要求/);
    assert.equal(requests.length, 3);
  } finally { globalThis.fetch = previousFetch; }
}));
