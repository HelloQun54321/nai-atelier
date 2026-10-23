// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import type { RollExperiment, RollRules } from '../../services/styleRoll';
import type { PromptChain } from '../../types';
import { StyleRollPage } from '../../components/StyleRollPage';
import { executeAgentCommand, getAgentCommands } from '../../services/agentCommands';
import { setLanguage } from '../../services/i18n';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), history: vi.fn(), dictionary: vi.fn(), generate: vi.fn(), confirm: vi.fn(), upload: vi.fn(), stop: vi.fn(), approve: vi.fn(), pause: vi.fn(), session: null as any, setupRules: null as RollRules | null, key: 'synthetic-key', cost: 0, mobile: false }));
vi.mock('../../services/artistSamples', () => ({ getArtistSampleDictionary: mocks.dictionary, normalizeArtistSampleTag: (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s+/g, ' ').toLowerCase() }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), searchArtistDictionary: async () => [] }));
const sampleUrls = new Map<string, string>();
vi.mock('../../services/artistSampleUrls', () => ({ loadArtistSampleUrls: async () => sampleUrls }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => preferredItems, subscribeCollection: () => () => {}, ensureCollection: async () => {}, toggleArtistPreference: vi.fn() }));
vi.mock('../../services/artistSampleDrafts', () => ({ getSampledArtistTags: async () => new Set(['alpha']) }));
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollExperiments: mocks.load, saveRollExperiment: mocks.save, loadRollHistory: mocks.history, loadRollBlocklist: async () => [], saveRollBlocklist: async (tags: string[]) => tags }));
vi.mock('../../services/styleRollGeneration', () => ({ beginRollGeneration: mocks.generate, readRollApiKey: () => mocks.key }));
vi.mock('../../services/localHistory', () => ({ localHistory: { subscribe: () => () => {} } }));
vi.mock('../../services/generationSeries', () => ({ getGenerationSeriesSession: () => mocks.session, subscribeGenerationSeries: () => () => {}, stopGenerationSeriesSession: mocks.stop, approveGenerationSeries: mocks.approve }));
vi.mock('../../services/generationTask', () => ({ setGenerationQueuePaused: mocks.pause }));
vi.mock('../../services/naiRuntime', async original => { const actual = await original<typeof import('../../services/naiRuntime')>(); return { ...actual, useNaiRuntime: () => actual.DEFAULT_NAI_RUNTIME }; });
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ info: { tier: 3 }, refreshIfStale: vi.fn() }), isActiveOpusSubscription: () => true }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 100 }), applyEstimatorRuntime: () => {}, estimateV45GenerationCost: () => mocks.cost, formatGenerationCostLabel: (cost: number) => cost > 0 ? `${cost} Anlas` : '免费' }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { uploadFile: mocks.upload } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/ImageShareActions', () => ({ ImageShareActions: () => null, IMAGE_CARD_ACTION_CLASS: 'image-action' }));
vi.mock('../../components/ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className, previewTransform, containerClassName }: any) => <img src={src} alt={alt} className={className} data-preview-transform={previewTransform} data-container-class={containerClassName} />, OriginalImage: (props: any) => <img {...props} /> }));
vi.mock('../../components/roll/StyleRollSetup', () => ({ StyleRollSetup: ({ initial, onSave, onClose }: any) => <div role="dialog" data-pinned={(initial.pinnedArtists ?? []).join(',')}><button onClick={async () => { await onSave({ ...initial, rules: mocks.setupRules || initial.rules }); onClose(); }}>保存合成实验</button></div> }));
vi.mock('../../components/roll/StyleRollChainSeedDialog', () => ({ StyleRollChainSeedDialog: ({ chains, createOptions, onClose }: any) => <div role="dialog" aria-label="从风格串开始"><button onClick={async () => { await createOptions(chains[0]); onClose(); }}>合成从风格串新建</button></div> }));

const preferredItems: any[] = [];
let experiment: RollExperiment;
const rows = (e: RollExperiment) => e.candidates.map(candidate => rollImageFixture(e, candidate));
beforeEach(() => {
  sampleUrls.clear();
  preferredItems.length = 0; vi.clearAllMocks(); mocks.cost = 0; mocks.mobile = false; mocks.session = null; mocks.setupRules = null; mocks.key = 'synthetic-key'; localStorage.clear(); sessionStorage.clear();
  experiment = rollFixture(); experiment.candidates = [candidateFixture('a', 'alpha'), candidateFixture('b', 'beta')];
  mocks.dictionary.mockResolvedValue(experiment.artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 })));
  mocks.load.mockImplementation(async () => [structuredClone(experiment)]);
  mocks.save.mockImplementation(async value => ({ ...structuredClone(value), revision: value.revision + 1 }));
  mocks.history.mockResolvedValue(rows(experiment)); mocks.confirm.mockResolvedValue(true);
  mocks.generate.mockResolvedValue({ session: {}, settle: Promise.resolve({ success: true }) });
  mocks.upload.mockResolvedValue({ url: '/api/assets/covers/synthetic.png' });
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: mocks.mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe(target: Element) { this.callback([{ target, contentRect: { width: 1024 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic-image'], { type: 'image/png' }) })));
});
afterEach(() => { cleanup(); setLanguage('zh-CN'); vi.unstubAllGlobals(); });
const setup = async (options = {}) => {
  const onSaveChain = vi.fn(async chain => ({ ...chain, id: 'saved-chain' })), onNavigateToPlayground = vi.fn();
  const props = { active: true, chains: [], enforceFreeStepLimit: true, generationStreamPreview: true, notify: vi.fn(), onSaveChain, onNavigateToPlayground, onOpenChain: vi.fn(), ...options };
  const view = render(<StyleRollPage {...props} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '切换画风记录' })?.getAttribute('disabled')).toBeNull());
  if (experiment.candidates.length) await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  return { ...view, props };
};
const filterBy = (name: string) => { fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.click(screen.getByRole('button', { name })); };
const pending = () => filterBy('待生成');
const configure = (name: string, value: string) => { fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); for (const label of name === '每串总人数' ? ['最少画师人数', '最多画师人数'] : [name]) fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value } }); fireEvent.keyDown(window, { key: 'Escape' }); };
const openArtists = () => { fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ })); };
const reloadRecords = () => { fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '重新加载画风记录' })); };
const details = () => fireEvent.click(screen.getByText('更多操作', { exact: true }));

it('画师库的全局屏蔽变更即时同步 Roll，解除该画师锁定并排除下一轮', async () => {
  experiment.candidates = []; experiment.pinnedArtists = ['alpha']; experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  const { container } = await setup();
  act(() => window.dispatchEvent(new CustomEvent('nai-roll-blocklist-changed', { detail: ['alpha'] })));
  openArtists();
  expect(screen.getByRole('button', { name: '取消屏蔽画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 1, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0] as RollExperiment;
  expect(saved.candidates.at(-1)!.tags.every(artist => artist.tag !== 'alpha')).toBe(true);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('向助手登记读取、发起、补齐与保存 Roll 候选的命令', async () => {
  const { container } = await setup();
  const names = getAgentCommands(container).map(command => command.name);
  expect(names).toEqual(expect.arrayContaining(['get_roll_state', 'run_roll_round', 'generate_roll_pending', 'save_roll_candidate']));
  const state = await executeAgentCommand(container, 'get_roll_state', {}, true) as { experiment: { id: string }; candidates: unknown[] };
  expect(state.experiment.id).toBe(experiment.id);
  expect(state.candidates.length).toBeGreaterThan(0);
});

it('助手发起 Roll 时保存候选；generate=false 不投递收费生成', async () => {
  const { container } = await setup();
  const before = mocks.save.mock.calls.length;
  const result = await executeAgentCommand(container, 'run_roll_round', { count: 1, generate: false }, false) as { candidateIds: string[]; generationStarted: boolean };
  expect(result.candidateIds).toHaveLength(1);
  expect(result.generationStarted).toBe(false);
  expect(mocks.save.mock.calls.length).toBeGreaterThan(before);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('手机390px工具栏可横向滚动，主操作固定在滚动区外并保持触控尺寸，菜单通过Portal显示且预览不单独放大', async () => {
  mocks.mobile = true; vi.stubGlobal('innerWidth', 390);
  const { container } = await setup();
  const scroller = container.querySelector<HTMLElement>('[data-roll-toolbar-scroll]')!;
  expect(scroller.classList.contains('min-w-0')).toBe(true);
  expect(scroller.classList.contains('overflow-x-auto')).toBe(true);
  expect(scroller.closest('header')).toBeTruthy();
  const roll = screen.getByRole('button', { name: '再 Roll 一轮' });
  const settings = screen.getByRole('button', { name: '本轮设置' });
  expect(scroller.contains(roll)).toBe(false); expect(scroller.contains(settings)).toBe(false);
  expect(scroller.closest('header')!.contains(roll)).toBe(true); expect(scroller.closest('header')!.contains(settings)).toBe(true);
  expect(roll.classList.contains('h-10')).toBe(true);
  expect(roll.className).not.toContain('!h-7');
  const preview = screen.getByAltText('候选 1');
  expect(preview.classList.contains('object-contain')).toBe(true);
  expect(preview.className).not.toMatch(/(?:group-hover:|hover:)scale/);
  fireEvent.click(settings);
  const menu = screen.getByRole('dialog', { name: '本轮设置' });
  expect(scroller.contains(menu)).toBe(false);
  expect(menu.closest('[data-roll-page]')).toBeNull();
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '0.7');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '1.4');
});

it('首次使用直接设置人数、张数和权重范围开始一轮，无需先建实验；多配方一次提交', async () => {
  experiment.candidates = []; experiment.artists = []; mocks.load.mockResolvedValue([]);
  const names = Array.from({ length: 1205 }, (_, index) => `catalog-${index}`); mocks.dictionary.mockResolvedValue(names.map(name => ({ name, chinese: '', postCount: 1 })));
  await setup(); configure('每串总人数', '4');
  configure('本轮生成张数', '3');
  configure('最低权重', '1.8'); configure('最高权重', '2.2');
  fireEvent.click(screen.getAllByRole('button', { name: '开始 Roll' })[0]); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [saved, candidates] = mocks.generate.mock.calls[0]; expect(saved.artists).toEqual([]); expect(candidates).toHaveLength(3);
  expect(candidates.every((candidate: any) => candidate.tags.length === 4 && candidate.tags.every((tag: any) => names.includes(tag.tag)))).toBe(true);
  expect(saved.rules).toMatchObject({ minWeight: 1.8, maxWeight: 2.2 });
  expect(candidates.every((candidate: any) => candidate.tags.every((tag: any) => tag.weight >= 1.8 && tag.weight <= 2.2))).toBe(true);
  expect(saved.rounds[0].candidateIds).toHaveLength(3);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByAltText('左侧候选')).toBeNull(); expect(screen.queryByRole('list', { name: '画风探索进度' })).toBeNull();
});
it('权重范围随记录切换并在重新进入后恢复，新范围只作用于新候选', async () => {
  experiment.rules = { ...experiment.rules, minWeight: 0.2, maxWeight: 0.5 };
  const other = { ...structuredClone(experiment), id: 'other-record', name: '另一记录', rules: { ...experiment.rules, minWeight: 2, maxWeight: 2.4 } };
  mocks.load.mockResolvedValue([experiment, other]);
  const view = await setup();
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '0.2');
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.change(screen.getByRole('combobox', { name: '切换画风记录' }), { target: { value: other.id } });
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '2');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '2.4');
  fireEvent.keyDown(window, { key: 'Escape' });
  configure('最低权重', '1.7'); configure('最高权重', '1.9');
  await waitFor(() => expect(screen.getByRole('button', { name: '再 Roll 一轮' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const saved = mocks.generate.mock.calls[0][0];
  expect(saved.candidates.slice(0, 2)).toEqual(other.candidates);
  expect(saved.rules).toMatchObject({ minWeight: 1.7, maxWeight: 1.9 });
  view.unmount(); mocks.load.mockResolvedValue([saved]); await setup();
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '1.7');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '1.9');
});
it('本轮设置与完整配置双向同步人数和权重范围，保存配置不会自动出图', async () => {
  await setup(); configure('每串总人数', '5'); configure('最低权重', '0.4'); configure('最高权重', '0.6');
  const openSetup = () => { fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' })); };
  openSetup(); fireEvent.click(screen.getByRole('button', { name: '保存合成实验' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].rules).toEqual({ minArtists: 5, maxArtists: 5, minWeight: 0.4, maxWeight: 0.6 });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  mocks.setupRules = { minArtists: 6, maxArtists: 6, minWeight: 0.2, maxWeight: 0.3 };
  openSetup(); fireEvent.click(screen.getByRole('button', { name: '保存合成实验' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.getByRole('spinbutton', { name: '最多画师人数' })).toHaveProperty('value', '6');
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '0.2');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '0.3');
  expect(mocks.generate).not.toHaveBeenCalled();
});
it.each([['', '1.4'], ['1.5', '1.4'], ['0.7', '3.1'], ['0.75', '1.4']])('无效权重范围 %s～%s 不保存、不提交出图', async (min, max) => {
  await setup(); configure('最低权重', min); configure('最高权重', max);
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('请检查画师数量和权重范围'));
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});
it('整轮按总费用确认，拒绝不提交，随后仅生成本轮原配方而不重新Roll', async () => {
  mocks.cost = 7; await setup(); configure('本轮生成张数', '2');
  mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce()); expect(mocks.confirm.mock.calls[0][0].message).toContain('预计共消耗 14 Anlas'); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: '补齐剩余 2 张' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1]).toHaveLength(2); expect(mocks.save).toHaveBeenCalledOnce();
});
it('普通轮次第六张失败后仅手动补缺图，保留五张成品，不显示无效刷新操作', async () => {
  experiment.candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => candidateFixture(id));
  experiment.rounds = [{ id: 'partial-round', candidateIds: ['a', 'b', 'c', 'd', 'e', 'f'], createdAt: 1 }];
  const before = structuredClone(experiment);
  mocks.history.mockResolvedValue(rows(experiment).slice(0, 5));
  mocks.generate.mockResolvedValueOnce({ session: {}, settle: Promise.resolve({ success: false, outcome: 'failed', error: '<!DOCTYPE html><html><title>502 Bad Gateway</title><body>synthetic-ray</body></html>' }) });
  await setup(); expect(screen.getByText('本轮已出图 5/6')).toBeTruthy(); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('服务返回了错误页面，请稍后重试'); expect(alert.textContent).not.toMatch(/DOCTYPE|synthetic-ray|<html/);
  expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.generate.mock.calls[0][0]).toEqual(before);
  expect(mocks.generate.mock.calls[0][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.generate).toHaveBeenCalledOnce();
  mocks.generate.mockImplementationOnce(async () => { mocks.history.mockResolvedValue(rows(experiment)); return { session: {}, settle: Promise.resolve({ success: true }) }; });
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '补齐剩余 1 张' })).toBeNull());
  expect(mocks.generate).toHaveBeenCalledTimes(2); expect(mocks.generate.mock.calls[1][0]).toEqual(before);
  expect(mocks.generate.mock.calls[1][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
});
it('Roll 成图记账异常仍显示已保存结果与结算原因，不自动补图', async () => {
  experiment.candidates = [candidateFixture('a', 'alpha')];
  experiment.rounds = [{ id: 'accounting-round', candidateIds: ['a'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  const saved = rollImageFixture(experiment, experiment.candidates[0]);
  mocks.generate.mockImplementationOnce(async () => {
    mocks.history.mockResolvedValue([saved]);
    return { session: { accountingFailed: true, accountingError: '本地用量结算失败（HTTP 503）', lastSavedItem: saved }, settle: Promise.resolve({ success: true }) };
  });
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  expect((await screen.findByRole('alert')).textContent).toContain('图片已保存，但本地记账异常，请核对额度后再继续：本地用量结算失败（HTTP 503）');
  await waitFor(() => expect(screen.queryByRole('button', { name: '补齐剩余 1 张' })).toBeNull());
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.upload).not.toHaveBeenCalled();
});
it('保存轮次冲突不提交生图，保留现有图片和候选', async () => {
  await setup(); mocks.save.mockRejectedValueOnce(new Error('合成保存冲突'));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('合成保存冲突'));
  expect(mocks.generate).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('词库读取失败禁止抽取，重试后恢复；关闭连续生成不提交多张', async () => {
  mocks.dictionary.mockRejectedValueOnce(new Error('合成词库读取失败')); const view = await setup({ continuousGenerationEnabled: false });
  expect(await screen.findByText('合成词库读取失败')).toBeTruthy(); expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await waitFor(() => expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await screen.findByText('连续生成已关闭，请开启后生成本轮'); expect(mocks.generate).not.toHaveBeenCalled(); view.unmount();
});
it('重新加载期间不从旧版本提交，失败继续保留当前画风', async () => {
  await setup(); let reject!: (reason: Error) => void; mocks.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  reloadRecords(); expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('合成读取失败'))); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('连续生成关闭时仍可按一张开始一轮，不强制开启连续请求', async () => {
  await setup({ continuousGenerationEnabled: false }); configure('本轮生成张数', '1');
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1]).toEqual(expect.objectContaining({ id: expect.any(String), tags: expect.any(Array) }));
});
it('切换语言后单张费用同步翻译，固定参数生成入口保留', async () => {
  mocks.history.mockResolvedValue([]); await setup(); pending(); act(() => setLanguage('en'));
  fireEvent.click(screen.getByRole('button', { name: 'View candidate 1' })); expect(screen.getByRole('button', { name: 'Generate image · Free' })).toBeTruthy();
});
it.each([true, false])('后台费用上涨确认=%s，取消停止任务，授权按原Key补充', async approved => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 1 }, progress: { current: 1, total: 6 } };
  mocks.confirm.mockResolvedValueOnce(approved); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' }));
  await waitFor(() => expect(approved ? mocks.approve : mocks.stop).toHaveBeenCalledOnce());
  expect(mocks.confirm.mock.calls[0][0].message).toContain('剩余 5 张'); expect(mocks.confirm.mock.calls[0][0].message).toContain('共 45 Anlas');
  if (approved) expect(mocks.approve).toHaveBeenCalledWith(mocks.session, 9);
});
it('确认期间切Key不授权旧任务；暂停后只在主动继续时恢复', async () => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 0 }, progress: { current: 0, total: 6 } };
  mocks.confirm.mockImplementationOnce(async () => { mocks.key = 'another-key'; return true; }); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' })); await screen.findByRole('alert'); expect(mocks.approve).not.toHaveBeenCalled();
  cleanup(); mocks.key = 'synthetic-key'; mocks.session = { ...mocks.session, state: 'paused', awaiting: undefined }; await setup(); expect(mocks.pause).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续' })); await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith('synthetic-key', false));
});
it('画风库按范围浏览，待生成可筛选；全局选择聚焦和关闭详情仍有效', async () => {
  const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); expect(screen.getByRole('button', { name: '查看候选 2' }).className).toContain('brightness-[.7]');
  view.rerender(<StyleRollPage {...view.props} selectionFocusEnabled={false} />); expect(screen.getByRole('button', { name: '查看候选 2' }).className).not.toContain('brightness-[.7]');
  pending(); expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull();
});
it('手机详情置于工作区之外，返回保留画风库', async () => {
  mocks.mobile = true; await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); const dialog = await screen.findByRole('dialog', { name: '候选 1' }); expect(dialog.closest('[data-roll-page]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('历史读取失败阻止未知状态重复消费，任务保存回执仍保留', async () => {
  mocks.history.mockRejectedValue(new Error('合成历史读取失败')); await setup(); pending(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  expect(screen.getAllByText('历史暂不可用')).toHaveLength(2);
  expect((screen.getByRole('button', { name: /生成图片/ }) as HTMLButtonElement).disabled).toBe(true); expect(mocks.generate).not.toHaveBeenCalled();
});
it('存为风格串保留实际参数，关联失败后重试不重复创建链或封面', async () => {
  const item = rollImageFixture(experiment, experiment.candidates[0]); item.params.steps = 23; mocks.history.mockResolvedValue([item]); const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  mocks.save.mockRejectedValueOnce(new Error('合成保存失败')); fireEvent.click(screen.getByRole('button', { name: '存为风格串' })); await screen.findByRole('alert');
  expect(props.onSaveChain).toHaveBeenCalledWith(expect.objectContaining({ previewImage: '/api/assets/covers/synthetic.png', params: item.params }));
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(props.onSaveChain).toHaveBeenCalledOnce(); expect(mocks.upload).toHaveBeenCalledOnce();
});
it('实验室入口在详情直接可达，导入完整草稿而不生图', async () => {
  const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details(); fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
  expect(props.onNavigateToPlayground).toHaveBeenCalledOnce(); expect(JSON.parse(sessionStorage.getItem('nai_pending_import')!)).toEqual(expect.objectContaining({ fullMetadata: true, targetMode: 'text-to-image', params: experiment.template.params, importSeed: true })); expect(mocks.generate).not.toHaveBeenCalled();
});

it('卡片直接保存；下一轮重新从画师库随机抽取，不再继承已保存组合', async () => {
  const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '保存候选 1' }));
  await screen.findByLabelText('已保存候选 1');
  expect(props.onSaveChain).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.queryByAltText('左侧候选')).toBeNull();
  filterBy('已保存'); expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  configure('本轮生成张数', '4'); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce()); const [, candidates] = mocks.generate.mock.calls[0];
  expect(candidates).toHaveLength(4);
  expect(candidates.every((candidate: any) => !('parents' in candidate) && !('method' in candidate))).toBe(true);
  expect(new Set(candidates.map((candidate: any) => JSON.stringify(candidate.tags))).size).toBe(4); expect(screen.queryByAltText('左侧候选')).toBeNull();
});

it('未完成轮次可直接再Roll，保留已生成图片和原配方', async () => {
  experiment.rounds = [{ id: 'unfinished', candidateIds: ['a', 'b'], createdAt: 1 }];
  await setup(); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const e = mocks.generate.mock.calls[0][0]; expect(e.rounds[0].closedAt).toBeGreaterThan(0); expect(e.rounds.at(-1).candidateIds).toHaveLength(6); expect(e.candidates.slice(0, 2)).toEqual(experiment.candidates);
});
it('批量管理原位替换工具栏，按当前搜索全选，保存成功后退出仍能打开风格串', async () => {
  const { props } = await setup();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师、中文名或编号' }), { target: { value: 'alpha' } });
  expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  expect(screen.queryByRole('searchbox')).toBeNull(); expect(screen.queryByRole('button', { name: '再 Roll 一轮' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  expect(screen.getByRole('checkbox', { name: '选择候选 1' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByText('已选 0 个候选')).toBeTruthy());
  expect(mocks.save.mock.calls[0][0].candidates[0].savedChainId).toBe('saved-chain');
  expect(mocks.save.mock.calls[0][0].candidates[1].savedChainId).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '退出多选' })); expect(screen.getByRole('searchbox').getAttribute('value')).toBe('alpha');
});

it('批量保存逐项落盘，第二项关联失败保留选择，重试不重复保存封面和风格串', async () => {
  const { props } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  mocks.save.mockImplementationOnce(async value => ({ ...value, revision: value.revision + 1 })).mockRejectedValueOnce(new Error('第二项合成冲突'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByText('第二项合成冲突'); expect(screen.getByText('已选 1 个候选')).toBeTruthy();
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '保存所选' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByText('已选 0 个候选')).toBeTruthy());
});

it('单项与批量丢弃共用可恢复状态，不删除原图及保存的风格串', async () => {
  experiment.candidates[0].savedChainId = 'existing';
  await setup();
  const discard = screen.getByRole('button', { name: '丢弃候选 1' });
  const column = discard.parentElement!.parentElement!;
  expect(column.className).toContain('left-2.5'); expect(column.className).toContain('top-2.5');
  expect(column.textContent).toContain('#1'); expect(column.className).not.toContain('bottom-2.5');
  fireEvent.click(discard);
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull());
  expect(mocks.save.mock.calls[0][0].candidates[0]).toEqual({ ...experiment.candidates[0], archived: true });
  filterBy('回收站'); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '恢复所选' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1][0].candidates[0]).toEqual(experiment.candidates[0]); expect(mocks.generate).not.toHaveBeenCalled();
});

it('完整轮次不显示伪补图入口，旧轮缺图可按轮次查到并手选补齐', async () => {
  experiment.rounds = [{ id: 'old', candidateIds: ['a'], createdAt: 1, closedAt: 2 }, { id: 'new', candidateIds: ['b'], createdAt: 3 }];
  mocks.history.mockResolvedValue([rollImageFixture(experiment, experiment.candidates[1])]);
  await setup(); expect(screen.queryByRole('button', { name: /补齐剩余/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ })); fireEvent.change(screen.getByRole('combobox', { name: '查看轮次' }), { target: { value: 'old' } }); fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy(); expect(screen.queryByRole('button', { name: '查看候选 2' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce()); expect(mocks.generate.mock.calls[0][1].id).toBe('a');
  const saved = mocks.save.mock.calls[0][0]; expect(saved.rounds[1].closedAt).toBeGreaterThan(0); expect(saved.rounds[2].candidateIds).toEqual(['a']);
});

it('记录可重命名、移入与恢复回收站，全部收起后仍保留恢复入口', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '管理记录' }));
  fireEvent.change(screen.getByRole('textbox', { name: '记录名称' }), { target: { value: '新的画风记录' } }); fireEvent.submit(screen.getByRole('textbox', { name: '记录名称' }).closest('form')!);
  await screen.findByRole('option', { name: '新的画风记录' });
  fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '将记录移入回收站' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '管理记录' })); fireEvent.click(screen.getByRole('button', { name: '恢复记录：新的画风记录' }));
  await screen.findByRole('button', { name: '查看候选 1' }); expect(mocks.save.mock.calls.at(-1)![0].archived).toBe(false);
  expect(mocks.save.mock.calls.at(-1)![0].candidates).toEqual(experiment.candidates); expect(mocks.generate).not.toHaveBeenCalled();
});

it('本轮设置直接固定部分 Tag，总人数包含固定项且所有权重随机', async () => {
  await setup(); configure('每串总人数', '5'); configure('最低权重', '1.8'); configure('最高权重', '2.2');
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.queryByRole('button', { name: /全随机|固定权重|选择固定画师/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByText('手动添加固定 Tag'));
  fireEvent.change(screen.getByRole('textbox', { name: '固定画师 Tag（可选）' }), { target: { value: 'alpha, beta' } });
  fireEvent.click(screen.getByRole('button', { name: '添加到固定画师 Tag（可选）' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  configure('本轮生成张数', '1');
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [saved, candidate] = mocks.generate.mock.calls[0];
  expect(saved.pinnedArtists).toEqual(['alpha', 'beta']); expect(saved.drawPlan).toBeUndefined();
  expect(candidate.tags).toHaveLength(5);
  expect(candidate.tags.slice(0, 2).map((tag: any) => tag.tag)).toEqual(['alpha', 'beta']);
  expect(candidate.tags.every((tag: any) => tag.weight >= 1.8 && tag.weight <= 2.2)).toBe(true);
});

it('旧固定模式无需解除权重锁，助手沿用相同的总人数和固定 Tag', async () => {
  experiment.artists[0] = { ...experiment.artists[0], locked: true, weight: 3 };
  experiment.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] };
  experiment.rules = { ...experiment.rules, minArtists: 2, maxArtists: 5 };
  const { container } = await setup();
  const state = await executeAgentCommand(container, 'get_roll_state', {}, true) as any;
  expect(state.rules).toMatchObject({ minArtists: 2, maxArtists: 5 }); expect(state.pinnedArtists).toEqual(['alpha', 'beta']); expect(state.drawMode).toBeUndefined();
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 6, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.candidates.slice(-6).every((candidate: any) => candidate.tags.length >= 2 && candidate.tags.length <= 5 && candidate.tags[0].tag === 'alpha' && candidate.tags[0].weight <= 1.4)).toBe(true);
  expect(saved.candidates.slice(0, 2)).toEqual(experiment.candidates);
});

it('旧固定组多于原人数时保存候选仍成功，固定项与历史配方完整保留', async () => {
  experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  experiment.drawPlan = { mode: 'pinnedArtists', pinnedArtists: ['alpha', 'beta'] };
  const { props } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledOnce());
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const saved = mocks.save.mock.calls[0][0];
  expect(saved.rules).toMatchObject({ minArtists: 2, maxArtists: 2 });
  expect(saved.pinnedArtists).toEqual(['alpha', 'beta']);
  expect(saved.candidates[0].tags).toEqual(experiment.candidates[0].tags);
});

it('只从有样张的画师中抽取会过滤抽取范围，并把开关写进记录与轮次条件', async () => {
  experiment.artists = [];
  mocks.dictionary.mockResolvedValue(['alpha', 'beta', 'gamma'].map(name => ({ name, chinese: '', postCount: 1 })));
  await setup(); configure('每串总人数', '1');
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' }));
  expect(screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' })).toHaveProperty('checked', true);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [saved, candidates] = mocks.generate.mock.calls[0];
  expect(saved.sampledOnly).toBe(true);
  expect(saved.rounds.at(-1).snapshot.sampledOnly).toBe(true);
  expect(candidates.every((candidate: any) => candidate.tags.every((tag: any) => tag.tag === 'alpha'))).toBe(true);
  expect(mocks.save.mock.calls[0][0].sampledOnly).toBe(true);
});

it('筛选面板显示轮次条件并可沿用，沿用只填设置不自动提交', async () => {
  experiment.rounds = [{ id: 'r1', candidateIds: ['a'], createdAt: 1, snapshot: { rules: { ...experiment.rules, minArtists: 2, maxArtists: 2, minWeight: 2, maxWeight: 2.4 }, mode: 'random' } }];
  await setup(); fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.change(screen.getByRole('combobox', { name: '查看轮次' }), { target: { value: 'r1' } });
  expect(screen.getByRole('option', { name: /2 位画师.*固定 0 位/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '沿用这轮条件' }));
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '2');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '2.4');
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('生成设置从本轮菜单打开时关闭原弹层，避免两个模态窗口叠盖', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '本轮设置' })); fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' }));
  expect(screen.queryByRole('dialog', { name: '本轮设置' })).toBeNull(); expect(screen.getByRole('button', { name: '保存合成实验' })).toBeTruthy();
});
it.each([false, true])('多选补图显示实际提交张数，遵循连续生成开关与每轮24张上限：%s', async continuous => {
  experiment.candidates = Array.from({ length: 25 }, (_, index) => candidateFixture('pending-' + index, 'artist-' + index)); mocks.history.mockResolvedValue([]);
  await setup({ continuousGenerationEnabled: continuous }); fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: continuous ? '生成所选 · 24' : '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(continuous ? mocks.generate.mock.calls[0][1].length : 1).toBe(continuous ? 24 : 1);
  expect(mocks.generate.mock.calls[0][0].rounds.at(-1).candidateIds).toHaveLength(continuous ? 24 : 1);
});


it('页面只提供Roll和配方操作，不包含对比入口、评分或投票快捷键', async () => {
  const { props } = await setup();
  expect(screen.queryByRole('button', { name: /画风对比|可选工具|进化下一轮|换 Seed 验证/ })).toBeNull();
  expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
  expect(screen.queryByText(/变异|画师基因配方|来源候选|纯新探索|微调变体/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.queryByRole('option', { name: /Elo/ })).toBeNull(); fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details();
  expect(screen.queryByRole('button', { name: '权重测试' })).toBeNull(); expect(screen.queryByText(/Elo/)).toBeNull();
  expect(screen.queryByText('画师基因配方')).toBeNull(); expect(screen.getByText('画师与权重')).toBeTruthy();
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', ' ']) fireEvent.keyDown(window, { key });
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][0].rounds.at(-1).candidateIds).toHaveLength(6);
});

it('卡片画师标签使用小号磨砂徽章，编号只保留在左上角', async () => {
  await setup();
  const chip = screen.getByText('alpha').closest('.gallery-card-badge');
  expect(chip).toBeTruthy();
  expect(chip!.className).toContain('text-micro');
  expect(chip!.className).toContain('max-w-[96px]');
  const card = screen.getByRole('button', { name: '查看候选 1' });
  expect(card.querySelectorAll('.gallery-card-meta')).toHaveLength(0);
});

it('可从候选新建记录并预置固定画师，之后只抽权重', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details();
  fireEvent.click(screen.getByRole('button', { name: '新建记录 · 固定这些画师' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const created = mocks.save.mock.calls[0][0];
  expect(created.pinnedArtists).toEqual(['alpha']);
  expect(created.rules).toMatchObject({ minArtists: 1, maxArtists: 1 });
  expect(created.candidates).toEqual([]);
  expect(created.name).not.toContain('权重');
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
});

it('重 Roll 后保持全部轮次视图，旧候选不会被筛掉', async () => {
  experiment.rounds = [{ id: 'old', candidateIds: ['a'], createdAt: 1 }];
  await setup(); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看候选 2' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getByRole('combobox', { name: '查看轮次' })).toHaveProperty('value', '');
});

it('旧统一权重记录使用相同上下限继续抽取，新轮次不保存模式', async () => {
  experiment.drawPlan = { mode: 'fixedWeight' }; experiment.rules = { ...experiment.rules, minWeight: 1, maxWeight: 1 };
  await setup(); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [saved, candidates] = mocks.generate.mock.calls[0];
  expect(saved.drawPlan).toBeUndefined(); expect(saved.rounds.at(-1).snapshot.mode).toBeUndefined();
  expect(candidates.every((candidate: any) => candidate.tags.every((tag: any) => tag.weight === 1))).toBe(true);
});

it('流式预览显示在本轮第一张未出图的封面，关闭预览设置后不显示', async () => {
  experiment.rounds = [{ id: 'live', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'generating', progress: { current: 0, total: 2 }, preview: { image: 'data:image/png;base64,c3ludGhldGlj' } };
  const view = await setup();
  expect(screen.getByAltText('生成预览')).toBeTruthy();
  view.unmount();
  await setup({ generationStreamPreview: false });
  expect(screen.queryByAltText('生成预览')).toBeNull();
});

it('已有图片的候选详情不再提供生成入口，查看保存不重复提交图片', async () => {
  const { props } = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  expect(screen.queryByRole('button', { name: /生成图片/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledOnce()); expect(mocks.generate).not.toHaveBeenCalled();
});

it('未出图的候选不允许保存为风格串，先生成再保存', async () => {
  mocks.history.mockResolvedValue([]);
  await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  expect(screen.getByRole('button', { name: '生成后可保存' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: '存为风格串' })).toBeNull();
});

it('从画师库带入固定画师时新建记录并固定 Tag，不覆盖当前记录', async () => {
  experiment.candidates = []; mocks.load.mockResolvedValue([]);
  await setup({ initialPinned: { tags: ['alpha', 'beta'], token: 1 } });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const created = mocks.save.mock.calls[0][0];
  expect(created.pinnedArtists).toEqual(['alpha', 'beta']);
  expect(created.drawPlan).toBeUndefined();
  expect(created.rules).toMatchObject({ minArtists: 2, maxArtists: 2 });
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
});

it('回收站可永久清理已归档候选，原图与已保存风格串仍保留', async () => {
  experiment.candidates[1].archived = true;
  await setup();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  fireEvent.click(screen.getByRole('button', { name: '回收站' }));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: '永久清理所选' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].candidates.map((candidate: any) => candidate.id)).toEqual(['a']);
  expect(mocks.confirm).toHaveBeenCalledOnce();
});

it('候选编号旁显示所属轮次，便于区分新一轮结果', async () => {
  experiment.rounds = [{ id: 'first', candidateIds: ['a'], createdAt: 1 }];
  await setup();
  expect(screen.getByText('R1')).toBeTruthy();
});

it('可从已有风格串新建 Roll 记录并保留提示词、参数与固定 Seed', async () => {
  const chain = {
    id: 'source', userId: 'u', type: 'style', name: '合成画风', description: '', tags: [], modules: [], createdAt: 1, updatedAt: 1,
    basePrompt: 'masterpiece, 1.2::artist:alpha ::, 1girl, artist:beta, solo', negativePrompt: 'lowres',
    params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42, qualityToggle: false, ucPreset: 4 },
    variableValues: { subject: '' },
  } as PromptChain;
  experiment.candidates = []; mocks.load.mockResolvedValue([]);
  await setup({ chains: [chain] });
  fireEvent.click(screen.getAllByRole('button', { name: '从风格串开始' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '合成从风格串新建' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const created = mocks.save.mock.calls[0][0];
  expect(created.name).toBe('合成画风 · Roll');
  expect(created.template.prompt).toBe('masterpiece, {style}, 1girl, solo');
  expect(created.template.params.seed).toBe(42);
  expect(created.pinnedArtists).toEqual(['alpha', 'beta']);
  expect(created.drawPlan).toBeUndefined();
  expect(created.artists).toEqual([
    expect.objectContaining({ tag: 'alpha', weight: 1, locked: false }),
    expect.objectContaining({ tag: 'beta', weight: 1, locked: false }),
  ]);
  expect(created.rules).toMatchObject({ minArtists: 2, maxArtists: 2 });
});

it('从风格串开始时用画师词库识别裸画师名', async () => {
  const chain = {
    id: 'bare', userId: 'u', type: 'style', name: '裸画师串', description: '', tags: [], modules: [], createdAt: 1, updatedAt: 1,
    basePrompt: 'dishwasher1910, 1.2::akita_hika::, year 2026', negativePrompt: '',
    params: { model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 7, qualityToggle: false, ucPreset: 4 },
    variableValues: { subject: '' },
  } as PromptChain;
  experiment.candidates = []; mocks.load.mockResolvedValue([]);
  mocks.dictionary.mockResolvedValue([{ name: 'dishwasher1910', chinese: '', postCount: 1 }, { name: 'akita_hika', chinese: '', postCount: 1 }]);
  await setup({ chains: [chain] });
  await waitFor(() => expect(mocks.dictionary).toHaveBeenCalled());
  await act(async () => {});
  fireEvent.click(screen.getAllByRole('button', { name: '从风格串开始' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '合成从风格串新建' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].artists.map((artist: any) => artist.tag)).toEqual(['dishwasher1910', 'akita_hika']);
});


it('本轮人数与权重各占一行，保存范围并让助手遵循偏好保底', async () => {
  preferredItems.push({ sourceType: 'artist', sourceId: 'beta', archived: false });
  const { container } = await setup();
  configure('最少画师人数', '4'); configure('最多画师人数', '6');
  fireEvent.click(screen.getByRole('button', { name: '本轮设置' }));
  const people = screen.getByRole('group', { name: '每串人数范围' }), weights = screen.getByRole('group', { name: '权重范围' });
  expect(people.contains(screen.getByLabelText('最多画师人数'))).toBe(true);
  expect(weights.contains(screen.getByLabelText('最低权重'))).toBe(true);
  expect(people.contains(weights)).toBe(false);
  expect(screen.queryByRole('textbox', { name: '固定画师 Tag（可选）' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' }); openArtists();
  fireEvent.click(screen.getByRole('button', { name: '抽取设置' }));
  fireEvent.change(screen.getByLabelText('每串偏好保底人数'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('偏好抽中倍率'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 6, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.rules).toMatchObject({ minArtists: 4, maxArtists: 6, preferredMinArtists: 1, preferredMultiplier: 3 });
  expect(saved.candidates.slice(-6).every((candidate: any) => candidate.tags.some((tag: any) => tag.tag === 'beta'))).toBe(true);
});

it('偏好不足时页面和助手都停止，不保存候选也不触发生图', async () => {
  experiment.rules.preferredMinArtists = 2;
  preferredItems.push({ sourceType: 'artist', sourceId: 'alpha', archived: false });
  const { container } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await screen.findByText('可用偏好画师不足，请减少保底人数或调整屏蔽与样张过滤');
  await expect(executeAgentCommand(container, 'run_roll_round', { count: 1, generate: false }, false)).rejects.toThrow('可用偏好画师不足');
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});

it('助手临时开启样张过滤时按真实样张集合抽取，旧覆盖项不能绕过过滤', async () => {
  experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  const { container } = await setup();
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 3, sampledOnly: true, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.sampledOnly).toBe(true);
  expect(saved.candidates.slice(2).every((candidate: any) => candidate.tags.length === 1 && candidate.tags[0].tag === 'alpha')).toBe(true);
});

it.each([
  ['/api/artist-samples/image?pack=v45&tag=alpha&index=0&revision=synthetic', 'artist-sample-padding-v2'],
  ['/api/artist-samples/image?pack=v5&tag=alpha&index=0&revision=synthetic', 'artist-sample-padding-v2'],
  ['/api/assets/own-sample.png', null],
  ['/api/history/synthetic/image', null],
  ['https://synthetic.invalid/unknown.jpg', null],
])('候选详情小头像仅为已知图包来源启用共用裁边预览：%s', async (url, transform) => {
  sampleUrls.set('alpha', url!);
  const onOpenArtistLibrary = vi.fn();
  const { container } = await setup({ onOpenArtistLibrary });
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  await waitFor(() => expect(container.querySelector(`img[src="${url}"]`)).toBeTruthy());
  const image = container.querySelector<HTMLImageElement>(`img[src="${url}"]`)!;
  expect(image.getAttribute('data-preview-transform')).toBe(transform);
  expect(image.getAttribute('data-container-class')).toContain('h-8 w-8 shrink-0');
  expect(image.classList.contains('object-cover')).toBe(true);
  fireEvent.click(image);
  expect(onOpenArtistLibrary).toHaveBeenCalledWith('alpha');
  expect(image.getAttribute('src')).toBe(url);
  for (const candidate of screen.getAllByAltText('候选 1')) expect(candidate.getAttribute('data-preview-transform')).toBeNull();
});
