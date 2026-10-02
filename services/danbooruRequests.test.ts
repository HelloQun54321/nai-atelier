import { afterEach, expect, it, vi } from 'vitest';
import { createDanbooruRequestPool } from './danbooruRequests';
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

it('同查询单飞，一方取消不影响其他使用者，成功后复用到期缓存', async () => {
  vi.useFakeTimers();
  const request = createDanbooruRequestPool<number>();
  const pending = deferred<number>(); const load = vi.fn((_signal: AbortSignal) => pending.promise);
  const a = new AbortController(); const b = new AbortController();
  const first = request('same', load, 1000, a.signal); const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = request('same', load, 1000, b.signal);
  await Promise.resolve(); a.abort(); await rejected;
  expect(load.mock.calls[0][0].aborted).toBe(false);
  pending.resolve(7); expect(await second).toBe(7);
  expect(await request('same', load, 1000)).toBe(7); expect(load).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1001); await request('same', load, 1000); expect(load).toHaveBeenCalledTimes(2);
});

it('最后一方离开中止底层，迟到结果不缓存，新请求仍可成功', async () => {
  const request = createDanbooruRequestPool<number>(); const old = deferred<number>(); const controller = new AbortController();
  let underlying!: AbortSignal;
  const first = request('same', signal => { underlying = signal; return old.promise; }, 1000, controller.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); controller.abort(); await rejected; expect(underlying.aborted).toBe(true);
  expect(await request('same', async () => 2, 1000)).toBe(2);
  old.resolve(1); await Promise.resolve();
  expect(await request('same', async () => 3, 1000)).toBe(2);
});

it('失败不缓存，LRU 和体积上限有效，零 TTL 不固定随机结果', async () => {
  const request = createDanbooruRequestPool<string>(2, 100);
  await expect(request('failed', async () => { throw Error('offline'); }, 1000)).rejects.toThrow('offline');
  expect(await request('failed', async () => 'ok', 1000)).toBe('ok');
  await request('b', async () => 'b', 1000); await request('failed', async () => 'wrong', 1000);
  await request('c', async () => 'c', 1000);
  expect(await request('b', async () => 'new', 1000)).toBe('new');
  const large = vi.fn(async () => 'x'.repeat(100)); await request('large', large, 1000); await request('large', large, 1000);
  expect(large).toHaveBeenCalledTimes(2);
  expect(await request('random', async () => 'one', 0)).toBe('one');
  expect(await request('random', async () => 'two', 0)).toBe('two');
});

it('空结果采用较短 TTL', async () => {
  vi.useFakeTimers(); const request = createDanbooruRequestPool<number[]>(); const load = vi.fn(async () => [] as number[]);
  await request('empty', load, value => value.length ? 1000 : 10);
  vi.advanceTimersByTime(11); await request('empty', load, 1000); expect(load).toHaveBeenCalledTimes(2);
});
