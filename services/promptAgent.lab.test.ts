import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptAgentCreativeInspectResult, PromptAgentInjectionItem, formatModelOptionTitle, promptAgentService } from './promptAgent';

/** 破限提示词与预设实验室服务客户端行为测试（fetch-stub）。 */

it('同名模型展示时标注服务来源', () => {
  const models = [
    { id: 'deepseek-v4-flash', provider: 'deepseek', providerName: 'DeepSeek' },
    { id: 'deepseek/deepseek-v4-flash', provider: 'custom-1', providerName: 'command-goat' },
  ];
  expect(formatModelOptionTitle(models[0], models)).toBe('deepseek-v4-flash (DeepSeek)');
  expect(formatModelOptionTitle(models[1], models)).toBe('deepseek-v4-flash (command-goat)');
});

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const samplePreset = {
  id: 'preset-a',
  name: '破限示例',
  description: '演示',
  isBuiltin: false,
  createdAt: 1,
  updatedAt: 2,
  slots: [
    { id: 's1', name: 'head-u', target: 'context_head', enabled: true, content: 'hi', role: 'user', pairId: 'p1' },
    { id: 's2', name: 'head-a', target: 'context_head', enabled: true, content: 'yo', role: 'assistant', pairId: 'p1' },
    { id: 's3', name: '深度', target: 'context_depth', enabled: true, content: '', depth: 2 },
  ] satisfies PromptAgentInjectionItem[],
};

describe('promptAgentService creative-presets lab client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET creative-presets 返回 { items, activeCreativePresetId, warnings }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [samplePreset], activeCreativePresetId: 'preset-a', warnings: ['提示'] })));
    const state = await promptAgentService.getCreativePresets();
    expect(fetch).toHaveBeenCalledWith('/api/prompt-agent/creative-presets', { cache: 'no-store' });
    expect(state.items[0].slots).toHaveLength(3);
    expect(state.activeCreativePresetId).toBe('preset-a');
    expect(state.warnings).toEqual(['提示']);
  });

  it('POST creative-presets 用 name/slots/description/forkFromId 创建', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(samplePreset)));
    const created = await promptAgentService.createCreativePreset({ name: '副本', description: 'd', forkFromId: 'x', slots: samplePreset.slots });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: '副本', description: 'd', forkFromId: 'x', slots: samplePreset.slots });
    expect(created.id).toBe('preset-a');
  });

  it('PUT creative-presets/:id 更新 name/slots/description', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...samplePreset, name: '改名' })));
    const updated = await promptAgentService.updateCreativePreset('preset-a', { name: '改名', description: 'd2', slots: samplePreset.slots });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/preset-a');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toMatchObject({ name: '改名', description: 'd2' });
    expect(updated.name).toBe('改名');
  });

  it('DELETE creative-presets/:id 返回 ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));
    const result = await promptAgentService.deleteCreativePreset('preset-a');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/preset-a');
    expect(init.method).toBe('DELETE');
    expect(result).toEqual({ ok: true });
  });

  it('PUT creative-presets/active 支持设默认/正常激活（非 null）与清空（id: null）', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({ items: [samplePreset], activeCreativePresetId: 'preset-a' }));
    vi.stubGlobal('fetch', mockFetch);

    // 正常激活非 null 分支
    const activated = await promptAgentService.setActiveCreativePreset('preset-a');
    expect(mockFetch).toHaveBeenCalledWith('/api/prompt-agent/creative-presets/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'preset-a' }),
    });
    expect(activated.activeCreativePresetId).toBe('preset-a');

    // 清空分支（id: null）
    mockFetch.mockResolvedValueOnce(jsonResponse({ items: [], activeCreativePresetId: undefined }));
    const cleared = await promptAgentService.setActiveCreativePreset(null);
    expect(mockFetch).toHaveBeenLastCalledWith('/api/prompt-agent/creative-presets/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: null }),
    });
    expect(cleared.activeCreativePresetId).toBeUndefined();
  });

  it('特殊字符 presetId（含 /、空格、中文）在 update/delete/detail 路径中正确 encodeURIComponent 转义', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', mockFetch);
    const specialId = '测试 预设/sub:id';
    const encoded = encodeURIComponent(specialId);

    await promptAgentService.updateCreativePreset(specialId, { name: '更新名' });
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/prompt-agent/creative-presets/${encoded}`,
      expect.objectContaining({ method: 'PUT' }),
    );

    await promptAgentService.deleteCreativePreset(specialId);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/prompt-agent/creative-presets/${encoded}`,
      expect.objectContaining({ method: 'DELETE' }),
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({ ...samplePreset, id: specialId, revisions: [] }));
    await promptAgentService.getCreativePresetDetail(specialId);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/prompt-agent/creative-presets/${encoded}?detail=1`,
      { cache: 'no-store' },
    );
  });

  it('GET detail 通过 ?detail=1 返回修订列表', async () => {
    const detail = { ...samplePreset, revisions: [{ presetId: 'preset-a', presetName: '破限示例', revisionHash: 'abc', version: 1, createdAt: 3, slots: samplePreset.slots }] };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(detail)));
    const result = await promptAgentService.getCreativePresetDetail('preset-a');
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/preset-a?detail=1');
    expect(result.revisions[0].version).toBe(1);
  });

  it('exportCreativePresets 采用标准多值 query（ids=a&ids=b），支持含逗号/空格/中文 id，真实 searchParams 解析无损', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({ schema: 'creative-presets', version: 1, exportedAt: 4, presets: [samplePreset] }));
    vi.stubGlobal('fetch', mockFetch);
    const ids = ['a b', 'c,d', '预设,中文/1'];
    await promptAgentService.exportCreativePresets(ids);
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit?];
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/prompt-agent/creative-presets/export');
    expect(parsed.searchParams.getAll('ids')).toEqual(ids);
  });

  it('exportCreativePresets([]) 空数组时省略 query，全量导出', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({ schema: 'creative-presets', version: 1, exportedAt: 4, presets: [samplePreset] }));
    vi.stubGlobal('fetch', mockFetch);
    await promptAgentService.exportCreativePresets([]);
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit?];
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/prompt-agent/creative-presets/export');
    expect(parsed.search).toBe('');
    expect(parsed.searchParams.getAll('ids')).toEqual([]);
  });

  it('import 透传 schema/version/presets 并返回 imported/skipped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, imported: 1, skipped: ['x'], activeCreativePresetId: 'preset-a' })));
    const result = await promptAgentService.importCreativePresets({ schema: 'creative-presets', version: 1, presets: [samplePreset] });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ schema: 'creative-presets', version: 1 });
    expect(result).toEqual({ ok: true, imported: 1, skipped: ['x'], activeCreativePresetId: 'preset-a' });
  });

  it('inspect POST 携带 draft/message/presetId 并回传完整规范化结构（含字符串与对象数组 content、injected 及 budget）', async () => {
    const inspectResult: PromptAgentCreativeInspectResult = {
      ok: true,
      systemPrompt: 'system…',
      canonicalMessages: [
        { role: 'user', content: 'hi' },
        { role: 'user', content: [{ type: 'text', text: 'tail-part' }], injected: true },
        { role: 'assistant', content: [{ type: 'text', text: 'prefill-part' }, { type: 'custom', extra: 1 }], injected: true },
      ],
      sourceSegments: [{ label: 'context_head', target: 'context_head', presetName: '破限示例', characterCount: 2 }],
      tokenEstimate: { policyTokens: 1, draftTokens: 2, historyTokens: 3, presetTokens: 4, totalTokens: 10, contextWindow: 128000, contextDepth: 2, projectedBuffer: 100 },
      warnings: [],
      hashes: { presetRevisionHash: 'abc' },
      budget: {
        contextWindow: 128000,
        outputReserve: 16384,
        protocolReserve: 2048,
        conversationTokenBudget: 100000,
        storedConversation: [
          { role: 'user', content: 'hi' },
          { role: 'user', content: [{ type: 'text', text: 'tail-part' }], injected: true },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(inspectResult)));
    const result = await promptAgentService.inspectCreativeContext({ presetId: 'preset-a', draft: { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' } }, message: '测试' });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/inspect');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ presetId: 'preset-a', message: '测试' });
    expect(result.systemPrompt).toBe('system…');
    expect(result.canonicalMessages).toHaveLength(3);
    expect(result.canonicalMessages?.[0].content).toBe('hi');
    expect(result.canonicalMessages?.[1].injected).toBe(true);
    expect(Array.isArray(result.canonicalMessages?.[1].content)).toBe(true);
    expect(result.canonicalMessages?.[2].injected).toBe(true);
    expect(result.sourceSegments?.[0].target).toBe('context_head');
    expect(result.tokenEstimate?.totalTokens).toBe(10);
    expect(result.hashes?.presetRevisionHash).toBe('abc');
    expect(result.budget).toBeDefined();
    expect(result.budget?.contextWindow).toBe(128000);
    expect(result.budget?.outputReserve).toBe(16384);
    expect(result.budget?.protocolReserve).toBe(2048);
    expect(result.budget?.conversationTokenBudget).toBe(100000);
    expect(result.budget?.storedConversation).toHaveLength(2);
  });

  it('非 2xx 响应抛错（沿用 parseErrorResponse 约定）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '服务端拒绝' }, 400)));
    await expect(promptAgentService.getCreativePresets()).rejects.toThrow(/服务端拒绝/);
  });
});
