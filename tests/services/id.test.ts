// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createUuid } from '../../services/id';

afterEach(() => { vi.unstubAllGlobals(); });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

it('有 randomUUID 时优先使用原生实现', () => {
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
  expect(createUuid()).toBe('11111111-2222-4333-8444-555555555555');
});

it('缺少 randomUUID 时用 getRandomValues 生成合法 v4，且连续调用不重复', () => {
  let seed = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed++ + i * 17) & 0xff;
      return bytes;
    },
  });
  const a = createUuid();
  const b = createUuid();
  expect(a).toMatch(UUID_V4);
  expect(b).toMatch(UUID_V4);
  expect(a).not.toBe(b);
});

it('完全没有 Web Crypto 时仍返回合法 v4 形态且不抛错', () => {
  vi.stubGlobal('crypto', undefined);
  const a = createUuid();
  const b = createUuid();
  expect(a).toMatch(UUID_V4);
  expect(b).toMatch(UUID_V4);
  expect(a).not.toBe(b);
});
