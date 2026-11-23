// @vitest-environment jsdom
import { useMobileHistoryLayer } from '../../components/MobileUI';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture, rollImageFixture } from '../fixtures/styleRoll';
import { DEFAULT_ROLL_CHARACTER_PROMPT, DEFAULT_ROLL_PROMPT, DEFAULT_ROLL_NEGATIVE, type RollExperiment, type RollRules } from '../../services/styleRoll';
import type { PromptChain } from '../../types';
import { StyleRollPage } from '../../components/StyleRollPage';
import { executeAgentCommand, getAgentCommands } from '../../services/agentCommands';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { setLanguage } from '../../services/i18n';
import { emitCloudQueueStatus } from '../../services/cloudQueue';

const mocks = vi.hoisted(() => ({ load: vi.fn(), loadOne: vi.fn(), save: vi.fn(), history: vi.fn(), dictionary: vi.fn(), sampled: vi.fn(), generate: vi.fn(), confirm: vi.fn(), alert: vi.fn(), upload: vi.fn(), stop: vi.fn(), approve: vi.fn(), pause: vi.fn(), session: null as any, remove: vi.fn(), setupRules: null as RollRules | null, key: 'synthetic-key', cost: 0, mobile: false, setupHistory: false, ensureCollection: vi.fn(), favorites: new Set<string>(), collectionRevision: 0, collectionListeners: new Set<() => void>(), interrupted: [] as any[], clearInterrupted: vi.fn(), restore: vi.fn(async () => {}), getQueue: vi.fn(async () => ({ intervalSeconds: 2, intervalJitterPercent: 0, busy: false, completed: 0, total: 0, paused: false, pausing: false, waiting: [] })), setIntervalPref: vi.fn(async (_key: string, seconds: number, jitterPercent?: number) => ({ intervalSeconds: seconds, intervalJitterPercent: jitterPercent ?? 0, busy: false, completed: 0, total: 0, paused: false, pausing: false, waiting: [] })) }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleStatus: async () => ({ available: true, canManage: true, packs: [] }), ARTIST_SAMPLES_CHANGED: 'nai-artist-samples-changed', getArtistSampleLibrary: mocks.dictionary, normalizeArtistSampleTag: (tag: string) => tag.trim().replaceAll('_', ' ').replace(/\s+/g, ' ').toLowerCase() }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), searchArtistDictionary: async () => [] }));
const sampleUrls = new Map<string, string>();
vi.mock('../../services/artistSampleUrls', () => ({ loadArtistSampleUrls: async () => sampleUrls }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => preferredItems, subscribeCollection: (listener: () => void) => { mocks.collectionListeners.add(listener); return () => { mocks.collectionListeners.delete(listener); }; }, collectionRevision: () => mocks.collectionRevision, ensureCollection: mocks.ensureCollection, toggleArtistPreference: vi.fn(), collectionTargetActive: (target: { sourceId?: string }) => mocks.favorites.has(target.sourceId || '') }));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), getArtistSampleData: async () => ({ templates: {}, samples: [] }), getSampledArtistTags: mocks.sampled }));
vi.mock('../../services/styleRollApi', async original => ({ ...await original<typeof import('../../services/styleRollApi')>(), loadRollExperiments: mocks.load, loadRollExperiment: mocks.loadOne, saveRollExperiment: mocks.save, deleteRollExperiment: mocks.remove, loadRollHistory: mocks.history, loadRollBlocklist: async () => [], saveRollBlocklist: async (tags: string[]) => tags }));
vi.mock('../../services/styleRollGeneration', () => ({ beginRollGeneration: mocks.generate, readRollApiKey: () => mocks.key }));
vi.mock('../../services/localHistory', () => ({ localHistory: { subscribe: () => () => {} } }));
vi.mock('../../services/generationSeries', () => ({ getGenerationSeriesSession: () => mocks.session, subscribeGenerationSeries: () => () => {}, stopGenerationSeriesSession: mocks.stop, approveGenerationSeries: mocks.approve, restoreGenerationSeriesSessions: mocks.restore, listInterruptedGenerationSeries: () => mocks.interrupted, clearInterruptedGenerationSeries: mocks.clearInterrupted }));
vi.mock('../../services/generationTask', () => ({ setGenerationQueuePaused: mocks.pause, getGenerationQueue: mocks.getQueue, setGenerationInterval: mocks.setIntervalPref }));
vi.mock('../../services/naiRuntime', async original => { const actual = await original<typeof import('../../services/naiRuntime')>(); return { ...actual, useNaiRuntime: () => actual.DEFAULT_NAI_RUNTIME }; });
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ info: { tier: 3 }, refreshIfStale: vi.fn() }), isActiveOpusSubscription: () => true }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 100 }), applyEstimatorRuntime: () => {}, estimateV45GenerationCost: () => mocks.cost, formatGenerationCostLabel: (cost: number) => cost > 0 ? `${cost} Anlas` : '免费' }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { uploadFile: mocks.upload } }));
vi.mock('../../components/ConfirmDialog', () => ({
  useConfirmDialog: () => mocks.confirm,
  // 错误与状态都已改为弹窗：把正文与附加动作挂到无障碍树上，原有查找与点击断言照常成立。
  useAlertDialog: () => (message: string, options?: { action?: { label: string; onClick: () => void | Promise<void> } }) => {
    mocks.alert(message);
    document.querySelectorAll('[data-test-alert]').forEach(node => node.remove());
    const node = document.createElement('p');
    node.setAttribute('data-test-alert', 'true');
    node.setAttribute('role', 'alert');
    node.className = 'sr-only';
    node.textContent = String(message);
    document.body.appendChild(node);
    if (options?.action) {
      const button = document.createElement('button');
      button.setAttribute('data-test-alert', 'true');
      button.textContent = options.action.label;
      // 点动作等同真实弹窗：先关闭弹窗，再执行动作。
      button.addEventListener('click', () => { document.querySelectorAll('[data-test-alert]').forEach(node => node.remove()); void options.action!.onClick(); });
      document.body.appendChild(button);
    }
  },
}));
vi.mock('../../components/ImageShareActions', () => ({ ImageShareActions: () => null, IMAGE_CARD_ACTION_CLASS: 'image-action', IMAGE_CARD_ACTION_TONE: { save: '', delete: '', primary: '' } }));
vi.mock('../../components/ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className, previewTransform, containerClassName }: any) => <img src={src} alt={alt} className={className} data-preview-transform={previewTransform} data-container-class={containerClassName} />, OriginalImage: (props: any) => <img {...props} /> }));
vi.mock('../../components/roll/StyleRollSetup', () => ({ StyleRollSetup: ({ initial, forceEmptySeed, onSave, onClose }: any) => { const close = useMobileHistoryLayer(mocks.setupHistory, onClose, 'roll-setup'); return <div role="dialog" aria-label="Roll 串配置" data-pinned={(initial.pinnedArtists ?? []).join(',')} data-force-empty={String(Boolean(forceEmptySeed))}><button onClick={async () => { await onSave({ ...initial, rules: mocks.setupRules || initial.rules }); onClose(); }}>保存合成实验</button><button onClick={close}>取消草稿</button></div>; } }));

const preferredItems: any[] = [];
let experiment: RollExperiment;
const rows = (e: RollExperiment) => e.candidates.map(candidate => rollImageFixture(e, candidate));
beforeEach(() => {
  sampleUrls.clear(); mocks.sampled.mockResolvedValue(new Set(['alpha']));
  preferredItems.length = 0; vi.clearAllMocks(); mocks.ensureCollection.mockReset().mockResolvedValue(undefined); mocks.favorites = new Set(); mocks.collectionRevision = 0; mocks.collectionListeners.clear(); mocks.cost = 0; mocks.remove.mockReset().mockResolvedValue(undefined); mocks.mobile = false; mocks.setupHistory = false; mocks.session = null; mocks.setupRules = null; mocks.key = 'synthetic-key'; localStorage.clear(); sessionStorage.clear();
  mocks.interrupted = []; mocks.clearInterrupted.mockReset(); mocks.restore.mockClear();
  experiment = rollFixture(); experiment.candidates = [candidateFixture('a', 'alpha'), candidateFixture('b', 'beta')];
  mocks.dictionary.mockResolvedValue(experiment.artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 })));
  mocks.load.mockImplementation(async () => [structuredClone(experiment)]);
  // 列表只回摘要；完整记录在选中后按 ID 读取，测试沿用同一份合成记录。
  mocks.loadOne.mockImplementation(async (id: string) => {
    const list = await mocks.load() as RollExperiment[];
    const found = list.find(item => item.id === id) ?? list[0] ?? experiment;
    return structuredClone(found);
  });
  mocks.save.mockImplementation(async value => ({ ...structuredClone(value), revision: value.revision + 1 }));
  mocks.history.mockResolvedValue(rows(experiment)); mocks.confirm.mockResolvedValue(true);
  mocks.generate.mockResolvedValue({ session: {}, settle: Promise.resolve({ success: true }) });
  mocks.upload.mockResolvedValue({ url: '/api/assets/covers/synthetic.png' });
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: mocks.mobile && query.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe(target: Element) { this.callback([{ target, contentRect: { width: 1024 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic-image'], { type: 'image/png' }) })));
});
afterEach(() => { emitCloudQueueStatus(null); cleanup(); document.querySelectorAll('[data-test-alert]').forEach(node => node.remove()); setLanguage('zh-CN'); vi.unstubAllGlobals(); });
const setup = async (options = {}) => {
  const onSaveChain = vi.fn(async chain => ({ ...chain, id: 'saved-chain' })), onNavigateToPlayground = vi.fn();
  const props = { active: true, chains: [], enforceFreeStepLimit: true, generationStreamPreview: true, notify: vi.fn(), onSaveChain, onNavigateToPlayground, onOpenChain: vi.fn(), ...options };
  const view = render(<StyleRollPage {...props} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  // 列表只回摘要，完整记录是随后按 ID 拉取的；等这次读取落地再让用例操作页面。
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  // 记录切换只有一处入口：桌面是左栏开关，手机是同一个按钮打开面板。
  await waitFor(() => expect(screen.getByRole('button', { name: '切换画风记录' })).toHaveProperty('disabled', false));
  if (experiment.candidates.length) await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  return { ...view, props };
};

it('候选详情复制已选候选的画师串与权重', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { props } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  fireEvent.click(screen.getByRole('button', { name: '复制画风' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('1.0::artist:alpha ::'));
  expect(props.notify).toHaveBeenCalledWith('已复制提示词', 'success');
});

it.each([false, true])('详情按当前排序前后浏览且到边界后隐藏翻页按钮，手机=%s', async mobile => {
  mocks.mobile = mobile;
  await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 2' }));
  expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  expect(screen.getByRole('button', { name: '查看候选 1' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '上一张' }));
  expect(screen.getByRole('button', { name: '查看候选 2' }).getAttribute('aria-pressed')).toBe('true');
});

it('批量个别封面失败继续其余候选，汇总编号和原错误且仅重试失败项', async () => {
  experiment.candidates.push(candidateFixture('c', 'gamma')); mocks.history.mockResolvedValue(rows(experiment));
  const { props } = await setup(); mocks.upload.mockRejectedValueOnce(new Error('合成封面失败'));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试失败项' });
  expect(screen.getByRole('alert').textContent).toContain('已保存 2 个候选，1 个失败，0 个未处理');
  expect(screen.getByRole('alert').textContent).toContain('#3：合成封面失败'); expect(props.onSaveChain).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
  await waitFor(() => expect(props.onSaveChain).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试失败项' })).toBeNull());
  expect(mocks.upload).toHaveBeenCalledTimes(4);
});

it.each([{}, { url: '' }, { url: 42 }])('封面上传回执缺少有效地址时保留失败项且继续保存其余候选：%j', async uploadResult => {
  const { props } = await setup(); mocks.upload.mockResolvedValueOnce(uploadResult);
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试失败项' });
  expect(screen.getByRole('alert').textContent).toContain('已保存 1 个候选，1 个失败，0 个未处理');
  expect(screen.getByRole('alert').textContent).toContain('上传失败');
  expect(props.onSaveChain).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试失败项' })).toBeNull());
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(3);
});

it.each([false, true])('上传后建串失败重试按实际历史图片复用封面，换图=%s', async changedImage => {
  const onSaveChain = vi.fn().mockRejectedValueOnce(new Error('合成建串失败')).mockResolvedValue({ id: 'saved' });
  const view = await setup({ onSaveChain });
  fireEvent.click(screen.getByRole('button', { name: '保存候选 1' }));
  await screen.findByText('合成建串失败');
  expect(mocks.upload).toHaveBeenCalledOnce();
  if (changedImage) {
    const image = rollImageFixture(experiment, experiment.candidates[0], 'replacement');
    mocks.history.mockResolvedValue([image, rollImageFixture(experiment, experiment.candidates[1])]);
    const previousCalls = mocks.history.mock.calls.length;
    view.rerender(<StyleRollPage {...view.props} active={false} />);
    view.rerender(<StyleRollPage {...view.props} active />);
    await waitFor(() => expect(mocks.history.mock.calls.length).toBeGreaterThan(previousCalls));
    await waitFor(() => expect(screen.getByRole('button', { name: '查看候选 1' }).querySelector('img')?.getAttribute('src')).toContain('replacement'));
  }
  fireEvent.click(screen.getByRole('button', { name: '保存候选 1' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(onSaveChain).toHaveBeenCalledTimes(2);
  expect(mocks.upload).toHaveBeenCalledTimes(changedImage ? 2 : 1);
  expect(fetch).toHaveBeenCalledTimes(changedImage ? 2 : 1);
});

it('失败重试期间改变查询仍保留失败回执并清进度，不改新视图选择', async () => {
  const onSaveChain = vi.fn().mockRejectedValue(new Error('首次失败'));
  await setup({ onSaveChain });
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试失败项' });
  fireEvent.click(screen.getByRole('button', { name: '退出多选' }));
  let fail!: (cause: Error) => void;
  onSaveChain.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
  await waitFor(() => expect(onSaveChain).toHaveBeenCalledTimes(3));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师、中文名或编号' }), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  await act(async () => fail(new Error('重试仍失败')));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试失败项' }).hasAttribute('disabled')).toBe(false));
  expect(screen.getByRole('alert').textContent).toContain('重试仍失败');
  expect(screen.getByRole('button', { name: '查看候选 1' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  expect(screen.queryByText(/^正在保存 \d+\/\d+$/)).toBeNull();
});

it('批存遵循筛选排序，逐项清理网页错误且长错误不截掉后续失败', async () => {
  await setup();
  mocks.upload.mockRejectedValueOnce(new Error('<html><body>upstream</body></html>')).mockRejectedValueOnce(new Error('后续失败' + '长'.repeat(600)));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试失败项' });
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('已保存 0 个候选，2 个失败，0 个未处理');
  // 失败详情随汇总一起进弹窗正文（多行文本），不再渲染成旧错误条里的列表。
  expect(alert.textContent).toContain('#2：服务返回了错误页面，请稍后重试');
  expect(alert.textContent).toContain('#1：后续失败');
  expect(alert.textContent).not.toContain('<html>');
});

it('关联冲突后回读最新修订再保存其他项，保留外部修改，重试不重复建串或封面', async () => {
  const { props } = await setup();
  const latest = structuredClone(experiment); latest.revision = 12; latest.name = '外部更新记录';
  mocks.load.mockResolvedValue([latest]); mocks.save.mockRejectedValueOnce(new Error('关联冲突'));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试失败项' });
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ revision: 12, name: '外部更新记录' });
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(mocks.save.mock.calls[2][0].candidates[0].savedChainId).toBe('saved-chain');
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
});

it('关联失败且无法核对修订时停止余下项，区分失败和未处理', async () => {
  const { props } = await setup(); mocks.save.mockRejectedValueOnce(new Error('关联失败')); mocks.load.mockRejectedValueOnce(new Error('读取失败'));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByRole('button', { name: '重试待保存项' });
  expect(screen.getByRole('alert').textContent).toContain('已保存 0 个候选，1 个失败，1 个未处理');
  expect(props.onSaveChain).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
  mocks.load.mockRejectedValueOnce(new Error('仍不可读'));
  fireEvent.click(screen.getByRole('button', { name: '重试待保存项' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('暂时无法确认保存结果，已暂停后续项目'));
  expect(mocks.save).toHaveBeenCalledOnce(); expect(props.onSaveChain).toHaveBeenCalledOnce();
});

it('关联回读发现外部已保存时尊重外部关联，不用本端缓存覆盖', async () => {
  const { props } = await setup(); const latest = structuredClone(experiment); latest.revision = 8; latest.candidates[1].savedChainId = 'external-chain';
  mocks.load.mockResolvedValue([latest]); mocks.save.mockRejectedValueOnce(new Error('并发冲突'));
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' })); fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1][0].candidates[1].savedChainId).toBe('external-chain');
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(screen.queryByRole('button', { name: '重试失败项' })).toBeNull();
});

it('保存期间主动关闭详情，迟到成功不重新打开另一项', async () => {
  let finish!: (value: PromptChain) => void;
  const onSaveChain = vi.fn(() => new Promise<PromptChain>(resolve => { finish = resolve; }));
  await setup({ onSaveChain }); fireEvent.click(screen.getByRole('button', { name: '查看候选 2' }));
  fireEvent.click(screen.getByRole('button', { name: '存为风格串' })); await waitFor(() => expect(onSaveChain).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '关闭候选详情' })); await act(async () => finish({ id: 'saved' } as PromptChain));
  expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.getByRole('button', { name: '查看候选 1' }).getAttribute('aria-pressed')).toBe('false');
});

it('UI保存挂起时助手保存共用锁，不重复创建同一候选', async () => {
  let finish!: (value: PromptChain) => void;
  const onSaveChain = vi.fn(() => new Promise<PromptChain>(resolve => { finish = resolve; }));
  const { container } = await setup({ onSaveChain }); fireEvent.click(screen.getByRole('button', { name: '保存候选 1' }));
  await waitFor(() => expect(onSaveChain).toHaveBeenCalledOnce());
  await expect(executeAgentCommand(container, 'save_roll_candidate', { candidateIds: ['a'] }, false)).rejects.toThrow('正在保存，请稍候');
  await act(async () => finish({ id: 'saved-chain' } as PromptChain)); expect(onSaveChain).toHaveBeenCalledOnce();
});

it('手机390窄窗记录面板点新建直接建好并切换，关闭底部面板且不弹大配置窗', async () => {
  mocks.mobile = true; mocks.setupHistory = true; vi.stubGlobal('innerWidth', 390);
  window.history.replaceState(null, '');
  const original = structuredClone(experiment);
  await setup();
  // 手机不再把记录管理藏在「更多」里：记录名按钮直接打开同一个记录面板。
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  expect(window.history.state?.__naiMobileLayer).toMatch(/^sheet-/);
  fireEvent.click(screen.getByRole('button', { name: '新建记录' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '画风记录' })).toBeNull());
  expect(screen.queryByRole('dialog', { name: 'Roll 串配置' })).toBeNull();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(experiment).toEqual(original);
  window.history.replaceState(null, '');
});

it('删除样张广播刷新已打开Roll详情缩略图，保留候选且不保存或生图', async () => {
  sampleUrls.set('alpha', '/api/assets/removed-sample.png');
  const { container } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  await waitFor(() => expect(document.querySelector('img[src="/api/assets/removed-sample.png"]')).not.toBeNull());
  sampleUrls.clear();
  act(() => window.dispatchEvent(new Event('nai-artist-samples-changed')));
  await waitFor(() => expect(document.querySelector('img[src="/api/assets/removed-sample.png"]')).toBeNull());
  expect(screen.getAllByAltText('候选 1')).toHaveLength(2);
  expect(container.querySelector('[data-roll-page]')).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});
const configure = (name: string, value: string) => { fireEvent.click(screen.getByRole('button', { name: '设置' })); for (const label of name === '每串总人数' ? ['最少画师人数', '最多画师人数'] : [name]) fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value } }); fireEvent.keyDown(window, { key: 'Escape' }); };
const openArtists = () => { fireEvent.click(screen.getByRole('button', { name: '设置' })); fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ })); };
/** 详情里的操作已直接放在标题栏与正文中，不再需要展开「更多操作」。 */
const details = () => {};

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

it('助手可启动连续 Roll 系列，读取进度并随时停止', async () => {
  const { container } = await setup();
  const started = await executeAgentCommand(container, 'run_roll_series', { maxRounds: 12, stopAtPercent: 5, stopAtPoints: 0 }, false) as { running: boolean; maxRounds: number; note: string };
  expect(started.running).toBe(true);
  expect(started.maxRounds).toBe(12);
  const state = await executeAgentCommand(container, 'get_roll_state', {}, true) as { series: { running: boolean; maxRounds: number; rounds: number } };
  expect(state.series.running).toBe(true);
  expect(state.series.maxRounds).toBe(12);
  expect(state.series.rounds).toBe(0);
  const stopped = await executeAgentCommand(container, 'run_roll_series', { stop: true }, false) as { running: boolean; stopReason: string };
  expect(stopped.running).toBe(false);
  expect(stopped.stopReason).toBe('user_stop');
  const after = await executeAgentCommand(container, 'get_roll_state', {}, true) as { series: { running: boolean } };
  expect(after.series.running).toBe(false);
});

type SeriesState = { series: { running: boolean; rounds: number; stopReason: string; lastError: string } };
const readSeries = async (container: HTMLElement) => (await executeAgentCommand(container, 'get_roll_state', {}, true) as SeriesState).series;

it('连续 Roll 任一轮失败即停，只汇总提示一次且不逐轮弹窗', async () => {
  mocks.generate.mockResolvedValue({ session: {}, settle: Promise.resolve({ success: false, error: '合成上游失败' }) });
  const { container, props } = await setup();
  await executeAgentCommand(container, 'run_roll_series', { maxRounds: 50, count: 1 }, false);
  await waitFor(async () => expect(await readSeries(container)).toMatchObject({ running: false, stopReason: 'error', rounds: 0 }), { timeout: 5000 });
  expect((await readSeries(container)).lastError).toMatch(/合成上游失败/);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.alert).not.toHaveBeenCalled();
  expect(props.notify).toHaveBeenCalledWith(expect.stringMatching(/连续 Roll 已停止/), 'error');
});

it('连续 Roll 成功一轮后计数，页面卸载即停并留下原因', async () => {
  const { container, unmount } = await setup();
  await executeAgentCommand(container, 'run_roll_series', { maxRounds: 5, count: 1 }, false);
  await waitFor(async () => expect((await readSeries(container)).rounds).toBe(1), { timeout: 5000 });
  expect((await readSeries(container)).running).toBe(true);
  unmount();
  const { getRollSeries } = await import('../../services/styleRollSeries');
  expect(getRollSeries()).toMatchObject({ running: false, stopReason: 'page_closed', rounds: 1 });
});

it('连续 Roll 在记录容量将满时拒绝启动', async () => {
  // 合成一条逼近单行上限的记录：只撑大公共正文，不渲染海量候选。
  experiment.template = { ...experiment.template, prompt: `{style}, ${'x'.repeat(1_850_000)}` };
  const { container } = await setup();
  await expect(executeAgentCommand(container, 'run_roll_series', { maxRounds: 5, count: 6 }, false)).rejects.toThrow(/容量将满/);
  expect((await readSeries(container)).running).toBe(false);
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
it.each([{ ids: undefined }, { ids: ['a', 'b'] }])('助手补齐多项在连续生成关闭时明确拒绝且不创建部分轮次：%j', async ({ ids }) => {
  experiment.rounds = [{ id: 'pending-round', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  const { container } = await setup({ continuousGenerationEnabled: false });
  const before = mocks.save.mock.calls.length;
  await expect(executeAgentCommand(container, 'generate_roll_pending', { ids }, false)).rejects.toThrow('连续生成已关闭，本次只能生成 1 张');
  expect(mocks.save.mock.calls).toHaveLength(before); expect(mocks.generate).not.toHaveBeenCalled();
  await act(async () => { await executeAgentCommand(container, 'generate_roll_pending', { ids: ['a'] }, false); });
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1].id).toBe('a');
  expect(getAgentCommands(container).filter(command => ['run_roll_round', 'generate_roll_pending'].includes(command.name)).every(command => !JSON.stringify(command.parameters).includes('agentPermissionMode'))).toBe(true);
});
it.each(['standard', 'full', 'read_only'] as const)('通用Roll命令不能通过模型参数改变真实费用授权：%s', async permissionMode => {
  mocks.cost = 5; mocks.confirm.mockResolvedValue(false); mocks.history.mockResolvedValue([]);
  const { container } = await setup(); container.dataset.agentView = 'roll';
  const page = readAgentPage();
  const operation = { action: 'command' as const, command: 'generate_roll_pending', args: { ids: ['a'], agentPermissionMode: permissionMode === 'full' ? 'standard' : 'full' }, permissionMode, snapshotId: page.snapshotId };
  if (permissionMode === 'read_only') await expect(operateAgentPage(operation)).rejects.toThrow('只读');
  else await act(async () => { await operateAgentPage(operation); });
  expect(mocks.confirm).toHaveBeenCalledTimes(permissionMode === 'standard' ? 1 : 0);
  expect(mocks.generate).toHaveBeenCalledTimes(permissionMode === 'full' ? 1 : 0);
});

it('手机390px工具栏禁止横滑，主操作与更多可达并保持触控尺寸，设置通过Portal显示且预览不单独放大', async () => {
  mocks.mobile = true; vi.stubGlobal('innerWidth', 390);
  const { container } = await setup();
  const header = container.querySelector<HTMLElement>('header')!;
  expect(header).toBeTruthy();
  const roll = screen.getByRole('button', { name: '再 Roll 一轮' });
  expect(header.contains(roll)).toBe(true);
  expect(roll.className).not.toContain('!h-7');
  // 手机不再常驻英文 “Roll” 短标签；完整文案仅在 md+ 的隐藏跨度里保留无障碍名称。
  expect([...roll.querySelectorAll('span')].some(span => span.textContent === 'Roll')).toBe(false);
  const preview = screen.getByAltText('候选 1');
  expect(preview.classList.contains('object-contain')).toBe(true);
  expect(preview.className).not.toMatch(/(?:group-hover:|hover:)scale/);
  // 手机端设置统一收进「更多操作」，避免顶栏右侧并排出现两个菜单图标。
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '更多操作' })).getByRole('button', { name: '设置' }));
  const menu = screen.getByRole('dialog', { name: '设置' });
  expect(header.contains(menu)).toBe(false);
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '0.2');
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开画风记录：另一记录' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '设置' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '1.7');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '1.9');
});
it('设置默认折叠生成间隔并显示摘要，展开后可调生成间隔与随机浮动并按同一 Key 保存', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const dialog = screen.getByRole('dialog', { name: '设置' });
  await waitFor(() => expect(mocks.getQueue).toHaveBeenCalledWith('synthetic-key'));
  const toggle = within(dialog).getByRole('button', { name: /生成间隔/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.textContent).toContain('2.0 秒');
  expect(within(dialog).queryByRole('spinbutton', { name: '生成间隔' })).toBeNull();
  fireEvent.click(toggle);
  const interval = within(dialog).getByRole('spinbutton', { name: '生成间隔' }) as HTMLInputElement;
  expect(interval.value).toBe('2.0');
  fireEvent.change(interval, { target: { value: '3.5' } });
  fireEvent.blur(interval);
  await waitFor(() => expect(mocks.setIntervalPref).toHaveBeenCalledWith('synthetic-key', 3.5, undefined));
  fireEvent.change(within(dialog).getByRole('combobox', { name: '间隔随机浮动幅度' }), { target: { value: '20' } });
  await waitFor(() => expect(mocks.setIntervalPref).toHaveBeenCalledWith('synthetic-key', 3.5, 20));
  expect((within(dialog).getByRole('spinbutton', { name: '生成间隔' }) as HTMLInputElement).value).toBe('3.5');
  expect(toggle.textContent).toContain('3.5 秒');
  expect(toggle.textContent).toContain('±20%');
});
it('设置与完整配置双向同步人数和权重范围，保存配置不会自动出图', async () => {
  await setup(); configure('每串总人数', '5'); configure('最低权重', '0.4'); configure('最高权重', '0.6');
  const openSetup = () => { fireEvent.click(screen.getByRole('button', { name: '设置' })); fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' })); };
  openSetup(); fireEvent.click(screen.getByRole('button', { name: '保存合成实验' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].rules).toEqual({ minArtists: 5, maxArtists: 5, minWeight: 0.4, maxWeight: 0.6 });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  mocks.setupRules = { minArtists: 6, maxArtists: 6, minWeight: 0.2, maxWeight: 0.3 };
  openSetup(); fireEvent.click(screen.getByRole('button', { name: '保存合成实验' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('spinbutton', { name: '最多画师人数' })).toHaveProperty('value', '6');
  expect(screen.getByRole('spinbutton', { name: '最低权重' })).toHaveProperty('value', '0.2');
  expect(screen.getByRole('spinbutton', { name: '最高权重' })).toHaveProperty('value', '0.3');
  expect(mocks.generate).not.toHaveBeenCalled();
});
it('强制清空种子对 Roll 生效：配置窗口同步状态，生成按随机种子提交', async () => {
  await setup({ forceEmptySeed: true });
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' }));
  expect(screen.getByRole('dialog', { name: 'Roll 串配置' }).getAttribute('data-force-empty')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '取消草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0]).toHaveLength(7);
  expect(mocks.generate.mock.calls[0][6]).toBe(true);
});
it.each([['', '1.4'], ['1.5', '1.4'], ['0.7', '3.1'], ['0.75', '1.4']])('无效权重范围 %s～%s 不保存、不提交出图', async (min, max) => {
  await setup(); configure('最低权重', min); configure('最高权重', max);
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  expect(await screen.findByText(/请检查画师数量和权重范围/)).toBeTruthy();
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
  await setup(); expect(screen.getByTitle('已加载 5 / 共 6')).toBeTruthy(); expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  const errorText = await screen.findByText('服务返回了错误页面，请稍后重试');
  expect(errorText.textContent).not.toMatch(/DOCTYPE|synthetic-ray|<html/);
  expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.generate.mock.calls[0][0]).toEqual(before);
  expect(mocks.generate.mock.calls[0][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
  // 生成失败回执留在候选卡占位区，不再是可关闭的顶部横幅。
  expect(screen.queryByRole('button', { name: '关闭错误提示' })).toBeNull();
  expect(mocks.generate).toHaveBeenCalledOnce();
  mocks.generate.mockImplementationOnce(async () => { mocks.history.mockResolvedValue(rows(experiment)); return { session: {}, settle: Promise.resolve({ success: true }) }; });
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '补齐剩余 1 张' })).toBeNull());
  expect(mocks.generate).toHaveBeenCalledTimes(2); expect(mocks.generate.mock.calls[1][0]).toEqual(before);
  expect(mocks.generate.mock.calls[1][1]).toEqual(before.candidates[5]); expect(mocks.save).not.toHaveBeenCalled();
});
it.each([false, true])('Roll 成图记账异常仍显示已保存结果与结算原因，不自动补图，清理异常=%s', async cleanupFailed => {
  experiment.candidates = [candidateFixture('a', 'alpha')];
  experiment.rounds = [{ id: 'accounting-round', candidateIds: ['a'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  const saved = rollImageFixture(experiment, experiment.candidates[0]);
  mocks.generate.mockImplementationOnce(async () => {
    mocks.history.mockResolvedValue([saved]);
    return { session: { accountingFailed: true, accountingError: '本地用量结算失败（HTTP 503）', ...(cleanupFailed ? { cleanupError: '合成后台释放失败' } : {}), lastSavedItem: saved }, settle: Promise.resolve({ success: true }) };
  });
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '补齐剩余 1 张' }));
  expect((await screen.findByText(/本地用量结算失败（HTTP 503）/)).textContent).toContain('图片已保存，但本地记账异常，请核对额度后再继续');
  if (cleanupFailed) expect(screen.getByText(/后台任务清理异常：合成后台释放失败/)).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('button', { name: '补齐剩余 1 张' })).toBeNull());
  expect(screen.getByRole('button', { name: '查看候选 1' }).querySelector('img')?.getAttribute('src')).toContain(saved.id);
  expect(mocks.generate).toHaveBeenCalledOnce(); expect(mocks.upload).not.toHaveBeenCalled();
});
it('保存轮次冲突不提交生图，保留现有图片和候选', async () => {
  await setup(); mocks.save.mockRejectedValueOnce(new Error('合成保存冲突'));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); expect(await screen.findByText(/合成保存冲突/)).toBeTruthy();
  expect(mocks.generate).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('词库读取失败禁止抽取，重试后恢复；关闭连续生成不提交多张', async () => {
  mocks.dictionary.mockRejectedValueOnce(new Error('合成词库读取失败')); const view = await setup({ continuousGenerationEnabled: false });
  expect(await screen.findByText('合成词库读取失败')).toBeTruthy(); expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await waitFor(() => expect((screen.getByRole('button', { name: '再 Roll 一轮' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await screen.findByText('连续生成已关闭，请开启后生成本轮'); expect(mocks.generate).not.toHaveBeenCalled(); view.unmount();
});
it('记录读取期间禁用发起，失败后弹窗报错不崩页', async () => {
  let reject!: (reason: Error) => void;
  mocks.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<StyleRollPage active chains={[]} enforceFreeStepLimit generationStreamPreview={false} notify={vi.fn()} onSaveChain={vi.fn(async chain => chain)} onOpenChain={vi.fn()} onNavigateToPlayground={vi.fn()} />);
  expect((screen.getByRole('button', { name: '开始 Roll' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => reject(new Error('合成读取失败')));
  expect(mocks.alert).toHaveBeenCalledWith('合成读取失败');
});
it('连续生成关闭时仍可按一张开始一轮，不强制开启连续请求', async () => {
  await setup({ continuousGenerationEnabled: false }); configure('本轮生成张数', '1');
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate.mock.calls[0][1]).toEqual(expect.objectContaining({ id: expect.any(String), tags: expect.any(Array) }));
});
it('切换语言后单张费用同步翻译，固定参数生成入口保留', async () => {
  mocks.history.mockResolvedValue([]); await setup(); act(() => setLanguage('en'));
  fireEvent.click(screen.getByRole('button', { name: 'View candidate 1' })); expect(screen.getByRole('button', { name: 'Generate image · Free' })).toBeTruthy();
});
it.each([true, false])('后台费用上涨确认=%s，取消停止任务，授权按原Key补充', async approved => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 1 }, progress: { current: 1, total: 6 } };
  mocks.history.mockResolvedValue([]);
  mocks.confirm.mockResolvedValueOnce(approved); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' }));
  await waitFor(() => expect(approved ? mocks.approve : mocks.stop).toHaveBeenCalledOnce());
  expect(mocks.confirm.mock.calls[0][0].message).toContain('剩余 5 张'); expect(mocks.confirm.mock.calls[0][0].message).toContain('共 45 Anlas');
  if (approved) expect(mocks.approve).toHaveBeenCalledWith(mocks.session, 9);
});
it('确认期间切Key不授权旧任务；暂停后只在主动继续时恢复', async () => {
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'awaiting_confirmation', awaiting: { cost: 9, requestedCount: 6, completedCount: 0 }, progress: { current: 0, total: 6 } };
  mocks.history.mockResolvedValue([]);
  mocks.confirm.mockImplementationOnce(async () => { mocks.key = 'another-key'; return true; }); await setup(); fireEvent.click(screen.getByRole('button', { name: '确认费用' })); await screen.findByText(/NovelAI Key 已变化/); expect(mocks.approve).not.toHaveBeenCalled();
  cleanup(); mocks.key = 'synthetic-key'; mocks.session = { ...mocks.session, state: 'paused', awaiting: undefined }; mocks.history.mockResolvedValue([]); await setup(); expect(mocks.pause).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续' })); await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith('synthetic-key', false));
});
it('全局选择聚焦生效，搜索隐藏当前候选时自动收起详情', async () => {
  const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); expect(screen.getByRole('button', { name: '查看候选 2' }).className).toContain('brightness-[.7]');
  view.rerender(<StyleRollPage {...view.props} selectionFocusEnabled={false} />); expect(screen.getByRole('button', { name: '查看候选 2' }).className).not.toContain('brightness-[.7]');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师、中文名或编号' }), { target: { value: 'beta' } });
  expect(screen.queryByRole('button', { name: '关闭候选详情' })).toBeNull(); expect(screen.queryByRole('button', { name: '查看候选 1' })).toBeNull();
});
it('手机详情置于工作区之外，返回保留画风库', async () => {
  mocks.mobile = true; await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); const dialog = await screen.findByRole('dialog', { name: '候选 1' }); expect(dialog.closest('[data-roll-page]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
});
it('历史读取失败阻止未知状态重复消费，任务保存回执仍保留', async () => {
  mocks.history.mockRejectedValue(new Error('合成历史读取失败')); await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
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
  mocks.save.mockImplementationOnce(async value => { experiment = { ...value, revision: value.revision + 1 }; return experiment; }).mockRejectedValueOnce(new Error('第二项合成冲突'));
  fireEvent.click(screen.getByRole('button', { name: '保存所选' }));
  await screen.findByText(/第二项合成冲突/); expect(screen.getByText('已选 1 个候选')).toBeTruthy();
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '保存所选' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(props.onSaveChain).toHaveBeenCalledTimes(2); expect(mocks.upload).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.getByText('已选 0 个候选')).toBeTruthy());
});

const setFavorites = (ids: string[]) => act(() => { mocks.favorites = new Set(ids); mocks.collectionRevision++; mocks.collectionListeners.forEach(listener => listener()); });

it('收藏读取失败不把图片判成未收藏，禁用快捷选择并可原位重试', async () => {
  mocks.ensureCollection.mockRejectedValueOnce(new Error('temporary failure'));
  mocks.favorites = new Set(['history-a']);
  const { container } = await setup();
  await waitFor(() => expect(mocks.ensureCollection).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  expect(screen.getByRole('button', { name: '选择已收藏图片' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '选择未收藏图片' })).toHaveProperty('disabled', true);
  const state = await executeAgentCommand(container, 'get_roll_state', {}, true) as { candidates: { favorite: boolean | null }[] };
  expect(state.candidates.every(candidate => candidate.favorite === null)).toBe(true);
});

it('多选可直接选中已收藏或未收藏图片并同步助手收藏状态', async () => {
  experiment.candidates.push(candidateFixture('c', 'gamma'));
  mocks.history.mockResolvedValue(rows(experiment).slice(0, 2)); mocks.favorites = new Set(['history-a']);
  const { container } = await setup();
  await waitFor(() => expect(screen.getByAltText('候选 1')).toBeTruthy());
  expect(screen.queryByRole('img', { name: '已收藏' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  expect(within(screen.getByRole('checkbox', { name: '选择候选 1' })).getByRole('img', { name: '已收藏' })).toBeTruthy();
  expect(within(screen.getByRole('checkbox', { name: '选择候选 2' })).queryByRole('img', { name: '已收藏' })).toBeNull();
  expect(within(screen.getByRole('checkbox', { name: '选择候选 3' })).queryByRole('img', { name: '已收藏' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '选择已收藏图片' }));
  expect(screen.getByRole('checkbox', { name: '选择候选 1' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: '选择候选 2' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: '选择候选 3' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '选择未收藏图片' }));
  expect(screen.getByRole('checkbox', { name: '选择候选 1' }).getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('checkbox', { name: '选择候选 2' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: '选择候选 3' }).getAttribute('aria-checked')).toBe('false');
  const state = await executeAgentCommand(container, 'get_roll_state', {}, true) as { candidates: { id: string; favorite: boolean }[] };
  expect(state.candidates.map(candidate => [candidate.id, candidate.favorite])).toEqual([['a', true], ['b', false], ['c', false]]);
});

it('单项删除永久移除候选，不删除原图及保存的风格串', async () => {
  experiment.candidates[0].savedChainId = 'existing';
  const removedId = experiment.candidates[0].id;
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '删除候选 1' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0].candidates.map((item: any) => item.id)).not.toContain(removedId);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('完整轮次不显示伪补图入口，旧轮缺图可手选补齐', async () => {
  experiment.rounds = [{ id: 'old', candidateIds: ['a'], createdAt: 1, closedAt: 2 }, { id: 'new', candidateIds: ['b'], createdAt: 3 }];
  mocks.history.mockResolvedValue([rollImageFixture(experiment, experiment.candidates[1])]);
  await setup(); expect(screen.queryByRole('button', { name: /补齐剩余/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '批量选择候选' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择候选 1' }));
  fireEvent.click(screen.getByRole('button', { name: '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce()); expect(mocks.generate.mock.calls[0][1].id).toBe('a');
  const saved = mocks.save.mock.calls[0][0]; expect(saved.rounds[1].closedAt).toBeGreaterThan(0); expect(saved.rounds[2].candidateIds).toEqual(['a']);
});

it('记录可重命名与删除，删除后记录与候选一并离场且不触碰原图', async () => {
  const other = { ...structuredClone(experiment), id: 'other-record', name: '另一记录' };
  mocks.load.mockResolvedValue([recordSummary(experiment.id, experiment.name, { updatedAt: 2 }), recordSummary(other.id, other.name, { updatedAt: 1 })]);
  mocks.loadOne.mockImplementation(async (id: string) => structuredClone(id === other.id ? other : experiment));
  await setup();
  // 记录管理只有左栏一处，顶栏不再保留「管理记录」浮层。
  expect(screen.queryByRole('button', { name: '管理记录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '重命名记录：合成实验' }));
  fireEvent.change(screen.getByRole('textbox', { name: '记录名称' }), { target: { value: '新的画风记录' } }); fireEvent.submit(screen.getByRole('textbox', { name: '记录名称' }).closest('form')!);
  await waitFor(() => expect(screen.getByRole('button', { name: '切换画风记录' }).getAttribute('title') || screen.getByRole('button', { name: '切换画风记录' }).textContent).toContain('新的画风记录'));
  fireEvent.click(await screen.findByRole('button', { name: '删除记录：新的画风记录' }));
  // 删除是彻底的：直接走 DELETE，而不是把 archived 标记写回记录。
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(experiment.id, expect.any(Number)));
  expect(mocks.confirm).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: '切换画风记录' }).getAttribute('title') || screen.getByRole('button', { name: '切换画风记录' }).textContent).toContain('另一记录'));
  expect(mocks.save.mock.calls.some(call => call[0]?.archived === true)).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('旧版回收站里标记删除的记录只保留一次性清理入口', async () => {
  mocks.load.mockResolvedValue([recordSummary(experiment.id, experiment.name, { updatedAt: 2 }), recordSummary('legacy-record', '旧记录', { archived: true, updatedAt: 1 })]);
  mocks.loadOne.mockImplementation(async () => structuredClone(experiment));
  await setup();
  // 已删除的旧记录不出现在记录导航里，左栏底部只留一次性清理。
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  const navigation = await screen.findByRole('complementary', { name: '画风记录列表' });
  expect(within(navigation).queryByRole('button', { name: '打开画风记录：旧记录' })).toBeNull();
  fireEvent.click(within(navigation).getByRole('button', { name: '清理 1 条旧的已删除记录' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('legacy-record', expect.any(Number)));
  expect(mocks.confirm).toHaveBeenCalled();
});

it('设置直接固定部分 Tag，总人数包含固定项且所有权重随机', async () => {
  await setup(); configure('每串总人数', '5'); configure('最低权重', '1.8'); configure('最高权重', '2.2');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.queryByRole('button', { name: /全随机|固定权重|选择固定画师/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '手动添加固定 Tag' }));
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: /偏好与画师范围/ }));
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

it('生成设置从本轮菜单打开时关闭原弹层，避免两个模态窗口叠盖', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '设置' })); fireEvent.click(screen.getByRole('button', { name: '提示词与生成设置' }));
  expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull(); expect(screen.getByRole('button', { name: '保存合成实验' })).toBeTruthy();
});
it.each([false, true])('多选补图显示实际提交张数，遵循连续生成开关与每轮24张上限：%s', async continuous => {
  experiment.candidates = Array.from({ length: 25 }, (_, index) => candidateFixture('pending-' + index, 'artist-' + index)); mocks.history.mockResolvedValue([]);
  await setup({ continuousGenerationEnabled: continuous }); fireEvent.click(screen.getByRole('button', { name: '批量选择候选' })); fireEvent.click(screen.getByRole('button', { name: '全选筛选结果' }));
  fireEvent.click(screen.getByRole('button', { name: continuous ? '生成所选 · 24' : '生成所选 · 1' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(continuous ? mocks.generate.mock.calls[0][1].length : 1).toBe(continuous ? 24 : 1);
  expect(mocks.generate.mock.calls[0][0].rounds.at(-1).candidateIds).toHaveLength(continuous ? 24 : 1);
});


it('页面只提供Roll和配方操作，不包含筛选弹窗、对比入口、评分或投票快捷键', async () => {
  const { props } = await setup();
  expect(screen.queryByRole('button', { name: /^筛选/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /画风对比|可选工具|进化下一轮|换 Seed 验证/ })).toBeNull();
  expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull();
  expect(screen.queryByText(/变异|画师基因配方|来源候选|纯新探索|微调变体/)).toBeNull();
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

it('卡片画师标签最多三个并显示剩余数量，编号只保留在左上角', async () => {
  await setup();
  const chip = screen.getByText('alpha').closest('.gallery-card-badge');
  expect(chip).toBeTruthy();
  expect(chip!.className).toContain('min-w-0');
  // 画师标签行必须撑满底栏：磨砂底栏是纵轴布局，若只靠父级对齐会缩成内容宽度并居中。
  expect(chip!.parentElement!.className).toContain('w-full');
  const card = screen.getByRole('button', { name: '查看候选 1' });
  expect(card.querySelectorAll('.gallery-card-badge').length).toBeLessThanOrEqual(4);
  expect(card.querySelectorAll('.gallery-card-meta')).toHaveLength(0);
});

it('可从候选新建记录并预置固定画师，保留自定义公共配置与Seed', async () => {
  experiment.template = { ...experiment.template, prompt: '{style}, custom source', negativePrompt: 'custom negative', characterPrompt: 'custom character', params: { ...experiment.template.params, seed: 42 } };
  const originalTemplate = structuredClone(experiment.template);
  await setup(); fireEvent.click(screen.getByRole('button', { name: '查看候选 1' })); details();
  fireEvent.click(screen.getByRole('button', { name: '新建记录 · 固定这些画师' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const created = mocks.save.mock.calls[0][0];
  expect(created.pinnedArtists).toEqual(['alpha']);
  expect(created.template).toEqual(originalTemplate);
  expect(created.rules).toMatchObject({ minArtists: 1, maxArtists: 1 });
  expect(created.candidates).toEqual([]);
  expect(created.name).not.toContain('权重');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  expect(screen.getByRole('button', { name: '锁定画师：alpha' }).getAttribute('aria-pressed')).toBe('true');
});

it('重 Roll 后保留旧候选一并展示，不会被筛掉', async () => {
  experiment.rounds = [{ id: 'old', candidateIds: ['a'], createdAt: 1 }];
  await setup(); fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '查看候选 1' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看候选 2' })).toBeTruthy();
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

it('生成状态不再有底部小框：空闲候选卡自带生成按钮，中断记录不渲染横幅', async () => {
  experiment.rounds = [{ id: 'interrupted-round', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([rollImageFixture(experiment, experiment.candidates[0])]);
  mocks.interrupted = [{ token: 'interrupted-token', scope: 'style-roll:synthetic-experiment', count: 2, meta: { experimentId: 'synthetic-experiment', roundId: 'interrupted-round' } }];
  await setup();
  expect(screen.queryByText(/上次生成已中断/)).toBeNull();
  expect(screen.queryByRole('button', { name: '继续生成剩余' })).toBeNull();
  expect(screen.queryByRole('button', { name: '忽略' })).toBeNull();
  const card = screen.getByRole('button', { name: '查看候选 2' });
  fireEvent.click(within(card).getByRole('button', { name: '生成' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const [source, candidate] = mocks.generate.mock.calls[0];
  expect(source.id).toBe('synthetic-experiment');
  expect(candidate.id).toBe('b');
});

it('未出图卡片的占位区显示本批排序与生成按钮，已出图候选不显示生成入口', async () => {
  experiment.rounds = [{ id: 'batch-round', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([rollImageFixture(experiment, experiment.candidates[0])]);
  await setup();
  const pendingCard = screen.getByRole('button', { name: '查看候选 2' });
  expect(within(pendingCard).getByText('本批第 2/2 张')).toBeTruthy();
  expect(within(pendingCard).getByRole('button', { name: '生成' })).toBeTruthy();
  const doneCard = screen.getByRole('button', { name: '查看候选 1' });
  expect(within(doneCard).queryByRole('button', { name: '生成' })).toBeNull();
  expect(within(doneCard).queryByText(/本批第/)).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  expect(screen.getByRole('button', { name: '锁定画师：beta' }).getAttribute('aria-pressed')).toBe('true');
});

it('已归档候选不再出现在任何视图，原图与已保存风格串仍保留', async () => {
  experiment.candidates[1].archived = true;
  await setup();
  expect(screen.queryAllByRole('button', { name: /^查看候选 / })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '回收站' })).toBeNull();
  expect(screen.queryByRole('button', { name: '永久清理所选' })).toBeNull();
});

it('无论加载中、已出图还是未出图占位卡均不叠放左上角编号与轮次，右侧详情仍保留轮次信息', async () => {
  experiment.rounds = [{ id: 'first', candidateIds: ['a', 'b'], createdAt: 1 }];
  let resolveHistory!: (items: ReturnType<typeof rows>) => void;
  mocks.history.mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve; }));
  render(<StyleRollPage active chains={[]} enforceFreeStepLimit generationStreamPreview={false} onSaveChain={vi.fn()} onOpenChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
  const loadingCard = await screen.findByRole('button', { name: '查看候选 1' });
  expect(within(loadingCard).queryByText('#1')).toBeNull();
  expect(within(loadingCard).queryByText('R1')).toBeNull();
  await act(async () => { resolveHistory(rows(experiment).slice(0, 1)); });
  const generatedCard = screen.getByRole('button', { name: '查看候选 1' });
  const pendingCard = screen.getByRole('button', { name: '查看候选 2' });
  expect(within(generatedCard).queryByText('#1')).toBeNull();
  expect(within(generatedCard).queryByText('R1')).toBeNull();
  expect(within(pendingCard).queryByText('#2')).toBeNull();
  expect(within(pendingCard).queryByText('R1')).toBeNull();
  fireEvent.click(generatedCard);
  expect(screen.getByLabelText('候选生成信息').textContent).toContain('R1');
});

it('中转与公共队列排队状态直接融入正在生成的候选卡占位区', async () => {
  experiment.rounds = [{ id: 'first', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  mocks.session = { scope: `roll:${experiment.id}`, key: mocks.key, token: 't1', count: 2, state: 'generating', cloudQueueTaskId: 'q1', progress: { current: 0, total: 2, stopping: false } };
  await setup();
  const generatingCard = screen.getByRole('button', { name: '查看候选 1' });
  expect(within(generatingCard).getByText('生成中…')).toBeTruthy();

  act(() => {
    emitCloudQueueStatus({ taskId: 'q1', phase: 'waiting', proxy: true, cancelable: true });
  });
  expect(within(generatingCard).getByText('中转排队／生成中…')).toBeTruthy();

  act(() => {
    emitCloudQueueStatus({ taskId: 'q1', phase: 'waiting', proxy: false, position: 2, queueSize: 4, cancelable: true });
  });
  expect(within(generatingCard).getByText('排队中 · 前方 2 个任务')).toBeTruthy();
  expect(within(generatingCard).getByText('队列共 4 个任务')).toBeTruthy();
});

it('普通新建直接建好新记录并使用推荐模板与默认参数，不弹配置大窗且无风格串导入入口', async () => {
  experiment.template = { ...experiment.template, prompt: '{style}, custom source', negativePrompt: 'custom negative', characterPrompt: 'custom character', params: { ...experiment.template.params, seed: 42, width: 1024, height: 1024 } };
  const original = structuredClone(experiment);
  await setup({ chains: [{ id: 'source', type: 'style', name: '库中风格串' } as PromptChain] });
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  expect(screen.queryByRole('button', { name: '从风格串开始' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新建记录' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog', { name: 'Roll 串配置' })).toBeNull();
  const created = mocks.save.mock.calls[0][0] as RollExperiment;
  expect(created.id).not.toBe(original.id);
  expect(created.template.prompt).toBe(DEFAULT_ROLL_PROMPT);
  expect(created.template.negativePrompt).toBe(DEFAULT_ROLL_NEGATIVE);
  expect(created.template.characterPrompt).toBe(DEFAULT_ROLL_CHARACTER_PROMPT);
  expect(created.template.params).toMatchObject({ seed: 0, width: 832, height: 1216, scale: 5, qualityToggle: false, characters: [] });
  expect(experiment).toEqual(original);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('空记录仍可直接开始第一轮，但不再提供从风格串开始', async () => {
  experiment.candidates = []; mocks.load.mockResolvedValue([]);
  const { container } = await setup({ chains: [{ id: 'source', type: 'style', name: '库中风格串' } as PromptChain] });
  expect(screen.getByRole('button', { name: '开始第一轮' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '从风格串开始' })).toBeNull();
  expect(getAgentCommands(container).some(command => /from_chain|chain_seed/.test(command.name))).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('设置浮层的偏好与画师范围默认折叠并展示实时摘要，仅收藏开关保留倍率保底且大倍率滑条不回缩', async () => {
  experiment.rules = { ...experiment.rules, preferredMultiplier: 4.5, preferredMinArtists: 2 };
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const toggle = screen.getByRole('button', { name: /偏好与画师范围/ });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.textContent).toContain('偏好 4.5×');
  expect(toggle.textContent).toContain('保底 2 人');
  expect(screen.queryByRole('checkbox', { name: '只抽取收藏画师' })).toBeNull();
  fireEvent.click(toggle);
  const only = screen.getByRole('checkbox', { name: '只抽取收藏画师' });
  const multiplier = screen.getByRole('spinbutton', { name: '偏好抽中倍率' });
  const slider = screen.getByRole('slider', { name: '偏好抽中倍率滑条' });
  const minimum = screen.getByRole('spinbutton', { name: '每串偏好保底人数' });
  fireEvent.click(only);
  expect(only).toHaveProperty('checked', true);
  for (const control of [multiplier, slider, minimum]) expect(control.matches(':disabled')).toBe(true);
  expect(toggle.textContent).toContain('仅收藏');
  fireEvent.click(only);
  expect(multiplier).toHaveProperty('value', '4.5');
  expect(minimum).toHaveProperty('value', '2');
  fireEvent.change(multiplier, { target: { value: '250' } });
  expect(slider).toHaveProperty('max', '250');
  fireEvent.change(slider, { target: { value: '12' } });
  expect(multiplier).toHaveProperty('value', '12');
  expect(slider).toHaveProperty('max', '250');
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});

it('本轮人数与权重各占一行，保存范围并让助手遵循偏好保底', async () => {
  preferredItems.push({ sourceType: 'artist', sourceId: 'beta', archived: false });
  const { container } = await setup();
  configure('最少画师人数', '4'); configure('最多画师人数', '6');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const people = screen.getByRole('group', { name: '每串人数范围' }), weights = screen.getByRole('group', { name: '权重范围' });
  expect(people.contains(screen.getByLabelText('最多画师人数'))).toBe(true);
  expect(weights.contains(screen.getByLabelText('最低权重'))).toBe(true);
  expect(people.contains(weights)).toBe(false);
  expect(screen.queryByRole('textbox', { name: '固定画师 Tag（可选）' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /偏好与画师范围/ }));
  fireEvent.change(screen.getByLabelText('每串偏好保底人数'), { target: { value: '1' } });
  fireEvent.change(screen.getByRole('slider', { name: '偏好抽中倍率滑条' }), { target: { value: '3' } });
  expect(screen.getByRole('spinbutton', { name: '偏好抽中倍率' })).toHaveProperty('value', '3');
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 6, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.rules).toMatchObject({ minArtists: 4, maxArtists: 6, preferredMinArtists: 1, preferredMultiplier: 3 });
  expect(saved.candidates.slice(-6).every((candidate: any) => candidate.tags.some((tag: any) => tag.tag === 'beta'))).toBe(true);
});

it('只抽收藏：倍率1保底0仍读取有效收藏，整轮仅抽收藏且重进保留规则与快照', async () => {
  experiment.candidates = [];
  experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1, preferredMultiplier: 1, preferredMinArtists: 0, preferredOnly: true };
  preferredItems.push({ sourceType: 'artist', sourceId: 'beta', archived: false }, { sourceType: 'artist', sourceId: 'alpha', archived: true }, { sourceType: 'character', sourceId: 'gamma' });
  const view = await setup();
  mocks.ensureCollection.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.ensureCollection).toHaveBeenCalled();
  const [saved, candidates] = mocks.generate.mock.calls[0] as [RollExperiment, RollExperiment['candidates']];
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.every(candidate => candidate.tags.length === 1 && candidate.tags[0].tag === 'beta')).toBe(true);
  expect(saved.rules).toMatchObject({ preferredOnly: true, preferredMultiplier: 1, preferredMinArtists: 0 });
  expect(saved.rounds.at(-1)?.snapshot?.rules.preferredOnly).toBe(true);
  expect(mocks.save.mock.calls.at(-1)![0].rules.preferredOnly).toBe(true);
  view.unmount();
  experiment = structuredClone(saved);
  const reopened = await setup();
  const state = await executeAgentCommand(reopened.container, 'get_roll_state', {}, true) as { rules: RollRules };
  expect(state.rules.preferredOnly).toBe(true);
});

it('只抽收藏：没有有效收藏时页面与助手都停止，不保存候选或发起生成', async () => {
  experiment.candidates = [];
  experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1, preferredMultiplier: 1, preferredMinArtists: 0, preferredOnly: true };
  preferredItems.push({ sourceType: 'artist', sourceId: 'alpha', archived: true }, { sourceType: 'character', sourceId: 'beta' });
  const { container } = await setup();
  fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' }));
  await screen.findByText('可用收藏画师不足，请调整收藏、屏蔽、样张或来源范围，或降低每串总人数');
  await expect(executeAgentCommand(container, 'run_roll_round', { count: 1, generate: false }, false)).rejects.toThrow('可用收藏画师不足');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
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
  '/api/artist-samples/image?pack=v45&tag=alpha&index=0&revision=synthetic',
  '/api/artist-samples/image?pack=v5&tag=alpha&index=0&revision=synthetic',
  '/api/assets/own-sample.png',
  '/api/history/synthetic/image',
  'https://synthetic.invalid/unknown.jpg',
])('候选详情的画师头像可点开画师库：%s', async url => {
  sampleUrls.set('alpha', url);
  const onOpenArtistLibrary = vi.fn();
  const { container } = await setup({ onOpenArtistLibrary });
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  await waitFor(() => expect(container.querySelector(`img[src="${url}"]`)).toBeTruthy());
  const image = container.querySelector<HTMLImageElement>(`img[src="${url}"]`)!;
  expect(image.classList.contains('object-cover')).toBe(true);
  fireEvent.click(image);
  expect(onOpenArtistLibrary).toHaveBeenCalledWith('alpha');
  expect(image.getAttribute('src')).toBe(url);
});

it('图包原名进入完整选择目录并可固定，已知中文与无图词库条目仍保留', async () => {
  const tag = 'Pack_Only (Artist)';
  experiment.artists = []; experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  mocks.dictionary.mockResolvedValue([{ name: 'alpha', chinese: '词库中文', postCount: 42 }, { name: 'no sample', chinese: '', postCount: 2 }, { name: tag, chinese: '', postCount: 0, postCountKnown: false }]);
  const { container } = await setup(); openArtists();
  const dialog = screen.getByRole('dialog', { name: 'Roll 画师' });
  expect(within(dialog).getByText('词库中文')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: '锁定画师：no sample' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: `锁定画师：${tag}` }));
  expect(within(dialog).getByRole('button', { name: `锁定画师：${tag}` }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 1, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.pinnedArtists).toEqual([tag]); expect(saved.candidates.at(-1).tags[0].tag).toBe(tag);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('有样张抽取包含图包-only原名并遵循偏好保底，不将无图词库项混入', async () => {
  const tag = 'afternooners';
  experiment.artists = []; experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1, preferredMinArtists: 1 };
  preferredItems.push({ sourceType: 'artist', sourceId: tag, archived: false });
  mocks.dictionary.mockResolvedValue([{ name: 'no sample', chinese: '保留词库', postCount: 40 }, { name: tag, chinese: '', postCount: 0, postCountKnown: false }]);
  mocks.sampled.mockResolvedValue(new Set([tag]));
  const { container } = await setup(); await waitFor(() => expect(mocks.sampled).toHaveBeenCalled());
  await act(async () => { await executeAgentCommand(container, 'run_roll_round', { count: 2, sampledOnly: true, generate: false }, false); });
  const saved = mocks.save.mock.calls.at(-1)![0];
  expect(saved.candidates.slice(-2).every((candidate: any) => candidate.tags.length === 1 && candidate.tags[0].tag === tag)).toBe(true);
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('图包广播刷新完整目录，迟到旧响应不覆盖新目录，失败保留原列表并明确报错', async () => {
  const known = { name: 'alpha', chinese: '', postCount: 42 };
  mocks.dictionary.mockResolvedValue([known]);
  await setup(); openArtists();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师' }), { target: { value: 'pack' } });
  let resolveOld!: (value: any[]) => void;
  mocks.dictionary.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  act(() => window.dispatchEvent(new Event('nai-artist-samples-changed')));
  await waitFor(() => expect(mocks.dictionary).toHaveBeenCalledTimes(2));
  mocks.dictionary.mockResolvedValueOnce([known, { name: 'pack_new', chinese: '', postCount: 0, postCountKnown: false }]);
  act(() => window.dispatchEvent(new Event('nai-artist-samples-changed')));
  await screen.findByRole('button', { name: '锁定画师：pack_new' });
  await act(async () => { resolveOld([{ name: 'pack_stale', chinese: '', postCount: 0, postCountKnown: false }]); });
  expect(screen.queryByRole('button', { name: '锁定画师：pack_stale' })).toBeNull();
  expect(screen.getByRole('searchbox', { name: '搜索画师' })).toHaveProperty('value', 'pack');
  mocks.dictionary.mockRejectedValueOnce(new Error('图包目录读取失败'));
  act(() => window.dispatchEvent(new Event('nai-artist-samples-changed')));
  await within(screen.getByRole('dialog', { name: 'Roll 画师' })).findByText('图包目录读取失败');
  expect(screen.getByRole('button', { name: '锁定画师：pack_new' })).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
});

it('保存阶段即使关闭过程预览仍展示最终图，状态条明确保存且不能发起新轮', async () => {
  experiment.rounds = [{ id: 'live', candidateIds: ['a', 'b'], createdAt: 1 }];
  mocks.history.mockResolvedValue([]);
  mocks.session = { scope: 'style-roll:synthetic-experiment', key: 'synthetic-key', state: 'saving', progress: { current: 0, total: 2 }, preview: { image: 'data:image/png;base64,c3ludGhldGlj' } };
  await setup({ generationStreamPreview: false });
  expect(screen.getByAltText('生成预览').getAttribute('src')).toBe('data:image/png;base64,c3ludGhldGlj');
  expect(screen.getByText('正在保存…')).toBeTruthy();
  expect(mocks.generate).not.toHaveBeenCalled();
});

vi.mock('../../components/roll/StyleRollChainArtistDialog', () => ({ StyleRollChainArtistDialog: ({ source, blocked, onConfirm, onClose }: any) => <div role="dialog" aria-label="提取接线" data-source={JSON.stringify(source ?? null)} data-blocked={blocked.join(',')}><button onClick={() => { onConfirm({ chainIds: ['source-chain', 'source-two'], artists: [{ tag: 'beta', count: 2 }, { tag: 'gamma', count: 1 }, { tag: 'delta', count: 1 }, { tag: 'epsilon', count: 1 }] }); onClose(); }}>确认提取接线</button><button onClick={() => { onConfirm(undefined); onClose(); }}>使用全部画师接线</button><button onClick={onClose}>取消提取接线</button></div> }));

it('设置里直接提取抽样来源，不打开管理、不生成或保存参数；隐藏与切记录卸载', async () => {
  const second = { ...rollFixture(), id: 'other-record', name: '另一个记录' };
  mocks.load.mockImplementation(async () => [structuredClone(experiment), second]);
  const view = await setup();
  const chainButton = () => screen.getByRole('button', { name: /从风格串提取/ });
  const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const closeSettings = () => fireEvent.keyDown(window, { key: 'Escape' });
  const open = () => { openSettings(); fireEvent.click(chainButton()); };
  openSettings();
  expect(within(chainButton()).getByText('画师库')).toBeTruthy();
  closeSettings();
  open(); expect(screen.getByRole('dialog', { name: '提取接线' })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Roll 画师' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认提取接线' }));
  openSettings();
  expect(within(chainButton()).getByText('已选 2 串')).toBeTruthy();
  closeSettings();
  open(); expect(screen.getByRole('dialog', { name: '提取接线' }).getAttribute('data-source')).toContain('beta');
  view.rerender(<StyleRollPage {...view.props} active={false} />);
  expect(screen.queryByRole('dialog', { name: '提取接线' })).toBeNull();
  view.rerender(<StyleRollPage {...view.props} />); await waitFor(() => expect(screen.getByRole('button', { name: '再 Roll 一轮' }).hasAttribute('disabled')).toBe(false)); open();
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开画风记录：另一个记录' }));
  expect(screen.queryByRole('dialog', { name: '提取接线' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: '设置' }).hasAttribute('disabled')).toBe(false));
  open(); expect(screen.getByRole('dialog', { name: '提取接线' }).getAttribute('data-source')).not.toContain('beta');
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

it.each([false, true])('提取来源经页面/Agent保存到记录与轮次，可清除恢复全库，Agent=%s', async agent => {
  experiment.candidates = []; experiment.rules = { ...experiment.rules, minArtists: 2, maxArtists: 2 };
  // 轮次快照只留来源串 ID；「沿用这轮条件」按 ID 从这些风格串重新提取画师。
  const sourceChains = [
    { id: 'source-chain', type: 'style', name: '来源一', description: '', tags: [], basePrompt: 'beta, gamma', negativePrompt: '', modules: [], params: experiment.template.params, variableValues: { subject: '' }, createdAt: 1, updatedAt: 1 },
    { id: 'source-two', type: 'style', name: '来源二', description: '', tags: [], basePrompt: 'delta, epsilon', negativePrompt: '', modules: [], params: experiment.template.params, variableValues: { subject: '' }, createdAt: 1, updatedAt: 1 },
  ] as unknown as PromptChain[];
  const view = await setup({ chains: sourceChains });
  const chainButton = () => screen.getByRole('button', { name: /从风格串提取/ });
  const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '设置' }));
  const closeSettings = () => fireEvent.keyDown(window, { key: 'Escape' });
  openSettings(); fireEvent.click(chainButton());
  fireEvent.click(screen.getByRole('button', { name: '确认提取接线' }));
  const state = await executeAgentCommand(view.container, 'get_roll_state', {}, true) as any;
  expect(state.chainArtistSource.artists).toHaveLength(4);
  expect(state.pinnedArtists).toEqual([]);
  if (agent) await act(async () => { await executeAgentCommand(view.container, 'run_roll_round', { count: 1, generate: false }, false); });
  else { fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.save).toHaveBeenCalled()); }
  const saved = mocks.save.mock.calls.at(-1)![0] as RollExperiment;
  expect(saved.chainArtistSource?.artists).toHaveLength(4);
  expect(saved.rounds.at(-1)?.snapshot?.sourceChainIds).toEqual(saved.chainArtistSource?.chainIds);
  expect(saved.pinnedArtists).toEqual([]);
  expect(saved.template).toEqual(experiment.template);
  expect(saved.candidates.every(candidate => candidate.tags.length === 2 && candidate.tags.every(tag => ['beta', 'gamma', 'delta', 'epsilon'].includes(tag.tag)))).toBe(true);
  await waitFor(() => expect(screen.getByRole('button', { name: '再 Roll 一轮' }).hasAttribute('disabled')).toBe(false));
  openSettings(); fireEvent.click(chainButton());
  expect(screen.getByRole('dialog', { name: '提取接线' }).getAttribute('data-source')).toContain('source-chain');
  fireEvent.click(screen.getByRole('button', { name: '使用全部画师接线' }));
  openSettings();
  expect(within(chainButton()).getByText('画师库')).toBeTruthy();
  closeSettings();
  expect((await executeAgentCommand(view.container, 'get_roll_state', {}, true) as any).chainArtistSource).toBeUndefined();
});

it.each([false, true])('已有提取来源不依赖全词库成功，仍显示词库错误且UI/Agent可抽取，Agent=%s', async agent => {
  experiment.candidates = []; experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  experiment.chainArtistSource = { chainIds: ['saved-source'], artists: [{ tag: 'outside dictionary', count: 1 }] };
  mocks.dictionary.mockRejectedValue(new Error('合成词库读取失败'));
  const view = await setup();
  await waitFor(() => expect(screen.getByRole('button', { name: '再 Roll 一轮' }).hasAttribute('disabled')).toBe(false));
  expect((await executeAgentCommand(view.container, 'get_roll_state', {}, true) as any).library.error).toContain('合成词库读取失败');
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('button', { name: /从风格串提取/ }).hasAttribute('disabled')).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  if (agent) await act(async () => { await executeAgentCommand(view.container, 'run_roll_round', { count: 1, generate: false }, false); });
  else { fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.save).toHaveBeenCalled()); }
  expect(mocks.save.mock.calls.at(-1)![0].candidates.every((candidate: any) => candidate.tags[0].tag === 'outside dictionary')).toBe(true);
});
it.each([
  { tag: 'outside_dictionary', sample: 'outside dictionary', expected: 'outside dictionary' },
  { tag: 'alpha (style)', sample: 'alpha(style)', expected: 'alpha (style)' },
  { tag: 'beta (style)', sample: 'ＢＥＴＡ\\(style\\)', expected: 'beta (style)' },
].flatMap(entry => [false, true].map(agent => ({ ...entry, agent }))))('仅有样张从提取来源过滤词库外画师，来源=$tag 样张=$sample Agent=$agent', async ({ tag, sample, expected, agent }) => {
  experiment.candidates = []; experiment.artists = []; experiment.sampledOnly = true;
  experiment.rules = { ...experiment.rules, minArtists: 1, maxArtists: 1 };
  experiment.chainArtistSource = { chainIds: ['saved-source'], artists: [{ tag, count: 1 }, { tag: 'no source sample', count: 1 }] };
  mocks.dictionary.mockResolvedValue([{ name: 'unrelated dictionary', chinese: '', postCount: 1 }]);
  mocks.sampled.mockResolvedValue(new Set([sample]));
  const view = await setup();
  await waitFor(() => expect(screen.getByRole('button', { name: '再 Roll 一轮' }).hasAttribute('disabled')).toBe(false));
  if (agent) await act(async () => { await executeAgentCommand(view.container, 'run_roll_round', { count: 1, generate: false }, false); });
  else { fireEvent.click(screen.getByRole('button', { name: '再 Roll 一轮' })); await waitFor(() => expect(mocks.save).toHaveBeenCalled()); }
  expect(mocks.save.mock.calls.at(-1)![0].candidates.every((candidate: any) => candidate.tags.length === 1 && candidate.tags[0].tag === expected)).toBe(true);
});

const recordSummary = (id: string, name: string, extra: { archived?: boolean; rounds?: number; candidates?: number; createdAt?: number; updatedAt?: number } = {}) => ({ id, name, revision: 0, archived: false, createdAt: 1, updatedAt: 1, rounds: 1, candidates: 2, ...extra });

it('桌面展开画风记录左栏，按名称与最近时间列出并切换记录', async () => {
  const other = { ...structuredClone(experiment), id: 'other-record', name: '另一记录' };
  mocks.load.mockResolvedValue([recordSummary(experiment.id, experiment.name, { updatedAt: 2 }), recordSummary(other.id, other.name, { updatedAt: 1, candidates: 5 })]);
  mocks.loadOne.mockImplementation(async (id: string) => structuredClone(id === other.id ? other : experiment));
  await setup();
  // 默认折叠：顶栏按钮只显示当前记录名，主区不额外让出宽度。
  expect(screen.queryByRole('complementary', { name: '画风记录列表' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  const navigation = await screen.findByRole('complementary', { name: '画风记录列表' });
  expect(within(navigation).getByRole('button', { name: '打开画风记录：合成实验' }).getAttribute('aria-pressed')).toBe('true');
  // 副行给出轮次、候选数与最近时间，不必展开记录就能分辨。
  expect(within(navigation).getByText(/1 轮 · 2 个候选/)).toBeTruthy();
  expect(within(navigation).getByText(/1 轮 · 5 个候选/)).toBeTruthy();
  fireEvent.click(within(navigation).getByRole('button', { name: '打开画风记录：另一记录' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '切换画风记录' }).getAttribute('title') || screen.getByRole('button', { name: '切换画风记录' }).textContent).toContain('另一记录'));
  expect(within(navigation).getByRole('button', { name: '打开画风记录：另一记录' }).getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('nai-roll-records-expanded')).toBe('true');
});

it('记录左栏支持搜索、按创建时间排序，并记住展开偏好', async () => {
  localStorage.setItem('nai-roll-records-expanded', 'true');
  const records = Array.from({ length: 8 }, (_, index) => recordSummary(`record-${index}`, `记录 ${index}`, { createdAt: index + 1, updatedAt: 100 - index }));
  mocks.load.mockResolvedValue(records);
  mocks.loadOne.mockImplementation(async (id: string) => structuredClone({ ...experiment, id, name: `记录 ${id.split('-')[1]}` }));
  await setup();
  const navigation = await screen.findByRole('complementary', { name: '画风记录列表' });
  const rows = () => within(navigation).getAllByRole('button', { name: /^打开画风记录：/ }).map(button => button.getAttribute('aria-label'));
  expect(rows()[0]).toBe('打开画风记录：记录 0');
  fireEvent.click(within(navigation).getByRole('button', { name: '记录排序' }));
  expect(rows()[0]).toBe('打开画风记录：记录 7');
  expect(within(navigation).queryByRole('button', { name: '重新加载画风记录' })).toBeNull();
  fireEvent.change(within(navigation).getByRole('textbox', { name: '搜索画风记录' }), { target: { value: '记录 3' } });
  expect(rows()).toEqual(['打开画风记录：记录 3']);
  fireEvent.change(within(navigation).getByRole('textbox', { name: '搜索画风记录' }), { target: { value: '没有这条' } });
  expect(within(navigation).getByRole('status').textContent).toBe('没有匹配的画风记录');
});

it('记录左栏内联重命名当前记录，删除后从导航移除且不触碰历史图片', async () => {
  const other = { ...structuredClone(experiment), id: 'other-record', name: '另一记录' };
  mocks.load.mockResolvedValue([recordSummary(experiment.id, experiment.name, { updatedAt: 3 }), recordSummary(other.id, other.name, { updatedAt: 2 })]);
  mocks.loadOne.mockImplementation(async (id: string) => structuredClone(id === other.id ? other : experiment));
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  const navigation = await screen.findByRole('complementary', { name: '画风记录列表' });
  fireEvent.click(within(navigation).getByRole('button', { name: '重命名记录：合成实验' }));
  fireEvent.change(within(navigation).getByRole('textbox', { name: '记录名称' }), { target: { value: '改名后的记录' } });
  fireEvent.submit(within(navigation).getByRole('textbox', { name: '记录名称' }).closest('form')!);
  await waitFor(() => expect(mocks.save.mock.calls.at(-1)![0].name).toBe('改名后的记录'));
  await within(navigation).findByRole('button', { name: '打开画风记录：改名后的记录' });
  fireEvent.click(within(navigation).getByRole('button', { name: '删除记录：改名后的记录' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(experiment.id, expect.any(Number)));
  await waitFor(() => expect(screen.queryByRole('button', { name: '打开画风记录：改名后的记录' })).toBeNull());
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('手机记录按钮打开底部面板，选中记录后面板收起', async () => {
  mocks.mobile = true; vi.stubGlobal('innerWidth', 390);
  const other = { ...structuredClone(experiment), id: 'other-record', name: '另一记录' };
  mocks.load.mockResolvedValue([recordSummary(experiment.id, experiment.name, { updatedAt: 2 }), recordSummary(other.id, other.name, { updatedAt: 1 })]);
  mocks.loadOne.mockImplementation(async (id: string) => structuredClone(id === other.id ? other : experiment));
  await setup();
  // 手机不铺桌面左栏：同一个按钮打开底部面板。
  fireEvent.click(screen.getByRole('button', { name: '切换画风记录' }));
  const panel = await screen.findByRole('dialog', { name: '画风记录' });
  expect(within(panel).getByRole('button', { name: '打开画风记录：另一记录' })).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: '打开画风记录：另一记录' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '画风记录' })).toBeNull());
  expect(screen.getByRole('button', { name: '切换画风记录' }).getAttribute('title') || '').toContain('另一记录');
});

it('候选详情展示基础元信息并支持直接固定或屏蔽画师到下一轮', async () => {
  const seeded = structuredClone(experiment);
  seeded.candidates[0].savedChainId = 'chain-saved';
  seeded.rounds = [{ id: 'round-1', candidateIds: [seeded.candidates[0].id], createdAt: 1 }];
  mocks.loadOne.mockResolvedValue(seeded);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '查看候选 1' }));
  const meta = screen.getByLabelText('候选生成信息');
  expect(meta.textContent).toContain('R1');
  expect(meta.textContent).toContain('832×1216');
  expect(meta.textContent).toContain('Seed 0');

  const pinButton = screen.getByRole('button', { name: '固定画师 alpha' });
  fireEvent.click(pinButton);
  expect(screen.getByRole('button', { name: '取消固定画师 alpha' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '屏蔽画师 alpha' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '取消屏蔽画师 alpha' }).getAttribute('aria-pressed')).toBe('true'));
  // 屏蔽自动解除该画师的固定状态并禁用固定按钮。
  const unpinnedButton = screen.getByRole('button', { name: '固定画师 alpha' }) as HTMLButtonElement;
  expect(unpinnedButton.getAttribute('aria-pressed')).toBe('false');
  expect(unpinnedButton.disabled).toBe(true);
});

it('顶栏不再提供冗余筛选入口，搜索无结果禁用多选并可一键清空，设置可调偏好与有样张开关', async () => {
  await setup();
  expect(screen.queryByRole('button', { name: /^筛选/ })).toBeNull();

  // 顶栏设置展开偏好与画师范围后可调整倍率、保底人数与有样张开关。
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByRole('button', { name: /偏好与画师范围/ }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '偏好抽中倍率' }), { target: { value: '12' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '每串偏好保底人数' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' }));
  expect((screen.getByRole('checkbox', { name: '只从有样张的画师中抽取' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '设置' }));

  // 搜索无结果时禁用多选，并提供就地「清空搜索」按钮。
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索画师、中文名或编号' }), { target: { value: '不存在的画师' } });
  expect((screen.getByRole('button', { name: '批量选择候选' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '查看候选 2' })).toBeTruthy());
  expect((screen.getByRole('button', { name: '批量选择候选' }) as HTMLButtonElement).disabled).toBe(false);
});
