// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';
import { cloneDefaultLabPageLayouts } from '../services/appearancePreferences';
import { createLabWorkspaceSession, loadLabWorkspaceSession, saveLabWorkspaceSession } from '../services/labWorkspace';
import { ChainEditor } from './ChainEditor';
type ImageEditPanelProps = React.ComponentProps<typeof import('./ImageEditPanel').ImageEditPanel>;

const state = vi.hoisted(() => ({
  low: { enabled: false },
  history: vi.fn(async () => []),
  confirm: vi.fn(async () => true),
  generate: vi.fn(),
  assets: new Map<string, Blob>(),
  delayedAsset: null as Promise<Blob> | null,
}));
vi.mock('../services/lowConsumption', async importOriginal => ({
  ...await importOriginal<typeof import('../services/lowConsumption')>(),
  useLowConsumption: () => state.low,
  getLowConsumption: async () => state.low,
}));
vi.mock('../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/naiRuntime')>();
  return { ...actual, getNaiRuntimeConfig: async () => actual.DEFAULT_NAI_RUNTIME };
});
vi.mock('../services/naiUsage', async importOriginal => ({
  ...await importOriginal<typeof import('../services/naiUsage')>(),
  useNovelaiUsage: () => ({ info: null, usage: null, loading: false, refreshIfStale: async () => null }),
}));
vi.mock('../services/anlasBudget', async importOriginal => ({
  ...await importOriginal<typeof import('../services/anlasBudget')>(),
  useAnlasBudget: () => ({ remaining: 1666 }),
}));
vi.mock('../services/localHistory', () => ({ localHistory: { getBySourceChain: state.history } }));
vi.mock('../services/labWorkspace', async importOriginal => ({
  ...await importOriginal<typeof import('../services/labWorkspace')>(),
  cleanupLabWorkspaceAssets: async () => {},
  readLabWorkspaceAsset: async (id: string) => id === 'delayed-base' && state.delayedAsset ? state.delayedAsset : state.assets.get(id) || null,
  deleteLabWorkspaceAsset: async () => {},
  dataUrlToWorkspaceAsset: async (dataUrl: string, id = 'synthetic-pasted-asset') => {
    state.assets.set(id, new Blob([Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' }));
    return id;
  },
}));
vi.mock('../services/naiService', () => ({ generateImage: state.generate, generateImageStream: state.generate, generateImageEdit: state.generate, generateImageEditStream: state.generate }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => state.confirm }));
vi.mock('./CloudQueueStatus', () => ({ useCloudQueueStatus: () => null, InlineCloudQueueStatus: () => null }));
vi.mock('./LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('./TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: (props: { value: string; placeholder?: string; onValueChange: (value: string) => void }) => <textarea value={props.value} placeholder={props.placeholder} onChange={event => props.onValueChange(event.target.value)} /> }));
vi.mock('./ChainEditorParams', () => ({ ChainEditorParams: () => null }));
vi.mock('./ChainEditorPreview', () => ({ ChainEditorPreview: () => null }));
vi.mock('./VibeManager', () => ({ VibeManager: () => null }));
vi.mock('./CharacterReferenceManager', () => ({ CharacterReferenceManager: () => null }));
vi.mock('./ImageTaggerPanel', () => ({ ImageTaggerPanel: () => null }));
vi.mock('./chain/ChainEditorCharacters', () => ({ ChainEditorCharacters: () => null }));
vi.mock('./chain/ChainEditorPresetModal', () => ({ ChainEditorPresetModal: () => null }));
vi.mock('./chain/PresetSourceBadges', async importOriginal => ({
  ...await importOriginal<typeof import('./chain/PresetSourceBadges')>(),
  PromptAgentOverlayController: () => null,
}));
// 只替换 Canvas 表面；真实编辑器、顶栏、切换、保存和会话持久化均执行实际代码。
vi.mock('./ImageEditPanel', () => ({ ImageEditPanel: (props: ImageEditPanelProps) => <section aria-label={props.operation}>
  <input aria-label="编辑提示词" value={props.draft.prompt} onChange={event => props.onPromptChange(event.target.value)} />
  <input aria-label="编辑负面词" value={props.draft.negativePrompt} onChange={event => props.onNegativePromptChange(event.target.value)} />
  <button onClick={() => props.onDraftChange({ strength: 0.42 })}>调整强度</button>
  <output aria-label="编辑强度">{props.draft.strength}</output>
  <output aria-label="编辑底图">{props.baseImage}</output>
  <output aria-label="编辑蒙版">{props.maskData}</output>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,cGFzdGVk', 'clipboard', 'old-parent'); }}>粘贴合成底图</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'upload', undefined, { prompt: '', negativePrompt: '', params: { ...props.draft.params, characters: [{ id: 'imported', prompt: 'imported character', x: 0.2, y: 0.8 }] } }); }}>上传分角色底图</button>
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [{ id: 'edited', prompt: 'edited character', negativePrompt: 'edited negative', x: 0.3, y: 0.7 }], useCoords: true } })}>修改编辑角色</button>
  <button onClick={() => { void props.onBaseImageChange('data:image/png;base64,AQID', 'clipboard', undefined, { prompt: 'copied scene', negativePrompt: 'copied negative', params: { ...props.draft.params, characters: [{ id: 'copied', prompt: 'copied role', negativePrompt: 'copied role negative', x: 0.2, y: 0.8 }] } }); }}>粘贴分角色底图</button>
  <button onClick={() => props.onDraftChange({ params: { ...props.draft.params, characters: [] } })}>清空编辑角色</button>
  <button onClick={() => { void props.onGenerate({ operation: props.operation, image: 'data:image/png;base64,AQID', canvasWidth: 832, canvasHeight: 1216, strength: 1, noise: 0, prompt: props.draft.prompt, negativePrompt: props.draft.negativePrompt, promptSource: props.draft.promptSource }); }}>生成合成编辑</button>
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
    tagAssistEnabled: false, onTagAssistEnabledChange: vi.fn(), generationStreamPreview: false, labPageLayouts: cloneDefaultLabPageLayouts(), safeMode: false, onBack: vi.fn() };
  return { ...render(<ChainEditor {...props} />), props };
};
const textPrompt = () => screen.getByPlaceholderText('输入全局提示词，英文逗号分隔') as HTMLTextAreaElement;
const switchTo = async (label: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
  await waitFor(() => expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false));
};

beforeEach(() => {
  state.low.enabled = false;
  state.assets.clear();
  state.delayedAsset = null;
  state.confirm.mockClear(); state.history.mockClear(); state.generate.mockReset();
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('统一工作台真实状态链路', () => {
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
    await waitFor(() => expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe(''));
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits[operation].params.characters?.[0].prompt).toBe('imported character');
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

  it('低消耗隐藏两种付费编辑模式，关闭后恢复原草稿与模式', async () => {
    const session = { ...fallback(), activeMode: 'outpaint' as const, edits: { ...fallback().edits, outpaint: { ...fallback().edits.outpaint, prompt: 'hidden draft', baseImageRef: 'synthetic-base', maskRef: 'synthetic-mask' } } };
    state.assets.set('synthetic-base', new Blob(['synthetic base'], { type: 'image/png' }));
    state.assets.set('synthetic-mask', new Blob(['synthetic mask'], { type: 'image/png' }));
    saveLabWorkspaceSession(chain.id, session);
    state.low.enabled = true;
    const view = setup();
    await waitFor(() => expect(textPrompt().value).toBe('saved style'));
    expect(screen.queryByRole('button', { name: '图生图' })).toBeNull();
    expect(screen.queryByRole('button', { name: '扩图' })).toBeNull();
    expect(loadLabWorkspaceSession(chain.id, fallback()).edits.outpaint.prompt).toBe('hidden draft');
    state.low.enabled = false;
    view.rerender(<ChainEditor {...view.props} />);
    expect(screen.getByRole('button', { name: '扩图' }).getAttribute('aria-current')).toBe('page');
    expect((screen.getByLabelText('编辑提示词') as HTMLInputElement).value).toBe('hidden draft');
    await waitFor(() => expect(screen.getByLabelText('编辑底图').textContent).toBe('data:image/png;base64,c3ludGhldGljIGJhc2U='));
    await waitFor(() => expect(screen.getByLabelText('编辑蒙版').textContent).toBe('data:image/png;base64,c3ludGhldGljIG1hc2s='));
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
    await switchTo('局部重绘');
    await act(async () => { release(new Blob(['late base'], { type: 'image/png' })); });
    expect(screen.getByRole('region', { name: 'inpaint' })).toBeTruthy();
    expect(screen.getByLabelText('编辑底图').textContent).toBe('');
    expect(screen.getByLabelText('编辑蒙版').textContent).toBe('');
  });
});
