import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCoverTransport, type CoverQuery, type CoverReply } from '../../services/danbooruCoverTransport';
import type { DanbooruSearchResult } from '../../services/danbooruService';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const query = (name: string): CoverQuery => ({ query: name, page: 1, limit: 60 });
const data = (name: string): DanbooruSearchResult => ({ query: name, page: 1, limit: 60, items: [], hasMore: false });
const harness = () => {
  const batches: Array<{ queries: CoverQuery[]; reply: (item: CoverReply) => void; signal: AbortSignal; background: boolean; end: () => void }> = [];
  const load = vi.fn((queries: CoverQuery[], reply: (item: CoverReply) => void, signal: AbortSignal, background: boolean) =>
    new Promise<void>(resolve => { batches.push({ queries, reply, signal, background, end: resolve }); signal.addEventListener('abort', () => resolve(), { once: true }); }));
  return { batches, load, request: createCoverTransport(load) };
};
const complete = (batch: ReturnType<typeof harness>['batches'][number]) => {
  batch.queries.forEach((query, index) => batch.reply({ index, status: 200, data: data(query.query) })); batch.end();
};

it('收集同帧卡片，最多两批／每批五项，填满十个任务且逐项展示', async () => {
  const { batches, request } = harness();
  const pending = Array.from({ length: 12 }, (_, index) => request(query(String(index))));
  await vi.advanceTimersByTimeAsync(100);
  expect(batches.map(batch => batch.queries.length)).toEqual([5, 5]);
  const first = vi.fn(); void pending[0].then(first);
  batches[0].reply({ index: 0, status: 200, data: data('first') });
  await Promise.resolve(); expect(first).toHaveBeenCalledWith(data('first'));
  expect(batches).toHaveLength(2);
  complete(batches[0]); await vi.advanceTimersByTimeAsync(50);
  expect(batches).toHaveLength(3);
  batches.slice(1).forEach(complete); await Promise.all(pending);
});

it('屏幕内优先于先入队的附近卡片，滚动后按新位置提级', async () => {
  const { batches, request } = harness();
  let priority = 1200;
  const near = request(query('near'), undefined, () => priority);
  const visible = request(query('visible'));
  await vi.advanceTimersByTimeAsync(50);
  expect(batches[0].queries.map(item => item.query)).toEqual(['visible']);
  expect(batches[0].background).toBe(false);
  priority = 0;
  await vi.advanceTimersByTimeAsync(50);
  expect(batches[1].queries.map(item => item.query)).toEqual(['near']);
  batches.forEach(complete); await Promise.all([near, visible]);
});

it('附近预取每秒最多一项，并为可见请求保留连接', async () => {
  const { batches, request } = harness();
  const pending = ['a', 'b', 'c'].map(name => request(query(name), undefined, () => 1000));
  await vi.advanceTimersByTimeAsync(50); expect(batches).toHaveLength(1); expect(batches[0].background).toBe(true);
  complete(batches[0]); await vi.advanceTimersByTimeAsync(999); expect(batches).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(batches).toHaveLength(2);
  complete(batches[1]); await vi.advanceTimersByTimeAsync(1000); complete(batches[2]); await Promise.all(pending);
});

it('取消排队项不发请求，单项取消不打断同批，全部离开才中止流', async () => {
  const { batches, request } = harness();
  const controllers = Array.from({ length: 11 }, () => new AbortController());
  const pending = controllers.map((controller, index) => request(query(String(index)), controller.signal).catch(error => error));
  await vi.advanceTimersByTimeAsync(100);
  controllers[10].abort(); controllers[0].abort(); expect(batches[0].signal.aborted).toBe(false);
  controllers.slice(1, 5).forEach(controller => controller.abort()); expect(batches[0].signal.aborted).toBe(true);
  complete(batches[1]); await vi.runAllTimersAsync();
  const values = await Promise.all(pending);
  expect(values[10].name).toBe('AbortError'); expect(values[5].query).toBe('5'); expect(batches).toHaveLength(2);
});

it('429 及时拒绝排队项，等待期间不发新批次，到期可恢复', async () => {
  const { batches, request } = harness();
  const pending = Array.from({ length: 11 }, (_, index) => request(query(String(index))).catch(error => error));
  await vi.advanceTimersByTimeAsync(100);
  batches[0].reply({ index: 0, status: 429, data: { error: 'Danbooru 429' } });
  complete(batches[0]); complete(batches[1]);
  const values = await Promise.all(pending);
  expect(values[0].status).toBe(429); expect(values[10].status).toBe(429); expect(values[10].retryAfter).toBe(30);
  await vi.advanceTimersByTimeAsync(29_999); expect(batches).toHaveLength(2);
  await expect(request(query('cooling'))).rejects.toMatchObject({ status: 429, retryAfter: 1 });
  await vi.advanceTimersByTimeAsync(1);
  const recovered = request(query('10')); await vi.advanceTimersByTimeAsync(50);
  complete(batches[2]); expect((await recovered).query).toBe('10');
});

it('验证页保持 403 和错误码，遵守真实等待时长，取消优先于冷却', async () => {
  const { batches, request } = harness();
  const pending = Array.from({ length: 11 }, (_, index) => request(query(String(index))).catch(error => error));
  await vi.advanceTimersByTimeAsync(100);
  batches[0].reply({ index: 0, status: 403, data: { error: 'Danbooru 要求网站验证', code: 'DANBOORU_CHALLENGE', retryAfter: 420 } });
  complete(batches[0]); complete(batches[1]);
  const values = await Promise.all(pending);
  expect(values[10]).toMatchObject({ status: 403, code: 'DANBOORU_CHALLENGE', retryAfter: 420 });
  await vi.advanceTimersByTimeAsync(419_999);
  await expect(request(query('blocked'))).rejects.toMatchObject({ status: 403, code: 'DANBOORU_CHALLENGE', retryAfter: 1 });
  const controller = new AbortController(); controller.abort();
  await expect(request(query('aborted'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(batches).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  const recovered = request(query('ok')); await vi.advanceTimersByTimeAsync(50); complete(batches[2]); await recovered;
});

it('普通错误文本中的 429 不触发等待', async () => {
  const { batches, request } = harness();
  const first = request(query('first')).catch(error => error); await vi.advanceTimersByTimeAsync(50);
  batches[0].reply({ index: 0, status: 502, data: { error: 'post 429 unavailable' } }); batches[0].end(); await first;
  const second = request(query('second')); await vi.advanceTimersByTimeAsync(50); expect(batches).toHaveLength(2);
  complete(batches[1]); await second;
});

it('流中断只拒绝未完成项，已经收到的结果仍可使用', async () => {
  const { batches, request } = harness();
  const first = request(query('first')); const second = request(query('second')).catch(error => error);
  await vi.advanceTimersByTimeAsync(50);
  batches[0].reply({ index: 0, status: 200, data: data('first') }); batches[0].end();
  expect(await first).toEqual(data('first')); expect((await second).message).toContain('响应中断');
});
