import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptAgentInjectionItem, promptAgentService } from './promptAgent';

/** 破限提示词与预设实验室服务客户端行为测试（fetch-stub）。 */

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

  it('PUT creative-presets/active 支持设默认与清空（id: null）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [], activeCreativePresetId: undefined })));
    await promptAgentService.setActiveCreativePreset(null);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ id: null });
  });

  it('GET detail 通过 ?detail=1 返回修订列表', async () => {
    const detail = { ...samplePreset, revisions: [{ presetId: 'preset-a', presetName: '破限示例', revisionHash: 'abc', version: 1, createdAt: 3, slots: samplePreset.slots }] };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(detail)));
    const result = await promptAgentService.getCreativePresetDetail('preset-a');
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/preset-a?detail=1');
    expect(result.revisions[0].version).toBe(1);
  });

  it('export ids 单次 encode：内部逗号转 %2C，分隔逗号为裸逗号，可无损切分', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ schema: 'creative-presets', version: 1, exportedAt: 4, presets: [samplePreset] })));
    const ids = ['a b', 'c,d'];
    await promptAgentService.exportCreativePresets(ids);
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // fetch 层会把 URL 规整（%2C→,），故对最终 query 断言“还原后可无损切分出两个原始 id”。
    const raw = url.slice(url.indexOf('ids=') + 4);
    expect(raw.split(',').map((segment: string) => decodeURIComponent(segment))).toEqual(['a b', 'c,d']);
    // 服务端同一切分逻辑可无损还原：这保证后端按裸逗号切分后逐段 decode 的契约成立。
    expect(raw.split(',').map((segment: string) => decodeURIComponent(segment)).join('|')).toBe('a b|c,d');
  });

  it('import 透传 schema/version/presets 并返回 imported/skipped', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, imported: 1, skipped: ['x'], activeCreativePresetId: 'preset-a' })));
    const result = await promptAgentService.importCreativePresets({ schema: 'creative-presets', version: 1, presets: [samplePreset] });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ schema: 'creative-presets', version: 1 });
    expect(result).toEqual({ ok: true, imported: 1, skipped: ['x'], activeCreativePresetId: 'preset-a' });
  });

  it('inspect POST 携带 draft/message/presetId 并回传完整规范化结构', async () => {
    const inspectResult = {
      ok: true,
      systemPrompt: 'system…',
      canonicalMessages: [{ role: 'user' as const, content: 'hi' }],
      sourceSegments: [{ label: 'context_head', target: 'context_head' as const, presetName: '破限示例', characterCount: 2 }],
      tokenEstimate: { policyTokens: 1, draftTokens: 2, historyTokens: 3, presetTokens: 4, totalTokens: 10, contextWindow: 128000, contextDepth: 2, projectedBuffer: 100 },
      warnings: [],
      hashes: { presetRevisionHash: 'abc' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(inspectResult)));
    const result = await promptAgentService.inspectCreativeContext({ presetId: 'preset-a', draft: { basePrompt: '', subjectPrompt: '', negativePrompt: '', modules: [], params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' } }, message: '测试' });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/prompt-agent/creative-presets/inspect');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ presetId: 'preset-a', message: '测试' });
    expect(result.systemPrompt).toBe('system…');
    expect(result.canonicalMessages).toHaveLength(1);
    expect(result.sourceSegments?.[0].target).toBe('context_head');
    expect(result.tokenEstimate?.totalTokens).toBe(10);
    expect(result.hashes?.presetRevisionHash).toBe('abc');
  });

  it('非 2xx 响应抛错（沿用 parseErrorResponse 约定）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '服务端拒绝' }, 400)));
    await expect(promptAgentService.getCreativePresets()).rejects.toThrow(/服务端拒绝/);
  });
});
