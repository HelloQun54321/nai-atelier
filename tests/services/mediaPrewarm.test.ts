import { afterEach, expect, it, vi } from 'vitest';
import { createMediaPrewarmSession } from '../../services/mediaPrewarm';
afterEach(() => vi.unstubAllGlobals());
it('预热跟随尺寸、去重来源；取消后新代任务独立，其他窗口所有者不同', () => {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response('{}')); vi.stubGlobal('fetch', fetcher);
  const first = createMediaPrewarmSession(); const second = createMediaPrewarmSession();
  first.enqueue(['a', '', 'a', 'b'], 'thumb-640', true); first.cancel(); first.enqueue(['c'], 'thumb-960');
  second.enqueue(['a'], 'thumb-320');
  const bodies = fetcher.mock.calls.map(call => JSON.parse(String(call[1].body)));
  expect(bodies[0]).toMatchObject({ sources: ['a', 'b'], variant: 'thumb-640', pin: true, generation: 1, priority: 2 });
  expect(bodies[1]).toEqual({ cancel: true, owner: bodies[0].owner, generation: 1 });
  expect(bodies[2]).toMatchObject({ owner: bodies[0].owner, generation: 2, variant: 'thumb-960' });
  expect(bodies[3].owner).not.toBe(bodies[0].owner);
});
