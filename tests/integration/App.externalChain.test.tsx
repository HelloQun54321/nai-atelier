import { normalizeAppearancePreferences, saveAppearancePreferences } from '../../services/appearancePreferences';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { api, NAI_ACCOUNTING_ERROR_EVENT } from '../../services/api';
import { localHistory } from '../../services/localHistory';
import { consumeEditorSessionDiscarded } from '../../services/labWorkspace';
import { contentSnapshotOf } from '../../services/contentRoll';
import type { ConfirmDialogOptions } from '../../components/ConfirmDialog';

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(), getAllChains: vi.fn(), getAllInspirations: vi.fn(),
  createChain: vi.fn(), createChainWithData: vi.fn(), deleteChain: vi.fn(),
  updateChain: vi.fn(),
  editorDraft: null as PromptChain | null,
  updatePlayground: null as ((id: string, updates: Partial<PromptChain>) => Promise<void>) | null,
  confirm: vi.fn(), save: vi.fn(), canSave: true, bulkProgress: vi.fn(), bulkResult: vi.fn(),
}));
vi.mock('../../services/dbService', () => ({ db: mocks }));
vi.mock('../../services/collectorAppearance', () => ({ useCollectorAppearance: () => {} }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/Layout', () => ({ Layout: ({ children, onNavigate, currentView, toast }: any) => <>
  <div data-testid="view">{currentView}</div>
  {['aitag', 'inspiration', 'list', 'prompts', 'roll', 'library', 'playground', 'content-roll', 'content-roll-library'].map(view => <button key={view} onClick={() => onNavigate(view)}>{view}</button>)}
  {toast && <div role="status" data-type={toast.type}>{toast.message}</div>}{children}
</> }));
vi.mock('../../components/ChainList', () => ({ ChainList: ({ chains, onDelete, onBulkDelete, onReloadTags, onSelect, returnTargetId, notify }: { chains: PromptChain[]; onDelete: (id: string) => Promise<void>; onBulkDelete?: (ids: string[], onProgress: (completed: number) => void) => Promise<unknown>; onReloadTags?: () => Promise<void>; onSelect: (id: string) => void; returnTargetId?: string; notify: (message: string, type?: string) => void }) => <div data-testid="list" data-return-target={returnTargetId}>{chains.map(chain => chain.id).join(',')}{onReloadTags && <button onClick={async () => {
  try { await onReloadTags(); notify('合成标签已回读'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>回读合成分类标签</button>}{onBulkDelete && <button onClick={async () => {
  try { mocks.bulkResult(await onBulkDelete(chains.map(chain => chain.id), mocks.bulkProgress)); }
  catch (error: any) { notify(error.message, 'error'); }
}}>批量删除合成风格串</button>}{chains[0] && <><button onClick={async () => {
  try { await onDelete(chains[0].id); notify('合成删除成功'); }
  catch { notify('合成删除失败', 'error'); }
}}>删除合成风格串</button><button onClick={() => onSelect(chains[0].id)}>编辑合成风格串</button></>}</div> }));
vi.mock('../../components/ChainEditor', () => ({ ChainEditor: ({ chain, onUpdateChain, onBack, onFork, saveRef, setIsDirty }: any) => {
  mocks.editorDraft = chain;
  mocks.updatePlayground = onUpdateChain;
  React.useImperativeHandle(saveRef, () => ({ canSave: mocks.canSave, save: mocks.save }));
  return <div data-testid="editor">{chain.id}|{chain.basePrompt}|{chain.previewImage}<button onClick={onBack}>返回资料库</button><button onClick={() => { void Promise.resolve(onUpdateChain(chain.id, { basePrompt: 'edited style', previewImage: '/api/assets/covers/edited.png', tags: [] })).catch(() => {}); }}>保存合成内容及封面</button><button onClick={() => setIsDirty(true)}>修改合成草稿</button><button onClick={() => void onFork(chain, 'style')}>另存为新串</button><button onClick={() => void onFork(chain, 'character')}>另存为角色</button></div>;
} }));
// 这里验证 App 的共享保存回调；AITag 实际按钮的元数据与连点行为在图库组件测试中覆盖。
const source: PromptChain = {
  id: 'aitag-synthetic', type: 'style', userId: 'owner', name: '合成作品 P1', description: '', tags: [],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, characters: [] },
  previewImage: '/api/assets/aitag/source.png', createdAt: 1, updatedAt: 1,
};
const saved = { ...source, id: 'server-saved', previewImage: '/api/assets/covers/server-saved.png' };
const ExternalGallery = ({ onCreateArtistChain, onImportRefresh, notify }: any) => <><button onClick={async () => {
  try { await onCreateArtistChain(source); notify('已保存到风格串'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>保存合成作品</button>{onImportRefresh && <button onClick={async () => {
  try { await onImportRefresh(); notify('合成导入已刷新'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>回读合成导入图片</button>}</>;
vi.mock('../../components/AitagGallery', () => ({ AitagGallery: (props: any) => <ExternalGallery {...props} /> }));
vi.mock('../../components/ArtistLibrary', () => ({ ArtistLibrary: (props: any) => <div data-testid="artist-library" data-legacy-prop={String(Object.hasOwn(props, 'artistsData'))}>画师词库</div> }));
vi.mock('../../components/InspirationGallery', () => ({ InspirationGallery: (props: any) => <><div data-testid="collection-items" data-module-order={JSON.stringify(props.labModuleOrder)}>{(props.inspirationsData || []).filter((item: any) => !item.archived).map((item: any) => item.title).join(',')}</div><ExternalGallery {...props} /></> }));
vi.mock('../../components/StyleRollPage', () => ({ StyleRollPage: ({ onSaveChain, onNavigateToPlayground, chains }: any) => <div><span data-testid="roll-chains">{chains.map((chain: PromptChain) => chain.id).join(',')}</span><button onClick={() => void onSaveChain(source)}>保存 Roll 候选</button><button onClick={onNavigateToPlayground}>Roll 送往实验室</button></div> }));
vi.mock('../../components/PromptLibrary', () => ({ PromptLibraryHub: ({ chains, onCreate }: any) => <div>
  <span data-testid="prompt-library-chains">{chains.map((chain: PromptChain) => chain.id).join(',')}</span>
  <button onClick={() => void onCreate('合成服饰', '', 'wardrobe')}>新建合成服饰</button>
</div> }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.getMe.mockResolvedValue({ id: 'owner', username: '合成用户', role: 'admin' });
  mocks.getAllChains.mockResolvedValue([]); mocks.getAllInspirations.mockResolvedValue([]);
  mocks.createChain.mockResolvedValue(saved.id); mocks.createChainWithData.mockResolvedValue(saved);
  mocks.deleteChain.mockResolvedValue(undefined);
  mocks.updateChain.mockResolvedValue(undefined);
  mocks.canSave = true;
  mocks.confirm.mockReset(); mocks.confirm.mockResolvedValue(true);
  mocks.save.mockReset(); mocks.save.mockResolvedValue(true);
  consumeEditorSessionDiscarded(saved.id);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = async (entry = 'aitag') => {
  const { default: App } = await import('../../App');
  render(<App />);
  await screen.findByTestId('list');
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: entry }));
  await screen.findByRole('button', { name: entry === 'prompts' ? '新建合成服饰' : '保存合成作品' });
};

it('内容 Roll 保留旧手写正文与参数，实际填入后可完整撤销并返回 Roll 页', async () => {
  mocks.getAllChains.mockResolvedValue([{ ...saved, id: 'scene', type: 'scene', basePrompt: 'night', negativePrompt: 'day' }]);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  await screen.findByTestId('editor');
  await act(async () => { await mocks.updatePlayground!('playground', { variableValues: { subject: 'legacy_subject' }, params: { ...source.params, seed: 42 } }); });
  fireEvent.click(screen.getByRole('button', { name: 'content-roll' }));
  fireEvent.click(await screen.findByRole('button', { name: '抽一次' }));
  expect(screen.getByRole('dialog', { name: 'Roll 组合' })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  fireEvent.change(screen.getByRole('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues?.subject).toBe('night, legacy_subject'));
  expect(mocks.editorDraft?.params).toMatchObject({ seed: 42, _promptSections: { extra: 'legacy_subject', scene: 'night', sectionNegatives: { scene: 'day' } } });
  fireEvent.click(screen.getByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues?.subject).toBe('legacy_subject'));
  expect(mocks.editorDraft?.params.seed).toBe(42);
  expect(mocks.editorDraft?.params._promptSections?.scene).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  fireEvent.click(await screen.findByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('content-library'));
});

it('旧组合库入口映射到组合库，载入打开面板，关闭保留原库和已载入组合', async () => {
  mocks.getAllChains.mockResolvedValue([{ ...saved, id: 'combo', type: 'preset', name: '已存夜景', params: {
    _rollContentSnapshot: contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21'),
  } }]);
  await setup('prompts');
  fireEvent.click(screen.getByRole('button', { name: 'content-roll-library' }));
  fireEvent.click(await screen.findByRole('button', { name: '载入组合' }));
  expect(await screen.findByRole('dialog', { name: 'Roll 组合' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '组合库' }).getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('[data-content-roll-row="scene"]')?.textContent).toContain('night');
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  expect(screen.queryByRole('dialog', { name: 'Roll 组合' })).toBeNull();
  expect(screen.getByRole('button', { name: '载入组合' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Roll 组合' }));
  expect(document.querySelector('[data-content-roll-row="scene"]')?.textContent).toContain('night');
});

it('提示词库创建使用完整回执并留在当前库，不重新下载整库或打开实验室', async () => {
  await setup('prompts');
  const readsBeforeCreate = mocks.getAllChains.mock.calls.length;
  mocks.createChainWithData.mockResolvedValueOnce({ ...saved, id: 'new-wardrobe', type: 'wardrobe' });
  fireEvent.click(screen.getByRole('button', { name: '新建合成服饰' }));
  await waitFor(() => expect(screen.getByTestId('prompt-library-chains').textContent).toContain('new-wardrobe'));
  expect(mocks.createChainWithData).toHaveBeenCalledWith('合成服饰', '', undefined, 'wardrobe');
  expect(mocks.getAllChains).toHaveBeenCalledTimes(readsBeforeCreate);
  expect(screen.getByTestId('view').textContent).toBe('content-library');
  expect(screen.queryByTestId('editor')).toBeNull();
});

it('普通风格串从原列表进入原编辑器，内容与封面仍保存原db并返回同一张卡', async () => {
  const original = { ...source, id: 'ordinary-style' };
  mocks.getAllChains.mockResolvedValue([original]);
  mocks.updateChain.mockImplementationOnce(async (_id: string, updates: Partial<PromptChain>) => { mocks.getAllChains.mockResolvedValue([{ ...original, ...updates }]); });
  await setup(); fireEvent.click(screen.getByRole('button', { name: 'list' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑合成风格串' }));
  expect((await screen.findByTestId('editor')).textContent).toContain(original.id);
  fireEvent.click(screen.getByRole('button', { name: '保存合成内容及封面' }));
  await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledWith(original.id, { basePrompt: 'edited style', previewImage: '/api/assets/covers/edited.png', tags: [] }));
  await waitFor(() => expect(screen.getByTestId('editor').textContent).toContain('edited style'));
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  expect(screen.getByTestId('list').getAttribute('data-return-target')).toBe(original.id);
});

it('进入画师库和资料变更刷新不读取旧artists表，也不向页面传入旧画师资料', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'library' }));
  expect((await screen.findByTestId('artist-library')).getAttribute('data-legacy-prop')).toBe('false');
  expect(screen.queryByText('画师库加载失败，请稍后重试')).toBeNull();
  await act(async () => window.dispatchEvent(new Event('nai-project-data-changed')));
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('画师库加载失败，请稍后重试')).toBeNull();
});

it('Roll 页面保存加入同一风格串列表并停留原页，实验室返回可回到 Roll', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: 'roll' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存 Roll 候选' }));
  await waitFor(() => expect(screen.getByTestId('roll-chains').textContent).toContain(saved.id));
  expect(screen.getByTestId('view').textContent).toBe('roll');
  fireEvent.click(screen.getByRole('button', { name: 'Roll 送往实验室' }));
  await screen.findByTestId('editor');
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('roll'));
});

it.each([false, true])('共享删除回调失败=%s：结果传回调用方，成功刷新列表，失败保留条目', async fails => {
  mocks.getAllChains.mockResolvedValue([saved]);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  if (fails) mocks.deleteChain.mockRejectedValueOnce(new Error('合成后端删除失败'));
  else mocks.getAllChains.mockResolvedValueOnce([]);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '删除合成风格串' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(fails ? '合成删除失败' : '合成删除成功'));
  expect(mocks.deleteChain).toHaveBeenCalledWith(saved.id);
  expect(screen.getByTestId('list').textContent?.includes(saved.id)).toBe(fails);
  expect(mocks.getAllChains).toHaveBeenCalledTimes(fails ? 1 : 2);
  expect(screen.getByTestId('view').textContent).toBe('list');
  log.mockRestore();
});

it.each([false, true])('分类标签回读失败=%s：真实刷新结果传回管理组件，读取失败不伪报成功', async fails => {
  mocks.getAllChains.mockResolvedValue([saved]);
  await setup(); fireEvent.click(screen.getByRole('button', { name: 'list' }));
  if (fails) mocks.getAllChains.mockRejectedValueOnce(new Error('合成标签列表读取失败'));
  else mocks.getAllChains.mockResolvedValueOnce([{ ...saved, id: 'tag-reloaded' }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '回读合成分类标签' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(fails ? '风格串列表加载失败，请稍后重试' : '合成标签已回读'));
  expect(screen.getByRole('status').getAttribute('data-type')).toBe(fails ? 'error' : 'success');
  expect(mocks.getAllChains).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('list').textContent).toContain(fails ? saved.id : 'tag-reloaded');
});

it.each([false, true])('收藏导入回读失败=%s：读取异常传回窗口，成功直接更新列表', async fails => {
  await setup('inspiration');
  mocks.getAllInspirations.mockClear();
  if (fails) mocks.getAllInspirations.mockRejectedValueOnce(new Error('合成导入刷新失败'));
  else mocks.getAllInspirations.mockResolvedValueOnce([{ id: 'new-local-image', title: '新导入的本地图片', tags: [] }]);
  fireEvent.click(screen.getByRole('button', { name: '回读合成导入图片' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(fails ? '合成导入刷新失败' : '合成导入已刷新'));
  expect(mocks.getAllInspirations).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').getAttribute('data-type')).toBe(fails ? 'error' : 'success');
  if (!fails) expect(screen.getByTestId('collection-items').textContent).toBe('新导入的本地图片');
});

it('批量删除串行提交并在末尾统一回读，丢失回执的已删除条目不保留为失败', async () => {
  const items = [saved, { ...saved, id: 'remaining' }, { ...saved, id: 'lost-receipt' }];
  mocks.getAllChains.mockResolvedValue(items);
  await setup(); fireEvent.click(screen.getByRole('button', { name: 'list' }));
  let resolve!: () => void;
  mocks.deleteChain.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  mocks.deleteChain.mockRejectedValueOnce(new Error('合成未删除'));
  mocks.deleteChain.mockRejectedValueOnce(new Error('合成删除回执丢失'));
  mocks.getAllChains.mockResolvedValueOnce([items[1]]);
  fireEvent.click(screen.getByRole('button', { name: '批量删除合成风格串' }));
  await waitFor(() => expect(mocks.deleteChain).toHaveBeenCalledTimes(1));
  expect(mocks.getAllChains).toHaveBeenCalledTimes(1);
  expect(mocks.bulkProgress).not.toHaveBeenCalled();
  await act(async () => resolve());
  await waitFor(() => expect(mocks.bulkResult).toHaveBeenCalledWith({ remainingIds: ['remaining'], errorCount: 2 }));
  expect(mocks.deleteChain.mock.calls.map(call => call[0])).toEqual(items.map(item => item.id));
  expect(mocks.bulkProgress.mock.calls.map(call => call[0])).toEqual([1, 2, 3]);
  expect(mocks.getAllChains).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('list').textContent).toContain('remaining');
  expect(screen.getByTestId('list').textContent).not.toContain('lost-receipt');
});

it('批量删除后的列表回读失败不能伪报成功或把旧列表当作真实剩余项', async () => {
  mocks.getAllChains.mockResolvedValue([saved]);
  await setup(); fireEvent.click(screen.getByRole('button', { name: 'list' }));
  mocks.getAllChains.mockRejectedValueOnce(new Error('合成列表读取失败'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: '批量删除合成风格串' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('删除已提交，但列表刷新失败，请刷新后核对结果'));
  expect(mocks.bulkResult).not.toHaveBeenCalled(); expect(mocks.deleteChain).toHaveBeenCalledExactlyOnceWith(saved.id);
  expect(mocks.getAllChains).toHaveBeenCalledTimes(2);
});

it.each([
  ['style', '另存为新串', '已保存到风格串'],
  ['character', '另存为角色', '已保存到角色库'],
] as const)('另存为%s时提示目标库名称', async (targetType, action, message) => {
  const chain = { ...source, id: 'source-style' };
  mocks.getAllChains.mockResolvedValue([chain]);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑合成风格串' }));
  await screen.findByTestId('editor');
  fireEvent.click(await screen.findByRole('button', { name: action }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
  expect(mocks.createChain).toHaveBeenCalledWith(`${chain.name} (Fork)`, chain.description, chain, targetType);
});

it.each(['save', 'discard', 'cancel'] as const)('离开编辑页选择 %s：保存与放弃分开处理草稿，取消保持原页', async action => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  const key = `nai-lab-workspace-v1:${saved.id}`;
  sessionStorage.setItem(key, '合成会话草稿');
  fireEvent.click(screen.getByRole('button', { name: '修改合成草稿' }));
  mocks.confirm.mockImplementation(async (options: ConfirmDialogOptions) => action === 'save' ? options.onSave!() : action === 'discard');
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe(action === 'cancel' ? 'edit' : 'list'));
  expect(mocks.confirm.mock.lastCall?.[0]).toMatchObject({ rememberKey: 'editor.leave', rememberScope: { canSave: true }, title: '有未保存的修改', cancelLabel: '继续编辑', onSave: expect.any(Function) });
  expect(mocks.save).toHaveBeenCalledTimes(action === 'save' ? 1 : 0);
  expect(sessionStorage.getItem(key)).toBe(action === 'discard' ? null : '合成会话草稿');
  expect(consumeEditorSessionDiscarded(saved.id)).toBe(action === 'discard');
});

it('离开前保存失败留在原页，下一次点击仍提示未保存；成功后继续原定跳转', async () => {
  await setup(); fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  fireEvent.click(screen.getByRole('button', { name: '修改合成草稿' }));
  const key = `nai-lab-workspace-v1:${saved.id}`;
  sessionStorage.setItem(key, '失败后仍需保留的合成草稿');
  mocks.confirm.mockImplementation((options: ConfirmDialogOptions) => options.onSave!());
  mocks.save.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(screen.getByTestId('view').textContent).toBe('edit');
  expect(sessionStorage.getItem(key)).toBe('失败后仍需保留的合成草稿');
  expect(consumeEditorSessionDiscarded(saved.id)).toBe(false);
  let resolve!: (success: boolean) => void;
  mocks.save.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('view').textContent).toBe('edit');
  await act(async () => resolve(true));
  expect(screen.getByTestId('view').textContent).toBe('list');
  expect(sessionStorage.getItem(key)).toBe('失败后仍需保留的合成草稿');
  expect(consumeEditorSessionDiscarded(saved.id)).toBe(false);
});

it('当前模式不能保存时仍可继续编辑或放弃，不提供无效的保存动作', async () => {
  mocks.canSave = false;
  await setup(); fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  fireEvent.click(screen.getByRole('button', { name: '修改合成草稿' }));
  mocks.confirm.mockResolvedValue(false);
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.confirm.mock.lastCall?.[0].onSave).toBeUndefined();
  expect(mocks.confirm.mock.lastCall?.[0].cancelLabel).toBe('继续编辑');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByTestId('view').textContent).toBe('edit');
});

it.each(['aitag', 'inspiration'])('%s 保存后直接打开服务端条目，无须等待整库刷新', async entry => {
  await setup(entry);
  // 若重新读整库会永远等待，证明跳转没有依赖这个请求。
  mocks.getAllChains.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  const editor = await screen.findByTestId('editor');
  expect(editor.textContent).toContain('server-saved|synthetic prompt|/api/assets/covers/server-saved.png');
  expect(screen.getByTestId('view').textContent).toBe('edit');
  expect(mocks.getAllChains).toHaveBeenCalledTimes(1);
  expect(mocks.createChainWithData).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('已保存到风格串');
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
});

it('写入失败保持来源页，只显示失败，不伪报已保存', async () => {
  await setup(); mocks.createChainWithData.mockRejectedValueOnce(new Error('模拟创建失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('模拟创建失败'));
  expect(screen.getByRole('status').getAttribute('data-type')).toBe('error');
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
});

it('应用自行保持滚动，关闭详情的浏览器返回不再恢复历史旧位置', async () => {
  window.history.scrollRestoration = 'auto';
  await setup();
  expect(window.history.scrollRestoration).toBe('manual');
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  expect(window.history.scrollRestoration).toBe('manual');
  cleanup();
  expect(window.history.scrollRestoration).toBe('auto');
});

it('生成后记账错误明确提示，随后的成功通知不能立即覆盖费用异常', async () => {
  await setup();
  act(() => window.dispatchEvent(new CustomEvent(NAI_ACCOUNTING_ERROR_EVENT, { detail: { message: '图片已生成，但本地用量记账失败；勿重复生成' } })));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  expect(screen.getByRole('status').textContent).toContain('本地用量记账失败');
  expect(screen.getByRole('status').getAttribute('data-type')).toBe('error');
});

it('旧的整库刷新迟到不会移除刚保存的条目或破坏已打开的工作台', async () => {
  await setup(); let resolve!: (value: PromptChain[]) => void;
  mocks.getAllChains.mockImplementation(() => new Promise<PromptChain[]>(done => { resolve = done; }));
  act(() => window.dispatchEvent(new CustomEvent('nai-project-data-changed')));
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  await act(async () => resolve([{ ...source, id: 'existing-from-slow-list' }]));
  expect(screen.getByTestId('editor').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain('existing-from-slow-list');
});

it('保存中已主动离开时保留新页面，仍把成功条目加入资料库', async () => {
  await setup(); let resolve!: (value: PromptChain) => void;
  mocks.createChainWithData.mockImplementation(() => new Promise<PromptChain>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  await act(async () => resolve(saved));
  expect(screen.getByTestId('view').textContent).toBe('list');
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
});

it('保存中离开再返回来源页，旧保存完成也不打断新的浏览会话', async () => {
  await setup(); let resolve!: (value: PromptChain) => void;
  mocks.createChainWithData.mockImplementation(() => new Promise<PromptChain>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  fireEvent.click(screen.getByRole('button', { name: 'aitag' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('aitag'));
  await act(async () => resolve(saved));
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
});


it('共享收藏已加载时直接进入收藏库，跨页面爱心保存或取消立即更新页面，不追加整库请求', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async () => []);
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => ({ item: body }));
  const put = vi.spyOn(api, 'put').mockResolvedValue({ success: true });
  const history = vi.spyOn(localHistory, 'getPage').mockResolvedValue({ items: [], count: 0 });
  try {
    const collection = await import('../../services/collectionFavorites');
    await collection.loadCollection({ id: 'owner', username: '合成用户', role: 'admin', createdAt: 1 });
    const order = ['negative', 'params', 'prompt', 'characters', 'vibe', 'characterReference'];
    saveAppearancePreferences(normalizeAppearancePreferences({ labPageLayouts: { 'text-to-image': { order } } }));
    await setup('inspiration');
    expect(JSON.parse(screen.getByTestId('collection-items').dataset.moduleOrder!)).toEqual(order);
    expect(mocks.getAllInspirations).not.toHaveBeenCalled();
    const image = { imageUrl: '/synthetic/instant.png', title: '立即显示的新收藏', sourceType: 'character' as const, sourceId: 'instant' };
    const reads = get.mock.calls.length;
    await act(async () => { await collection.toggleCollectionTarget(image); });
    expect(screen.getByTestId('collection-items').textContent).toBe(image.title);
    expect(get).toHaveBeenCalledTimes(reads); expect(mocks.getAllInspirations).not.toHaveBeenCalled();
    await act(async () => { await collection.toggleCollectionTarget(image); });
    expect(screen.getByTestId('collection-items').textContent).toBe('');
    expect(get).toHaveBeenCalledTimes(reads); expect(mocks.getAllInspirations).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('nai-project-data-changed')); });
    expect(mocks.getAllInspirations).toHaveBeenCalledOnce();
  } finally { get.mockRestore(); post.mockRestore(); put.mockRestore(); history.mockRestore(); }
});
