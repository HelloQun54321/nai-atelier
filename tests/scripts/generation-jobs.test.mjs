import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationTasks } from '../../worker/generationTasks.mjs';
import { GenerationJobs, generationJobEventResponse } from '../../worker/generationJobs.mjs';

const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
const descriptor = (approvedCost = 0) => ({ payload: { model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { n_samples: 1, width: 832, height: 1216 } }, history: { prompt: 'synthetic', negativePrompt: '', params: { width: 832, height: 1216 } }, randomSeed: true, stream: false, approvedCost });
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const until = async predicate => {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); }
  assert.fail('后台任务没有进入预期状态');
};
const setup = (overrides = {}) => {
  let now = 0;
  const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now });
  const calls = [];
  const jobs = new GenerationJobs({ tasks, sleep: tick, now: () => now,
    validate: data => { assert.equal(data.payload.parameters.n_samples, 1); },
    readCleanup: job => job.lastQueueTaskId ? 'synthetic-cleanup-warning' : undefined,
    estimate: async () => 0,
    generate: async (job, payload) => { const finish = tasks.enter(job.key, job.token); calls.push({ token: job.token, seed: payload.parameters.seed }); finish(); return { seed: payload.parameters.seed }; },
    save: async (_job, _output, metadata) => ({ ...metadata, imageUrl: '/api/local-history/' + metadata.id + '/image' }),
    ...overrides,
  });
  return { tasks, jobs, calls, advance: value => { now += value; } };
};

for (const saveFails of [false, true]) test(`final 后立即保存且保存失败=${saveFails}仍等记账和清理，不提前交接`, async () => {
  let finish, saves = 0, requests = 0;
  const states = [];
  const f = setup({
    generate: async (_job, _payload, preview, final) => {
      requests++;
      preview({ image: 'data:image/png;base64,AQID' });
      final({ seed: 7 }); final({ seed: 8 });
      await new Promise(resolve => { finish = resolve; });
      return { seed: 7, accountingFailed: true, accountingError: 'synthetic accounting', cleanupError: 'synthetic cleanup' };
    },
    save: async (_job, output, metadata) => {
      saves++; assert.equal(output.seed, 7);
      if (saveFails) throw Object.assign(new Error('synthetic save failure'), { preview: { image: 'data:image/png;base64,AQID' } });
      return { ...metadata, imageUrl: '/synthetic.png' };
    },
  });
  f.jobs.start('key', a, 2, undefined, descriptor(), {});
  const job = f.jobs.get('key', a);
  f.jobs.subscribe(job, snapshot => states.push(snapshot.state));
  await until(() => saves === 1);
  assert.equal(job.state, 'saving'); assert.ok(states.includes('saving'));
  assert.equal(job.historyIds.length, 0); assert.equal(f.tasks.current('key').token, a);
  assert.throws(() => f.tasks.reserve('key', b), { code: 'generation_busy' });
  // 已取消的后续张数不能妨碍当前成图保存及流尾消费。
  f.jobs.cancel('key', a); finish(); await job.running;
  const snapshot = f.jobs.snapshot(job);
  assert.equal(requests, 1); assert.equal(saves, 1);
  assert.equal(snapshot.accountingError, 'synthetic accounting'); assert.equal(snapshot.cleanupError, 'synthetic cleanup');
  assert.equal(snapshot.completedCount, saveFails ? 0 : 1);
  assert.equal(snapshot.state, saveFails ? 'failed' : 'cancelled');
  if (saveFails) assert.equal(snapshot.preview.image, 'data:image/png;base64,AQID');
});

test('final 后假409仍等待保存成功，保留历史回执并只提示收尾异常', async () => {
  let finishSave, requests = 0;
  const f = setup({ generate: async (_job, _payload, _preview, final) => {
    requests++; final({ seed: 9 });
    throw Object.assign(new Error('synthetic tail failure'), { status: 409, code: 'generation_waiting' });
  }, save: async (_job, _output, metadata) => {
    await new Promise(resolve => { finishSave = resolve; });
    return { ...metadata, imageUrl: '/synthetic.png' };
  } });
  f.jobs.start('key', a, 1, undefined, descriptor(), {}); const job = f.jobs.get('key', a);
  await until(() => Boolean(finishSave));
  assert.equal(job.state, 'saving'); assert.ok(job.context); assert.equal(f.tasks.current('key').token, a);
  finishSave(); await job.running;
  const snapshot = f.jobs.snapshot(job);
  assert.equal(snapshot.state, 'succeeded'); assert.equal(snapshot.completedCount, 1); assert.equal(requests, 1);
  assert.equal(snapshot.cleanupError, 'synthetic tail failure'); assert.equal(snapshot.accountingFailed, true);
  assert.equal(snapshot.lastSavedItem.imageUrl, '/synthetic.png');
});

test('保存失败仍等公共清理释放内部在途锁，再发布失败终态及清理告警', async () => {
  let finishCleanup, saves = 0, cleanupRead = false;
  const f = setup({ generate: async (job, _payload, preview, final) => {
    finishCleanup = f.tasks.enter(job.key, job.token);
    preview({ image: 'data:image/png;base64,AQID' }); final({ queueTaskId: 'synthetic-task' });
    return { queueTaskId: 'synthetic-task' };
  }, save: async () => { saves++; throw new Error('synthetic save failure'); },
  readCleanup: () => { cleanupRead = true; return 'synthetic late cleanup'; } });
  f.jobs.start('key', a, 1, undefined, descriptor(), {}); const job = f.jobs.get('key', a);
  await until(() => saves === 1);
  assert.equal(job.state, 'saving'); assert.ok(job.context); assert.equal(cleanupRead, false);
  assert.equal(f.tasks.current('key').inFlight, true);
  finishCleanup(); await job.running;
  assert.equal(job.state, 'failed'); assert.equal(f.jobs.snapshot(job).cleanupError, 'synthetic late cleanup');
  assert.equal(f.tasks.current('key'), undefined);
});

test('成图记账异常与原因随真实保存快照交付，不重复生成或保存', async () => {
  let generated = 0, saved = 0;
  const f = setup({ generate: async () => { generated++; return { accountingFailed: true, accountingError: '本地预算更新失败（HTTP 503）' }; },
    save: async (_job, _output, metadata) => { saved++; return { ...metadata, imageUrl: '/synthetic.png' }; },
  });
  f.jobs.start('key', a, 1, undefined, descriptor(), {}); const job = f.jobs.get('key', a); await job.running;
  assert.equal(generated, 1); assert.equal(saved, 1);
  assert.equal(f.jobs.snapshot(job).accountingError, '本地预算更新失败（HTTP 503）');
  assert.equal(f.jobs.snapshot(job).accountingFailed, true); assert.equal(f.jobs.snapshot(job).completedCount, 1);
});

test('一轮不同配方只占一个执行位，按顺序估价、生成和保存各自元数据', async () => {
  const seen = [], saved = [], estimated = [];
  const f = setup({ estimate: async job => { estimated.push(job.descriptor.history.prompt); return 0; },
    generate: async (job, payload) => { seen.push([job.token, payload.parameters.seed, payload.parameters.prompt]); return { seed: payload.parameters.seed }; },
    save: async (_job, _out, metadata) => { saved.push(metadata); return { ...metadata, imageUrl: '/synthetic.png' }; },
  });
  const entries = ['first', 'second', 'third'].map((prompt, index) => ({ ...descriptor(), randomSeed: false, payload: { ...descriptor().payload, parameters: { ...descriptor().payload.parameters, prompt, seed: index } }, history: { ...descriptor().history, prompt, modules: [{ id: prompt }] } }));
  f.jobs.start('key', a, 3, undefined, { ...entries[0], sequence: entries }, {}); const job = f.jobs.get('key', a); await job.running;
  assert.deepEqual(estimated, ['first', 'second', 'third']); assert.deepEqual(seen, [[a, 0, 'first'], [a, 1, 'second'], [a, 2, 'third']]);
  assert.deepEqual(saved.map(item => [item.prompt, item.params.seed, item.modules[0].id]), [['first', 0, 'first'], ['second', 1, 'second'], ['third', 2, 'third']]);
  assert.equal(job.historyIds.length, 3); assert.equal(job.sequence, undefined);
});
test('不同配方轮次也会在费用上涨时等待确认，取消后不再提交后续配方', async () => {
  let made = 0;
  const f = setup({ estimate: async () => made ? 8 : 0, generate: async () => { made++; return {}; } });
  const first = descriptor(0), second = { ...descriptor(0), history: { ...descriptor().history, prompt: 'second' } };
  f.jobs.start('key', a, 2, undefined, { ...first, sequence: [first, second] }, {}); const job = f.jobs.get('key', a);
  await until(() => job.state === 'awaiting_confirmation'); assert.equal(made, 1); assert.equal(job.descriptor.history.prompt, 'second');
  f.jobs.cancel('key', a); await job.running; assert.equal(made, 1); assert.equal(job.historyIds.length, 1);
});
test('配方列表全部通过验证才准入，数量不符、嵌套或坏条目不占执行位', () => {
  const f = setup(), first = descriptor();
  for (const sequence of [[first], [first, { ...first, sequence: [first] }], [first, { ...first, history: null }], 'invalid']) {
    assert.throws(() => f.jobs.start('key', a, 2, undefined, { ...first, sequence }, {}), /后台任务/);
    assert.equal(f.tasks.current('key'), undefined); assert.equal(f.jobs.has('key', a), false);
  }
});

test('后台查询与实时推送携带公共队列状态，保留零与未知且不暴露内部字段', async () => {
  let queue = null, finish;
  const f = setup({ readQueue: () => queue,
    generate: async () => { await new Promise(resolve => { finish = resolve; }); return {}; },
  });
  f.jobs.start('key', a, 1, undefined, descriptor(), {});
  await until(() => Boolean(finish));
  const job = f.jobs.get('key', a), reader = generationJobEventResponse(f.jobs, job).body.getReader();
  const read = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]);
  assert.equal((await read()).cloudQueue, null);
  queue = { taskId: 'synthetic-cloud-task', phase: 'waiting', position: 2, queueSize: 4, greeting: '正在生成中～',
    cancelable: true, keyHash: 'private-key-hash', controller: new AbortController(), lockToken: 'private-lock' };
  f.jobs.notify(job);
  const status = (await read()).cloudQueue;
  assert.deepEqual(status, { taskId: queue.taskId, phase: 'waiting', position: 2, queueSize: 4, greeting: queue.greeting, cancelable: true });
  assert.equal(JSON.stringify(status).includes('private'), false);
  queue.position = 0; queue.queueSize = 0;
  assert.equal(f.jobs.snapshot(job).cloudQueue.position, 0);
  assert.equal(f.jobs.snapshot(job).cloudQueue.queueSize, 0);
  queue = { taskId: queue.taskId, phase: 'waiting', proxy: true, position: null, queueSize: null, cancelable: true };
  f.jobs.notify(job);
  assert.deepEqual((await read()).cloudQueue, queue);
  queue = { taskId: queue.taskId, phase: 'completed', cleanupError: 'synthetic cleanup warning', cancelable: false };
  finish(); await job.running;
  assert.equal(f.jobs.snapshot(job).cloudQueue.cleanupError, queue.cleanupError);
  await reader.cancel();
});

for (const operation of ['generate', 'img2img', 'inpaint', 'outpaint']) test(`${operation} 每步立即推送，断开观察仍完成后台保存`, async () => {
  let emit, finish;
  const f = setup({ generate: async (_job, _payload, onPreview) => {
    emit = onPreview;
    await new Promise(resolve => { finish = resolve; });
    return {};
  } });
  const data = descriptor(); data.stream = true;
  data.payload.action = operation === 'generate' ? 'generate' : operation === 'img2img' ? 'img2img' : 'infill';
  if (operation === 'outpaint') data.payload.parameters._local_edit_operation = 'outpaint';
  f.jobs.start('key', a, 1, undefined, data, {});
  await until(() => Boolean(emit));
  const job = f.jobs.get('key', a), abort = new AbortController();
  const response = generationJobEventResponse(f.jobs, job, undefined, abort.signal);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  await reader.read();
  // 模拟一个上游数据块内连续返回八步，图片内容相同也必须保留每个步数事件。
  for (let step = 1; step <= 8; step++) emit({ image: 'data:image/png;base64,AQID', step });
  const received = [];
  for (let i = 0; i < 8; i++) received.push(JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]).preview.step);
  assert.deepEqual(received, [1, 2, 3, 4, 5, 6, 7, 8]);
  abort.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(job.cancelled, false);
  finish(); await job.running;
  assert.equal(f.jobs.snapshot(job).state, 'succeeded');
  assert.equal(f.jobs.snapshot(job).completedCount, 1);
});

test('实时观察终态带保存回执并关闭，重连只收最新帧，取消 reader 释放订阅', async () => {
  let emit, finish;
  const f = setup({ generate: async (_job, _payload, onPreview) => { emit = onPreview; await new Promise(resolve => { finish = resolve; }); return {}; } });
  f.jobs.start('key', a, 1, undefined, descriptor(), {}); await until(() => Boolean(emit));
  const job = f.jobs.get('key', a);
  emit({ image: 'data:image/png;base64,AQID', step: 3 });
  const first = generationJobEventResponse(f.jobs, job).body.getReader();
  assert.equal(JSON.parse(new TextDecoder().decode((await first.read()).value).split('data: ')[1]).preview.step, 3);
  await first.cancel(); assert.equal(job.listeners.size, 0);
  const reader = generationJobEventResponse(f.jobs, job, job.previewVersion).body.getReader();
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]).preview, undefined);
  finish(); await job.running;
  const states = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    states.push(JSON.parse(new TextDecoder().decode(value).split('data: ')[1]));
  }
  assert.equal(states.at(-1).state, 'succeeded');
  assert.equal(states.at(-1).lastSavedItem.id, job.historyIds[0]);
  assert.equal(job.listeners.size, 0);
});

test('终态推送入缓冲不冒充手机已读取，冻结超过清理时间仍能 GET 补查', async () => {
  let finish;
  const f = setup({ generate: async () => { await new Promise(resolve => { finish = resolve; }); return {}; } });
  f.jobs.start('key', a, 1, undefined, descriptor(), {}); await until(() => Boolean(finish));
  const job = f.jobs.get('key', a), reader = generationJobEventResponse(f.jobs, job).body.getReader();
  await reader.read(); finish(); await job.running;
  assert.equal(job.observedAt, undefined);
  f.advance(360_000);
  assert.equal(f.jobs.get('key', a), job);
  assert.equal(f.jobs.snapshot(job).state, 'succeeded');
  await reader.cancel();
});

test('预览按客户端版本发送，保存后等待与暂停释放图片，旧客户端仍可读取', async () => {
  let releaseSave, emitPreview;
  const f = setup({
    generate: async (_job, _payload, preview) => { emitPreview = preview; preview({ image: 'data:image/png;base64,AQID', step: 1 }); return {}; },
    save: async (_job, _output, metadata) => { await new Promise(resolve => { releaseSave = resolve; }); return { ...metadata, imageUrl: '/saved/' + metadata.id }; },
  });
  f.jobs.start('key', a, 2, undefined, descriptor(), {});
  const job = f.jobs.get('key', a); await until(() => Boolean(releaseSave));
  const first = f.jobs.snapshot(job);
  assert.ok(first.preview); assert.equal(f.jobs.snapshot(job, String(first.previewVersion)).preview, undefined);
  assert.deepEqual(f.jobs.snapshot(job).preview, first.preview);
  emitPreview({ image: 'data:image/png;base64,BAUG', step: 2 });
  const next = f.jobs.snapshot(job, first.previewVersion); assert.equal(next.preview.step, 2);
  f.tasks.pause('key', true); releaseSave(); await until(() => job.state === 'paused');
  const saved = f.jobs.snapshot(job, next.previewVersion);
  assert.equal(saved.preview, undefined); assert.ok(saved.previewVersion > next.previewVersion); assert.equal(saved.completedCount, 1);
  f.jobs.cancel('key', a); await job.running;
});

test('无浏览器轮询或心跳仍逐张生成保存，超过空闲租期不失效，回执与种子对应', async () => {
  let continueSaving;
  const fixture = setup({ save: async (_job, _output, metadata) => { await new Promise(resolve => { continueSaving = resolve; }); return { ...metadata, imageUrl: '/saved/' + metadata.id }; } });
  const { jobs, tasks, calls } = fixture;
  jobs.start('key', a, 2, undefined, descriptor(), {});
  await until(() => Boolean(continueSaving));
  fixture.advance(360_000);
  assert.equal(tasks.current('key').token, a);
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  const firstSeed = calls[0].seed;
  continueSaving();
  await until(() => calls.length === 2 && jobs.get('key', a).state === 'saving');
  assert.equal(jobs.snapshot(jobs.get('key', a)).lastSavedItem.params.seed, firstSeed);
  continueSaving();
  await jobs.get('key', a).running;
  const result = jobs.snapshot(jobs.get('key', a));
  assert.equal(result.state, 'succeeded'); assert.equal(result.completedCount, 2);
  assert.equal(new Set(result.historyIds).size, 2); assert.equal(result.lastSavedItem.params.seed, calls[1].seed);
  assert.equal(tasks.current('key'), undefined);
});

test('额度准备期间暂停可继续，但未继续前绝不提交生成', async () => {
  let finishEstimate;
  const fixture = setup({ estimate: async () => { await new Promise(resolve => { finishEstimate = resolve; }); return 0; } });
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  await until(() => Boolean(finishEstimate));
  const paused = fixture.tasks.pause('key', true);
  assert.equal(paused.pausing, false);
  finishEstimate(); await tick();
  assert.equal(fixture.calls.length, 0);
  fixture.tasks.pause('key', false);
  await until(() => fixture.jobs.get('key', a).state === 'preparing');
  finishEstimate(); await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).state, 'succeeded');
});

test('跨客户端取消在途任务仍收图保存，取消终态保留部分历史且不执行后续', async () => {
  const fixture = setup();
  let finishUpstream;
  fixture.jobs.generate = async (job, payload) => {
    const finish = fixture.tasks.enter(job.key, job.token);
    fixture.calls.push({ token: job.token, seed: payload.parameters.seed });
    await new Promise(resolve => { finishUpstream = resolve; });
    finish(); return { seed: payload.parameters.seed };
  };
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await until(() => Boolean(finishUpstream));
  fixture.jobs.cancel('key', a);
  assert.throws(() => fixture.tasks.enter('key'), { code: 'generation_busy' });
  finishUpstream(); await fixture.jobs.get('key', a).running;
  const result = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(result.state, 'cancelled'); assert.equal(result.code, 'generation_cancelled');
  assert.equal(result.completedCount, 1); assert.equal(result.historyIds[0], result.lastSavedItem.id);
  assert.equal(fixture.calls.length, 1);
  assert.throws(() => fixture.jobs.cancel('another-key', a), { status: 404 });
});

for (const cancelJob of [false, true]) test(`保存成功遇取消墓碑如实返回已保存及取消，释放 Key 且不续跑（取消 runner=${cancelJob}）`, async () => {
  let finishSave;
  const fixture = setup({ save: async (_job, _output, metadata) => {
    await new Promise(resolve => { finishSave = resolve; });
    return { ...metadata, imageUrl: '/saved/' + metadata.id };
  } });
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  const job = fixture.jobs.get('key', a);
  await until(() => Boolean(finishSave));
  assert.equal(fixture.tasks.current('key').phase, 'saving');
  fixture.tasks.cancelAll('key');
  if (cancelJob) fixture.jobs.cancel('key', a);
  fixture.tasks.pause('key', true);
  fixture.tasks.enqueue('key', b, 'end');
  fixture.tasks.cancel('key', a);
  assert.equal(fixture.tasks.status('key', b).position, 1);
  assert.throws(() => fixture.tasks.reserve('key', c), { code: 'generation_busy' });
  finishSave(); await job.running;
  const result = fixture.jobs.snapshot(job);
  assert.equal(result.completedCount, 1);
  assert.equal(result.historyIds[0], result.lastSavedItem.id);
  assert.equal(result.state, 'cancelled'); assert.equal(result.code, 'generation_cancelled');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.tasks.current('key').token, b);
  assert.equal(fixture.tasks.status('key', b).paused, true);
  assert.equal(fixture.tasks.snapshot('key').completed, 0);
  assert.throws(() => fixture.tasks.status('key', a), { code: 'generation_cancelled' });
});

test('取消墓碑期间真实保存失败仍报 history_save_failed，释放 Key 且不补张', async () => {
  let failSave;
  const fixture = setup({ save: async () => {
    await new Promise(resolve => { failSave = resolve; });
    throw Object.assign(new Error('synthetic cancelled save failure'), { preview: { image: 'data:image/png;base64,AQID' } });
  } });
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  const job = fixture.jobs.get('key', a);
  await until(() => Boolean(failSave));
  fixture.tasks.cancelAll('key'); fixture.jobs.cancel('key', a);
  assert.equal(fixture.tasks.current('key').token, a);
  failSave(); await job.running;
  const result = fixture.jobs.snapshot(job);
  assert.equal(result.state, 'failed'); assert.equal(result.code, 'history_save_failed');
  assert.equal(result.completedCount, 0); assert.equal(result.preview.image, 'data:image/png;base64,AQID');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.tasks.current('key'), undefined);
  assert.equal(fixture.tasks.snapshot('key').completed, 0);
});

test('后台插队以保存为边界，插入任务完成后恢复原任务余量及队尾', async () => {
  const fixture = setup(); let finishFirst;
  const generate = fixture.jobs.generate;
  fixture.jobs.generate = async (job, payload, preview) => {
    if (!fixture.calls.length) await new Promise(resolve => { finishFirst = resolve; });
    return generate(job, payload, preview);
  };
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await until(() => Boolean(finishFirst));
  fixture.jobs.start('key', c, 1, 'end', descriptor(), {});
  fixture.jobs.start('key', b, 2, 'next', descriptor(), {});
  finishFirst();
  await Promise.all([a, b, c].map(token => fixture.jobs.get('key', token).running));
  assert.deepEqual(fixture.calls.map(call => call.token[0]), ['a', 'b', 'b', 'a', 'a', 'c']);
  assert.equal(fixture.tasks.snapshot('key').completed, 6);
});

test('费用上涨保持停止，重新授权剩余费用后继续，不允许较低授权绕过', async () => {
  const fixture = setup(); let checks = 0;
  fixture.jobs.estimate = async () => ++checks === 1 ? 0 : 12;
  fixture.jobs.start('key', a, 2, undefined, descriptor(), {});
  await until(() => fixture.jobs.get('key', a).state === 'awaiting_confirmation');
  assert.equal(fixture.calls.length, 1);
  const pending = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(pending.cost, 12); assert.equal(pending.completedCount, 1);
  assert.throws(() => fixture.jobs.approve('key', a, 11), { code: 'generation_confirmation_required' });
  fixture.jobs.approve('key', a, 12);
  await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).state, 'succeeded');
});

test('完全访问的费用授权随有限任务生效，费用上涨直接继续且保留暂停与真实记账依据', async () => {
  const costs = [0, 12]; let estimates = 0;
  const fixture = setup({ estimate: async () => costs[estimates++] });
  fixture.tasks.pause('key', true);
  fixture.jobs.start('key', a, 2, 'end', { ...descriptor(), autoApproveCost: true }, {});
  const job = fixture.jobs.get('key', a);
  await until(() => job.state === 'paused');
  assert.equal(fixture.calls.length, 0);
  fixture.tasks.pause('key', false);
  await job.running;
  assert.equal(fixture.calls.length, 2);
  assert.equal(estimates, 2);
  assert.equal(job.approvedCost, 0);
  assert.equal(fixture.jobs.snapshot(job).state, 'succeeded');
});

test('非布尔的自动费用授权不能跳过确认', async () => {
  const fixture = setup({ estimate: async () => 12 });
  fixture.jobs.start('key', a, 1, undefined, { ...descriptor(), autoApproveCost: 'true' }, {});
  const job = fixture.jobs.get('key', a);
  await until(() => job.state === 'awaiting_confirmation');
  assert.equal(fixture.calls.length, 0);
  fixture.jobs.cancel('key', a); await job.running;
});

test('保存失败不计完成、不补张，终态保留未保存图片而非伪报取消或成功', async () => {
  const fixture = setup({ save: async () => { throw Object.assign(new Error('synthetic-save-failure'), { preview: { image: 'data:image/png;base64,AQID' } }); } });
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await fixture.jobs.get('key', a).running;
  const result = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(result.state, 'failed'); assert.equal(result.code, 'history_save_failed');
  assert.equal(result.completedCount, 0); assert.equal(result.preview.image, 'data:image/png;base64,AQID');
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.tasks.size, 0);
});

test('同 token 重复投递不增张数、不重复消费，另一个 Key 不可查询回执', async () => {
  const fixture = setup();
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  fixture.jobs.start('key', a, 8, 'end', descriptor(100), {});
  await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).requestedCount, 1);
  assert.throws(() => fixture.jobs.get('other', a), { status: 404 });
});

test('冻结超过终态清理时间仍能收取已保存回执，收取后才开始过期', async () => {
  const fixture = setup();
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  await fixture.jobs.get('key', a).running;
  fixture.advance(600_000);
  const receipt = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(receipt.state, 'succeeded');
  assert.equal(receipt.completedCount, 1);
  assert.equal(receipt.historyIds[0], receipt.lastSavedItem.id);
  fixture.advance(300_001);
  assert.throws(() => fixture.jobs.get('key', a), { code: 'generation_job_not_found' });
});
