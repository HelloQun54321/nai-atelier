import { getGenerationQueue, setGenerationQueuePaused, setGenerationInterval, type GenerationPlacement, type GenerationQueueSnapshot } from '../../services/generationTask';
vi.mock('../../services/generationTask', () => ({ getGenerationQueue: vi.fn<typeof import('../../services/generationTask').getGenerationQueue>(async () => { throw new Error('synthetic-status-unavailable'); }), setGenerationInterval: vi.fn<typeof import('../../services/generationTask').setGenerationInterval>(async () => { throw new Error('synthetic-status-unavailable'); }), setGenerationQueuePaused: vi.fn<typeof import('../../services/generationTask').setGenerationQueuePaused>(async () => { throw new Error('synthetic-status-unavailable'); }) }));
import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalGenItem, PromptAgentGenerationResult, PromptChain } from '../../types';
import { cloneDefaultLabPageLayouts, DEFAULT_GENERATION_MEMORY_PREFERENCES, type GenerationMemoryPreferences } from '../../services/appearancePreferences';
import { blobToDataUrl, createLabWorkspaceSession, loadLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';
import { ChainEditor, type ChainEditorSaveHandle } from '../../components/ChainEditor';
import { getGenerationSeriesSession, getQueuedGenerationSeries, stopGenerationSeriesSession } from '../../services/generationSeries';
import { GenerationCountControl } from '../../components/GenerationCountControl';
import { DEFAULT_NAI_RUNTIME, type NaiRuntimeConfig } from '../../services/naiRuntime';
import * as promptTranslations from '../../services/tagTranslations';
import type { NovelaiSubscriptionInfo } from '../../services/naiUsage';
import type { GenerationJobDescriptor, GenerationJobSnapshot } from '../../services/generationJob';
import type { GenerationJobDescriptorInput } from '../../services/naiService';
type ImageEditPanelProps = React.ComponentProps<typeof import('../../components/ImageEditPanel').ImageEditPanel>;

// Node 22 的 Response.blob() 返回原生 Blob，jsdom FileReader 只接受同一环境的 Blob。
const syntheticImageResponse = () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const response = new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  vi.spyOn(response, 'blob').mockResolvedValue(new Blob([bytes], { type: 'image/png' }));
  return response;
};

/** 脚本里的快照不含 token：真实网关只在响应时带上它，由 mock 注入，绝不改生产类型迁就测试。 */
type JobScriptSnapshot = Omit<GenerationJobSnapshot, 'token'>;
// 后台任务由 services/generationJob 唯一持有：本文件只脚本化它的 snapshot，不再驱动逐张生成。
const state = vi.hoisted(() => ({
  agent: null as React.ComponentProps<typeof import('../../components/chain/PresetSourceBadges').PromptAgentOverlayController> | null,
  history: vi.fn(async (_id: string): Promise<LocalGenItem[]> => []),
  addHistory: vi.fn(async () => { throw new Error('后台任务不得再逐张写入历史'); }),
  notifySaved: vi.fn(),
  saveArtistSample: vi.fn(async () => {}),
  unlinkHistory: vi.fn(async () => {}),
  getEditMask: vi.fn(async (): Promise<Blob | null> => null),
  confirm: vi.fn(async (_options?: unknown) => true),
  agentConfig: vi.fn<() => Promise<{ permissionMode: 'read_only' | 'standard' | 'full' }>>(),
  classify: vi.fn<typeof import('../../services/promptAgent').promptAgentService.classifyPrompts>(),
  budget: 1666,
  buildDescriptor: vi.fn<(input: GenerationJobDescriptorInput) => Promise<GenerationJobDescriptor>>(),
  startJob: vi.fn<(key: string, token: string, descriptor: GenerationJobDescriptor, count: number, placement?: GenerationPlacement) => Promise<GenerationJobSnapshot>>(),
  getJob: vi.fn<(key: string, token: string) => Promise<GenerationJobSnapshot>>(),
  observeJob: vi.fn<typeof import('../../services/generationJob').observeGenerationJob>(),
  cancelJob: vi.fn<(key: string, token: string, options?: { keepalive?: boolean }) => Promise<void>>(),
  approveJob: vi.fn<(key: string, token: string, approvedCost: number) => Promise<GenerationJobSnapshot>>(),
  started: [] as { key: string; token: string; descriptor: GenerationJobDescriptor; count: number; placement?: GenerationPlacement }[],
  scripts: [] as JobScriptSnapshot[][],
  cursors: new Map<string, { script: JobScriptSnapshot[]; index: number }>(),
  drained: false,
  scopes: new Set<string>(),
  assets: new Map<string, Blob>(),
  delayedAsset: null as Promise<Blob> | null,
  delayedBaseSave: null as Promise<void> | null,
  runtime: null as NaiRuntimeConfig | null,
  subscription: null as NovelaiSubscriptionInfo | null,
  subscriptionLoading: false,
  refreshedSubscription: null as NovelaiSubscriptionInfo | null,
  delayedSubscription: null as Promise<NovelaiSubscriptionInfo | null> | null,
}));

vi.mock('../../services/promptAgent', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/promptAgent')>(),
  promptAgentService: { getConfig: state.agentConfig, classifyPrompts: state.classify },
}));
vi.mock('../../services/artistSampleDrafts', async original => ({ ...await original<typeof import('../../services/artistSampleDrafts')>(), saveArtistOwnSample: state.saveArtistSample }));
vi.mock('../../services/generationJob', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/generationJob')>();
  return { ...actual, startGenerationJob: state.startJob, getGenerationJob: state.getJob, cancelGenerationJob: state.cancelJob, updateGenerationJobApproval: state.approveJob, observeGenerationJob: state.observeJob };
});
vi.mock('../../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/naiRuntime')>();
  return { ...actual, getNaiRuntimeConfig: async () => actual.DEFAULT_NAI_RUNTIME,
    useNaiRuntime: () => state.runtime || actual.DEFAULT_NAI_RUNTIME };
});
vi.mock('../../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiUsage')>(),
  requestNovelaiSubscription: async () => { if (!state.refreshedSubscription) throw new Error('synthetic quota failure'); return state.refreshedSubscription; },
  useNovelaiUsage: () => ({ info: state.subscription, usage: state.subscription?.usage, loading: state.subscriptionLoading, error: null, fetchedAt: 0, refresh: async () => state.refreshedSubscription, refreshIfStale: async () => state.delayedSubscription || state.refreshedSubscription }),
}));
vi.mock('../../services/anlasBudget', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/anlasBudget')>(),
  useAnlasBudget: () => ({ remaining: state.budget, loading: false }),
}));
vi.mock('../../services/localHistory', () => ({ localHistory: { getBySourceChain: state.history, add: state.addHistory, unlinkFromSourceChain: state.unlinkHistory, unlinkAllFromSourceChain: state.unlinkHistory, notifyBackgroundSaved: state.notifySaved, getEditMask: state.getEditMask } }));
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
// 编辑模式的预处理要读画布与像素，jsdom 下不可用；文本模式也走同一入口，便于断言组件真正提交的描述。
vi.mock('../../services/naiService', () => ({ buildGenerationJobDescriptor: state.buildDescriptor }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => state.confirm }));
vi.mock('../../components/CloudQueueStatus', () => ({ useCloudQueueStatus: () => null, useCloudQueueEnabled: () => false, CloudQueueButton: () => null }));
vi.mock('../../components/LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: (props: React.ComponentProps<typeof import('../../components/ChainEditorParams').ChainEditorParams>) => props.onForceEmptySeedChange
  ? <button onClick={() => props.onForceEmptySeedChange?.(!props.forceEmptySeed)}>{props.forceEmptySeed ? '强制置空 ON' : '强制置空 OFF'}</button> : null }));
vi.mock('../../components/ChainEditorPreview', () => ({ ChainEditorPreview: (props: React.ComponentProps<typeof import('../../components/ChainEditorPreview').ChainEditorPreview>) => <section aria-label="文生图预览">
  <output aria-label="文生图结果">{props.generatedImage}</output>
  <output aria-label="文生图步数">{props.generationProgress && `${props.generationProgress.step}/${props.generationProgress.total}`}</output>
  <output aria-label="文生图费用">{props.generationCostLabel}</output>
  <output aria-label="预览历史编号">{props.historyLabel}</output>
  {props.canNavigateHistory && <button onClick={props.onNextHistory}>浏览下一张</button>}
  <output aria-label="生成不可用原因">{props.unavailableLabel}</output>
  {props.onSaveArtistSample && <button onClick={props.onSaveArtistSample}>保存为画师样张</button>}
  <button disabled={props.generationDisabled} onClick={() => { fireEvent.keyDown(window, { key: 'Escape' }); void props.handleGenerate(); }}>生成合成文生图</button>
  {props.generationCountControl && <GenerationCountControl {...props.generationCountControl} disabled={props.isGenerating} busy={props.isGenerating || props.generationDisabled} />}
</section> }));
vi.mock('../../components/VibeManager', () => ({ VibeManager: () => null }));
vi.mock('../../components/CharacterReferenceManager', () => ({ CharacterReferenceManager: () => null }));
vi.mock('../../components/chain/ChainEditorCharacters', () => ({ ChainEditorCharacters: () => null }));
vi.mock('../../components/chain/PresetSourceBadges', async importOriginal => ({
  ...await importOriginal<typeof import('../../components/chain/PresetSourceBadges')>(),
  PromptAgentOverlayController: (props: React.ComponentProps<typeof import('../../components/chain/PresetSourceBadges').PromptAgentOverlayController>) => { state.agent = props; return null; },
}));
// 只替换 Canvas 表面；真实编辑器、顶栏、切换、保存和会话持久化均执行实际代码。
vi.mock('../../components/ImageEditPanel', () => ({ ImageEditPanel: (props: ImageEditPanelProps) => {
  // 真实面板会把草稿底图来源一起提交，并按来源决定是否保留父历史编号；这里保持同一映射。
  const baseImageSource = props.draft.baseImageSource;
  const linkedParentHistoryId = baseImageSource === 'upload' || baseImageSource === 'inspiration' || baseImageSource === 'clipboard'
    ? undefined : props.draft.parentHistoryId;
  React.useEffect(() => { props.onAgentGenerateReady?.((draft, onApproved, count, placement) => props.onGenerate({
    operation: props.operation, image: 'data:image/png;base64,AQID', canvasWidth: 832, canvasHeight: 1216,
    strength: 1, noise: 0, prompt: draft.basePrompt, negativePrompt: draft.negativePrompt, promptSource: 'custom',
    baseImageSource, parentHistoryId: linkedParentHistoryId,
  }, { params: draft.params, onApproved, agent: true, count, placement }).then(value => value ?? true)); });
  return <section aria-label={props.operation}>
  {props.onForceEmptySeedChange && <button onClick={() => props.onForceEmptySeedChange?.(!props.forceEmptySeed)}>{props.forceEmptySeed ? '强制置空 ON' : '强制置空 OFF'}</button>}
  {props.generationCountControl && <GenerationCountControl {...props.generationCountControl} disabled={props.isGenerating} busy={props.isGenerating} />}
  <input aria-label="编辑提示词" value={props.draft.prompt} onChange={event => props.onPromptChange(event.target.value)} />
  <input aria-label="编辑负面词" value={props.draft.negativePrompt} onChange={event => props.onNegativePromptChange(event.target.value)} />
  <button onClick={() => props.onDraftChange({ strength: 0.42 })}>调整强度</button>
  <output aria-label="编辑强度">{props.draft.strength}</output>
  <output aria-label="聚焦重绘状态">{String(props.draft.focused)}</output>
  <output aria-label="编辑费用">{props.generationCostLabel(props.operation, props.draft.focused, { width: 832, height: 1216, focusedRect: props.draft.focusedRect })}</output>
  <button onClick={() => props.onDraftChange({ focused: false })}>使用普通重绘</button>
  <button onClick={() => props.onDraftChange({ focusedRect: { x: 0, y: 0, width: 832, height: 1216 } })}>选择合成重绘区域</button>
  <output aria-label="编辑底图">{props.baseImage}</output>
  <output aria-label="编辑底图读取状态">{String(props.isBaseImageLoading)}</output>
  <output aria-label="编辑蒙版">{props.maskData}</output>
  <output aria-label="编辑结果">{props.previewImage}</output>
  <output aria-label="编辑步数">{props.generationProgress && `${props.generationProgress.step}/${props.generationProgress.total}`}</output>
  {props.canNavigateHistory && <button onClick={props.onNextHistory}>浏览编辑下一张</button>}
  {props.canManageHistoryGroup && <button onClick={props.onRemoveCurrentHistory}>移除编辑历史</button>}
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,cGFzdGVk', 'clipboard', 'old-parent'); }}>粘贴合成底图</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'upload', undefined, { prompt: '', negativePrompt: '', params: { ...props.draft.params, characters: [{ id: 'imported', prompt: 'imported character', x: 0.2, y: 0.8 }] } }); }}>上传分角色底图</button>
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.3, y: 0.7 }], useCoords: true } })}>修改编辑角色</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'clipboard', undefined, { prompt: 'copied scene', negativePrompt: 'copied negative', params: { ...props.draft.params, characters: [{ id: 'copied', prompt: 'copied role', negativePrompt: 'copied role negative', x: 0.2, y: 0.8 }] } }); }}>粘贴分角色底图</button>
  {props.latestTextToImageItem && <button onClick={() => { void props.onBaseImageChange(props.latestTextToImageItem!.imageUrl, 'generated', props.latestTextToImageItem!.id); }}>文生图最新</button>}
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [] } })}>清空编辑角色</button>
  <output aria-label="编辑生成不可用原因">{props.generationUnavailableLabel}</output>
  <button disabled={Boolean(props.generationUnavailableLabel)} onClick={() => { void props.onGenerate({ operation: props.operation, image: 'data:image/png;base64,AQID', canvasWidth: 832, canvasHeight: 1216, strength: 1, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource, baseImageSource, parentHistoryId: linkedParentHistoryId }); }}>生成合成编辑</button>
  <button onClick={() => { void props.onGenerate({ operation: props.operation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,TUFTSw==', canvasWidth: 832, canvasHeight: 1216, strength: 1, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource, baseImageSource, parentHistoryId: linkedParentHistoryId }); }}>生成合成蒙版编辑</button>
  <button onClick={() => { void props.onGenerate({ operation: 'image-to-image', image: 'data:image/png;base64,AQID', canvasWidth: 1024, canvasHeight: 1024,
    params: { ...props.draft.params, width: 1024, height: 1024, characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.4, y: 0.7 }] },
    strength: 0.7, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource }); }}>生成尺寸副本</button>
</section>; } }));

const chain: PromptChain = {
  id: 'synthetic-style', name: '合成风格串', description: '', type: 'style', userId: 'local-owner', tags: [],
  basePrompt: 'saved style', negativePrompt: 'saved negative', variableValues: { subject: 'subject' },
  modules: [{ id: 'light', name: '光线', content: 'soft light', isActive: true, position: 'post' }],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' },
  createdAt: 1, updatedAt: 1,
};
const fallback = () => createLabWorkspaceSession(chain.basePrompt, 'subject', chain.negativePrompt, chain.params, { light: true });
/** 后端保存后的历史记录：界面只消费它，不再由本页逐张落库。 */
const savedItem = (id: string, overrides: Partial<LocalGenItem> = {}): LocalGenItem => ({
  // 后台刚保存的记录一定比既有历史新：夹具的时间必须让新图排在最前。
  id, imageUrl: `/synthetic/${id}.png`, prompt: chain.basePrompt, negativePrompt: chain.negativePrompt, params: chain.params, createdAt: 1000, ...overrides,
});
const backgroundResult = (id: string, count = 1, overrides: Partial<JobScriptSnapshot> = {}): JobScriptSnapshot => ({
  state: 'succeeded', completedCount: count, requestedCount: count, historyIds: [id], lastSavedItem: savedItem(id), ...overrides,
});
/** 每个 POST 取一条脚本，后续 GET 依次推进，末条重复到终态为止。 */
const scriptJobs = (...scripts: JobScriptSnapshot[][]) => { state.scripts = scripts; state.cursors.clear(); state.started.length = 0; };
const nextSnapshotFor = (token: string): GenerationJobSnapshot => {
  // 用例收尾统一收敛：仍未终态的归属按取消终态结束，避免跨用例串会话。
  if (state.drained) return { token, state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] };
  const cursor = state.cursors.get(token);
  // 与真实网关一致：未知/过期 token 明确 404，监督器才不会再把它当成临时观察失败。
  if (!cursor) throw Object.assign(new Error('生成任务已过期或归属已变化'), { status: 404, code: 'generation_task_expired' });
  const index = Math.min(cursor.index, cursor.script.length - 1);
  cursor.index += 1;
  return { ...cursor.script[index], token };
};
/** 忠实映射组件提交的描述：字段本身在用例里按输入断言，这里只保证下游读数（步数等）可用。 */
const descriptorFromInput = (input: GenerationJobDescriptorInput): GenerationJobDescriptor => {
  const { edit: historyEdit, ...historyBase } = input.history;
  return {
    payload: { model: input.params.model ?? 'nai-diffusion-4-5-full', action: input.operation === 'text-to-image' ? 'generate' : input.operation === 'inpaint' ? 'infill' : 'img2img', parameters: { ...input.params }, ...(input.edit ? { input: input.edit.image } : {}) },
    history: {
      ...historyBase, prompt: input.prompt, negativePrompt: input.negative, params: input.params,
      ...(historyEdit ? { edit: { ...historyEdit, operation: input.operation === 'text-to-image' ? 'inpaint' : input.operation } } : {}),
    },
    randomSeed: Boolean(input.forceEmptySeed) || input.params.seed === undefined || input.params.seed === -1,
    stream: Boolean(input.stream),
    approvedCost: input.approvedCost,
    ...(input.edit?.mask ? { editMask: input.edit.mask } : {}),
  };
};
const setup = (entry: PromptChain = chain, rememberGenerationSettings = true, generationMemory = DEFAULT_GENERATION_MEMORY_PREFERENCES) => {
  state.scopes.add(entry.id);
  const props = { chain: entry, allChains: [entry], onUpdateChain: vi.fn(async () => {}), onFork: vi.fn(async () => {}), setIsDirty: vi.fn(), notify: vi.fn(),
    saveRef: React.createRef<ChainEditorSaveHandle>(),
    promptClassificationEnabled: true, tagAssistEnabled: false, onTagAssistEnabledChange: vi.fn(), generationStreamPreview: false, rememberGenerationSettings, generationMemory, labPageLayouts: cloneDefaultLabPageLayouts(), safeMode: false, onBack: vi.fn() };
  return { ...render(<ChainEditor {...props} />), props };
};
const textPrompt = () => screen.getByRole('textbox', { name: '画师串' }) as HTMLTextAreaElement;

describe('元数据导入后自动分类', () => {
  it('整段编辑的复制与一键翻译包含分类正负词和角色内容', async () => {
    const resolve = vi.spyOn(promptTranslations, 'resolvePromptTranslations').mockResolvedValue([]);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const sectioned = { ...chain, variableValues: { subject: 'forest' }, params: { ...chain.params, _promptSections: { scene: 'forest', sectionNegatives: { scene: 'city' } },
      characters: [{ id: 'role', prompt: 'smile', x: 0.2, y: 0.8, sections: { wardrobe: 'blue dress' }, sectionNegatives: { wardrobe: 'red dress' } }] } };
    const view = setup(sectioned);
    view.rerender(<ChainEditor {...view.props} promptClassificationEnabled={false} />);
    await waitFor(() => expect((screen.getByRole('textbox', { name: '全局正面提示词' }) as HTMLTextAreaElement).value).toBe('saved style, forest'));
    fireEvent.click(screen.getByTitle('复制全局负面提示词'));
    expect(writeText).toHaveBeenCalledWith('saved negative, city');
    fireEvent.click(screen.getByRole('button', { name: '翻译所有未翻译提示词' }));
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(resolve.mock.calls.at(-1)![0].map(token => token.displayTag)).toEqual(expect.arrayContaining(['saved style', 'forest', 'city', 'blue dress', 'red dress', 'smile']));
  });
  const result = { items: [{ id: 'global', kind: 'global' as const, sections: { style: 'artist:test', wardrobe: 'red dress' } }] };
  const sendImport = (view: ReturnType<typeof setup>, token: number, auto = true, classified = true) => {
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', fullMetadata: true, targetMode: 'text-to-image', replace: true,
      prompt: 'artist:test, red dress', negativePrompt: 'imported negative', params: { ...chain.params, seed: 42 }, importSettings: true }));
    view.rerender(<ChainEditor {...view.props} promptClassificationEnabled={classified} autoClassifyMetadata={auto} externalImportToken={token} />);
  };
  it.each([[false, true], [true, false]])('自动分类=%s，分类编辑=%s 时不隐式调用模型', async (auto, classified) => {
    const view = setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    sendImport(view, 1, auto, classified);
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('artist:test, red dress'));
    expect(state.classify).not.toHaveBeenCalled();
  });
  it('正常导入自动填栏，不弹确认；可撤销且保留导入参数和负面', async () => {
    state.classify.mockResolvedValue(result);
    const view = setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    sendImport(view, 1);
    await waitFor(() => expect(state.agent?.draft.params._promptSections?.wardrobe).toBe('red dress'));
    expect(state.classify).toHaveBeenCalledTimes(1);
    expect(state.classify).toHaveBeenCalledWith([{ id: 'global', kind: 'global', prompt: 'artist:test, red dress' }]);
    expect(state.agent?.draft).toMatchObject({ basePrompt: 'artist:test', subjectPrompt: 'red dress', negativePrompt: 'imported negative', params: { seed: 42 } });
    expect(screen.queryByRole('dialog', { name: '查看助手草稿差异' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '撤销分类' }));
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('artist:test, red dress'));
    expect(state.agent?.draft.params._promptSections).toBeUndefined();
    expect(state.agent?.draft.negativePrompt).toBe('imported negative');
  });
  it('失败保留原文，不自动重试；再次导入才发起新调用', async () => {
    state.classify.mockRejectedValue(new Error('synthetic failure'));
    const view = setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    sendImport(view, 1);
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('自动分类失败，已保留导入原文：synthetic failure', 'error'));
    expect(state.agent?.draft.basePrompt).toBe('artist:test, red dress');
    expect(state.classify).toHaveBeenCalledTimes(1);
  });
  it('等待期间手改不被覆盖，结果留在就地入口，不自动打开差异窗口', async () => {
    let finish!: (value: typeof result) => void;
    state.classify.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    sendImport(view, 1); await waitFor(() => expect(state.classify).toHaveBeenCalledTimes(1));
    fireEvent.change(textPrompt(), { target: { value: 'manual edit' } });
    await act(async () => finish(result));
    await screen.findByRole('button', { name: '查看分类结果' });
    expect(state.agent?.draft.basePrompt).toBe('manual edit');
    expect(screen.queryByRole('dialog', { name: '查看助手草稿差异' })).toBeNull();
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 完整配置导入使用同一自动分类链，纯换底图不触发', async mode => {
    state.classify.mockResolvedValue(result);
    const view = setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'image-edit', imageEditOperation: mode, baseImageUrl: 'data:image/png;base64,AQID', prompt: 'artist:test, red dress', negativePrompt: 'imported negative', params: chain.params }));
    view.rerender(<ChainEditor {...view.props} autoClassifyMetadata externalImportToken={1} />);
    await waitFor(() => expect(state.agent?.draft.params._promptSections?.wardrobe).toBe('red dress'));
    expect(state.agent?.draft.target?.mode).toBe(mode); expect(state.classify).toHaveBeenCalledTimes(1);
    expect(state.agent?.draft.basePrompt).toBe('artist:test, red dress');
    fireEvent.click(screen.getByText('粘贴合成底图'));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toContain('cGFzdGVk'));
    expect(state.classify).toHaveBeenCalledTimes(1);
  });
});

it('Roll 填入后编辑器重新挂载，外部内容优先于旧会话草稿', async () => {
  const initial = { ...chain, id: 'playground', variableValues: { subject: 'old_subject' } };
  const view = setup(initial);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '补充' }) as HTMLTextAreaElement).value).toBe('old_subject'));
  view.unmount();
  const applied = { ...initial, variableValues: { subject: 'new_scene' }, params: { ...initial.params, _promptSections: { scene: 'new_scene' } } };
  render(<ChainEditor {...view.props} chain={applied} sectionsRevision={1} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '场景' }) as HTMLTextAreaElement).value).toBe('new_scene'));
  expect((screen.getByRole('textbox', { name: '补充' }) as HTMLTextAreaElement).value).toBe('');
  expect(loadLabWorkspaceSession('playground', fallback()).textToImage.subjectPrompt).toBe('new_scene');
});

it.each([
  { name: '空正文', subject: '', sections: {}, expected: '' },
  { name: '旧版手写正文', subject: 'legacy_subject', sections: {}, expected: 'legacy_subject' },
  { name: '只有分栏的旧记录', subject: undefined, sections: { scene: 'restored_scene' }, expected: 'restored_scene' },
])('Roll 撤销恢复$name后，编辑框、草稿回写与生成请求一致', async ({ subject, sections, expected }) => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  const initial = { ...chain, id: 'playground', variableValues: { subject: '' }, params: { ...chain.params, _promptSections: {} } };
  const view = setup(initial);
  const applied = { ...initial, variableValues: { subject: 'new_scene' }, params: { ...initial.params, _promptSections: { scene: 'new_scene' } } };
  view.rerender(<ChainEditor {...view.props} chain={applied} sectionsRevision={1} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '场景' }) as HTMLTextAreaElement).value).toBe('new_scene'));

  view.props.onUpdateChain.mockClear();
  const restored: PromptChain = { ...initial, variableValues: subject === undefined ? {} : { subject }, params: { ...initial.params, _promptSections: sections } };
  view.rerender(<ChainEditor {...view.props} chain={restored} sectionsRevision={2} />);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '场景' }) as HTMLTextAreaElement).value).toBe(sections.scene || ''));
  expect((screen.getByRole('textbox', { name: '补充' }) as HTMLTextAreaElement).value).toBe(subject === 'legacy_subject' ? subject : '');
  await waitFor(() => expect(view.props.onUpdateChain).toHaveBeenLastCalledWith('playground', expect.objectContaining({ variableValues: { subject: expected } })));
  expect(loadLabWorkspaceSession('playground', fallback()).textToImage.subjectPrompt).toBe(expected);

  fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' }));
  await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledOnce());
  expect(state.buildDescriptor.mock.calls[0][0].history.subjectPrompt).toBe(expected);
  expect(state.buildDescriptor.mock.calls[0][0].prompt).not.toContain('new_scene');
});

it('画师样张取用不自动生成，固定 Seed 不被随机偏好覆盖，保存真实新结果', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  const templateParams = { ...chain.params, seed: 123, characters: [] };
  const target = { id: 'synthetic-target', tag: 'synthetic artist', pack: 'v45', historyIds: [] };
  sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true,
    prompt: 'solo, artist:synthetic artist', negativePrompt: 'low quality', params: templateParams, artistSampleTarget: target }));
  const old = savedItem('old', { prompt: 'solo, artist:synthetic artist', params: templateParams, createdAt: 1 });
  const next = savedItem('sample', { imageUrl: '/api/assets/sample.png', prompt: 'solo, artist:synthetic artist', negativePrompt: 'low quality', params: templateParams, createdAt: 0 });
  state.history.mockResolvedValue([old]);
  scriptJobs([backgroundResult('sample', 1, { lastSavedItem: next })]);
  const view = setup({ ...chain, id: 'playground' });
  view.rerender(<ChainEditor {...view.props} forceEmptySeed />);
  await waitFor(() => expect(textPrompt().value).toBe('solo, artist:synthetic artist'));
  expect(state.startJob).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '保存为画师样张' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' }));
  await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
  expect(state.buildDescriptor.mock.calls[0][0]).toMatchObject({ params: { seed: 123 }, forceEmptySeed: false });
  const save = await screen.findByRole('button', { name: '保存为画师样张' });
  fireEvent.click(save);
  await waitFor(() => expect(state.saveArtistSample).toHaveBeenCalledWith({ ...target, historyIds: ['sample'] }, expect.objectContaining({ id: 'sample', imageUrl: '/api/assets/sample.png', params: templateParams })));
});

it('文生图全局负词清空位于复制旁，撤销只恢复负词，切模式回来重新接入对应操作槽', async () => {
  setup();
  const initialPositive = textPrompt().value;
  const actions = screen.getByTitle('复制全局负面提示词').parentElement!;
  const negative = screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA' && (field as HTMLTextAreaElement).value === chain.negativePrompt) as HTMLTextAreaElement;
  const clear = within(actions).getByRole('button', { name: '清空当前提示词' });
  expect(negative.parentElement!.contains(clear)).toBe(false);
  fireEvent.click(clear);
  expect(negative.value).toBe(''); expect(textPrompt().value).toBe(initialPositive); expect(document.activeElement).toBe(negative);
  fireEvent.click(within(actions).getByRole('button', { name: '撤销清空' })); expect(negative.value).toBe(chain.negativePrompt);
  fireEvent.click(screen.getByRole('button', { name: '图生图' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '文生图' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '文生图' }));
  const reconnected = (await screen.findByTitle('复制全局负面提示词')).parentElement!;
  expect(within(reconnected).getByRole('button', { name: '清空当前提示词' })).toBeTruthy();
  expect(within(reconnected).queryByRole('button', { name: '撤销清空' })).toBeNull();
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 工作台传递强制置空状态与回调，原种子继续留在当前模式草稿', mode => {
  const session = fallback(); session.activeMode = mode;
  const content = mode === 'text-to-image' ? session.textToImage : session.edits[mode];
  content.params.seed = 987654321; saveLabWorkspaceSession(chain.id, session);
  const view = setup(), onForceEmptySeedChange = vi.fn();
  view.rerender(<ChainEditor {...view.props} forceEmptySeed onForceEmptySeedChange={onForceEmptySeedChange} />);
  fireEvent.click(screen.getByRole('button', { name: '强制置空 ON' }));
  expect(onForceEmptySeedChange).toHaveBeenLastCalledWith(false);
  view.rerender(<ChainEditor {...view.props} forceEmptySeed={false} onForceEmptySeedChange={onForceEmptySeedChange} />);
  fireEvent.click(screen.getByRole('button', { name: '强制置空 OFF' }));
  expect(onForceEmptySeedChange).toHaveBeenLastCalledWith(true);
  const saved = loadLabWorkspaceSession(chain.id, fallback());
  expect((mode === 'text-to-image' ? saved.textToImage : saved.edits[mode]).params.seed).toBe(987654321);
  expect(state.startJob).not.toHaveBeenCalled();
});

it.each([false, true])('队列忙碌=%s 时按需查询，隐藏页暂停，回前台立即补查', async busy => {
  vi.useFakeTimers();
  let hidden = false;
  const visibility = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.mocked(getGenerationQueue).mockResolvedValue({ busy, completed: 0, total: busy ? 1 : 0, paused: false, pausing: false, waiting: [] });
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  const view = setup();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getGenerationQueue).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(getGenerationQueue).toHaveBeenCalledTimes(busy ? 5 : 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(getGenerationQueue).toHaveBeenCalledTimes(busy ? 6 : 2);
    hidden = true;
    const calls = vi.mocked(getGenerationQueue).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(getGenerationQueue).toHaveBeenCalledTimes(calls);
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getGenerationQueue).toHaveBeenCalledTimes(calls + 1);
  } finally { view.unmount(); visibility.mockRestore(); vi.useRealTimers(); }
});
const switchTo = async (label: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
  await waitFor(() => expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false));
};

beforeEach(() => {
  state.classify.mockReset().mockResolvedValue({ items: [] });
  vi.mocked(getGenerationQueue).mockReset().mockRejectedValue(new Error('synthetic-status-unavailable'));
  vi.mocked(setGenerationQueuePaused).mockReset().mockRejectedValue(new Error('synthetic-status-unavailable'));
  vi.mocked(setGenerationInterval).mockReset().mockRejectedValue(new Error('synthetic-status-unavailable'));
  state.drained = false;
  state.scopes.clear();
  scriptJobs([backgroundResult('job-1')]);
  state.buildDescriptor.mockReset().mockImplementation(async input => descriptorFromInput(input));
  state.startJob.mockReset().mockImplementation(async (key, token, descriptor, count, placement) => {
    const script = state.scripts[state.started.length] || state.scripts[state.scripts.length - 1];
    state.started.push({ key, token, descriptor, count, ...(placement ? { placement } : {}) });
    state.cursors.set(token, { script, index: 1 });
    return { ...script[0], token, requestedCount: count };
  });
  state.getJob.mockReset().mockImplementation(async (_key, token) => nextSnapshotFor(token));
  state.observeJob.mockReset();
  state.cancelJob.mockReset().mockResolvedValue(undefined);
  state.approveJob.mockReset().mockResolvedValue({ token: 'synthetic-approval', state: 'generating', completedCount: 0, requestedCount: 0, historyIds: [] });
  state.assets.clear();
  state.delayedAsset = null;
  state.delayedBaseSave = null;
  state.runtime = { ...DEFAULT_NAI_RUNTIME, syncedAt: Date.now(), health: { ok: true } };
  state.subscription = null; state.refreshedSubscription = null;
  state.subscriptionLoading = false;
  state.delayedSubscription = null;
  state.getEditMask.mockReset(); state.getEditMask.mockResolvedValue(null);
  state.confirm.mockReset(); state.confirm.mockResolvedValue(true);
  state.agentConfig.mockReset(); state.agentConfig.mockResolvedValue({ permissionMode: 'standard' });
  state.budget = 1666;
  state.history.mockReset(); state.history.mockResolvedValue([]);
  state.addHistory.mockClear();
  state.notifySaved.mockReset(); state.unlinkHistory.mockClear();
  state.saveArtistSample.mockClear();
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});
afterEach(async () => {
  cleanup();
  // 后台任务归属是模块级状态：用例结束前按取消终态收敛，保证下一个用例不被 generation_busy 串住。
  state.drained = true;
  window.dispatchEvent(new Event('visibilitychange'));
  for (const scope of state.scopes) {
    while (getGenerationSeriesSession(scope) || getQueuedGenerationSeries(scope).length) {
      for (const session of [getGenerationSeriesSession(scope), ...getQueuedGenerationSeries(scope)]) if (session) stopGenerationSeriesSession(session);
      await waitFor(() => expect(getGenerationSeriesSession(scope) || getQueuedGenerationSeries(scope).length).toBeFalsy(), { timeout: 3000 });
    }
  }
  state.scopes.clear();
  state.drained = false;
  vi.unstubAllGlobals();
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('退出后 %s 按记忆恢复当前模式和内容，不自动写回预设', async mode => {
  const session = fallback(); session.activeMode = mode;
  session.textToImage.basePrompt = '重启后的文生图草稿';
  for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) {
    session.edits[operation].prompt = `${operation} 重启草稿`;
    session.edits[operation].strength = 0.42;
    session.edits[operation].baseImageRef = 'old-base';
  }
  saveLabWorkspaceSession(chain.id, session); sessionStorage.clear();
  const view = setup();
  if (mode === 'text-to-image') expect(textPrompt().value).toBe('重启后的文生图草稿');
  else {
    expect((await screen.findByLabelText('编辑提示词') as HTMLInputElement).value).toBe(`${mode} 重启草稿`);
    expect(screen.getByLabelText('编辑强度').textContent).toBe('0.42');
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
  }
  expect(loadLabWorkspaceSession(chain.id, fallback()).activeMode).toBe(mode);
  expect(view.props.onUpdateChain).not.toHaveBeenCalled();
});

it('关闭记忆的新启动使用预设，但本会话编辑、模式切换和切页继续保留；再开启立即记住当前内容', async () => {
  const remembered = fallback(); remembered.textToImage.basePrompt = '旧持久草稿';
  saveLabWorkspaceSession(chain.id, remembered); sessionStorage.clear();
  const oldMemory = localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`);
  const view = setup(chain, false);
  expect(textPrompt().value).toBe('saved style');
  fireEvent.change(textPrompt(), { target: { value: '本次新输入' } });
  await switchTo('局部重绘');
  fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: '本次编辑输入' } });
  fireEvent.click(screen.getByRole('button', { name: '调整强度' }));
  await switchTo('文生图');
  expect(textPrompt().value).toBe('本次新输入');
  expect(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)).toBe(oldMemory);
  view.unmount();
  const reopened = setup(chain, false);
  expect(textPrompt().value).toBe('本次新输入');
  reopened.rerender(<ChainEditor {...reopened.props} rememberGenerationSettings />);
  expect(textPrompt().value).toBe('本次新输入');
  const latest = JSON.parse(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)!);
  expect(latest.textToImage.basePrompt).toBe('本次新输入');
  expect(latest.edits.inpaint).toMatchObject({ prompt: '本次编辑输入', strength: 0.42 });
  reopened.rerender(<ChainEditor {...reopened.props} rememberGenerationSettings={false} />);
  expect(textPrompt().value).toBe('本次新输入');
  await switchTo('局部重绘');
  expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('本次编辑输入');
});

it('切换记忆偏好不取消已提交生成任务', async () => {
  sessionStorage.setItem('nai_api_key', 'remember-synthetic-key');
  scriptJobs([{ state: 'generating', completedCount: 0, requestedCount: 1, historyIds: [] }]);
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' }));
  await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
  view.rerender(<ChainEditor {...view.props} rememberGenerationSettings={false} />);
  expect(state.cancelJob).not.toHaveBeenCalled();
  view.rerender(<ChainEditor {...view.props} rememberGenerationSettings />);
  expect(state.cancelJob).not.toHaveBeenCalled();
});

it('跨重启记忆写入失败仅提醒一次，成功后再失败可提醒且当前输入仍可编辑', () => {
  const setItem = Storage.prototype.setItem;
  let failed = true;
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key.startsWith('nai-lab-workspace-v1:') && failed) throw new Error('synthetic storage full');
    setItem.call(this, key, value);
  });
  try {
    const view = setup();
    const message = '无法记住生图设置，本次草稿仍保留，请检查浏览器存储空间。';
    expect(view.props.notify).toHaveBeenCalledWith(message, 'error');
    const notices = () => view.props.notify.mock.calls.filter(([text]) => text === message).length;
    fireEvent.change(textPrompt(), { target: { value: '失败期间第一份草稿' } });
    fireEvent.change(textPrompt(), { target: { value: '失败期间第二份草稿' } });
    expect(notices()).toBe(1);
    expect(loadLabWorkspaceSession(chain.id, fallback(), false).textToImage.basePrompt).toBe('失败期间第二份草稿');
    failed = false;
    fireEvent.change(textPrompt(), { target: { value: '已恢复记忆' } });
    expect(JSON.parse(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)!).textToImage.basePrompt).toBe('已恢复记忆');
    failed = true;
    fireEvent.change(textPrompt(), { target: { value: '后来仍可编辑' } });
    expect(notices()).toBe(2);
    expect(textPrompt().value).toBe('后来仍可编辑');
  } finally { storage.mockRestore(); }
});

it('改变记忆范围立即收窄持久副本，四模式当前输入、参数和会话仍完整保留', async () => {
  const session = fallback(); session.textToImage.basePrompt = 'private-current-global'; session.textToImage.subjectPrompt = 'private-current-subject';
  session.textToImage.negativePrompt = 'private-current-negative';
  for (const [index, draft] of [session.textToImage, ...Object.values(session.edits)].entries()) {
    draft.params.characters = [{ id: 'current-role', prompt: `private-role-${index}`, negativePrompt: `private-role-negative-${index}`, x: 0.1, y: 0.2 }];
  }
  for (const [index, draft] of Object.values(session.edits).entries()) {
    draft.prompt = `private-edit-${index}`; draft.negativePrompt = `private-edit-negative-${index}`; draft.strength = 0.42;
  }
  saveLabWorkspaceSession(chain.id, session);
  const view = setup();
  const current = loadLabWorkspaceSession(chain.id, fallback());
  const onlyParams: GenerationMemoryPreferences = { parameters: true, globalPrompt: false, negativePrompt: false, characterPrompt: false, characterNegativePrompt: false };
  view.rerender(<ChainEditor {...view.props} generationMemory={onlyParams} />);
  expect(textPrompt().value).toBe('private-current-global');
  expect(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)).not.toContain('private-');
  expect(loadLabWorkspaceSession(chain.id, fallback()).textToImage).toEqual(current.textToImage);
  for (const [index, label] of ['图生图', '局部重绘', '扩图'].entries()) {
    await switchTo(label);
    expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe(`private-edit-${index}`);
    expect((screen.getByLabelText('编辑负面词') as HTMLInputElement).value).toBe(`private-edit-negative-${index}`);
    expect(screen.getByLabelText('编辑强度').textContent).toBe('0.42');
  }
  const onlyRoles = { ...onlyParams, parameters: false, characterPrompt: true };
  view.rerender(<ChainEditor {...view.props} generationMemory={onlyRoles} />);
  const memory = JSON.parse(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)!);
  expect(memory.activeMode).toBeUndefined(); expect(memory.edits.outpaint.strength).toBeUndefined();
  expect(memory.edits.outpaint.params.characters[0]).toEqual({ id: 'current-role', prompt: 'private-role-3' });
  expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('private-edit-2');
  expect(screen.getByLabelText('编辑强度').textContent).toBe('0.42');
  view.rerender(<ChainEditor {...view.props} rememberGenerationSettings={false} generationMemory={onlyParams} />);
  expect(JSON.parse(localStorage.getItem(`nai-lab-workspace-v1:${chain.id}`)!)).toEqual(memory);
  expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('private-edit-2');
  expect(view.props.onUpdateChain).not.toHaveBeenCalled();
});

it.each(['playground', 'style', 'character'] as const)('%s 重启仅带回角色正向词，未勾选内容和参数回到当前工作台原配置', type => {
  const entry = type === 'playground' ? { ...chain, id: 'playground', basePrompt: '', negativePrompt: '', modules: [], variableValues: {} }
    : { ...chain, id: `memory-${type}`, type, params: { ...chain.params, characters: [{ id: 'shared', prompt: 'preset role', negativePrompt: 'preset role negative', x: 0.7, y: 0.8 }] } };
  const session = fallback(); session.activeMode = 'outpaint'; session.textToImage.basePrompt = 'private old global';
  for (const draft of [session.textToImage, ...Object.values(session.edits)]) draft.params.characters = [
    { id: 'shared', prompt: 'remembered role', negativePrompt: 'private role negative', x: 0.1, y: 0.2 },
  ];
  saveLabWorkspaceSession(entry.id, session); sessionStorage.clear();
  const memory: GenerationMemoryPreferences = { parameters: false, globalPrompt: false, negativePrompt: false, characterPrompt: true, characterNegativePrompt: false };
  const view = setup(entry, true, memory);
  expect(textPrompt().value).toBe(entry.basePrompt);
  const restored = loadLabWorkspaceSession(entry.id, fallback());
  expect(restored.activeMode).toBe('text-to-image');
  expect(restored.textToImage.params.characters![0]).toMatchObject({ id: 'shared', prompt: 'remembered role',
    x: type === 'playground' ? 0.5 : 0.7, y: type === 'playground' ? 0.5 : 0.8 });
  expect(restored.textToImage.params.characters![0].negativePrompt).toBe(type === 'playground' ? undefined : 'preset role negative');
  if (type === 'playground') {
    expect(view.props.onUpdateChain).toHaveBeenLastCalledWith('playground', expect.objectContaining({ params: restored.textToImage.params }));
  } else expect(view.props.onUpdateChain).not.toHaveBeenCalled();
});

it('Medium 全局负面词禁用，生成的描述符用有效参数，保存的工作台仍保留 High 草稿', async () => {
  sessionStorage.setItem('nai_api_key', 'medium-test-key');
  state.subscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 0 } };
  setup({ ...chain, id: 'playground', params: { ...chain.params, model: 'nai-diffusion-5-full-medium', steps: 35, sampler: 'k_euler', cfgRescale: 0.6, ucPresetId: 'light' } });
  const negative = screen.getByDisplayValue('saved negative') as HTMLTextAreaElement;
  expect(negative.disabled).toBe(true);
  expect(negative.closest('.nai-model-locked')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' }));
  await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
  expect(state.buildDescriptor).toHaveBeenCalledOnce();
  const submitted = state.buildDescriptor.mock.calls[0][0];
  expect(submitted).toMatchObject({ operation: 'text-to-image', negative: '', stream: false, params: { steps: 14, sampler: 'k_euler_ancestral', ucPresetId: 'heavy' } });
  expect(submitted.history).toMatchObject({ basePrompt: 'saved style', subjectPrompt: 'subject', sourceChainId: 'playground', sourceChainType: 'playground' });
  expect(state.startJob.mock.calls[0][0]).toBe('medium-test-key');
  expect(state.startJob.mock.calls[0][3]).toBe(1);
  expect(state.startJob.mock.calls[0][4]).toBeUndefined();
  expect(state.addHistory).not.toHaveBeenCalled();
  const saved = loadLabWorkspaceSession('playground', fallback()).textToImage;
  expect(saved.negativePrompt).toBe('saved negative');
  expect(saved.params).toMatchObject({ steps: 35, sampler: 'k_euler', cfgRescale: 0.6, ucPresetId: 'light' });
});

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
  const pendingSave = Promise.withResolvers<void>();
  props.onUpdateChain.mockImplementation(() => pendingSave.promise);
  let pending!: Promise<boolean>;
  act(() => { pending = props.saveRef.current!.save(); });
  expect(props.saveRef.current?.canSave).toBe(false);
  expect(await props.saveRef.current!.save()).toBe(false);
  await act(async () => { pendingSave.resolve(); await pending; });
  expect(props.onUpdateChain).toHaveBeenCalledOnce();
  expect(props.saveRef.current?.canSave).toBe(true);
  unmount();
  expect(props.saveRef.current).toBeNull();
  const lab = setup({ ...chain, id: 'playground' });
  expect(lab.props.saveRef.current?.canSave).toBe(false);
  const draftSyncs = lab.props.onUpdateChain.mock.calls.length;
  expect(await lab.props.saveRef.current!.save()).toBe(false);
  expect(lab.props.onUpdateChain).toHaveBeenCalledTimes(draftSyncs);
});

it('图生图使用缩放副本的实际像素估费并只提交一次后台任务，当前草稿保持原坐标', async () => {
  sessionStorage.setItem('nai_api_key', 'image-size-fixture');
  state.subscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 0 } };
  vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1024, close: vi.fn() })));
  setup({ ...chain, previewImage: '/synthetic/cover.png', params: { ...chain.params, model: 'nai-diffusion-5-full', width: 1664, height: 2432 } });
  await switchTo('图生图');
  fireEvent.click(screen.getByRole('button', { name: '修改编辑角色' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成尺寸副本' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.buildDescriptor).toHaveBeenCalledOnce();
  expect(state.startJob).toHaveBeenCalledOnce();
  expect(state.buildDescriptor.mock.calls[0][0]).toMatchObject({
    operation: 'image-to-image', approvedCost: 0, stream: false, estimatedCost: 0,
    params: { width: 1024, height: 1024, characters: [{ id: 'edited', x: 0.4, y: 0.7 }] },
    edit: { image: 'data:image/png;base64,AQID', strength: 0.7, noise: 0 },
    history: { edit: { operation: 'image-to-image', strength: 0.7, noise: 0, baseImageSource: 'generated' } },
  });
  expect(state.startJob.mock.calls[0][2].payload).toMatchObject({ action: 'img2img', input: 'data:image/png;base64,AQID' });
  expect(state.addHistory).not.toHaveBeenCalled();
  expect(loadLabWorkspaceSession(chain.id, fallback()).edits['image-to-image'].params).toMatchObject({ width: 1664, height: 2432, characters: [{ id: 'edited', x: 0.3, y: 0.7 }] });
});

it.each(['图生图', '局部重绘', '扩图'])('%s 普通生成复用已有免费快照，不新增确认也不走进逐张流程', async label => {
  sessionStorage.setItem('nai_api_key', 'billing-preflight-fixture');
  state.subscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 0 } };
  state.refreshedSubscription = { ...state.subscription, usage: { percent: 0, isNegative: true, timeUntilNextPercent: 0 } };
  state.delayedSubscription = Promise.withResolvers<NovelaiSubscriptionInfo | null>().promise;
  state.confirm.mockResolvedValueOnce(false);
  vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  setup({ ...chain, params: { ...chain.params, model: 'nai-diffusion-5-full' } });
  await switchTo(label);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.startJob).toHaveBeenCalledOnce();
  expect(state.getJob).not.toHaveBeenCalled();
});

it('普通文生图在订阅刷新未返回时立即提交，不等待后台请求', async () => {
  sessionStorage.setItem('nai_api_key', 'fast-text-fixture');
  state.subscription = { active: true, tier: 3 };
  state.delayedSubscription = Promise.withResolvers<NovelaiSubscriptionInfo | null>().promise;
  setup();
  await act(async () => fireEvent.click(within(document.querySelector('.mobile-generation-actions') as HTMLElement).getByRole('button', { name: /^生成.*张/ })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.startJob).toHaveBeenCalledOnce();
});

it.each(['图生图', '局部重绘', '扩图'])('%s 零点数估算在同步失效时直接提交，不新增确认', async label => {
  sessionStorage.setItem('nai_api_key', 'billing-sync-fixture');
  state.subscription = state.refreshedSubscription = { active: true, tier: 3 };
  state.runtime = { ...DEFAULT_NAI_RUNTIME, health: { ok: false, reason: 'partial', missed: ['billing'] } };
  state.confirm.mockResolvedValueOnce(false);
  vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  setup(); await switchTo(label);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.startJob).toHaveBeenCalledOnce();
});

it('保持打开的实验室继续接收运行时更新，按钮费用不冻结在首次加载值', async () => {
  state.subscription = { active: false, tier: 3 };
  const entry = { ...chain, params: { ...chain.params, model: 'nai-diffusion-5-full', steps: 29 } };
  const { rerender, props } = setup(entry);
  expect(screen.getByRole('button', { name: /^生成.*30 Anlas/ })).toBeTruthy();
  state.runtime = { ...state.runtime!, billing: { ...DEFAULT_NAI_RUNTIME.billing, modelMultipliers: { v5: 2 } } };
  rerender(<ChainEditor {...props} />);
  expect(screen.getByRole('button', { name: /^生成.*40 Anlas/ })).toBeTruthy();
  expect(state.startJob).not.toHaveBeenCalled();
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
    expect(resources.textContent).toBe('Anlas —/—生成额度 —');
    act(() => { sessionStorage.setItem('nai_api_key', 'mobile-workspace-fixture'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'mobile-workspace-fixture' })); });
    expect(screen.getByRole('button', { name: /查看账户资源：预算 1666 · 余额 未知 · 额度未知/ })).toBeTruthy();
    act(() => { sessionStorage.removeItem('nai_api_key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: '' })); });
  }
  expect(state.startJob).not.toHaveBeenCalled();
});

it('贴底资源不占图片／生成操作行，图片入口继续打开大图且关闭后恢复资源', async () => {
  vi.stubGlobal('innerWidth', 390);
  const { container } = setup({ ...chain, previewImage: '/synthetic/preview.png' });
  const preview = await screen.findByRole('button', { name: '查看当前预览图' });
  const actions = container.querySelector<HTMLElement>('.mobile-generation-actions')!;
  expect(actions.contains(preview)).toBe(true);
  const generate = within(actions).getByRole('button', { name: /^生成.*张/ });
  expect(generate.closest('.mobile-generation-actions')).toBe(actions);
  expect(actions.contains(screen.getByRole('button', { name: /^查看账户资源/ }))).toBe(false);
  fireEvent.click(preview);
  const lightbox = await screen.findByRole('dialog', { name: '图片预览' });
  const imageStage=within(lightbox).getByLabelText('图片平移与缩放');
  longPress(within(lightbox).getByRole('img')); expect(imageStage.getAttribute('data-press-revealed')).toBe('true');
  expect(screen.getByRole('dialog', { name: '图片预览' })).toBe(lightbox);
  expect(screen.queryByRole('button', { name: /^查看账户资源/ })).toBeNull();
  fireEvent.click(imageStage);
  expect(await screen.findByRole('button', { name: /^查看账户资源/ })).toBeTruthy();
  expect(state.startJob).not.toHaveBeenCalled();
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

describe('蓝色导入明确指定文生图', () => {
  it('首次打开实验室也切到文生图，部分元数据保留已存文生图设置', async () => {
    const session = fallback(); session.activeMode = 'inpaint';
    session.textToImage.negativePrompt = 'retained text negative'; session.textToImage.params.scale = 4;
    session.edits.inpaint.params.scale = 9;
    saveLabWorkspaceSession(chain.id, session);
    const before = loadLabWorkspaceSession(chain.id, fallback());
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true,
      partialMetadata: true, prompt: 'known original prompt', params: { seed: 0 } }));
    setup();
    await waitFor(() => expect(textPrompt().value).toBe('known original prompt'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe('text-to-image');
    expect(saved.textToImage.negativePrompt).toBe('retained text negative');
    expect(saved.textToImage.params).toEqual({ ...session.textToImage.params, seed: 0 });
    expect(saved.edits).toEqual(before.edits);
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('从 %s 完整恢复文生图，保留全部编辑草稿和资产', async mode => {
    const session = fallback(); session.activeMode = mode;
    session.textToImage.params.vibes = { enabled: true, normalizeStrengths: true, slots: [] };
    for (const [operation, draft] of Object.entries(session.edits)) {
      draft.prompt = `retained ${operation}`; draft.negativePrompt = `negative ${operation}`; draft.params.seed = 77;
      draft.baseImageRef = `base-${operation}`; draft.maskRef = `mask-${operation}`;
    }
    saveLabWorkspaceSession(chain.id, session);
    const view = setup(); const before = loadLabWorkspaceSession(chain.id, fallback());
    const params = { model: 'nai-diffusion-5-full', width: 1024, height: 1024, steps: 20, scale: 3, sampler: 'k_euler', seed: 0,
      qualityToggle: false, ucPreset: 4, cfgRescale: 0.3, variety: true, useCoords: true,
      characters: [{ id: 'imported', prompt: 'girl', negativePrompt: 'hat', x: 0.2, y: 0.8, enabled: true }] };
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true,
      prompt: 'complete original prompt', negativePrompt: '', params }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => expect(textPrompt().value).toBe('complete original prompt'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe('text-to-image');
    expect(saved.textToImage).toMatchObject({ basePrompt: 'complete original prompt', subjectPrompt: '', negativePrompt: '', params });
    expect(saved.textToImage.params.vibes).toBeUndefined();
    expect(Object.values(saved.textToImage.activeModules).every(value => !value)).toBe(true);
    expect(saved.edits).toEqual(before.edits);
    expect(sessionStorage.getItem('nai_pending_import')).toBeNull(); expect(state.startJob).not.toHaveBeenCalled();
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('从 %s 取用部分元数据或所选字段，缺失内容沿用文生图草稿', async mode => {
    const session = fallback(); session.activeMode = mode;
    session.edits[mode].negativePrompt = 'edit negative'; session.edits[mode].params.scale = 9;
    saveLabWorkspaceSession(chain.id, session);
    const view = setup(); const before = loadLabWorkspaceSession(chain.id, fallback());
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', fullMetadata: true,
      partialMetadata: true, prompt: 'known original prompt', params: { steps: 20, seed: 0 } }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => expect(textPrompt().value).toBe('known original prompt'));
    const partial = loadLabWorkspaceSession(chain.id, fallback());
    expect(partial.activeMode).toBe('text-to-image'); expect(partial.edits).toEqual(before.edits);
    expect(partial.textToImage.negativePrompt).toBe(before.textToImage.negativePrompt);
    expect(partial.textToImage.params).toEqual({ ...before.textToImage.params, steps: 20, seed: 0 });
    await switchTo(mode === 'image-to-image' ? '图生图' : mode === 'inpaint' ? '局部重绘' : '扩图');
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', targetMode: 'text-to-image', prompt: 'selected tag', replace: false }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={2} />);
    await waitFor(() => expect(textPrompt().value).toBe('known original prompt, selected tag'));
    const selected = loadLabWorkspaceSession(chain.id, fallback());
    expect(selected.edits).toEqual(before.edits); expect(selected.textToImage.params).toEqual(partial.textToImage.params);
    expect(state.startJob).not.toHaveBeenCalled();
  });
});

describe('未指定目标的外部内容沿用当前创作模式', () => {
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 部分元数据恢复已知内容，缺失负面与参数保留当前值', async mode => {
    const session = fallback(); session.activeMode = mode;
    session.textToImage.subjectPrompt = 'old subject';
    saveLabWorkspaceSession(chain.id, session);
    const view = setup(); const before = loadLabWorkspaceSession(chain.id, fallback());
    const oldContent = mode === 'text-to-image' ? before.textToImage : before.edits[mode];
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', fullMetadata: true, partialMetadata: true, replace: true,
      prompt: 'known original scene', params: { steps: 20, seed: 0 } }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => {
      const saved = loadLabWorkspaceSession(chain.id, fallback());
      expect(mode === 'text-to-image' ? saved.textToImage.basePrompt : saved.edits[mode].prompt).toBe('known original scene');
    });
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    const content = mode === 'text-to-image' ? saved.textToImage : saved.edits[mode];
    expect(content.negativePrompt).toBe(oldContent.negativePrompt);
    expect(content.params).toEqual({ ...oldContent.params, steps: 20, seed: 0 });
    if (mode === 'text-to-image') {
      expect(saved.textToImage.subjectPrompt).toBe(''); expect(Object.values(saved.textToImage.activeModules).every(value => !value)).toBe(true); expect(saved.edits).toEqual(before.edits);
    } else expect(saved.textToImage).toEqual(before.textToImage);
    expect(state.startJob).not.toHaveBeenCalled();
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 完整元数据包含模型与 Seed，文生图清掉旧主体和模块，其他模式保持独立', async mode => {
    const session = fallback(); session.activeMode = mode;
    session.textToImage.subjectPrompt = 'old subject'; session.textToImage.activeModules = { 'old-module': true };
    if (mode !== 'text-to-image') { session.edits[mode].prompt = 'old edit'; session.edits[mode].params.scale = 5; }
    saveLabWorkspaceSession(chain.id, session);
    const view = setup({ ...chain, modules: [...chain.modules, { id: 'old-module', name: '旧模块', content: 'old module content', isActive: true, position: 'post' }] });
    const before = loadLabWorkspaceSession(chain.id, fallback());
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', fullMetadata: true, replace: true,
      prompt: 'weighted style, 1girl, bikini, standing', negativePrompt: 'lowres, bad anatomy', params: { model: 'nai-diffusion-5-full', width: 832, height: 1216, steps: 28, scale: 3,
        sampler: 'k_euler_ancestral', seed: 2324135392, qualityToggle: false, ucPreset: 4, characters: [] } }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => {
      const saved = loadLabWorkspaceSession(chain.id, fallback());
      expect(mode === 'text-to-image' ? saved.textToImage.basePrompt : saved.edits[mode].prompt).toBe('weighted style, 1girl, bikini, standing');
    });
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe(mode);
    const content = mode === 'text-to-image' ? saved.textToImage : saved.edits[mode];
    expect(content).toMatchObject({ negativePrompt: 'lowres, bad anatomy', params: { model: 'nai-diffusion-5-full', steps: 28, scale: 3, seed: 2324135392, characters: [] } });
    if (mode === 'text-to-image') {
      expect(saved.textToImage.subjectPrompt).toBe(''); expect(Object.values(saved.textToImage.activeModules).every(value => !value)).toBe(true); expect(saved.edits).toEqual(before.edits);
    } else expect(saved.textToImage).toEqual(before.textToImage);
    expect(state.startJob).not.toHaveBeenCalled();
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 仅修改选中的字段，保留其他模式、参考和结构', async mode => {
    const session = fallback(); session.activeMode = mode;
    if (mode !== 'text-to-image') { session.edits[mode].prompt = 'current edit'; session.edits[mode].negativePrompt = 'current negative'; }
    saveLabWorkspaceSession(chain.id, session);
    const view = setup();
    const before = loadLabWorkspaceSession(chain.id, fallback());
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', prompt: '{artist:synthetic}', replace: false }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => {
      const saved = loadLabWorkspaceSession(chain.id, fallback());
      expect(mode === 'text-to-image' ? saved.textToImage.basePrompt : saved.edits[mode].prompt).toContain('{artist:synthetic}');
    });
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe(mode);
    if (mode === 'text-to-image') {
      expect(saved.textToImage.negativePrompt).toBe(before.textToImage.negativePrompt);
      expect(saved.textToImage.subjectPrompt).toBe(before.textToImage.subjectPrompt);
      expect(saved.textToImage.params).toEqual(before.textToImage.params);
      expect(saved.edits).toEqual(before.edits);
    } else {
      expect(saved.edits[mode].negativePrompt).toBe('current negative');
      expect(saved.edits[mode].params).toEqual(before.edits[mode].params);
      expect(saved.textToImage).toEqual(before.textToImage);
    }
    expect(sessionStorage.getItem('nai_pending_import')).toBeNull(); expect(state.startJob).not.toHaveBeenCalled();
  });
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 外部底图保留当前提示词与参数，不借用文生图配置或自动生成', async operation => {
    const session = fallback(); session.activeMode = 'inpaint'; session.edits.inpaint.prompt = 'active edit';
    session.edits.inpaint.negativePrompt = 'active negative'; session.edits.inpaint.params.steps = 12;
    saveLabWorkspaceSession(chain.id, session);
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'base-image', imageEditOperation: operation, baseImageUrl: 'data:image/png;base64,AQID' }));
    setup();
    await waitFor(() => {
      const saved = loadLabWorkspaceSession(chain.id, fallback());
      expect(saved.activeMode).toBe(operation); expect(saved.edits[operation].baseImageRef).toBeTruthy();
    });
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.edits[operation]).toMatchObject({ prompt: 'active edit', negativePrompt: 'active negative' });
    expect(saved.edits[operation].params).toEqual(session.edits.inpaint.params);
    expect(saved.textToImage.basePrompt).toBe(session.textToImage.basePrompt); expect(state.startJob).not.toHaveBeenCalled();
  });
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
  it('没有显式主体正文时用参数里的四栏合并值兜底，剩余导入结构照常恢复', async () => {
    // 风格串卡片只投递原始数据：旧串可能只留下 params._promptSections，正文为空。
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ targetMode: 'text-to-image', basePrompt: 'imported base', modules: [],
      negativePrompt: 'imported negative', params: { ...chain.params, _promptSections: {
        appearance: '1girl', wardrobe: 'blue dress', pose: '', scene: '', camera: '', extra: '',
      } } }));
    setup();
    await waitFor(() => expect(textPrompt().value).toBe('imported base'));
    const saved = loadLabWorkspaceSession(chain.id, fallback());
    expect(saved.activeMode).toBe('text-to-image');
    expect(saved.textToImage).toMatchObject({ basePrompt: 'imported base', subjectPrompt: '1girl, blue dress', negativePrompt: 'imported negative' });
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
    expect(state.startJob).not.toHaveBeenCalled();
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
  expect(state.startJob).not.toHaveBeenCalled();
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
  expect(state.startJob).not.toHaveBeenCalled();
});

it.each(['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full'])('%s 四模式统一显示免费或 Opus，已有快照刷新时不闪回确认', async model => {
  state.subscription = { active: true, tier: 3 };
  state.subscriptionLoading = true;
  setup({ ...chain, params: { ...chain.params, model } });
  const label = model.startsWith('nai-diffusion-5-') ? '消耗 Opus 额度' : '免费';
  expect(screen.getByLabelText('文生图费用').textContent).toBe(label);
  expect(screen.getByRole('button', { name: new RegExp(`^生成.*${label}`) })).toBeTruthy();
  for (const mode of ['图生图', '局部重绘', '扩图']) {
    await switchTo(mode);
    if (mode === '局部重绘') fireEvent.click(screen.getByRole('button', { name: '使用普通重绘' }));
    expect(screen.getByLabelText('编辑费用').textContent).toBe(label);
  }
  expect(state.startJob).not.toHaveBeenCalled();
});

it.each([false, true])('订阅尚未知（刷新 %s）时四模式明确费用未知，文生图仍可点击', async loading => {
  state.subscriptionLoading = loading;
  setup();
  const label = loading ? '费用确认中…' : '费用未知';
  expect(screen.getByLabelText('文生图费用').textContent).toBe(label);
  expect((screen.getByRole('button', { name: new RegExp(`^生成.*${label}`) }) as HTMLButtonElement).disabled).toBe(false);
  for (const mode of ['图生图', '局部重绘', '扩图']) {
    await switchTo(mode);
    if (mode === '局部重绘') fireEvent.click(screen.getByRole('button', { name: '使用普通重绘' }));
    expect(screen.getByLabelText('编辑费用').textContent).toBe(label);
  }
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.startJob).not.toHaveBeenCalled();
});

describe('自由实验室图片只保留本次打开', () => {
  const lab = { ...chain, id: 'playground' };
  const oldHistory: LocalGenItem[] = Array.from({ length: 80 }, (_, index) => ({
    id: `old-${index}`, imageUrl: `/synthetic/old-${index}.png`, prompt: 'old prompt', params: chain.params, createdAt: 80 - index,
  }));
  const generation = { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) };
  const allowSyntheticGeneration = () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  };

  it('合成网络图片使用与 FileReader 同一环境的 Blob，结果可真实恢复', async () => {
    allowSyntheticGeneration();
    const blob = await (await fetch('/synthetic/result.png')).blob();
    expect(blob).toBeInstanceOf(Blob);
    expect(await blobToDataUrl(blob)).toBe('data:image/png;base64,AQID');
  });

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
    scriptJobs([backgroundResult('new-1')], [backgroundResult('new-2', 1, { lastSavedItem: savedItem('new-2', { edit: { operation } }) })]);
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
    const lateHistory = Promise.withResolvers<LocalGenItem[]>();
    state.history.mockReturnValueOnce(lateHistory.promise);
    setup({ ...chain, id, previewImage: '/synthetic/saved-cover.png' });
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' })));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-1.png'));
    await act(async () => lateHistory.resolve(oldHistory));
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-1.png');
    expect(screen.getByLabelText('预览历史编号').textContent).toBe('1 / 81');
  });

  it('编辑模式翻图、移除及重置只改变编辑预览，文生图保留自己的结果', async () => {
    allowSyntheticGeneration();
    scriptJobs([backgroundResult('new-1')], [backgroundResult('new-2', 1, { lastSavedItem: savedItem('new-2', { edit: { operation: 'inpaint' } }) })]);
    state.history.mockResolvedValue(oldHistory);
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
    const lateHistory = Promise.withResolvers<LocalGenItem[]>();
    state.history.mockReturnValueOnce(lateHistory.promise);
    const view = setup();
    await waitFor(() => expect(state.history).toHaveBeenCalledWith(chain.id));
    view.rerender(<ChainEditor {...view.props} chain={lab} allChains={[lab]} />);
    await waitFor(() => expect(state.history).toHaveBeenCalledWith('playground'));
    await act(async () => lateHistory.resolve(oldHistory));
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
    const baseSave = Promise.withResolvers<void>();
    state.delayedBaseSave = baseSave.promise;
    fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' }));
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: 'later prompt' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: 'later negative' } });
    fireEvent.click(screen.getByRole('button', { name: '修改编辑角色' }));
    await act(async () => baseSave.resolve());
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits['image-to-image']).toMatchObject({ prompt: 'later prompt', negativePrompt: 'later negative',
      params: { characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative' }] } });
  });

  it('图生图主动清空全局和角色后换底图，提交的描述符仍发送空提示词', async () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.startJob.mockRejectedValue(new Error('合成测试主动终止'));
    setup();
    await switchTo('图生图');
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '清空编辑角色' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledOnce());
    const submitted = state.buildDescriptor.mock.calls[0][0];
    expect(submitted.prompt).toBe('');
    expect(submitted.negative).toBe('');
    expect(submitted.params.characters).toEqual([]);
    expect(state.startJob).toHaveBeenCalledOnce();
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

  it('历史复制配置进入扩图；删除全局及角色后提交的描述符收到空内容，不补回文生图旧词', async () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.startJob.mockRejectedValue(new Error('合成测试主动终止'));
    setup();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    await switchTo('扩图');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴分角色底图' })));
    await waitFor(() => expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('copied scene'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledTimes(1));
    expect(state.buildDescriptor.mock.calls[0][0].prompt).toBe('copied scene');
    expect(state.buildDescriptor.mock.calls[0][0].negative).toBe('copied negative');
    expect(state.buildDescriptor.mock.calls[0][0].params.characters?.[0]).toMatchObject({ prompt: 'copied role', negativePrompt: 'copied role negative' });
    fireEvent.change(screen.getByLabelText('编辑提示词'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('编辑负面词'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '清空编辑角色' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledTimes(2));
    expect(state.buildDescriptor.mock.calls[1][0].prompt).toBe('');
    expect(state.buildDescriptor.mock.calls[1][0].negative).toBe('');
    expect(state.buildDescriptor.mock.calls[1][0].params.characters).toEqual([]);
    expect(loadLabWorkspaceSession(chain.id, fallback()).textToImage.basePrompt).toBe('saved style');
  });
  it.each([['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('%s 继承并保存角色模块，生成不清空，其他模式保持独立', async (operation, label) => {
    const character = { id: 'original', prompt: 'original character', negativePrompt: 'original negative', x: 0.5, y: 0.5 };
    const entry = { ...chain, params: { ...chain.params, characters: [character], useCoords: true } };
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    vi.stubGlobal('fetch', vi.fn(async () => syntheticImageResponse()));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    // 请求入口捕获后主动失败，不执行任何真实后台任务或结算。
    state.startJob.mockRejectedValueOnce(new Error('合成测试主动终止'));
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
    await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledOnce());
    expect(state.buildDescriptor.mock.calls[0][0].params).toMatchObject({ useCoords: true,
      characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.3, y: 0.7 }] });
    expect(state.startJob).toHaveBeenCalledOnce();
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

  it('分享配方替换生成配置后另存新串，仍保留原作者与免费出处', async () => {
    const source = { author: '合成作者', sourceUrl: 'https://example.org/free', note: '免费分享' };
    const view = setup({ ...chain, params: { ...chain.params, _styleBundleSources: [source] } });
    sessionStorage.setItem('nai_pending_import', JSON.stringify({ mode: 'prompt-fragments', fullMetadata: true, targetMode: 'text-to-image', replace: true,
      prompt: 'replacement recipe', negativePrompt: '', params: { ...chain.params, seed: 42 }, importSettings: true }));
    view.rerender(<ChainEditor {...view.props} externalImportToken={1} />);
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('replacement recipe'));
    const actions = view.container.querySelector('.chain-editor-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: '保存风格串' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '保存风格串' })).getByRole('button', { name: '另存为新串' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '风格串' })); });
    expect(view.props.onFork).toHaveBeenCalledWith(expect.objectContaining({ basePrompt: 'replacement recipe', params: expect.objectContaining({ seed: 42, _styleBundleSources: [source] }) }), 'style');
    expect(view.props.onUpdateChain).not.toHaveBeenCalled();
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
    const lateBase = Promise.withResolvers<Blob>();
    state.delayedAsset = lateBase.promise;
    saveLabWorkspaceSession(chain.id, {
      ...fallback(),
      edits: { ...fallback().edits, outpaint: { ...fallback().edits.outpaint, baseImageRef: 'delayed-base' } },
    });
    setup();
    await switchTo('扩图');
    expect(screen.getByLabelText('编辑底图读取状态').textContent).toBe('true');
    expect(screen.getByRole('button', { name: '读取图片中…' }).getAttribute('aria-disabled')).toBe('true');
    await switchTo('局部重绘');
    await act(async () => { lateBase.resolve(new Blob(['late base'], { type: 'image/png' })); });
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
  const dialog = screen.getByRole('dialog', { name: '查看助手草稿差异' });
  expect(dialog.textContent).toContain('manual edit'); expect(dialog.textContent).toContain('Agent edit');
  fireEvent.click(within(dialog).getByText('应用选中修改'));
  expect(textPrompt().value).toBe('Agent edit');
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('完全访问下 Agent %s 的免费、付费、预算不足和排队请求直接生成', async mode => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  state.agentConfig.mockResolvedValue({ permissionMode: 'full' });
  state.budget = 0;
  state.confirm.mockResolvedValue(false);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (!String(input).startsWith('/synthetic/') && !String(input).startsWith('data:image/')) throw new Error('测试禁止真实网络请求');
    return syntheticImageResponse();
  }));
  const session = fallback(); session.activeMode = mode;
  saveLabWorkspaceSession(chain.id, session); setup();
  await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(mode));
  const approve = vi.fn(async () => {});
  for (const free of [true, false]) {
    // 有效 Opus 快照覆盖免费；无订阅及超大尺寸覆盖预算已用尽时的付费分支。
    state.subscription = free ? { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 10 } } : null;
    await act(async () => state.agent!.onFinalDraft({ ...state.agent!.draft, params: { ...state.agent!.draft.params, width: free ? 832 : 2048, height: free ? 1216 : 2048 } }));
    const count = free ? 1 : 2, placement = free ? undefined : 'next';
    scriptJobs([backgroundResult('full-result', count, { historyIds: Array.from({ length: count }, (_, index) => `full-result-${index}`) })]);
    await act(async () => {
      await expect(state.agent!.onRequestGeneration(state.agent!.draft, '合成生图', approve, count, placement)).resolves.toMatchObject({ success: true, requestedCount: count, completedCount: count });
    });
    expect(state.started).toHaveLength(1);
    expect(state.started[0]).toMatchObject({ count, descriptor: { autoApproveCost: true } });
    if (free) expect(state.started[0].descriptor.approvedCost).toBe(0);
    else expect(state.started[0].descriptor.approvedCost).toBeGreaterThan(0);
    if (placement) expect(state.started[0].placement).toBe(placement);
  }
  expect(approve).toHaveBeenCalledTimes(2);
  expect(state.confirm).not.toHaveBeenCalled();
});

it('标准权限的 Agent 生图仍确认，确认后的任务不带自动费用授权', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key'); setup();
  await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  const approve = vi.fn(async () => {});
  await act(async () => { await state.agent!.onRequestGeneration(state.agent!.draft, '合成生图', approve); });
  expect(state.confirm).toHaveBeenCalledOnce(); expect(approve).toHaveBeenCalledOnce();
  expect(state.started).toHaveLength(1); expect(state.started[0].descriptor.autoApproveCost).toBeUndefined();
});

it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('只读权限的 Agent %s 不确认也不投递生图', async mode => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  state.agentConfig.mockResolvedValue({ permissionMode: 'read_only' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  const session = fallback(); session.activeMode = mode;
  saveLabWorkspaceSession(chain.id, session); setup();
  await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(mode));
  const approve = vi.fn(async () => {});
  await act(async () => {
    await expect(state.agent!.onRequestGeneration(state.agent!.draft, '合成生图', approve)).resolves.toMatchObject({ success: false, code: 'agent_read_only', completedCount: 0 });
  });
  expect(state.confirm).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled(); expect(state.startJob).not.toHaveBeenCalled();
});

it('生图确认期间手动修改使旧批准失效，不提交任务或批准回调', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  const confirmation = Promise.withResolvers<boolean>();
  state.confirm.mockImplementationOnce(() => confirmation.promise);
  // 回执类型直接取组件真实 props 签名（后台任务结果 | 布尔），不硬写窄类型。
  const approve = vi.fn(async () => {}); let task!: ReturnType<NonNullable<typeof state.agent>['onRequestGeneration']>;
  await act(async () => { task = state.agent!.onRequestGeneration(state.agent!.draft, 'synthetic', approve); });
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
  fireEvent.change(textPrompt(), { target: { value: 'manual while confirming' } });
  await act(async () => { confirmation.resolve(true); await expect(task).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'target_changed', error: '确认期间创作目标已变化，请重新提出请求' }); });
  expect(approve).not.toHaveBeenCalled(); expect(state.startJob).not.toHaveBeenCalled();
});

it.each([true, false])('生图确认接受=%s 时，用户取消与后台失败分别回执', async accepted => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  state.confirm.mockResolvedValueOnce(accepted);
  state.startJob.mockRejectedValueOnce(Object.assign(new Error('合成 API 失败'), { code: 'generation_failed', outcome: 'failed' }));
  const approve = vi.fn(async () => {});
  await act(async () => {
    const result = await state.agent!.onRequestGeneration(state.agent!.draft, 'synthetic', approve);
    expect(result).toMatchObject({ success: false, outcome: accepted ? 'failed' : 'cancelled', code: accepted ? 'generation_failed' : 'user_cancelled', error: accepted ? '合成 API 失败' : '用户取消了生图请求' });
  });
  expect(approve).toHaveBeenCalledTimes(accepted ? 1 : 0); expect(state.startJob).toHaveBeenCalledTimes(accepted ? 1 : 0);
});

it('生成前草稿实际变化返回检查拦截，不弹确认、不提交任务', async () => {
  sessionStorage.setItem('nai_api_key', 'synthetic-key');
  setup(); await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
  const oldDraft = state.agent!.draft;
  fireEvent.change(textPrompt(), { target: { value: 'manual' } });
  await act(async () => { await expect(state.agent!.onRequestGeneration(oldDraft)).resolves.toMatchObject({ success: false, outcome: 'blocked', code: 'target_changed' }); });
  expect(state.confirm).not.toHaveBeenCalled(); expect(state.startJob).not.toHaveBeenCalled();
});

describe('后台任务只提交一次并只观察后端状态', () => {
  const setupSeries = (entry: PromptChain = chain) => setup({ ...entry, previewImage: '/synthetic/cover.png' });
  const prepare = () => {
    sessionStorage.setItem('nai_api_key', 'synthetic-key');
    state.subscription = state.refreshedSubscription = { active: true, tier: 3, usage: { percent: 50, isNegative: false, timeUntilNextPercent: 10 } };
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (!String(input).startsWith('/synthetic/') && !String(input).startsWith('data:image/')) throw new Error('测试禁止真实网络请求');
      return syntheticImageResponse();
    }));
  };
  const countInput = (regionName = '文生图预览') => {
    if (!screen.queryByLabelText('生成张数')) fireEvent.keyDown(within(screen.getByRole('region', { name: regionName })).getByRole('button', { name: /^(生成|加入队列).*张/ }), { key: 'ArrowDown', altKey: true });
    return screen.getByLabelText('生成张数');
  };
  const mobileActions = () => within(document.querySelector('.mobile-generation-actions') as HTMLElement);

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('实时预览 %s 每步显示，同图片更新步数，新预览不被上一张历史覆盖', async (operation, label) => {
    prepare();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([{ state: 'generating', completedCount: 0, requestedCount: 2, historyIds: [], previewVersion: 0 }]);
    let push: Parameters<typeof import('../../services/generationJob').observeGenerationJob>[3] = () => {};
    let finish = () => {};
    state.observeJob.mockImplementation((_key, _token, _signal, onSnapshot) => {
      push = onSnapshot; return new Promise<void>(resolve => { finish = resolve; });
    });
    const view = setupSeries();
    view.rerender(<ChainEditor {...view.props} generationStreamPreview={true} />);
    if (operation !== 'text-to-image') {
      await switchTo(label);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    }
    fireEvent.change(countInput(operation === 'text-to-image' ? '文生图预览' : operation), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: operation === 'text-to-image' ? '生成合成文生图' : operation === 'image-to-image' ? '生成合成编辑' : '生成合成蒙版编辑' }));
    await waitFor(() => expect(state.observeJob).toHaveBeenCalledOnce());
    const image = 'data:image/png;base64,UFJPQ0VTUw==', token = state.started[0].token;
    for (let step = 1; step <= 3; step++) {
      await act(async () => { await push({ token, state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1'), previewVersion: step, preview: { image, step } }); });
      expect(screen.getByLabelText(operation === 'text-to-image' ? '文生图结果' : '编辑结果').textContent).toBe(image);
      expect(screen.getByLabelText(operation === 'text-to-image' ? '文生图步数' : '编辑步数').textContent).toBe(`${step}/${state.started[0].descriptor.history.params.steps}`);
    }
    if (operation === 'text-to-image') {
      view.unmount(); setupSeries();
      expect(screen.getByLabelText('文生图步数').textContent).toBe(`3/${state.started[0].descriptor.history.params.steps}`);
    }
    await act(async () => {
      await push({ ...backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] }), token, previewVersion: 4 }); finish();
    });
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
    expect(state.startJob).toHaveBeenCalledOnce(); expect(state.getJob).not.toHaveBeenCalled();
    expect(state.cancelJob).not.toHaveBeenCalled(); expect(state.addHistory).not.toHaveBeenCalled();
  });

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('四模式 %s 将真实执行与暂停状态同步到桌面和手机生成特效', async (operation, label) => {
    prepare();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: 1, historyIds: [] },
      { state: 'paused', completedCount: 0, requestedCount: 1, historyIds: [] },
      backgroundResult('synthetic-effect-result'),
    ]);
    setupSeries();
    if (operation !== 'text-to-image') {
      await switchTo(label);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    }
    const desktop = within(screen.getByRole('region', { name: operation === 'text-to-image' ? '文生图预览' : operation }));
    fireEvent.click(desktop.getByRole('button', { name: operation === 'text-to-image' ? '生成合成文生图' : operation === 'image-to-image' ? '生成合成编辑' : '生成合成蒙版编辑' }));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    const desktopButton = desktop.getByRole('button', { name: /^加入队列/ });
    const mobileButton = mobileActions().getByRole('button', { name: /^加入队列/ });
    await waitFor(() => {
      expect(desktopButton.classList.contains('generation-action-button--loading')).toBe(true);
      expect(mobileButton.classList.contains('generation-action-button--loading')).toBe(true);
    });
    if (operation === 'text-to-image') {
      expect(desktopButton.getAttribute('aria-disabled')).toBe('false');
      expect(mobileButton.getAttribute('aria-disabled')).toBe('false');
    }
    await waitFor(() => {
      expect(desktopButton.classList.contains('generation-action-button--loading')).toBe(false);
      expect(mobileButton.classList.contains('generation-action-button--loading')).toBe(false);
    }, { timeout: 3000 });
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull(), { timeout: 4000 });
    expect(desktop.getByRole('button', { name: /^生成.*1 张/ })).toBe(desktopButton);
    expect(mobileActions().getByRole('button', { name: /^生成.*1 张/ })).toBe(mobileButton);
  }, 10000);

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('关闭连续生成后 %s 不继承旧张数，费用和实际请求均为单张，重新开启从 1 开始', async (operation, label) => {
    prepare();
    state.subscription = state.refreshedSubscription = { active: false, tier: 3 };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    const view = setupSeries();
    if (label !== '文生图') {
      await switchTo(label);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    }
    if (operation === 'inpaint') fireEvent.click(screen.getByRole('button', { name: '选择合成重绘区域' }));
    const fee = screen.getByLabelText(label === '文生图' ? '文生图费用' : '编辑费用');
    const singleCost = Number(fee.textContent?.match(/\d+/)?.[0]);
    expect(singleCost).toBeGreaterThan(0);
    fireEvent.change(countInput(operation === 'text-to-image' ? '文生图预览' : operation), { target: { value: '3' } });
    expect(fee.textContent).toContain(String(singleCost * 3));
    view.rerender(<ChainEditor {...view.props} continuousGenerationEnabled={false} />);
    expect(fee.textContent).toContain(String(singleCost));
    expect(screen.queryByLabelText('生成张数')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: label === '文生图' ? '生成合成文生图' : '生成合成编辑' })));
    await waitFor(() => expect(state.notifySaved).toHaveBeenCalledWith('job-1'));
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.started[0]).toMatchObject({ count: 1 });
    expect(state.started[0].placement).toBeUndefined();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
    view.rerender(<ChainEditor {...view.props} continuousGenerationEnabled />);
    expect((countInput(operation === 'text-to-image' ? '文生图预览' : operation) as HTMLInputElement).value).toBe('1');
  });

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('关闭连续生成后 Agent %s 拒绝多张、队尾和插队，不降为单张或进入费用确认', async (operation, label) => {
    prepare();
    const view = setupSeries();
    if (label !== '文生图') await switchTo(label);
    view.rerender(<ChainEditor {...view.props} continuousGenerationEnabled={false} />);
    await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(operation));
    const approved = vi.fn(async () => {});
    for (const [count, placement] of [[2, undefined], [1, 'end'], [1, 'next']] as const) {
      await act(async () => {
        expect(await state.agent!.onRequestGeneration(state.agent!.draft, '合成请求', approved, count, placement)).toMatchObject({
          success: false, code: 'continuous_generation_disabled', outcome: 'blocked', requestedCount: count, completedCount: 0, historyIds: [],
        });
      });
    }
    expect(state.confirm).not.toHaveBeenCalled();
    expect(approved).not.toHaveBeenCalled();
    expect(state.buildDescriptor).not.toHaveBeenCalled();
    expect(state.startJob).not.toHaveBeenCalled();
  });

  it('Agent 批准回调尚未完成时关闭连续生成，不投递已准备的多张任务', async () => {
    prepare();
    const view = setupSeries();
    const approval = Promise.withResolvers<void>();
    const approved = vi.fn(() => approval.promise);
    let task!: Promise<boolean | PromptAgentGenerationResult>;
    await act(async () => { task = state.agent!.onRequestGeneration(state.agent!.draft, '两张', approved, 2); });
    await waitFor(() => expect(approved).toHaveBeenCalledOnce());
    view.rerender(<ChainEditor {...view.props} continuousGenerationEnabled={false} />);
    await act(async () => { approval.resolve(); await expect(task).resolves.toMatchObject({ success: false, code: 'continuous_generation_disabled', requestedCount: 2, completedCount: 0 }); });
    expect(state.startJob).not.toHaveBeenCalled();
  });

  it('关闭连续生成不取消已提交的任务，原张数全部完成并保存', async () => {
    prepare();
    scriptJobs([{ state: 'generating', completedCount: 0, requestedCount: 3, historyIds: [] }]);
    const completion = Promise.withResolvers<GenerationJobSnapshot>();
    state.getJob.mockImplementation(() => completion.promise);
    const view = setupSeries();
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '生成合成文生图' }));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    view.rerender(<ChainEditor {...view.props} continuousGenerationEnabled={false} />);
    expect(state.cancelJob).not.toHaveBeenCalled();
    expect(mobileActions().getByRole('button', { name: '暂停生成' }).getAttribute('disabled')).toBeNull();
    await act(async () => {
      completion.resolve({ ...backgroundResult('job-3', 3, { historyIds: ['job-1', 'job-2', 'job-3'] }), token: state.started[0].token });
    });
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 3 张图片', 'success'), { timeout: 4000 });
    expect(state.started[0].count).toBe(3);
    expect(state.cancelJob).not.toHaveBeenCalled();
    expect(mobileActions().queryByRole('button', { name: '暂停生成' })).toBeNull();
  });

  it('四模式共用当前 Key 的间隔设置，换 Key 后迟到回执不覆盖新设置', async () => {
    prepare();
    const old: GenerationQueueSnapshot = { intervalSeconds: 2, busy: false, completed: 0, total: 0, paused: false, pausing: false, waiting: [] };
    const next: GenerationQueueSnapshot = { ...old, intervalSeconds: 6 };
    vi.mocked(getGenerationQueue).mockImplementation(async key => key === 'synthetic-key' ? old : next);
    const pendingInterval = Promise.withResolvers<GenerationQueueSnapshot>();
    vi.mocked(setGenerationInterval).mockImplementationOnce(() => pendingInterval.promise);
    setupSeries(); countInput();
    const input = screen.getByLabelText('生成间隔') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } }); fireEvent.blur(input);
    await waitFor(() => expect(setGenerationInterval).toHaveBeenCalledWith('synthetic-key', 4));
    expect(input.disabled).toBe(true);
    act(() => { sessionStorage.setItem('nai_api_key', 'next-key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'next-key' })); });
    await waitFor(() => expect(Number(input.value)).toBe(6));
    await act(async () => { pendingInterval.resolve({ ...old, intervalSeconds: 4 }); });
    expect(Number(input.value)).toBe(6); expect(input.disabled).toBe(false);
    expect(state.startJob).not.toHaveBeenCalled();
  });

  it('换 Key 后不将旧 Key 的迟到暂停回执显示在新队伍上', async () => {
    prepare();
    const old: GenerationQueueSnapshot = { busy: true, completed: 0, total: 1, paused: false, pausing: false, waiting: [] };
    const next: GenerationQueueSnapshot = { ...old, busy: false, total: 0 };
    vi.mocked(getGenerationQueue).mockImplementation(async key => key === 'synthetic-key' ? old : next);
    const pendingPause = Promise.withResolvers<GenerationQueueSnapshot>();
    vi.mocked(setGenerationQueuePaused).mockImplementationOnce(() => pendingPause.promise);
    setupSeries();
    await waitFor(() => expect(mobileActions().getByRole('button', { name: '暂停生成' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(mobileActions().getByRole('button', { name: '暂停生成' }));
    await waitFor(() => expect(setGenerationQueuePaused).toHaveBeenCalledWith('synthetic-key', true));
    act(() => { sessionStorage.setItem('nai_api_key', 'next-key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'next-key' })); });
    await waitFor(() => expect(getGenerationQueue).toHaveBeenCalledWith('next-key'));
    await act(async () => { pendingPause.resolve({ ...old, paused: true }); });
    expect(mobileActions().queryByRole('button', { name: '继续生成' })).toBeNull();
    expect(mobileActions().getByRole('button', { name: '暂停生成' }).textContent).toBe('0/0');
  });

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('%s 只 POST 一次后台任务，描述符保留提示词、模块、来源与编辑元数据', async (operation, label) => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    setupSeries();
    if (label !== '文生图') { await switchTo(label); await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' }))); }
    await act(async () => fireEvent.click(screen.getByRole('button', { name: label === '文生图' ? '生成合成文生图' : '生成合成编辑' })));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.buildDescriptor).toHaveBeenCalledOnce();
    const submitted = state.buildDescriptor.mock.calls[0][0];
    expect(submitted.operation).toBe(operation);
    expect(submitted.approvedCost).toBe(0);
    expect(submitted.stream).toBe(false);
    expect(submitted.history.modules).toEqual([expect.objectContaining({ id: 'light', content: 'soft light' })]);
    expect(submitted.history).toMatchObject({ sourceChainId: chain.id, sourceChainName: chain.name, sourceChainType: 'style' });
    if (label === '文生图') {
      expect(submitted.prompt).toContain('saved style');
      expect(submitted.edit).toBeUndefined();
      expect(submitted.history.edit).toBeUndefined();
    } else {
      expect(submitted.edit).toMatchObject({ image: 'data:image/png;base64,AQID', strength: 1, noise: 0 });
      // 底图来自剪贴板粘贴：真实面板提交 baseImageSource='clipboard' 且不再关联父历史编号。
      expect(submitted.history.edit).toMatchObject({ operation, strength: 1, noise: 0, baseImageSource: 'clipboard', parentHistoryId: undefined });
    }
    expect(state.startJob.mock.calls[0][3]).toBe(1);
    expect(state.startJob.mock.calls[0][4]).toBeUndefined();
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(state.notifySaved).toHaveBeenCalledExactlyOnceWith('job-1');
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  });

  it('编辑模式保留历史来源的底图编号与本地编辑元数据', async () => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    state.history.mockResolvedValue([{ id: 'latest', imageUrl: 'data:image/png;base64,AQID', prompt: 'latest prompt', negativePrompt: 'latest negative', params: chain.params, createdAt: 1 }]);
    setupSeries({ ...chain, previewImage: 'data:image/png;base64,AQID' });
    await switchTo('图生图');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '文生图最新' })));
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,AQID'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成编辑' })));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.buildDescriptor.mock.calls[0][0].history.edit).toMatchObject({ parentHistoryId: 'latest', baseImageSource: 'generated' });
    expect(state.startJob.mock.calls[0][3]).toBe(1);
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  });

  it('带蒙版的编辑把原始蒙版一并交给后端', async () => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    setupSeries();
    await switchTo('局部重绘');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成合成蒙版编辑' })));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    const submitted = state.buildDescriptor.mock.calls[0][0];
    expect(submitted.edit).toMatchObject({ mask: 'data:image/png;base64,TUFTSw==' });
    expect(submitted.history.edit).toMatchObject({ operation: 'inpaint' });
    // 描述符的字段映射由真实 naiService 负责（其单测覆盖），这里确认组件把蒙版交给了提交入口。
    expect(state.startJob.mock.calls[0][2].editMask).toBe('data:image/png;base64,TUFTSw==');
    expect(state.notifySaved).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(state.addHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  });

  it('结果落库由后端完成：预览显示成图并只广播历史变更', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1'), preview: { image: 'data:image/png;base64,UFJPQ0VTUw==', step: 5 } },
      backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] }),
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '2' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    await waitFor(() => expect(state.notifySaved).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('data:image/png;base64,UFJPQ0VTUw=='));
    await waitFor(() => expect(state.getJob).toHaveBeenCalledOnce(), { timeout: 3000 });
    await waitFor(() => expect(state.notifySaved).toHaveBeenCalledWith('job-2'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-2.png'));
    expect(state.notifySaved).toHaveBeenCalledTimes(2);
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.getJob).toHaveBeenCalledOnce();
    expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 2 张图片', 'success');
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);


  it.each(['end', 'next'] as const)('排队位置 %s 交给后端：只 POST 一次并可按 token 取消等待中的任务', async placement => {
    prepare();
    scriptJobs([
      { state: 'waiting', completedCount: 0, requestedCount: 2, historyIds: [], position: 1 },
      { state: 'cancelled', completedCount: 0, requestedCount: 2, historyIds: [] },
    ]);
    setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '2' } });
    const preview = within(screen.getByRole('region', { name: '文生图预览' }));
    fireEvent.keyDown(preview.getByRole('button', { name: /^(生成|加入队列).*张/ }), { key: 'ArrowDown', altKey: true });
    fireEvent.click(screen.getByRole('button', { name: placement === 'next' ? '排到下一位' : '加入队列' }));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.startJob.mock.calls[0][3]).toBe(2);
    expect(state.startJob.mock.calls[0][4]).toBe(placement);
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(getGenerationSeriesSession(chain.id)).toBeNull();
    const token = state.started[0].token;
    fireEvent.keyDown(preview.getByRole('button', { name: /^(生成|加入队列).*张/ }), { key: 'ArrowDown', altKey: true });
    const queued = within(screen.getByRole('dialog', { name: '生成选项' }));
    expect(queued.getByText('2 张 · 等待第 1 位')).toBeTruthy();
    fireEvent.click(queued.getByRole('button', { name: '取消待生成任务' }));
    await waitFor(() => expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', token));
    await waitFor(() => expect(getQueuedGenerationSeries(chain.id)).toHaveLength(0), { timeout: 3000 });
  }, 12000);

  it('在途任务期间把新配置排到队尾，提交时固定当时的提示词', async () => {
    prepare();
    scriptJobs(
      [{ state: 'generating', completedCount: 0, requestedCount: 1, historyIds: [] }, backgroundResult('job-1')],
      [{ state: 'waiting', completedCount: 0, requestedCount: 1, historyIds: [], position: 1 }, backgroundResult('job-2')],
    );
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    fireEvent.change(textPrompt(), { target: { value: 'later draft' } });
    const preview = within(screen.getByRole('region', { name: '文生图预览' }));
    const queueButton = preview.getByRole('button', { name: /^加入队列/ });
    expect(queueButton.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(queueButton);
    await waitFor(() => expect(state.startJob).toHaveBeenCalledTimes(2));
    expect(state.startJob.mock.calls[1][4]).toBe('end');
    expect(state.buildDescriptor.mock.calls[1][0].prompt).toContain('later draft');
    await waitFor(() => expect(state.notifySaved).toHaveBeenCalledWith('job-2'), { timeout: 4000 });
    expect(state.buildDescriptor.mock.calls[0][0].prompt).not.toContain('later draft');
    expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 1 张图片', 'success');
    expect(state.addHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(getQueuedGenerationSeries(chain.id)).toHaveLength(0), { timeout: 3000 });
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 15000);

  it('停止只取消后续请求，已保存的图片留在预览并回执取消', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 3, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
      { state: 'cancelled', completedCount: 1, requestedCount: 3, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    const token = state.started[0].token;
    act(() => { const run = getGenerationSeriesSession(chain.id); if (run) stopGenerationSeriesSession(run); });
    expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', token);
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已取消后续生成，已保存 1 张图片', 'success'), { timeout: 4000 });
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-1.png');
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.addHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);

  it('关闭或刷新页面用 keepalive 取消未终态的后台任务', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: 2, historyIds: [] },
      { state: 'cancelled', completedCount: 0, requestedCount: 2, historyIds: [] },
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '2' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    const token = state.started[0].token;
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', token, { keepalive: true });
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已取消后续生成，已保存 0 张图片', 'success'), { timeout: 4000 });
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);

  it('费用上涨时等待用户确认：接受后补授权，拒绝则取消任务', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
      { state: 'awaiting_confirmation', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1'), cost: 40 },
      backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] }),
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '2' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(state.confirm.mock.calls[1][0]).toMatchObject({ title: '后台任务费用已变化', message: expect.stringContaining('剩余 1 张预计 40 Anlas'), confirmLabel: '消耗约 40 点并继续' });
    const token = state.started[0].token;
    await waitFor(() => expect(state.approveJob).toHaveBeenCalledWith('synthetic-key', token, 40), { timeout: 4000 });
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 2 张图片', 'success'), { timeout: 4000 });
    expect(state.cancelJob).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 20000);

  it('费用上涨拒绝后停止后续请求，保留已保存的图片', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
      { state: 'awaiting_confirmation', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1'), cost: 40 },
      { state: 'cancelled', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '2' } });
    state.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(2), { timeout: 4000 });
    const token = state.started[0].token;
    await waitFor(() => expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', token), { timeout: 4000 });
    expect(state.approveJob).not.toHaveBeenCalled();
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已取消后续生成，已保存 1 张图片', 'success'), { timeout: 5000 });
    expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-1.png');
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 20000);

  it('保存失败的终态只展示后端未保存成图，不误报落库成功', async () => {
    prepare();
    const unsaved = 'data:image/png;base64,VU5TQVZFRA==';
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: 1, historyIds: [], preview: { image: 'data:image/png;base64,UFJPQ0VTUw==', step: 4 } },
      { state: 'failed', code: 'history_save_failed', completedCount: 0, requestedCount: 1, historyIds: [], error: '保存历史失败', preview: { image: unsaved } },
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('data:image/png;base64,UFJPQ0VTUw=='));
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe(unsaved), { timeout: 3000 });
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('保存历史失败（已保存 0/1 张）', 'error'), { timeout: 3000 });
    expect(state.notifySaved).not.toHaveBeenCalled();
    expect(state.addHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
    expect(screen.getByLabelText('文生图结果').textContent).toBe(unsaved);
  }, 12000);

  it.each(['same-preview', 'partial-history'])('保存失败 %s 保留当前未保存产物和失败标记', async variant => {
    prepare();
    const unsaved = 'data:image/png;base64,VU5TQVZFRA==';
    const partial = variant === 'partial-history';
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: partial ? 2 : 1, historyIds: [], ...(partial ? {} : { preview: { image: unsaved, step: 4 } }) },
      { state: 'failed', code: 'history_save_failed', completedCount: partial ? 1 : 0, requestedCount: partial ? 2 : 1,
        historyIds: partial ? ['job-1'] : [], ...(partial ? { lastSavedItem: savedItem('job-1') } : {}), error: '保存历史失败', preview: { image: unsaved } },
    ]);
    const view = setupSeries();
    if (partial) fireEvent.change(countInput(), { target: { value: '2' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith(`保存历史失败（已保存 ${partial ? '1/2' : '0/1'} 张）`, 'error'), { timeout: 3000 });
    expect(screen.getByLabelText('文生图结果').textContent).toBe(unsaved);
    expect(screen.getByLabelText('预览历史编号').textContent).toBe('刚刚生成 · 历史保存失败');
    expect(state.addHistory).not.toHaveBeenCalled();
    if (partial) expect(state.notifySaved).toHaveBeenCalledWith('job-1');
  });

  it('编辑模式部分成功后的保存失败不会让旧历史图覆盖未保存产物', async () => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    const unsaved = 'data:image/png;base64,VU5TQVZFRA==';
    scriptJobs([{ state: 'failed', code: 'history_save_failed', completedCount: 1, requestedCount: 2, historyIds: ['job-1'],
      lastSavedItem: savedItem('job-1', { edit: { operation: 'image-to-image' } }), error: '保存历史失败', preview: { image: unsaved } }]);
    setupSeries(); await switchTo('图生图');
    await waitFor(() => expect(state.agent?.draft.target?.mode).toBe('image-to-image'));
    await act(async () => {
      expect(await state.agent!.onRequestGeneration(state.agent!.draft, '两张', vi.fn(async () => {}), 2)).toMatchObject({ success: false, completedCount: 1, historyIds: ['job-1'] });
    });
    expect(screen.getByLabelText('编辑结果').textContent).toBe(unsaved);
    expect(state.notifySaved).toHaveBeenCalledWith('job-1');
    expect(state.addHistory).not.toHaveBeenCalled();
  });

  it('换 Key 取消观察中的旧任务，不把新 Key 交给旧任务', async () => {
    prepare();
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: 1, historyIds: [] },
      { state: 'cancelled', completedCount: 0, requestedCount: 1, historyIds: [] },
    ]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    const token = state.started[0].token;
    act(() => { sessionStorage.setItem('nai_api_key', 'next-key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'next-key' })); });
    expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', token);
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已取消后续生成，已保存 0 张图片', 'success'), { timeout: 4000 });
    expect(state.startJob).toHaveBeenCalledOnce();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);

  it('描述符构建期间换 Key 不会把旧任务投递给新 Key', async () => {
    prepare();
    const building = Promise.withResolvers<GenerationJobDescriptor>();
    state.buildDescriptor.mockImplementationOnce(() => building.promise);
    setupSeries();
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    const approve = vi.fn(async () => {});
    let task!: ReturnType<NonNullable<typeof state.agent>['onRequestGeneration']>;
    await act(async () => { task = state.agent!.onRequestGeneration(state.agent!.draft, 'synthetic', approve); });
    await waitFor(() => expect(state.buildDescriptor).toHaveBeenCalledOnce());
    act(() => { sessionStorage.setItem('nai_api_key', 'next-key'); window.dispatchEvent(new CustomEvent('nai-api-key-changed', { detail: 'next-key' })); });
    await act(async () => {
      building.resolve({ payload: { model: String(chain.params.model), action: 'generate', parameters: {} }, history: { prompt: 'saved style', negativePrompt: 'saved negative', params: chain.params }, randomSeed: true, stream: false, approvedCost: 0 });
    });
    await expect(task).resolves.toMatchObject({ success: false, code: 'key_changed', completedCount: 0, historyIds: [] });
    expect(state.startJob).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(getGenerationSeriesSession(chain.id)).toBeNull();
  }, 12000);

  it('后端队列里的等待任务由页面按 token 直接取消', async () => {
    prepare();
    vi.mocked(getGenerationQueue).mockResolvedValue({ busy: true, completed: 0, total: 2, paused: false, pausing: false, waiting: [{ token: 'remote-task', total: 2, completed: 0, position: 1 }] });
    setupSeries();
    const preview = within(screen.getByRole('region', { name: '文生图预览' }));
    await waitFor(() => expect(preview.getByRole('button', { name: /^(生成|加入队列).*张/ })).toBeTruthy());
    fireEvent.keyDown(preview.getByRole('button', { name: /^(生成|加入队列).*张/ }), { key: 'ArrowDown', altKey: true });
    const panel = within(screen.getByRole('dialog', { name: '生成选项' }));
    await waitFor(() => expect(panel.getByRole('button', { name: '取消待生成任务' })).toBeTruthy());
    fireEvent.click(panel.getByRole('button', { name: '取消待生成任务' }));
    await waitFor(() => expect(state.cancelJob).toHaveBeenCalledWith('synthetic-key', 'remote-task'));
    expect(state.startJob).not.toHaveBeenCalled();
  });

  it('后端队列忙碌时四模式显示占用提示且不提交新任务', async () => {
    prepare();
    vi.mocked(getGenerationQueue).mockResolvedValue({ busy: true, completed: 0, total: 2, paused: false, pausing: false, waiting: [] });
    setupSeries();
    await waitFor(() => expect(screen.getByLabelText('生成不可用原因').textContent).toBe('此 Key 正在生成'));
    expect((screen.getByText('生成合成文生图') as HTMLButtonElement).disabled).toBe(true);
    for (const label of ['图生图', '局部重绘', '扩图']) {
      await switchTo(label);
      expect(screen.getByLabelText('编辑生成不可用原因').textContent).toBe('此 Key 正在生成');
      expect((screen.getByText('生成合成编辑') as HTMLButtonElement).disabled).toBe(true);
    }
    expect(state.startJob).not.toHaveBeenCalled();
  });

  it('只有已完成队伍快照时恢复普通生成，不把 busy 标记或旧进度当成待执行任务', async () => {
    prepare();
    vi.mocked(getGenerationQueue).mockResolvedValue({ busy: true, completed: 2, total: 2, paused: false, pausing: false, waiting: [] });
    setupSeries();
    await waitFor(() => expect(getGenerationQueue).toHaveBeenCalledWith('synthetic-key'));
    await waitFor(() => expect(screen.getByLabelText('生成不可用原因').textContent).toBe(''));
    const generate = mobileActions().getByRole('button', { name: /^生成.*1 张/ });
    fireEvent.click(generate);
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.started[0].placement).toBeUndefined();
    expect(state.started[0].count).toBe(1);
  });

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('后端返回占用时 %s 的 Agent 回执为 blocked，不误报用户取消', async (operation, label) => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    setupSeries(); if (label !== '文生图') await switchTo(label);
    await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(operation));
    state.startJob.mockRejectedValueOnce(Object.assign(new Error('此 Key 正在生成'), { code: 'generation_busy', status: 409, outcome: 'blocked' }));
    const approved = vi.fn(async () => {});
    await act(async () => {
      const result = await state.agent!.onRequestGeneration(state.agent!.draft, '两张', approved, 2);
      expect(result).toMatchObject({ success: false, code: 'generation_busy', outcome: 'blocked', completedCount: 0, historyIds: [] });
    });
    expect(approved).toHaveBeenCalledOnce();
    expect(state.notifySaved).not.toHaveBeenCalled();
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(getGenerationSeriesSession(chain.id)).toBeNull();
  });

  it.each([['text-to-image', '文生图'], ['image-to-image', '图生图'], ['inpaint', '局部重绘'], ['outpaint', '扩图']] as const)('Agent %s 连续生成只提交一次并回收后端历史回执', async (operation, label) => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
      backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] }),
    ]);
    setupSeries(); if (label !== '文生图') await switchTo(label);
    await waitFor(() => expect(state.agent?.draft.target?.mode).toBe(operation));
    const approved = vi.fn(async () => {});
    await act(async () => {
      const result = await state.agent!.onRequestGeneration(state.agent!.draft, '两张', approved, 2);
      expect(result).toMatchObject({ success: true, historySaved: true, requestedCount: 2, completedCount: 2, historyIds: ['job-1', 'job-2'] });
    });
    expect(approved).toHaveBeenCalledOnce();
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.startJob.mock.calls[0][3]).toBe(2);
    expect(state.startJob.mock.calls[0][4]).toBeUndefined();
    expect(state.buildDescriptor.mock.calls[0][0].operation).toBe(operation);
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(state.notifySaved).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);

  it.each(['end', 'next'] as const)('Agent 显式排队 %s 把位置与张数交给后端', async placement => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([
      { state: 'waiting', completedCount: 0, requestedCount: 2, historyIds: [], position: 1 },
      backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] }),
    ]);
    setupSeries();
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    const approved = vi.fn(async () => {});
    await act(async () => {
      const result = await state.agent!.onRequestGeneration(state.agent!.draft, '排队', approved, 2, placement);
      expect(result).toMatchObject({ success: true, requestedCount: 2, completedCount: 2 });
    });
    expect(approved).toHaveBeenCalledOnce();
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.startJob.mock.calls[0][3]).toBe(2);
    expect(state.startJob.mock.calls[0][4]).toBe(placement);
    expect(getGenerationSeriesSession(chain.id)).toBeNull();
    await waitFor(() => expect(getQueuedGenerationSeries(chain.id)).toHaveLength(0), { timeout: 4000 });
  }, 12000);

  it('一连串生成只确认一次，随机种子交给后端逐张抽取', async () => {
    prepare();
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '3' } });
    scriptJobs([
      { state: 'generating', completedCount: 0, requestedCount: 3, historyIds: [] },
      { state: 'succeeded', completedCount: 3, requestedCount: 3, historyIds: ['job-1', 'job-2', 'job-3'], lastSavedItem: savedItem('job-3') },
    ]);
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.buildDescriptor.mock.calls[0][0].params.seed).toBeUndefined();
    expect(state.startJob.mock.calls[0][2].randomSeed).toBe(true);
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 3 张图片', 'success'), { timeout: 4000 });
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.buildDescriptor).toHaveBeenCalledOnce();
    expect(state.addHistory).not.toHaveBeenCalled();
  }, 12000);

  it('固定种子随描述符交给后端，取消确认不调用批准或提交', async () => {
    prepare(); setupSeries({ ...chain, params: { ...chain.params, seed: 42 } });
    await waitFor(() => expect(state.agent?.draft.params.seed).toBe(42));
    const approve = vi.fn(async () => {});
    state.confirm.mockResolvedValueOnce(false);
    await act(async () => { expect(await state.agent!.onRequestGeneration(state.agent!.draft, '两张', approve, 2)).toMatchObject({ success: false, outcome: 'cancelled', completedCount: 0 }); });
    expect(approve).not.toHaveBeenCalled(); expect(state.startJob).not.toHaveBeenCalled();
    scriptJobs([{ state: 'generating', completedCount: 1, requestedCount: 2, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') }, backgroundResult('job-2', 2, { historyIds: ['job-1', 'job-2'] })]);
    await act(async () => { expect(await state.agent!.onRequestGeneration(state.agent!.draft, '两张', approve, 2)).toMatchObject({ success: true, completedCount: 2 }); });
    expect(state.buildDescriptor.mock.calls[0][0].params.seed).toBe(42);
    expect(state.startJob.mock.calls[0][2].randomSeed).toBe(false);
    expect(state.startJob).toHaveBeenCalledOnce();
  }, 12000);

  it('编辑模式连续生成只提交一次，同一底图与蒙版复用给后端', async () => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([backgroundResult('job-1', 2, { historyIds: ['job-1', 'job-2'] })]);
    setupSeries(); await switchTo('图生图');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '粘贴合成底图' })));
    fireEvent.change(countInput('image-to-image'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('生成合成编辑'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.buildDescriptor).toHaveBeenCalledOnce();
    expect(state.buildDescriptor.mock.calls[0][0].edit).toMatchObject({ image: 'data:image/png;base64,AQID' });
    expect(state.startJob.mock.calls[0][3]).toBe(2);
    expect(state.addHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  }, 12000);

  it('自由实验室重新挂载能查看本轮结果并停止原任务，不重复提交', async () => {
    prepare(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
    scriptJobs([
      { state: 'generating', completedCount: 1, requestedCount: 3, historyIds: ['job-1'], lastSavedItem: savedItem('job-1') },
      { state: 'succeeded', completedCount: 3, requestedCount: 3, historyIds: ['job-1', 'job-2', 'job-3'], lastSavedItem: savedItem('job-3') },
    ]);
    const lab = { ...chain, id: 'playground' };
    const view = setupSeries(lab);
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '3' } });
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(state.startJob).toHaveBeenCalledOnce());
    view.unmount();
    setupSeries(lab);
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-1.png'));
    expect(getGenerationSeriesSession('playground')).not.toBeNull();
    await waitFor(() => expect(screen.getByLabelText('文生图结果').textContent).toBe('/synthetic/job-3.png'), { timeout: 4000 });
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.getJob).toHaveBeenCalledOnce();
    await waitFor(() => expect(getGenerationSeriesSession('playground')).toBeNull());
  }, 15000);

  it('Agent 未明确指定张数时仍只生成一张，不继承界面张数', async () => {
    prepare(); const view = setupSeries();
    await waitFor(() => expect(state.agent?.draft.basePrompt).toBe('saved style'));
    fireEvent.change(countInput(), { target: { value: '5' } });
    await act(async () => { expect(await state.agent!.onRequestGeneration(state.agent!.draft)).toMatchObject({ success: true, historySaved: true }); });
    expect(state.startJob).toHaveBeenCalledOnce();
    expect(state.startJob.mock.calls[0][3]).toBe(1);
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(view.props.notify).toHaveBeenCalledWith('已生成并保存 1 张图片', 'success');
  });

  it.each(['', '本地预算更新失败（HTTP 503）'])('额度或同步异常不回退到逐张生成，保留记账原因 %s', async accountingError => {
    prepare();
    scriptJobs([{ state: 'failed', code: 'quota_exhausted', completedCount: 0, requestedCount: 1, historyIds: [], error: '账号额度不足', accountingFailed: true, accountingError }]);
    const view = setupSeries();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    fireEvent.click(screen.getByText('生成合成文生图'));
    await waitFor(() => expect(view.props.notify).toHaveBeenCalledWith('账号额度不足（已保存 0/1 张）', 'error'));
    expect(view.props.notify).toHaveBeenCalledWith('图片已保存，但本地记账异常，请核对额度后再继续' + (accountingError ? `：${accountingError}` : ''), 'error');
    expect(state.addHistory).not.toHaveBeenCalled();
    expect(state.notifySaved).not.toHaveBeenCalled();
    await waitFor(() => expect(getGenerationSeriesSession(chain.id)).toBeNull());
  });
});
