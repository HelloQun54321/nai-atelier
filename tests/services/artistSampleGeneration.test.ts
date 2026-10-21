// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { getDefaultArtistSampleTemplate } from '../../services/artistSampleDrafts';

const mocks = vi.hoisted(() => ({ build: vi.fn(), begin: vi.fn(), data: vi.fn(), save: vi.fn(), supportsStream: true, publish: undefined as (() => void) | undefined }));
vi.mock('../../services/naiService', () => ({ buildGenerationJobDescriptor: mocks.build }));
vi.mock('../../services/generationSeries', () => ({ beginGenerationSeries: mocks.begin, subscribeGenerationSeries: (listener: () => void) => { mocks.publish = listener; return () => {}; } }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: mocks.data, saveArtistOwnSample: mocks.save }));
vi.mock('../../services/naiModels', async original => ({ ...await original<typeof import('../../services/naiModels')>(), getRuntimeNaiModelInfo: () => ({ supportsStreamedResponses: mocks.supportsStream }) }));
vi.mock('../../services/naiRuntime', () => ({ getNaiRuntimeConfig: async () => undefined }));

const item = (id = 'history-one', pack = 'v45') => ({ id, imageUrl: `/api/assets/${id}.png`, prompt: '1girl, artist:synthetic artist', negativePrompt: '', params: { ...getDefaultArtistSampleTemplate(pack as 'v45').params, seed: 123 }, createdAt: 100 });
const sample = (id = 'history-one', pack = 'v45', tag = 'synthetic artist') => ({ ...item(id, pack), id: `sample-${pack}-${id}`, tag, pack });
const session = (id = 'history-one', pack = 'v45') => ({ scope: '', key: 'synthetic-key', state: 'succeeded', historyIds: [id], lastSavedItem: item(id, pack) });
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.supportsStream = true; localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('nai_api_key', 'synthetic-key');
  mocks.build.mockImplementation(async input => ({ ...input, history: input.history }));
  mocks.begin.mockImplementation(() => ({ session: session(), settle: Promise.resolve({ success: true, outcome: 'succeeded' }) }));
  mocks.data.mockResolvedValue({ templates: {}, samples: [sample()] }); mocks.save.mockResolvedValue(undefined);
});

it.each(['v45', 'v5'] as const)('%s补图只提交单张，并按明确画师/版本marker核对后台归档，不主动上传', async pack => {
  const service = await import('../../services/artistSampleGeneration');
  mocks.begin.mockReturnValue({ session: session('history-one', pack), settle: Promise.resolve({ success: true }) });
  mocks.data.mockResolvedValue({ templates: {}, samples: [sample('history-one', pack)] });
  const template = getDefaultArtistSampleTemplate(pack);
  await service.beginArtistSampleGeneration('synthetic artist', pack, template, 'synthetic-key', 3, true);
  const input = mocks.build.mock.calls[0][0];
  expect(input).toMatchObject({ operation: 'text-to-image', prompt: expect.stringContaining('artist:synthetic artist'), approvedCost: 3, forceEmptySeed: false, params: { seed: 0 } });
  expect(input.history.sourceChainId).toBe(`artist-sample:${pack}:synthetic%20artist`);
  const marker = input.history.modules[0];
  expect(marker).toMatchObject({ name: '画师样张', isActive: false });
  expect(JSON.parse(marker.content)).toEqual({ id: marker.id.replace('artist-sample-target:', ''), tag: 'synthetic artist', pack });
  expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ count: 1, key: 'synthetic-key', agent: false }));
  expect(service.getArtistSampleGeneration('synthetic artist', pack)).toMatchObject({ phase: 'saved', sample: { id: `sample-${pack}-history-one` } });
  expect(mocks.save).not.toHaveBeenCalled(); expect(template.params.seed).toBe(0);
});

it('样张已归档时保留记账失败的具体原因，不重新编码或生成', async () => {
  const service = await import('../../services/artistSampleGeneration');
  mocks.begin.mockReturnValue({ session: { ...session(), accountingFailed: true, accountingError: '用量记录写入失败（HTTP 503）' }, settle: Promise.resolve({ success: true }) });
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'saved', error: expect.stringContaining('用量记录写入失败（HTTP 503）') });
  expect(mocks.begin).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
});

it('再次生成只令本次描述符使用新随机Seed，模板保持不变且直播关闭有效', async () => {
  const service = await import('../../services/artistSampleGeneration');
  const template = getDefaultArtistSampleTemplate('v45');
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', template, 'synthetic-key', 0, false, true);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ forceEmptySeed: true, stream: false, params: { ...template.params, seed: 0 } }));
  expect(template.params.seed).toBe(0);
});

it('真实模型不支持流式时仍生成最终图并完成样张核对，不伪造中间帧', async () => {
  const service = await import('../../services/artistSampleGeneration'); mocks.supportsStream = false;
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'saved', sample: { id: 'sample-v45-history-one' } });
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')?.preview).toBeUndefined();
});

it('无界面订阅仍完成归档核对；并行卡片/版本归属固定，拒绝同目标重复任务', async () => {
  const service = await import('../../services/artistSampleGeneration');
  let finish!: (value: unknown) => void;
  mocks.begin.mockReturnValueOnce({ session: session(), settle: new Promise(resolve => { finish = resolve; }) });
  const pending = service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  await vi.waitFor(() => expect(mocks.begin).toHaveBeenCalledOnce());
  const samplesBeforePreview = service.getGeneratedArtistSamples();
  mocks.publish?.();
  expect(service.getGeneratedArtistSamples()).toBe(samplesBeforePreview);
  await expect(service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true)).rejects.toThrow('已有图片');
  expect(service.getArtistSampleGeneration('other', 'v5')).toBeUndefined();
  finish({ success: true }); await pending;
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')?.phase).toBe('saved');
});

it('描述符异步准备后页面已离开，不再投递尚未提交的任务', async () => {
  const service = await import('../../services/artistSampleGeneration');
  let active = true;
  mocks.build.mockImplementationOnce(async () => { active = false; return {}; });
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true, false, () => active);
  expect(mocks.begin).not.toHaveBeenCalled(); expect(service.getArtistSampleGeneration('synthetic artist', 'v45')?.phase).toBe('cancelled');
});

it('准备期间Key变化不提交，取消/失败无真实历史时不尝试保存样张', async () => {
  const service = await import('../../services/artistSampleGeneration');
  mocks.build.mockImplementationOnce(async () => { sessionStorage.setItem('nai_api_key', 'changed'); return {}; });
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(mocks.begin).not.toHaveBeenCalled(); expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'failed', error: expect.stringContaining('Key 已变化') });
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  mocks.begin.mockReturnValue({ session: { historyIds: [] }, settle: Promise.resolve({ outcome: 'cancelled' }) });
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')?.phase).toBe('cancelled'); expect(mocks.data).not.toHaveBeenCalled();
});

it('历史保存失败仍保留已生成预览，不自动重生或伪造可入库历史', async () => {
  const service = await import('../../services/artistSampleGeneration');
  mocks.begin.mockReturnValue({ session: { historyIds: [], preview: { image: 'data:image/png;base64,c3ludGhldGlj' } }, settle: Promise.resolve({ outcome: 'failed', error: '历史保存失败' }) });
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'failed', preview: 'data:image/png;base64,c3ludGhldGlj', error: '历史保存失败' });
  expect(mocks.data).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.begin).toHaveBeenCalledOnce();
});

it.each(['missing', 'read-failed'])('后台归档%s保留真实历史，手动只重试入库且展示服务端真实资产URL', async failure => {
  const service = await import('../../services/artistSampleGeneration');
  if (failure === 'missing') mocks.data.mockResolvedValueOnce({ templates: {}, samples: [] }); else mocks.data.mockRejectedValueOnce(new Error('读取失败'));
  await service.beginArtistSampleGeneration('synthetic artist', 'v45', getDefaultArtistSampleTemplate('v45'), 'synthetic-key', 0, true);
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'save_failed', item: { id: 'history-one' }, target: { historyIds: ['history-one'] } });
  expect(mocks.save).not.toHaveBeenCalled();
  await service.retryArtistSampleSave('synthetic artist', 'v45');
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ tag: 'synthetic artist', pack: 'v45', historyIds: ['history-one'] }), expect.objectContaining({ id: 'history-one' }));
  expect(mocks.begin).toHaveBeenCalledOnce();
  expect(service.getArtistSampleGeneration('synthetic artist', 'v45')).toMatchObject({ phase: 'saved', sample: { imageUrl: '/api/assets/history-one.png' } });
});
