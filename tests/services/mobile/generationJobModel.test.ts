import { describe, expect, it, vi } from 'vitest';
import type { GenerationJob, GenerationJobDescriptor, GenerationJobOutput, GenerationJobSnapshot } from '../../../worker/generationJobs.mjs';
import { GenerationJobs } from '../../../worker/generationJobs.mjs';
import { GenerationTasks } from '../../../worker/generationTasks.mjs';
import type { LocalGenItem } from '../../../types';
import { GENERATION_JOB_REQUEST_LIMIT, createGenerationJobHandler, normalizedBillingPayload, parseGenerationJobBody } from '../../../mobile/generationJobModel';

interface FakeContext { authorization: string }
interface FakeOutput extends GenerationJobOutput { bytes: Uint8Array }
interface RealContext { authorization: string }
interface RealOutput extends GenerationJobOutput { bytes: Uint8Array; mime: string; queueTaskId: string }

const TOKEN = 'synthetic-generation-token-0001';
const KEY = 'synthetic-key';
const idOf = (key: string, token = TOKEN) => `${key}\u0000${token}`;
// 只推进微任务：保活释放由 running 的 finally 触发，不依赖真实时钟。
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;
it('手机解析保留一轮不同配方，深层验证继续交给共享任务引擎', () => {
  const entries = [0, 1].map(seed => ({ payload: { action: 'generate', model: 'nai-diffusion-5-full', parameters: { n_samples: 1, seed } }, history: { prompt: `synthetic-${seed}`, negativePrompt: '', params: { seed } }, randomSeed: false, stream: false, approvedCost: 0 }));
  expect(parseGenerationJobBody(JSON.stringify({ ...entries[0], sequence: entries })).sequence).toEqual(entries);
});

const descriptorOf = (approvedCost = 4): GenerationJobDescriptor => ({
  payload: { model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { n_samples: 1 } },
  // params 在路由测试里只做结构占位，真实整图参数由共享 GenerationJobs 校验。
  history: { prompt: 'synthetic', negativePrompt: '', params: {} as GenerationJobDescriptor['history']['params'] },
  randomSeed: true, stream: false, approvedCost,
});

it('Android final 到达即并行保存并等待流尾，持有执行位且不重复提交', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  let finish = () => {}, saveStarted = () => {};
  const save = vi.fn(async (_job: GenerationJob<RealContext>, output: RealOutput, metadata: Omit<LocalGenItem, 'imageUrl'>) => {
    saveStarted();
    expect(output.queueTaskId).toBe('synthetic-queue-task');
    return { ...metadata, imageUrl: '/synthetic/saved.png' };
  });
  const jobs = new GenerationJobs<RealContext, RealOutput>({ tasks, validate: () => {}, estimate: async () => 0, readCleanup: () => undefined,
    generate: async (_job, _payload, _onPreview, onFinal) => {
      const output = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', queueTaskId: 'synthetic-queue-task' };
      onFinal(output);
      await new Promise<void>(resolve => { finish = resolve; });
      return output;
    }, save,
  });
  jobs.start(KEY, TOKEN, 1, undefined, descriptorOf(), { authorization: `Bearer ${KEY}` });
  const job = jobs.get(KEY, TOKEN);
  await new Promise<void>(resolve => { saveStarted = resolve; });
  await flush();
  expect(job.state).toBe('saving');
  expect(job.historyIds).toHaveLength(0);
  expect(tasks.current(KEY)?.token).toBe(TOKEN);
  expect(() => tasks.reserve(KEY, 'synthetic-other-task')).toThrow(expect.objectContaining({ code: 'generation_busy' }));
  expect(save).toHaveBeenCalledOnce();
  finish();
  await job.running;
  expect(save).toHaveBeenCalledOnce();
  expect(job.state).toBe('succeeded');
  expect(job.historyIds).toHaveLength(1);
});

const createFakeJobs = () => {
  const store = new Map<string, GenerationJob<FakeContext>>();
  const completions = new Map<string, () => void>();
  const missing = () => Object.assign(new Error('生成任务不存在或已结束，请查看历史'), { code: 'generation_job_not_found', status: 404 });
  const snapshot = (job: GenerationJob<FakeContext>): GenerationJobSnapshot => ({
    token: job.token, state: job.state, completedCount: job.historyIds.length, requestedCount: job.count, historyIds: [...job.historyIds],
  });
  const require_ = (key: string, token: string) => {
    const job = store.get(`${key}:${token}`);
    if (!job) throw missing();
    return job;
  };
  return {
    store, completions, snapshot, subscribe: () => () => {},
    has: (key: string, token: string) => store.has(`${key}:${token}`),
    get: require_,
    start: (key: string, token: string, count: number, placement: 'end' | 'next' | undefined, descriptor: GenerationJobDescriptor, context: FakeContext) => {
      const job: GenerationJob<FakeContext> = {
        key, token, count, ...(placement ? { placement } : {}), descriptor, context,
        state: 'generating', historyIds: [], approvedCost: descriptor.approvedCost, cancelled: false,
        running: new Promise<void>(resolve => { completions.set(`${key}:${token}`, resolve); }),
      };
      store.set(`${key}:${token}`, job);
      return snapshot(job);
    },
    cancel: (key: string, token: string) => {
      const job = require_(key, token);
      job.cancelled = true; job.state = 'cancelled';
      return snapshot(job);
    },
    approve: (key: string, token: string, approvedCost: number) => {
      const job = require_(key, token);
      if (job.state !== 'awaiting_confirmation') throw Object.assign(new Error('请重新确认当前剩余任务的费用'), { code: 'generation_confirmation_required', status: 409 });
      job.approvedCost = approvedCost; job.state = 'waiting';
      return snapshot(job);
    },
  };
};

const setup = () => {
  const jobs = createFakeJobs();
  const retained: string[] = [], released: string[] = [];
  const handler = createGenerationJobHandler<FakeContext, FakeOutput>({
    jobs,
    keyOf: authorization => authorization.replace(/^Bearer /, ''),
    contextOf: request => ({ authorization: request.headers.get('authorization') || '' }),
    retain: id => { retained.push(id); },
    release: id => { released.push(id); },
  });
  return { jobs, handler, retained, released };
};

it('手机 GET 将可选预览版本交给共享任务快照，旧查询仍可读', async () => {
  const f = setup();
  f.jobs.start(KEY, TOKEN, 1, undefined, descriptorOf(), { authorization: `Bearer ${KEY}` });
  const snapshot = vi.spyOn(f.jobs, 'snapshot');
  const query = new Request(`https://localhost/api/generation-job?token=${TOKEN}&previewVersion=7`, { headers: { authorization: `Bearer ${KEY}` } });
  expect((await f.handler(query)).status).toBe(200);
  expect(snapshot).toHaveBeenLastCalledWith(f.jobs.get(KEY, TOKEN), '7');
  expect((await f.handler(new Request(query.url.replace('&previewVersion=7', ''), query))).status).toBe(200);
  expect(snapshot).toHaveBeenLastCalledWith(f.jobs.get(KEY, TOKEN), null);
});

it.each(['generate', 'img2img', 'inpaint', 'outpaint'])('独立手机 %s 实时每步推送，观察断开仍保存且释放保活', async operation => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  let emit: (preview: NonNullable<GenerationJobSnapshot['preview']>) => void = () => {};
  let finish = () => {};
  const save = vi.fn(async (_job: GenerationJob<RealContext>, _output: RealOutput, metadata: Omit<LocalGenItem, 'imageUrl'>) => ({ ...metadata, imageUrl: '/synthetic/saved.png' }));
  const jobs = new GenerationJobs<RealContext, RealOutput>({ tasks, validate: () => {}, estimate: async () => 0, readCleanup: () => undefined,
    generate: async (job, _payload, onPreview) => {
      const release = tasks.enter(job.key, job.token); emit = onPreview;
      await new Promise<void>(resolve => { finish = resolve; }); release();
      return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', queueTaskId: 'synthetic' };
    }, save,
  });
  const retain = vi.fn(), release = vi.fn();
  const handler = createGenerationJobHandler({ jobs, keyOf: value => value.replace(/^Bearer /, ''), contextOf: request => ({ authorization: request.headers.get('authorization') || '' }), retain, release });
  const data = descriptorOf(); data.stream = true;
  data.payload.action = operation === 'generate' ? 'generate' : operation === 'img2img' ? 'img2img' : 'infill';
  if (operation === 'outpaint') data.payload.parameters._local_edit_operation = 'outpaint';
  expect((await handler(new Request('https://localhost/api/generation-job', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'X-Nai-Generation-Task': TOKEN }, body: JSON.stringify(data) }))).status).toBe(200);
  await flush();
  const abort = new AbortController();
  const response = await handler(new Request(`https://localhost/api/generation-job?token=${TOKEN}&events=1`, { headers: { Authorization: `Bearer ${KEY}` }, signal: abort.signal }));
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader(); await reader.read();
  for (let step = 1; step <= 8; step++) emit({ image: 'data:image/png;base64,AQID', step });
  const steps = [];
  for (let step = 1; step <= 8; step++) steps.push(JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1]).preview.step);
  expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  const other = await handler(new Request(`https://localhost/api/generation-job?token=${TOKEN}&events=1`, { headers: { Authorization: 'Bearer other-key' } }));
  expect(other.status).toBe(404);
  abort.abort(); expect((await reader.read()).done).toBe(true);
  expect(jobs.get(KEY, TOKEN).cancelled).toBe(false); expect(release).not.toHaveBeenCalled();
  finish(); await jobs.get(KEY, TOKEN).running; await flush();
  expect(save).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledExactlyOnceWith(idOf(KEY));
  expect(jobs.snapshot(jobs.get(KEY, TOKEN)).state).toBe('succeeded');
});

const request = (method: string, options: { body?: unknown; authorization?: string; token?: string; count?: string; placement?: string } = {}) =>
  new Request('https://localhost/api/generation-job', {
    method,
    headers: {
      ...(options.authorization === undefined ? { authorization: 'Bearer synthetic-key' } : { authorization: options.authorization }),
      ...(options.token === undefined ? { 'x-nai-generation-task': TOKEN } : { 'x-nai-generation-task': options.token }),
      ...(options.count === undefined ? {} : { 'x-nai-generation-count': options.count }),
      ...(options.placement === undefined ? {} : { 'x-nai-generation-placement': options.placement }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

describe('手机后台生成任务入口', () => {
  it('提交一次任务并保留保活，重复投递只观察原任务', async () => {
    const { jobs, handler, retained } = setup();
    const first = await json(await handler(request('POST', { body: descriptorOf() })));
    expect(first).toMatchObject({ token: TOKEN, state: 'generating', requestedCount: 1 });
    expect(retained).toEqual([idOf(KEY)]);
    const again = await json(await handler(request('POST', { body: descriptorOf(9) })));
    expect(again).toMatchObject({ token: TOKEN, requestedCount: 1 });
    expect(retained).toEqual([idOf(KEY)]);
    expect(jobs.store.size).toBe(1);
    expect(jobs.store.get(`${KEY}:${TOKEN}`)?.approvedCost).toBe(4);
  });

  it('按 Key 指纹隔离任务标识，取消与授权都只作用于当前 Key', async () => {
    const { jobs, handler, retained } = setup();
    await handler(request('POST', { body: descriptorOf() }));
    await handler(request('POST', { authorization: 'Bearer other-key', body: descriptorOf(6) }));
    // 同一 token 在两个 Key 下各建一份，互不覆盖也不会互相观测；保活标识同样按 Key 区分。
    expect(jobs.store.size).toBe(2);
    expect(retained).toEqual([idOf(KEY), idOf('other-key')]);
    expect(await json(await handler(request('GET', { authorization: 'Bearer other-key' })))).toMatchObject({ token: TOKEN, state: 'generating' });
    const approval = await json(await handler(request('PATCH', { body: { approvedCost: 7 } })));
    expect(approval).toMatchObject({ error: '请重新确认当前剩余任务的费用', code: 'generation_confirmation_required' });
    const cancelled = await json(await handler(request('DELETE')));
    expect(cancelled).toMatchObject({ state: 'cancelled' });
    // 当前 Key 的取消不能串到另一 Key 的同名任务。
    expect(jobs.store.get(`other-key:${TOKEN}`)?.state).toBe('generating');
  });

  it('读取当前任务不重新保活，任务终态后立即释放', async () => {
    const { jobs, handler, retained, released } = setup();
    await handler(request('POST', { body: descriptorOf() }));
    await handler(request('GET'));
    expect(retained).toEqual([idOf(KEY)]);
    expect(released).toEqual([]);
    jobs.completions.get(`${KEY}:${TOKEN}`)?.();
    await flush();
    expect(released).toEqual([idOf(KEY)]);
  });

  it('取消后仍等已提交图片保存完成再释放保活', async () => {
    const { jobs, handler, released } = setup();
    await handler(request('POST', { body: descriptorOf() }));
    const cancelled = await json(await handler(request('DELETE')));
    expect(cancelled).toMatchObject({ state: 'cancelled' });
    expect(released).toEqual([]);
    jobs.completions.get(`${KEY}:${TOKEN}`)?.();
    await flush();
    expect(released).toEqual([idOf(KEY)]);
  });

  it('缺少 Key、非法配置与方法错误都返回结构化回执', async () => {
    const { handler, retained } = setup();
    const anonymous = await handler(request('POST', { authorization: '', body: descriptorOf() }));
    expect(anonymous.status).toBe(401);
    expect(await json(anonymous)).toMatchObject({ code: 'missing_key' });
    const invalid = await handler(new Request('https://localhost/api/generation-job', { method: 'POST', headers: { authorization: 'Bearer synthetic-key', 'x-nai-generation-task': TOKEN }, body: '{' }));
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ code: 'invalid_generation_job' });
    const wrongMethod = await handler(request('PUT'));
    expect(wrongMethod.status).toBe(405);
    expect(retained).toEqual([]);
  });

  it('排队位置与张数原样交给任务准入，越界位置不建立任务', async () => {
    const { jobs, handler } = setup();
    const queued = await handler(request('POST', { body: descriptorOf(), count: '3', placement: 'next' }));
    expect(queued.status).toBe(200);
    expect(jobs.store.get(`${KEY}:${TOKEN}`)).toMatchObject({ count: 3, placement: 'next' });
    await handler(request('GET', { token: 'synthetic-generation-token-0002' }));
    const invalid = await json(await handler(request('POST', { token: 'synthetic-generation-token-0003', body: descriptorOf(), placement: 'middle' })));
    expect(invalid).toMatchObject({ code: 'invalid_generation_queue' });
    expect(jobs.store.has(`${KEY}:synthetic-generation-token-0003`)).toBe(false);
  });
});

describe('同一 token 在两个 Key 下的真实任务保活', () => {
  it('释放先完成的一方不会清掉另一方仍在使用的保活', async () => {
    // 合成回执与手动闸门：不触网、不写私人数据，也不依赖真实时钟。
    const gates = new Map<string, () => void>();
    const tasks = new GenerationTasks();
    const jobs = new GenerationJobs<RealContext, RealOutput>({
      tasks,
      validate: () => {},
      generate: async job => {
        await new Promise<void>(resolve => gates.set(job.key, resolve));
        return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', queueTaskId: 'synthetic-queue-task' };
      },
      // 共享 run 只读取 id 与 imageUrl 作为保存回执；其余历史字段不属于本测试范围。
      save: async job => ({ id: `${job.key}-image`, imageUrl: `/api/local-history/${job.key}/image` }) as LocalGenItem,
      estimate: async job => job.approvedCost,
      readCleanup: () => undefined,
    });
    const active = new Set<string>();
    const released: string[] = [];
    const handler = createGenerationJobHandler<RealContext, RealOutput>({
      jobs,
      keyOf: authorization => authorization.replace(/^Bearer /, ''),
      contextOf: request => ({ authorization: request.headers.get('authorization') || '' }),
      retain: id => { active.add(id); },
      release: id => { released.push(id); active.delete(id); },
    });
    const submit = (key: string) => handler(request('POST', { authorization: `Bearer ${key}`, body: descriptorOf() }));
    expect((await submit('key-a')).status).toBe(200);
    expect((await submit('key-b')).status).toBe(200);
    await flush();
    // 两个 Key 各自持有本任务的执行位与保活，互不覆盖。
    expect(tasks.current('key-a')?.token).toBe(TOKEN);
    expect(tasks.current('key-b')?.token).toBe(TOKEN);
    expect([...active].sort()).toEqual([idOf('key-a'), idOf('key-b')].sort());
    expect([...gates.keys()].sort()).toEqual(['key-a', 'key-b']);

    gates.get('key-a')?.();
    await jobs.get('key-a', TOKEN).running;
    await flush();
    expect(released).toEqual([idOf('key-a')]);
    expect([...active]).toEqual([idOf('key-b')]);

    gates.get('key-b')?.();
    await jobs.get('key-b', TOKEN).running;
    await flush();
    expect(released).toEqual([idOf('key-a'), idOf('key-b')]);
    expect(active.size).toBe(0);
    expect(jobs.snapshot(jobs.get('key-a', TOKEN)).state).toBe('succeeded');
    expect(jobs.snapshot(jobs.get('key-b', TOKEN)).state).toBe('succeeded');
  });
});

describe('费用待确认与手动暂停', () => {
  it('手动暂停后授权不会追加请求，主动继续才恢复', async () => {
    const key = 'key-paused';
    const tasks = new GenerationTasks();
    // 受控等待：后台循环的间隔与确认等待由测试推进，不依赖真实时钟。
    const waits: (() => void)[] = [];
    let generated = 0;
    const jobs = new GenerationJobs<RealContext, RealOutput>({
      tasks,
      sleep: () => new Promise<void>(resolve => { waits.push(resolve); }),
      validate: () => {},
      generate: async () => { generated += 1; return { bytes: new Uint8Array([1]), mime: 'image/png', queueTaskId: 'synthetic-queue-task' }; },
      save: async job => ({ id: `${job.key}-image`, imageUrl: `/api/local-history/${job.key}/image` }) as LocalGenItem,
      estimate: async () => 6,
      readCleanup: () => undefined,
    });
    const handler = createGenerationJobHandler<RealContext, RealOutput>({
      jobs,
      keyOf: authorization => authorization.replace(/^Bearer /, ''),
      contextOf: request => ({ authorization: request.headers.get('authorization') || '' }),
      retain: () => {},
      release: () => {},
    });
    const snapshot = () => jobs.snapshot(jobs.get(key, TOKEN));
    const advance = async () => { await flush(); for (const resolve of waits.splice(0)) resolve(); await flush(); };

    expect((await handler(request('POST', { authorization: `Bearer ${key}`, body: descriptorOf(4) }))).status).toBe(200);
    await advance();
    // 每张预计 6 > 已授权 4：停止后续请求并等待本任务授权，仍独占执行位。
    expect(snapshot()).toMatchObject({ state: 'awaiting_confirmation', cost: 6, completedCount: 0 });
    expect(generated).toBe(0);
    expect(tasks.current(key)?.token).toBe(TOKEN);

    // 用户在任意客户端手动暂停；授权只更新任务，不得改写这次暂停。
    tasks.pause(key, true);
    expect((await handler(request('PATCH', { authorization: `Bearer ${key}`, body: { approvedCost: 6 } }))).status).toBe(200);
    await advance();
    expect(snapshot().state).toBe('paused');
    expect(generated).toBe(0);
    expect(tasks.snapshot(key).paused).toBe(true);

    // 只有主动继续才恢复后续请求。
    tasks.pause(key, false);
    await advance();
    await advance();
    expect(generated).toBe(1);
    expect(snapshot()).toMatchObject({ state: 'succeeded', completedCount: 1 });
    expect(tasks.snapshot(key).paused).toBe(false);
  });
});

describe('后台任务描述与计费入参', () => {
  it('只接受带 payload、history 与有限授权费用的 JSON', () => {
    expect(parseGenerationJobBody(JSON.stringify({ ...descriptorOf(), approvedCost: 3 }))).toMatchObject({ randomSeed: true, stream: false, approvedCost: 3 });
    expect(() => parseGenerationJobBody('{')).toThrowError(/不是有效 JSON/);
    expect(() => parseGenerationJobBody('{"payload":{}}')).toThrowError(/配置无效/);
    expect(() => parseGenerationJobBody(JSON.stringify({ ...descriptorOf(), approvedCost: -1 }))).toThrowError(/配置无效/);
    expect(() => parseGenerationJobBody(' '.repeat(GENERATION_JOB_REQUEST_LIMIT + 1))).toThrowError(/过大/);
  });

  it('独立 Android 保留完全访问的费用授权，仅接受明确的布尔值', () => {
    expect(parseGenerationJobBody(JSON.stringify({ ...descriptorOf(), autoApproveCost: true })).autoApproveCost).toBe(true);
    for (const value of [undefined, false, 'true', 1]) {
      expect(parseGenerationJobBody(JSON.stringify({ ...descriptorOf(), autoApproveCost: value })).autoApproveCost).toBeUndefined();
    }
  });

  it('按本地 Vibe／角色参考数量补齐计费入参，不覆盖已有请求字段', () => {
    const priced = normalizedBillingPayload({
      model: 'nai-diffusion-4-5-full', action: 'generate',
      parameters: {
        n_samples: 1,
        _local_vibes: { enabled: true, slots: [{}, {}, {}] },
        _local_character_references: { enabled: true, slots: [{}] },
      },
    });
    expect(priced.parameters.reference_image_multiple_cached).toHaveLength(3);
    expect(priced.parameters.director_reference_images_cached).toHaveLength(1);
    const plain = normalizedBillingPayload({ model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { n_samples: 1 } });
    expect(plain.parameters.reference_image_multiple_cached).toBeUndefined();
    expect(plain.parameters.director_reference_images_cached).toBeUndefined();
  });
});

it('系统拒绝后台保活时拒绝任务，不领取执行位或提交生图', async () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const jobs = new GenerationJobs<RealContext, RealOutput>({
    tasks,
    validate: () => {},
    readCleanup: () => undefined,
    estimate: async () => 0,
    generate: async () => { throw new Error('未取得保活不能生图'); },
    save: async () => { throw new Error('未提交任务不能保存'); },
  });
  const handler = createGenerationJobHandler({
    jobs,
    keyOf: value => value.replace(/^Bearer /, ''),
    contextOf: request => ({ authorization: request.headers.get('authorization') || '' }),
    retain: async () => { throw new Error('system-denied'); },
    release: () => undefined,
  });
  const response = await handler(new Request('https://localhost/api/generation-job', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'X-Nai-Generation-Task': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(descriptorOf()),
  }));
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('generation_background_unavailable');
  expect(jobs.has(KEY, TOKEN)).toBe(false);
  expect(tasks.size).toBe(0);
});
