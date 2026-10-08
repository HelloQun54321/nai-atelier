import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalGenItem, PromptChain } from '../../types';
import { cloneDefaultLabPageLayouts } from '../../services/appearancePreferences';
import { createLabWorkspaceSession, loadLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';
import { ChainEditor, type ChainEditorSaveHandle } from '../../components/ChainEditor';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from '../../services/naiRuntime';
import type { NovelaiSubscriptionInfo } from '../../services/naiUsage';
type ImageEditPanelProps = React.ComponentProps<typeof import('../../components/ImageEditPanel').ImageEditPanel>;

const state = vi.hoisted(() => ({
  agent: null as React.ComponentProps<typeof import('../../components/chain/PresetSourceBadges').PromptAgentOverlayController> | null,
  history: vi.fn(async (): Promise<LocalGenItem[]> => []),
  addHistory: vi.fn(),
  unlinkHistory: vi.fn(async () => {}),
  getEditMask: vi.fn(async (): Promise<Blob | null> => null),
  confirm: vi.fn(async () => true),
  generate: vi.fn(),
  assets: new Map<string, Blob>(),
  delayedAsset: null as Promise<Blob> | null,
  delayedBaseSave: null as Promise<void> | null,
  runtime: null as NaiRuntimeConfig | null,
  subscription: null as NovelaiSubscriptionInfo | null,
  subscriptionLoading: false,
  refreshedSubscription: null as NovelaiSubscriptionInfo | null,
  delayedSubscription: null as Promise<NovelaiSubscriptionInfo | null> | null,
}));

vi.mock('../../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/naiRuntime')>();
  return { ...actual, getNaiRuntimeConfig: async () => actual.DEFAULT_NAI_RUNTIME,
    useNaiRuntime: () => state.runtime || actual.DEFAULT_NAI_RUNTIME };
});
vi.mock('../../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiUsage')>(),
  useNovelaiUsage: () => ({ info: state.subscription, usage: state.subscription?.usage, loading: state.subscriptionLoading, error: null, fetchedAt: 0, refresh: async () => state.refreshedSubscription, refreshIfStale: async () => state.delayedSubscription || state.refreshedSubscription }),
}));
vi.mock('../../services/anlasBudget', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/anlasBudget')>(),
  useAnlasBudget: () => ({ remaining: 1666, loading: false }),
}));
vi.mock('../../services/localHistory', () => ({ localHistory: { getBySourceChain: state.history, add: state.addHistory, unlinkFromSourceChain: state.unlinkHistory, getEditMask: state.getEditMask } }));
vi.mock('../../services/labWorkspace', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/labWorkspace')>(),
  cleanupLabWorkspaceAssets: async () => {},
  readLabWorkspaceAsset: async (id: string) => id === 'delayed-base' && state.delayedAsset ? state.delayedAsset : state.assets.get(id) || null,
  deleteLabWorkspaceAsset: async () => {},
  saveLabWorkspaceAsset: async (blob: Blob, id: string) => { state.assets.set(id, blob); return id; },
  dataUrlToWorkspaceAsset: async (dataUrl: string, id = 'synthetic-pasted-asset') => {
    if (state.delayedBaseSave) await state.delayedBaseSave;
    state.assets.set(id, new Blob([Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' }));
    return id;
  },
}));
vi.mock('../../services/naiService', () => ({ generateImage: state.generate, generateImageStream: state.generate, generateImageEdit: state.generate, generateImageEditStream: state.generate }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => state.confirm }));
vi.mock('../../components/CloudQueueStatus', () => ({ useCloudQueueStatus: () => null, InlineCloudQueueStatus: () => null }));
vi.mock('../../components/LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('../../components/TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: (props: { value: string; placeholder?: string; onValueChange: (value: string) => void }) => <textarea value={props.value} placeholder={props.placeholder} onChange={event => props.onValueChange(event.target.value)} /> }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: () => null }));
vi.mock('../../components/ChainEditorPreview', () => ({ ChainEditorPreview: (props: React.ComponentProps<typeof import('../../components/ChainEditorPreview').ChainEditorPreview>) => <section aria-label="文生图预览">
  <output aria-label="文生图结果">{props.generatedImage}</output>
  <output aria-label="文生图费用">{props.generationCostLabel}</output>
  <output aria-label="预览历史编号">{props.historyLabel}</output>
  {props.canNavigateHistory && <button onClick={props.onNextHistory}>浏览下一张</button>}
  <button onClick={() => { void props.handleGenerate(); }}>生成合成文生图</button>
</section> }));
vi.mock('../../components/VibeManager', () => ({ VibeManager: () => null }));
vi.mock('../../components/CharacterReferenceManager', () => ({ CharacterReferenceManager: () => null }));
vi.mock('../../components/ImageTaggerPanel', () => ({ ImageTaggerPanel: () => null }));
vi.mock('../../components/chain/ChainEditorCharacters', () => ({ ChainEditorCharacters: () => null }));
vi.mock('../../components/chain/ChainEditorPresetModal', () => ({ ChainEditorPresetModal: () => null }));
vi.mock('../../components/chain/PresetSourceBadges', async importOriginal => ({
  ...await importOriginal<typeof import('../../components/chain/PresetSourceBadges')>(),
  PromptAgentOverlayController: (props: React.ComponentProps<typeof import('../../components/chain/PresetSourceBadges').PromptAgentOverlayController>) => { state.agent = props; return null; },
}));
// 只替换 Canvas 表面；真实编辑器、顶栏、切换、保存和会话持久化均执行实际代码。
vi.mock('../../components/ImageEditPanel', () => ({ ImageEditPanel: (props: ImageEditPanelProps) => <section aria-label={props.operation}>
  <input aria-label="编辑提示词" value={props.draft.prompt} onChange={event => props.onPromptChange(event.target.value)} />
  <input aria-label="编辑负面词" value={props.draft.negativePrompt} onChange={event => props.onNegativePromptChange(event.target.value)} />
  <button onClick={() => props.onDraftChange({ strength: 0.42 })}>调整强度</button>
  <output aria-label="编辑强度">{props.draft.strength}</output>
  <output aria-label="聚焦重绘状态">{String(props.draft.focused)}</output>
  <output aria-label="编辑费用">{props.generationCostLabel(props.operation, props.draft.focused, { width: 832, height: 1216, focusedRect: props.draft.focusedRect })}</output>
  <button onClick={() => props.onDraftChange({ focused: false })}>使用普通重绘</button>
  <output aria-label="编辑底图">{props.baseImage}</output>
  <output aria-label="编辑底图读取状态">{String(props.isBaseImageLoading)}</output>
  <output aria-label="编辑蒙版">{props.maskData}</output>
  <output aria-label="编辑结果">{props.previewImage}</output>
  {props.canNavigateHistory && <button onClick={props.onNextHistory}>浏览编辑下一张</button>}
  {props.canManageHistoryGroup && <button onClick={props.onRemoveCurrentHistory}>移除编辑历史</button>}
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,cGFzdGVk', 'clipboard', 'old-parent'); }}>粘贴合成底图</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'upload', undefined, { prompt: '', negativePrompt: '', params: { ...props.draft.params, characters: [{ id: 'imported', prompt: 'imported character', x: 0.2, y: 0.8 }] } }); }}>上传分角色底图</button>
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.3, y: 0.7 }], useCoords: true } })}>修改编辑角色</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'clipboard', undefined, { prompt: 'copied scene', negativePrompt: 'copied negative', params: { ...props.draft.params, characters: [{ id: 'copied', prompt: 'copied role', negativePrompt: 'copied role negative', x: 0.2, y: 0.8 }] } }); }}>粘贴分角色底图</button>
  {props.latestTextToImageItem && <button onClick={() => { void props.onBaseImageChange(props.latestTextToImageItem!.imageUrl, 'generated', props.latestTextToImageItem!.id); }}>文生图最新</button>}
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [] } })}>清空编辑角色</button>
  <button onClick={() => { void props.onGenerate({ operation: props.operation, image: 'data:image/png;base64,AQID', canvasWidth: 832, canvasHeight: 1216, strength: 1, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource }); }}>生成合成编辑</button>
  <button onClick={() => { void props.onGenerate({ operation: 'image-to-image', image: 'data:image/png;base64,AQID', canvasWidth: 1024, canvasHeight: 1024,
    params: { ...props.draft.params, width: 1024, height: 1024, characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.4, y: 0.7 }] },
    strength: 0.7, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource }); }}>生成尺寸副本</button>
</section> }));

const chain: PromptChain = {
  id: 'synthetic-style', name: '合成风格串', description: '', type: 'style', userId: 'local-owner', tags: [],
  basePrompt: 'saved style', negativePrompt: 'saved negative', variableValues: { subject: 'subject' },
  modules: [{ id: 'light', name: '光线', content: 'soft light', isActive: true, position: 'post' }],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' },
  createdAt: 1, updatedAt: 1,
};
const fallback = () => createLabWorkspaceSession(chain.basePrompt, 'subject', chain.negativePrompt, chain.params, { light: true });
const setup = (entry: PromptChain = chain) => {
  const props = { chain: entry, allChains: [entry], onUpdateChain: vi.fn(async () => {}), onFork: vi.fn(async () => {}), setIsDirty: vi.fn(), notify: vi.fn(),
    saveRef: React.createRef<ChainEditorSaveHandle>(),
    tagAssistEnabled: false, onTagAssistEnabledChange: vi.fn(), generationStreamPreview: false, labPageLayouts: cloneDefaultLabPageLayouts(), safeMode: false, onBack: vi.fn() };
  return { ...render(<ChainEditor {...props} />), props };
};
const textPrompt = () => screen.getByPlaceholderText('输入全局提示词，英文逗号分隔') as HTMLTextAreaElement;
const switchTo = async (label: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
  await waitFor(() => expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false));
};

beforeEach(() => {
  state.assets.clear();
  state.delayedAsset = null;
  state.delayedBaseSave = null;
  state.runtime = { ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } };
  state.subscription = null; state.refreshedSubscription = null;
  state.subscriptionLoading = false;
  state.delayedSubscription = null;
  state.getEditMask.mockReset(); state.getEditMask.mockResolvedValue(null);
  state.confirm.mockReset(); state.confirm.mockResolvedValue(true); state.history.mockReset(); state.history.mockResolvedValue([]); state.generate.mockReset(); state.addHistory.mockReset(); state.unlinkHistory.mockClear();
  state.addHistory.mockImplementation(async (_blob, prompt, params, negativePrompt, source) => ({
    ...source, id: `new-${state.addHistory.mock.calls.length}`, imageUrl: `/synthetic/new-${state.addHistory.mock.calls.length}.png`,
    prompt, params, negativePrompt, createdAt: 100 + state.addHistory.mock.calls.length,
  }));
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['style', 'character'] as const)('%s 离开前保存复用当前最新草稿，返回成功并清除未保存标记', async type => {
  const { props } = setup({ ...chain, type });
  fireEvent.change(textPrompt(), { target: { value: '修改后的最新提示词' } });
  expect(props.saveRef.current?.canSave).toBe(true);
  let result: boolean | undefined;
  await act(async () => { result = await props.saveRef.current!.save(); });
  expect(result).toBe(true);
  expect(props.onUpdateChain).toHaveBeenCalledExactlyOnceWith(chain.id, expect.objectContaining({ basePrompt: '修改后的最新提示词', negativePrompt: chain.negativePrompt, params: expect.objectContaining({ width: 832 }) }));
  expect(props.setIsDirty).toHaveBeenLastCalledWith(false);
  expect(props.notify).toHaveBeenLastCalledWith(type === 'style' ? '风格串已保存' : '自定义角色已保存');
});

it('离开前保存失败返回 false，保留原草稿与未保存标记，重试仍能保存', async () => {
  const { props } = setup();
  fireEvent.change(textPrompt(), { target: { value: '不能丢失的草稿' } });
  props.onUpdateChain.mockRejectedValueOnce(new Error('合成保存失败'));
  let result: boolean | undefined;
  await act(async () => { result = await props.saveRef.current!.save(); });
  expect(result).toBe(false);
  expect(textPrompt().value).toBe('不能丢失的草稿');
  expect(props.setIsDirty).toHaveBeenLastCalledWith(true);
  expect(props.notify).toHaveBeenLastCalledWith('保存失败：合成保存失败', 'error');
  await act(async () => { result = await props.saveRef.current!.save(); });
  expect(result).toBe(true);
  expect(props.onUpdateChain).toHaveBeenCalledTimes(2);
});

it('离开前保存能力跟随模式与忙碌状态，不保存编辑模式或自由实验室的半套配置', async () => {
  const { props, unmount } = setup();
  for (const label of ['图生图', '局部重绘', '扩图']) {
    await switchTo(label);
    expect(props.saveRef.current?.canSave).toBe(false);
    expect(await props.saveRef.current!.save()).toBe(false);
  }
  expect(props.onUpdateChain).not.toHaveBeenCalled();
  await switchTo('文生图');
  let resolve!: () => void;
  props.onUpdateChain.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  let pending!: Promise<boolean>;
  act(() => { pending = props.saveRef.current!.save(); });
  expect(props.saveRef.current?.canSave).toBe(false);
  expect(await props.saveRef.current!.save()).toBe(false);
  await act(async () => { resolve(); await pending; });
  expect(props.onUpdateChain).toHaveBeenCalledOnce();
  expect(props.saveRef.current?.canSave).toBe(true);
  unmount();
  expect(props.saveRef.current).toBeNull();
  const lab = setup({ ...chain, id: 'playground' });
  expect(lab.props.saveRef.current?.canSave).toBe(false);
  expect(await lab.props.saveRef.current!.save()).toBe(false);
  expect(lab.props.onUpdateChain).not.toHaveBeenCalled();
});

it('图生图使用缩放副本的实际像素估费、发送转换后参数并保存历史，当前草稿保持原坐标', async () => {
  sessionStorage.setItem('nai_api_key', 'image-size-fixture');
  state.subscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 0 } };
  state.generate.mockImplementation(async (_key, _prompt, _negative, generatedParams) => ({ image: 'data:image/png;base64,AQID', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), params: generatedParams, seed: 123 }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1024, close: vi.fn() })));
  setup({ ...chain, previewImage: '/synthetic/cover.png', params: { ...chain.params, model: 'nai-diffusion-5-full', width: 1664, height: 2432 } });
  await switchTo('图生图');
  fireEvent.click(screen.getByRole('button', { name: '修改编辑角色' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成尺寸副本' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.generate).toHaveBeenCalledTimes(1);
  expect(state.generate.mock.calls[0][3]).toMatchObject({ width: 1024, height: 1024, characters: [{ id: 'edited', x: 0.4, y: 0.7 }] });
  await waitFor(() => expect(state.addHistory).toHaveBeenCalledTimes(1));
  expect(state.addHistory.mock.calls[0][2]).toMatchObject({ width: 1024, height: 1024, characters: [{ id: 'edited', x: 0.4, y: 0.7 }] });
  expect(loadLabWorkspaceSession(chain.id, fallback()).edits['image-to-image'].params).toMatchObject({ width: 1664, height: 2432, characters: [{ id: 'edited', x: 0.3, y: 0.7 }] });
});

it.each(['图生图', '局部重绘', '扩图'])('%s 普通生成复用已有免费快照，后台刷新不增加等待', async label => {
  sessionStorage.setItem('nai_api_key', 'billing-preflight-fixture');
  state.subscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 0 } };
  state.refreshedSubscription = { ...state.subscription, usage: { percent: 0, isNegative: true, timeUntilNextPercent: 0 } };
  state.delayedSubscription = new Promise(() => {});
  state.confirm.mockResolvedValueOnce(false);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  setup({ ...chain, params: { ...chain.params, model: 'nai-diffusion-5-full' } });
  await switchTo(label);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it('普通文生图在订阅刷新未返回时立即提交，不等待后台请求', async () => {
  sessionStorage.setItem('nai_api_key', 'fast-text-fixture');
  state.subscription = { active: true, tier: 3 };
  state.delayedSubscription = new Promise(() => {});
  setup();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^生成 ·/ })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it.each(['图生图', '局部重绘', '扩图'])('%s 零点数估算在同步失效时直接生成，不新增确认', async label => {
  sessionStorage.setItem('nai_api_key', 'billing-sync-fixture');
  state.subscription = state.refreshedSubscription = { active: true, tier: 3 };
  state.runtime = { ...DEFAULT_NAI_RUNTIME, health: { ok: false, reason: 'partial', missed: ['billing'] } };
  state.confirm.mockResolvedValueOnce(false);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  setup(); await switchTo(label);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.generate).toHaveBeenCalledTimes(1);
});

it('保持打开的实验室继续接收运行时更新，按钮费用不冻结在首次加载值', async () => {
  state.subscription = { active: false, tier: 3 };
  const entry = { ...chain, params: { ...chain.params, model: 'nai-diffusion-5-full', steps: 29 } };
  const { rerender, props } = setup(entry);
  expect(screen.getByRole('button', { name: /^生成 · 30 Anlas/ })).toBeTruthy();
  state.runtime = { ...state.runtime!, billing: { ...DEFAULT_NAI_RUNTIME.billing, modelMultipliers: { v5: 2 } } };
  rerender(<ChainEditor {...props} />);
  expect(screen.getByRole('button', { name: /^生成 · 40 Anlas/ })).toBeTruthy();
  expect(state.generate).not.toHaveBeenCalled();
});

it('四模式共用手机资源入口，切 Key 时继续使用当前工作台状态，不触发生成', async () => {
  vi.stubGlobal('innerWidth', 390);
  setup();
  for (const label of ['文生图', '图生图', '局部重绘', '扩图']) {
    if (label !== '文生图') await switchTo(label);
    const resources = screen.getByRole('button', { name: /查看账户资源：未配置 Key/ });
    // 小于 md 显示；md 及以上保留桌面侧栏，不能把响应式方向写反。
    expect(resources.className).toContain('md:hidden');
    expect(resources.className.split(' ')).not.toContain('hidden');
    expect(resources.closest('.mobile-generation-actions')).toBeNull();
    expect(resources.textContent).toBe('Anlas —/—Opus额度 —');
    act(() => { sessionStorage.setItem('nai_api_key', 'mobile-workspace-fixture'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'mobile-workspace-fixture' })); });
    expect(screen.getByRole('button', { name: /查看账户资源：预算 1666 · 余额 未知 · 额度未知/ })).toBeTruthy();
    act(() => { sessionStorage.removeItem('nai_api_key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: '' })); });
  }
  expect(state.generate).not.toHaveBeenCalled();
});

it('贴底资源不占图片／生成操作行，图片入口继续打开大图且关闭后恢复资源', async () => {
  vi.stubGlobal('innerWidth', 390);
  const { container } = setup({ ...chain, previewImage: '/synthetic/preview.png' });
  const preview = await screen.findByRole('button', { name: '查看当前预览图' });
  const actions = container.querySelector<HTMLElement>('.mobile-generation-actions')!;
  expect(actions.contains(preview)).toBe(true);
  const generate = within(actions).getByRole('button', { name: /^生成 ·/ });
  expect(preview.parentElement).toBe(generate.parentElement?.parentElement);
  expect(actions.contains(screen.getByRole('button', { name: /^查看账户资源/ }))).toBe(false);
  fireEvent.click(preview);
  const lightbox = await screen.findByRole('dialog', { name: '图片预览' });
  const imageStage=within(lightbox).getByLabelText('图片平移与缩放');
  longPress(within(lightbox).getByRole('img')); expect(imageStage.getAttribute('data-press-revealed')).toBe('true');
  expect(screen.getByRole('dialog', { name: '图片预览' })).toBe(lightbox);
  expect(screen.queryByRole('button', { name: /^查看账户资源/ })).toBeNull();
  fireEvent.click(imageStage);
  expect(await screen.findByRole('button', { name: /^查看账户资源/ })).toBeTruthy();
  expect(state.generate).not.toHaveBeenCalled();
});

it('提示词软键盘避让同时移动贴底资源与生成操作，收起后恢复各自锚点', () => {
  let resize!: () => void;
  const viewport = { height: 600, addEventListener: vi.fn((_event: string, handler: () => void) => { resize = handler; }), removeEventListener: vi.fn() };
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 800);
  const { container } = setup();
  act(() => { textPrompt().focus(); });
  const resources = screen.getByRole('button', { name: /^查看账户资源/ });
  const actions = container.querySelector<HTMLElement>('.mobile-generation-actions')!;
  expect(resources.style.bottom).toBe('calc(200px + env(safe-area-inset-bottom))');
  expect(actions.style.bottom).toBe('calc(200px + var(--mobile-generation-bottom))');
  act(() => { viewport.height = 800; resize(); });
  expect(resources.style.bottom).toBe('');
  expect(actions.style.bottom).toBe('');
});

describe('历史明确指定实验室导入模式', () => {
  it('已有局部重绘会话也切到文生图，恢复结构且保留其他模式草稿', async () => {
    const session = fallback();
    session.activeMode = 'inpaint';
    session.edits.inpaint.prompt = 'retained edit prompt';
    saveLabWorkspaceSession(chain.id, session);
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ targetMode: 'text-to-image', prompt: 'imported complete', basePrompt: 'imported base', subjectPrompt: 'imported subject',
      modules: [{ id: 'imported-module', name: '合成模块', content: 'imported content', isActive: true, position: 'post' }], negativePrompt: '', params: chain.params }));
    setup();
    await waitFor(() => expect(textPrompt().value).toBe('imported base'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe('text-to-image');
    expect(saved.textToImage).toMatchObject({ basePrompt: 'imported base', subjectPrompt: 'imported subject', negativePrompt: '' });
    expect(saved.edits.inpaint.prompt).toBe('retained edit prompt');
    expect(sessionStorage.getItem('nai_pending_import')).toBeNull();
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 载入指定底图，空提示词和负面词保持为空', async operation => {
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'image-edit', imageEditOperation: operation,
      baseImageUrl: 'data:image/png;base64,AQID', parentHistoryId: 'synthetic-parent', prompt: '', negativePrompt: '',
      params: { ...chain.params, characters: [{ id: 'role', prompt: 'synthetic character', x: 0.5, y: 0.5 }] }, reuseEditMask: false }));
    setup();
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    await waitFor(() => expect(loadLabWorkspaceSession(chain.id, fallback()).activeMode).toBe(operation));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe(operation);
    expect(saved.edits[operation]).toMatchObject({ prompt: '', negativePrompt: '', parentHistoryId: 'synthetic-parent', baseImageSource: 'history', expansion: { top: 0, right: 0, bottom: 0, left: 0 }, focused: operation === 'inpaint' });
    expect(saved.edits[operation].params.characters?.[0].prompt).toBe('synthetic character');
    expect(saved.edits[operation].maskRef).toBeUndefined();
    expect(saved.textToImage.basePrompt).toBe('saved style');
    expect(state.getEditMask).not.toHaveBeenCalled();
  });
  it('明确选择复用时从对应历史读取原蒙版', async () => {
    state.getEditMask.mockResolvedValue(new Blob(['synthetic mask'], { type: 'image/png' }));
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'image-edit', imageEditOperation: 'inpaint', baseImageUrl: 'data:image/png;base64,AQID',
      parentHistoryId: 'synthetic-parent', prompt: 'imported edit', negativePrompt: '', params: chain.params, reuseEditMask: true }));
    setup();
    await waitFor(() => expect(screen.getByLabelText('编辑蒙版').textContent).toContain('data:image/png;base64,'));
    expect(state.getEditMask).toHaveBeenCalledWith('synthetic-parent');
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits.inpaint.maskRef).toBeTruthy();
  });
  it.each([undefined, false, true])('历史导入保留明确聚焦选择 %s，缺失时默认开启', async focused => {
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'image-edit', imageEditOperation: 'inpaint',
      baseImageUrl: 'data:image/png;base64,AQID', prompt: 'imported edit', negativePrompt: '', params: chain.params,
      editMetadata: { operation: 'inpaint', focused, strength: 1, noise: 0 } }));
    setup();
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe(String(focused ?? true));
    await waitFor(() => expect(loadLabWorkspaceSession(chain.id, fallback()).edits.inpaint.focused).toBe(focused ?? true));
    expect(state.generate).not.toHaveBeenCalled();
  });
});

it.each(['playground', chain.id])('%s 局部重绘重置后默认聚焦，图生图与扩图保持独立', async id => {
  const session = fallback(); session.activeMode = 'inpaint'; session.edits.inpaint.focused = false;
  saveLabWorkspaceSession(id, session);
  const view = setup({ ...chain, id });
  expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('false');
  await act(async () => fireEvent.click(within(view.container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '重置当前模式' })));
  await waitFor(() => expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('true'));
  for (const label of ['图生图', '扩图']) {
    await switchTo(label);
    expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('false');
  }
  await switchTo('局部重绘');
  expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('true');
  expect(state.generate).not.toHaveBeenCalled();
});

it('默认聚焦未框选时费用留空，手动关闭后显示普通重绘费用', async () => {
  state.subscription = { active: false, tier: 3 };
  setup();
  await switchTo('局部重绘');
  expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('true');
  expect(screen.getByLabelText('编辑费用').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '使用普通重绘' }));
  expect(screen.getByLabelText('聚焦重绘状态').textContent).toBe('false');
  expect(screen.getByLabelText('编辑费用').textContent).toMatch(/^\d+ Anlas$/);
  expect(state.generate).not.toHaveBeenCalled();
});

it.each(['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full'])('%s 四模式统一显示免费或 Opus，已有快照刷新时不闪回确认', async model => {
  state.subscription = { active: true, tier: 3 };
  state.subscriptionLoading = true;
  setup({ ...chain, params: { ...chain.params, model } });
  const label = model.startsWith('nai-diffusion-5-') ? '消耗 Opus 额度' : '免费';
  expect(screen.getByLabelText('文生图费用').textContent).toBe(label);
  expect(screen.getByRole('button', { name: `生成 · ${label}` })).toBeTruthy();
  for (const mode of ['图生图', '局部重绘', '扩图']) {
    await switchTo(mode);
    if (mode === '局部重绘') fireEvent.click(screen.getByRole('button', { name: '使用普通重绘' }));
    expect(screen.getByLabelText('编辑费用').textContent).toBe(label);
  }
  expect(state.generate).not.toHaveBeenCalled();
});

it.each([false, true])('订阅尚未知（刷新 %s）时四模式明确费用未知，文生图仍可点击', async loading => {
  state.subscriptionLoading = loading;
  setup();
  const label = loading ? '费用确认中…' : '费用未知';
  expect(screen.getByLabelText('文生图费用').textContent).toBe(label);
  expect((screen.getByRole('button', { name: `生成 · ${label}` }) as HTMLButtonElement).disabled).toBe(false);
  for (const mode of ['图生图', '局部重绘', '扩图']) {
    await switchTo(mode);
    if (mode === '局部重绘') fireEvent.click(screen.getByRole('button', { name: '使用普通重绘' }));
    expect(screen.getByLabelText('编辑费用').textContent).toBe(label);
  }
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.generate).not.toHaveBeenCalled();
});

describe('自由实验室图片只保留本次打开', () => {
  const lab = { ...chain, id: 'playground' };
  const oldHistory: LocalGenItem[] = Array.from({ length: 80 }, (_, index) => ({
    id: `old-${index}`, imageUrl: `/synthetic/old-${index}.png`, prompt: 'old prompt', params: chain.params, createdAt: 80 - index,
  }));
  const generation = { image: 'data:image/png;base64,AQID', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), params: chain.params, seed: 123 };
  const allowSyntheticGeneration = () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.generate.mockResolvedValue(generation);
  };

  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('复开 %s 留空底图及结果，80 张历史不自动占位，文字参数仍恢复', async mode => {
    const session = fallback(); session.activeMode = mode;
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      session.edits[operation] = { ...session.edits[operation], prompt: `draft-${operation}`, strength: 0.42,
        baseImageRef: 'old-base', maskRef: 'old-mask', resultImageRef: 'old-result', parentHistoryId: 'old-0',
        focusedRect: { x: 8, y: 8, width: 64, height: 64 }, appliedExpansion: { top: 0, right: 128, bottom: 0, left: 0 } };
    }
    for (const id of ['old-base', 'old-mask', 'old-result']) state.assets.set(id, generation.blob);
    saveLabWorkspaceSession('playground', session);
    state.history.mockResolvedValue(oldHistory);
    setup(lab);
    await waitFor(() => expect(state.history).toHaveBeenCalledWith('playground'));
    await act(async () => {});
    if (mode === 'text-to-image') {
      expect(screen.getByLabelText('文生图结果').textContent).toBe('');
      expect(screen.getByLabelText('预览历史编号').textContent).toBe('');
      expect(screen.queryByRole('button', { name: '浏览下一张' })).toBeNull();
      expect(textPrompt().value).toBe('saved style');
    }
    for (const [operation, label] of [['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const) {
      await switchTo(label);
      expect(screen.getByLabelText('编辑底图').textContent).toBe('');
      expect(screen.getByLabelText('编辑蒙版').textContent).toBe('');
      expect(screen.getByLabelText('编辑结果').textContent).toBe('');
      expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe(`draft-${operation}`);
      expect(screen.getByLabelText('编辑强度').textContent).toBe('0.42');
      expect(loadLabWorkspaceSession('playground', fallback()).edits[operation].focusedRect).toBeUndefined();
    }
  });

  it.each([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('本次文生图及 %s 生成即时显示，切模式分别恢复，复开后图片留空', async (operation, label) => {
    allowSyntheticGeneration();
    state.history.mockResolvedValue(oldHistory);
    const view = setup(lab);
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' })));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png'));
    await switchTo(label);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(screen.getByLabelText('编辑结果').textContent).toBe('/synthetic/new-2.png'));
    await switchTo('文生图');
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png');
    expect(screen.getByLabelText('预览历史编号').textContent).toBe('2 / 82');
    await switchTo(label);
    await waitFor(() => expect(screen.getByLabelText('编辑结果').textContent).toBe('data:image/png;base64,AQID'));
    expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,cGFzdGVk');
    view.unmount();
    setup(lab);
    await waitFor(() => expect(screen.getByRole('region', { name: operation })).toBeTruthy());
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
    expect(screen.getByLabelText('编辑结果').textContent).toBe('');
    await switchTo('文生图');
    expect(screen.getByLabelText('文生图结果').textContent).toBe('');
  });

  it.each(['playground', chain.id])('%s 迟到的历史加载不覆盖新生成结果，也不丢掉新记录', async id => {
    allowSyntheticGeneration();
    let release!: (items: LocalGenItem[]) => void;
    state.history.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    setup({ ...chain, id, previewImage: '/synthetic/saved-cover.png' });
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' })));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png'));
    await act(async () => release(oldHistory));
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png');
    expect(screen.getByLabelText('预览历史编号').textContent).toBe('1 / 81');
  });

  it('编辑模式翻图、移除及重置只改变编辑预览，文生图保留自己的结果', async () => {
    allowSyntheticGeneration(); state.history.mockResolvedValue(oldHistory);
    const view = setup(lab);
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' })));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png'));
    await switchTo('局部重绘');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(screen.getByLabelText('编辑结果').textContent).toBe('/synthetic/new-2.png'));
    fireEvent.click(screen.getByRole('button', { name: '浏览编辑下一张' }));
    expect(screen.getByLabelText('编辑结果').textContent).toBe('/synthetic/new-1.png');
    fireEvent.click(screen.getByRole('button', { name: '浏览编辑下一张' }));
    expect(screen.getByLabelText('编辑结果').textContent).toBe('/synthetic/old-0.png');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '移除编辑历史' })));
    expect(state.unlinkHistory).toHaveBeenCalledWith('old-0');
    await act(async () => fireEvent.click(within(view.container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '重置当前模式' })));
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
    expect(screen.getByLabelText('编辑结果').textContent).toBe('');
    await switchTo('文生图');
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/new-1.png');
  });

  it('切换工作台后，旧工作台迟到的历史响应不会回填', async () => {
    let release!: (items: LocalGenItem[]) => void;
    state.history.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const view = setup();
    await waitFor(() => expect(state.history).toHaveBeenCalledWith(chain.id));
    view.rerender(<ChainEditor {...view.props} chain={lab} allChains={[lab]} />);
    await waitFor(() => expect(state.history).toHaveBeenCalledWith('playground'));
    await act(async () => release(oldHistory));
    expect(screen.getByLabelText('文生图结果').textContent).toBe('');
    expect(screen.queryByRole('button', { name: '浏览下一张' })).toBeNull();
  });

  it('风格串工作台仍自动显示其历史，恢复底图及结果', async () => {
    const session = fallback(); session.activeMode = 'inpaint';
    session.edits.inpaint = { ...session.edits.inpaint, baseImageRef: 'old-base', resultImageRef: 'old-result' };
    saveLabWorkspaceSession(chain.id, session);
    state.assets.set('old-base', generation.blob); state.assets.set('old-result', generation.blob);
    state.history.mockResolvedValue(oldHistory);
    setup({ ...chain, previewImage: '/synthetic/saved-cover.png' });
    await waitFor(() => expect(screen.getByLabelText('编辑结果').textContent).toBe('data:image/png;base64,AQID'));
    expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID');
    await switchTo('文生图');
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/old-0.png');
  });
});

describe('统一工作台真实状态链路', () => {
  it.each(['上传分角色底图', '粘贴分角色底图', '文生图最新'])('图生图%s 只换底图，提示词、负面词与角色参数保持独立', async action => {
    const character = { id: 'current-role', prompt: 'current role', negativePrompt: 'current role negative', x: 0.4, y: 0.6 };
    const session = fallback();
    session.activeMode = 'image-to-image';
    session.edits['image-to-image'] = { ...session.edits['image-to-image'], prompt: 'my edit prompt', negativePrompt: 'my edit negative', promptSource: 'custom',
      params: { ...chain.params, model: 'nai-diffusion-5-full', steps: 23, seed: 123, characters: [character] } };
    saveLabWorkspaceSession(chain.id, session);
    state.history.mockResolvedValue([{ id: 'latest', imageUrl: 'data:image/png;base64,AQID', prompt: 'latest prompt', negativePrompt: 'latest negative', params: chain.params, createdAt: 1 }]);
    setup({ ...chain, previewImage: 'data:image/png;base64,AQID' });
    await waitFor(() => expect(screen.getByLabelText('编辑提示词')).toHaveProperty('value', 'my edit prompt'));
    const beforeImport = loadLabWorkspaceSession(chain.id, fallback());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: action })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.edits['image-to-image']).toMatchObject({ prompt: 'my edit prompt', negativePrompt: 'my edit negative', promptSource: 'custom', params: session.edits['image-to-image'].params });
    expect(saved.textToImage).toEqual(beforeImport.textToImage);
    expect(saved.edits.inpaint).toEqual(beforeImport.edits.inpaint);
    expect(saved.edits.outpaint).toEqual(beforeImport.edits.outpaint);
  });

  it('图生图保存底图期间后改的提示词和角色不被旧快照覆盖', async () => {
    setup();
    await switchTo('图生图');
    let release!: () => void;
    state.delayedBaseSave = new Promise(resolve => { release = resolve; });
    fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' }));
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'later prompt' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: 'later negative' } });
    fireEvent.click(screen.getByRole('button', { name: '修改编辑角色' }));
    await act(async () => release());
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits['image-to-image']).toMatchObject({ prompt: 'later prompt', negativePrompt: 'later negative',
      params: { characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative' }] } });
  });

  it('图生图主动清空全局和角色后换底图，实际请求仍发送空提示词', async () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.generate.mockRejectedValue(new Error('合成测试主动终止'));
    setup();
    await switchTo('图生图');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '清空编辑角色' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.generate).toHaveBeenCalledOnce());
    expect(state.generate.mock.calls[0].slice(1, 3)).toEqual(['', '']);
    expect(state.generate.mock.calls[0][3].characters).toEqual([]);
  });

  it('图生图主动导入 JSON 配置仍恢复提示词、角色和参数，保留已选底图', async () => {
    setup();
    await switchTo('图生图');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    const beforeImport = loadLabWorkspaceSession(chain.id, fallback());
    const raw = JSON.stringify({ prompt: 'explicit prompt', uc: 'explicit negative', model: 'nai-diffusion-5-full', steps: 23, seed: 456,
      v4_prompt: { caption: { base_caption: 'explicit prompt', char_captions: [{ char_caption: 'explicit character', centers: [{ x: 0.3, y: 0.7 }] }] }, use_coords: true },
      v4_negative_prompt: { caption: { base_caption: 'explicit negative', char_captions: [{ char_caption: 'explicit character negative' }] } } });
    const file = new File([raw], 'config.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => raw });
    await act(async () => fireEvent.change(screen.getByLabelText('导入 PNG 或 JSON 创作配置'), { target: { files: [file] } }));
    await waitFor(() => expect(screen.getByLabelText('编辑提示词')).toHaveProperty('value', 'explicit prompt'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.edits['image-to-image']).toMatchObject({ prompt: 'explicit prompt', negativePrompt: 'explicit negative', promptSource: 'custom',
      baseImageRef: beforeImport.edits['image-to-image'].baseImageRef,
      params: { model: 'nai-diffusion-5-full', steps: 23, seed: 456, useCoords: true,
        characters: [expect.objectContaining({ prompt: 'explicit character', negativePrompt: 'explicit character negative', x: 0.3, y: 0.7 })] } });
    expect(saved.textToImage).toEqual(beforeImport.textToImage);
    expect(saved.edits.inpaint).toEqual(beforeImport.edits.inpaint);
    expect(saved.edits.outpaint).toEqual(beforeImport.edits.outpaint);
  });

  it('图生图空草稿切走再回来不补入文生图提示词或自动选底图', async () => {
    const session = fallback();
    session.edits['image-to-image'] = { ...session.edits['image-to-image'], prompt: '', negativePrompt: '', promptSource: 'custom' };
    saveLabWorkspaceSession(chain.id, session);
    setup({ ...chain, previewImage: 'data:image/png;base64,AQID' });
    await switchTo('图生图');
    await switchTo('文生图');
    await switchTo('图生图');
    expect(screen.getByLabelText('编辑提示词')).toHaveProperty('value', '');
    expect(screen.getByLabelText('编辑负面词')).toHaveProperty('value', '');
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits['image-to-image'].promptSource).toBe('custom');
  });

  it('历史复制配置进入扩图；删除全局及角色后生成入口收到空内容，不补回文生图旧词', async () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.generate.mockRejectedValue(new Error('合成测试主动终止'));
    setup();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await switchTo('扩图');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' })));
    await waitFor(() => expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('copied scene'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.generate).toHaveBeenCalledTimes(1));
    expect(state.generate.mock.calls[0].slice(1, 3)).toEqual(['copied scene', 'copied negative']);
    expect(state.generate.mock.calls[0][3].characters[0]).toMatchObject({ prompt: 'copied role', negativePrompt: 'copied role negative' });
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '清空编辑角色' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.generate).toHaveBeenCalledTimes(2));
    expect(state.generate.mock.calls.at(-1)?.slice(1, 3)).toEqual(['', '']);
    expect(state.generate.mock.calls.at(-1)?.[3].characters).toEqual([]);
    expect(loadLabWorkspaceSession(chain.id, fallback()).textToImage.basePrompt).toBe('saved style');
  });
  it.each([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('%s 继承并保存角色模块，生成不清空，其他模式保持独立', async (operation, label) => {
    const character = { id: 'original', prompt: 'original character', negativePrompt: 'original negative', x: 0.5, y: 0.5 };
    const entry = { ...chain, params: { ...chain.params, characters: [character], useCoords: true } };
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    // 请求入口捕获后主动失败，不执行任何真实生成、落库或结算。
    state.generate.mockRejectedValueOnce(new Error('合成测试主动终止'));
    setup(entry);
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await switchTo(label);
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits[operation].params.characters).toEqual([character]);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '上传分角色底图' })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    if (operation === 'image-to-image') {
      expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toContain('saved style');
      expect(loadLabWorkspaceSession(chain.id, fallback()).edits[operation].params.characters).toEqual([character]);
    } else {
      expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('');
      expect(loadLabWorkspaceSession(chain.id, fallback()).edits[operation].params.characters?.[0].prompt).toBe('imported character');
    }
    fireEvent.click(screen.getByRole('button', { name: '修改编辑角色' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.generate).toHaveBeenCalled());
    expect(state.generate.mock.calls[0][3]).toMatchObject({ useCoords: true,
      characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.3, y: 0.7 }] });
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.edits[operation].params.characters?.[0].prompt).toBe('edited character');
    expect(saved.textToImage.params.characters).toEqual([character]);
    for (const other of ['image-to-image', 'inpaint', 'outpaint'] as const) if (other !== operation) expect(saved.edits[other].params.characters).toEqual([character]);
  });

  it.each([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('%s 粘贴保留当前配置，清除旧底图编辑状态并独立持久化', async (operation, label) => {
    const session = fallback();
    session.activeMode = operation;
    const previous = {
      ...session.edits[operation], prompt: 'current edit prompt', negativePrompt: 'current edit negative',
      baseImageRef: 'old-base', baseImageSource: 'history' as const, parentHistoryId: 'old-parent',
      maskRef: 'old-mask', focusedRect: { x: 0, y: 0, width: 64, height: 64 },
      resultImageRef: 'old-result', expansion: { top: 64, right: 0, bottom: 128, left: 0 },
      appliedExpansion: { top: 64, right: 0, bottom: 128, left: 0 },
    };
    session.edits[operation] = previous;
    state.assets.set('old-base', new Blob(['old base'], { type: 'image/png' }));
    state.assets.set('old-mask', new Blob(['old mask'], { type: 'image/png' }));
    state.assets.set('old-result', new Blob(['old result'], { type: 'image/png' }));
    saveLabWorkspaceSession(chain.id, session);
    setup();
    await waitFor(() => expect(screen.getByRole('region', { name: operation })).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toContain('data:image/png'));
    const beforePaste = loadLabWorkspaceSession(chain.id, fallback());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })); });
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,cGFzdGVk'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.edits[operation]).toEqual(expect.objectContaining({
      baseImageSource: 'clipboard', prompt: previous.prompt, negativePrompt: previous.negativePrompt,
      params: previous.params, strength: previous.strength, noise: previous.noise,
      expansion: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
    expect(saved.edits[operation].parentHistoryId).toBeUndefined();
    expect(saved.edits[operation].maskRef).toBeUndefined();
    expect(saved.edits[operation].focusedRect).toBeUndefined();
    expect(saved.edits[operation].appliedExpansion).toBeUndefined();
    expect(saved.edits[operation].resultImageRef).toBeUndefined();
    expect(saved.textToImage).toEqual(beforePaste.textToImage);
    for (const other of ['image-to-image', 'inpaint', 'outpaint'] as const) {
      if (other !== operation) expect(saved.edits[other]).toEqual(beforePaste.edits[other]);
    }
    await switchTo('文生图');
    await switchTo(label);
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,cGFzdGVk'));
    expect(screen.getByLabelText('编辑蒙版').textContent).toBe('');
  });

  it('卡片改名后保存既有草稿使用最新信息，同时保留未保存提示词', async () => {
    const view = setup();
    await waitFor(() => expect(textPrompt().value).toBe(chain.basePrompt));
    fireEvent.change(textPrompt(), { target: { value: '未保存的提示词草稿' } });
    const renamed = { ...chain, name: '卡片新名称', description: '卡片新描述', tags: ['新标签'] };
    view.rerender(<ChainEditor {...view.props} chain={renamed} allChains={[renamed]} />);
    expect(textPrompt().value).toBe('未保存的提示词草稿');
    fireEvent.click(within(view.container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '保存风格串' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: '保存风格串' })).getByRole('button', { name: '保存修改' })); });
    expect(view.props.onUpdateChain).toHaveBeenCalledWith(chain.id, expect.objectContaining({
      name: renamed.name, description: renamed.description, tags: renamed.tags, basePrompt: '未保存的提示词草稿',
    }));
  });

  it.each(['style', 'character'] as const)('%s 入口的四模式草稿独立，返回后可恢复', async type => {
    const entry = { ...chain, type };
    const view = setup(entry);
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    expect(screen.getAllByRole('button', { name: /^(文生图|图生图|局部重绘|扩图)$/ })).toHaveLength(4);
    await switchTo('图生图');
    expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('saved style, subject, soft light');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'img2img draft' } });
    fireEvent.click(screen.getByRole('button', { name: '调整强度' }));
    await switchTo('局部重绘');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'inpaint draft' } });
    await switchTo('扩图');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'outpaint draft' } });
    await switchTo('文生图');
    expect(textPrompt().value).toBe('saved style');
    await switchTo('图生图');
    expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('img2img draft');
    expect(screen.getByLabelText('编辑强度').textContent).toBe('0.42');
    expect(view.props.onUpdateChain).not.toHaveBeenCalled();
    view.unmount();
    setup(entry);
    await waitFor(() => expect(screen.getByRole('region', { name: 'image-to-image' })).toBeTruthy());
    expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('img2img draft');
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits.outpaint.prompt).toBe('outpaint draft');
  });

  it('修改与另存使用文生图配置，编辑模式不出现保存且不改写原串', async () => {
    const view = setup();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(textPrompt(), { target: { value: 'new style' } });
    const actions = view.container.querySelector('.chain-editor-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: '保存风格串' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: '保存风格串' })).getByRole('button', { name: '保存修改' })); });
    expect(view.props.onUpdateChain).toHaveBeenCalledWith(chain.id, expect.objectContaining({ basePrompt: 'new style', negativePrompt: 'saved negative', modules: chain.modules }));
    fireEvent.click(within(actions).getByRole('button', { name: '保存风格串' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '保存风格串' })).getByRole('button', { name: '另存为新串' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '风格串' })); });
    expect(view.props.onFork).toHaveBeenCalledWith(expect.objectContaining({ basePrompt: 'new style' }), 'style');
    await switchTo('局部重绘');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'edit only' } });
    expect(screen.queryByRole('button', { name: /保存风格串|保存到库|另存为新串/ })).toBeNull();
    expect(view.props.onUpdateChain).toHaveBeenCalledOnce();
    expect(view.props.onFork).toHaveBeenCalledOnce();
  });

  it('自由实验室草稿不受风格串编辑影响，文生图重置恢复已保存预设', async () => {
    saveLabWorkspaceSession('playground', { ...fallback(), textToImage: { ...fallback().textToImage, basePrompt: 'private playground draft' } });
    const view = setup();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(textPrompt(), { target: { value: 'temporary change' } });
    await act(async () => { fireEvent.click(within(view.container.querySelector('.chain-editor-actions') as HTMLElement).getByRole('button', { name: '重置当前模式' })); });
    expect(textPrompt().value).toBe('saved style');
    expect(loadLabWorkspaceSession('playground', fallback()).textToImage.basePrompt).toBe('private playground draft');
    expect(view.props.onUpdateChain).not.toHaveBeenCalled();
    expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('合成风格串') }));
  });

  it('切换后迟到的底图读取不能污染另一个模式', async () => {
    let release!: (blob: Blob) => void;
    state.delayedAsset = new Promise<Blob>(resolve => { release = resolve; });
    saveLabWorkspaceSession(chain.id, {
      ...fallback(),
      edits: { ...fallback().edits, outpaint: { ...fallback().edits.outpaint, baseImageRef: 'delayed-base' } },
    });
    setup();
    await switchTo('扩图');
    expect(screen.getByLabelText('编辑底图读取状态').textContent).toBe('true');
    expect((screen.getByRole('button', { name: '读取图片中…' }) as HTMLButtonElement).disabled).toBe(true);
    await switchTo('局部重绘');
    await act(async () => { release(new Blob(['late base'], { type: 'image/png' })); });
    expect(screen.getByRole('region', { name: 'inpaint' })).toBeTruthy();
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
    expect(screen.getByLabelText('编辑底图读取状态').textContent).toBe('false');
    expect(screen.getByLabelText('编辑蒙版').textContent).toBe('');
  });
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('Agent 绑定 %s 草稿，不改写其他模式', async mode => {
  const session = fallback(); session.activeMode = mode;
  for (const edit of ['image-to-image', 'inpaint', 'outpaint'] as const) session.edits[edit].prompt = 'draft-' + edit;
  saveLabWorkspaceSession(chain.id, session); setup();
  await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(mode));
  const snapshot = state.agent!.draft;
  expect(state.agent!.splitPromptFields).toBe(false);
  expect(snapshot.basePrompt).toBe(mode === 'text-to-image' ? 'saved style' : 'draft-' + mode);
  await act(async () => state.agent!.onFinalDraft({ ...snapshot, basePrompt: 'Agent changed' }));
  if (mode === 'text-to-image') expect(textPrompt().value).toBe('Agent changed');
  else {
    await waitFor(() => expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('Agent changed'));
    await switchTo('文生图'); expect(textPrompt().value).toBe('saved style');
  }
});
it('手动修改冲突保留两份，选择字段后才应用', async () => {
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  const snapshot = state.agent!.draft;
  fireEvent.change(textPrompt(), { target: { value: 'manual edit' } });
  await act(async () => state.agent!.onFinalDraft({ ...snapshot, basePrompt: 'Agent edit' }));
  expect(textPrompt().value).toBe('manual edit');
  const dialog = screen.getByRole('dialog', { name: '查看 Agent 草稿差异' });
  expect(dialog.textContent).toContain('manual edit'); expect(dialog.textContent).toContain('Agent edit');
  fireEvent.click(within(dialog).getByText('应用选中修改'));
  expect(textPrompt().value).toBe('Agent edit');
});

it('生图确认期间手动修改使旧批准失效，不调用生成或批准回调', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  let release!: (value: boolean) => void;
  state.confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
  const approve = vi.fn(async () => {}); let task!: ReturnType<NonNullable<typeof state.agent>['onRequestGeneration']>;
  await act(async () => { task = state.agent!.onRequestGeneration(state.agent!.draft, 'synthetic', approve); });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.change(textPrompt(), { target: { value: 'manual while confirming' } });
  await act(async () => { release(true); await expect(task).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'target_changed', error: '确认期间创作目标已变化，请重新提出请求' }); });
  expect(approve).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
});

it.each([true, false])('生图确认接受=%s 时，用户取消与接口失败分别回执', async accepted => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  state.confirm.mockResolvedValueOnce(accepted); state.generate.mockRejectedValueOnce(new Error('合成 API 失败'));
  const approve = vi.fn(async () => {});
  await act(async () => {
    const result = await state.agent!.onRequestGeneration(state.agent!.draft, 'synthetic', approve);
    expect(result).toMatchObject({ success: false, outcome: accepted ? 'failed' : 'cancelled', code: accepted ? 'generation_failed' : 'user_cancelled', error: accepted ? '合成 API 失败' : '用户取消了生图请求' });
  });
  expect(approve).toHaveBeenCalledTimes(accepted ? 1 : 0); expect(state.generate).toHaveBeenCalledTimes(accepted ? 1 : 0);
});

it('生成前草稿实际变化返回检查拦截，不弹确认、不伪报用户取消', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  const oldDraft = state.agent!.draft;
  fireEvent.change(textPrompt(), { target: { value: 'manual' } });
  await act(async () => { await expect(state.agent!.onRequestGeneration(oldDraft)).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'target_changed' }); });
  expect(state.confirm).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
});
