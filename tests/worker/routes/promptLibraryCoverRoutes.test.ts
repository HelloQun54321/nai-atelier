import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteR2: vi.fn(),
  bucketGet: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('../../../worker/routes/settingsRoutes', () => ({ deleteR2File: mocks.deleteR2 }));

const db = {
  prepare: mocks.prepare,
};

const context = (overrides: Record<string, unknown> = {}) => ({
  path: '/api/prompt-library-cover-data',
  method: 'GET',
  request: new Request('http://localhost/api/prompt-library-cover-data'),
  db,
  currentUser: { id: 'owner', role: 'owner', username: 'owner' },
  env: { BUCKET: { get: mocks.bucketGet } },
  ...overrides,
}) as any;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.bucketGet.mockResolvedValue({ key: 'history/cover.png' });
  mocks.deleteR2.mockResolvedValue(undefined);
});

it('GET 无配置时返回 null 模板，POST 保存后可再读出', async () => {
  const { handlePromptLibraryCoverRoute } = await import('../../../worker/routes/promptLibraryCoverRoutes');
  mocks.prepare.mockImplementation((sql: string) => {
    if (sql.includes('SELECT value FROM settings')) {
      return { bind: () => ({ first: async () => null }) };
    }
    return {
      bind: (...args: unknown[]) => ({
        run: async () => ({ success: true, args }),
        first: async () => null,
      }),
    };
  });
  const empty = await handlePromptLibraryCoverRoute(context());
  expect(empty).toBeTruthy();
  expect(await empty!.json()).toEqual({ template: null });

  const template = {
    prompt: 'quality, {content}',
    negativePrompt: 'bad',
    characterPrompt: '1girl',
    params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0 },
  };
  let saved = '';
  mocks.prepare.mockImplementation((sql: string) => {
    if (sql.includes('INSERT INTO settings')) {
      return {
        bind: (_key: string, value: string) => ({
          run: async () => { saved = value; return { success: true }; },
        }),
      };
    }
    if (sql.includes('SELECT value FROM settings')) {
      return { bind: () => ({ first: async () => saved ? { value: saved } : null }) };
    }
    return { bind: () => ({ run: async () => ({ success: true }), first: async () => null }) };
  });
  const post = await handlePromptLibraryCoverRoute(context({
    method: 'POST',
    request: new Request('http://localhost/api/prompt-library-cover-data', {
      method: 'POST', body: JSON.stringify({ action: 'template', template }),
    }),
  }));
  expect(post).toBeTruthy();
  expect(post!.status).toBe(200);
  const again = await handlePromptLibraryCoverRoute(context());
  expect(again).toBeTruthy();
  expect(await again!.json()).toEqual({ template });
});

it('历史落盘后按 marker 写回 chains.previewImage，并可 apply 重试', async () => {
  const { archivePromptLibraryCoverHistory, handlePromptLibraryCoverRoute } = await import('../../../worker/routes/promptLibraryCoverRoutes');
  const updates: unknown[] = [];
  mocks.prepare.mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM chains')) return { id: 'fragment-one', user_id: 'owner', preview_image: '/api/assets/old.png' };
        if (sql.includes('FROM local_generation_history')) {
          return {
            image_key: 'history/cover.png',
            modules: JSON.stringify([{ id: 'prompt-library-cover-target:fragment-one', name: '提示词库封面', content: JSON.stringify({ chainId: 'fragment-one' }), isActive: false }]),
            source_chain_id: 'prompt-library-cover:fragment-one',
            params: '{}',
          };
        }
        return null;
      },
      run: async () => { updates.push([sql, ...args]); return { success: true }; },
    }),
  }));
  await archivePromptLibraryCoverHistory(context(), {
    id: 'history-one',
    prompt: 'soft light',
    params: {},
    modules: [{ id: 'prompt-library-cover-target:fragment-one', name: '提示词库封面', content: JSON.stringify({ chainId: 'fragment-one' }), isActive: false }],
    sourceChainId: 'prompt-library-cover:fragment-one',
  } as any, 'history/cover.png');
  expect(updates.some(entry => Array.isArray(entry) && String(entry[0]).includes('UPDATE chains SET preview_image'))).toBe(true);
  expect(mocks.deleteR2).toHaveBeenCalled();

  const apply = await handlePromptLibraryCoverRoute(context({
    method: 'POST',
    request: new Request('http://localhost/api/prompt-library-cover-data', {
      method: 'POST', body: JSON.stringify({ action: 'apply', chainId: 'fragment-one', historyId: 'history-one' }),
    }),
  }));
  expect(apply).toBeTruthy();
  expect(await apply!.json()).toEqual({ previewImage: '/api/assets/history%2Fcover.png' });
});
