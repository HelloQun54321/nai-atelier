// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { api, NAI_ACCOUNTING_ERROR_EVENT } from '../../services/api';
import { localHistory } from '../../services/localHistory';
import { consumeEditorSessionDiscarded } from '../../services/labWorkspace';
import type { ConfirmDialogOptions } from '../../components/ConfirmDialog';

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(), getAllChains: vi.fn(), getAllArtists: vi.fn(), getAllInspirations: vi.fn(),
  createChain: vi.fn(), createChainWithData: vi.fn(), deleteChain: vi.fn(),
  confirm: vi.fn(), save: vi.fn(), canSave: true,
}));
vi.mock('../../services/dbService', () => ({ db: mocks }));
vi.mock('../../services/collectorAppearance', () => ({ useCollectorAppearance: () => {} }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/Layout', () => ({ Layout: ({ children, onNavigate, currentView, toast }: any) => <>
  <div data-testid="view">{currentView}</div>
  {['aitag', 'inspiration', 'list'].map(view => <button key={view} onClick={() => onNavigate(view)}>{view}</button>)}
  {toast && <div role="status" data-type={toast.type}>{toast.message}</div>}{children}
</> }));
vi.mock('../../components/ChainList', () => ({ ChainList: ({ chains, onDelete, notify }: { chains: PromptChain[]; onDelete: (id: string) => Promise<void>; notify: (message: string, type?: string) => void }) => <div data-testid="list">{chains.map(chain => chain.id).join(',')}{chains[0] && <button onClick={async () => {
  try { await onDelete(chains[0].id); notify('合成删除成功'); }
  catch { notify('合成删除失败', 'error'); }
}}>删除合成风格串</button>}</div> }));
vi.mock('../../components/ChainEditor', () => ({ ChainEditor: ({ chain, onBack, saveRef, setIsDirty }: any) => {
  React.useImperativeHandle(saveRef, () => ({ canSave: mocks.canSave, save: mocks.save }));
  return <div data-testid="editor">{chain.id}|{chain.basePrompt}|{chain.previewImage}<button onClick={onBack}>返回资料库</button><button onClick={() => setIsDirty(true)}>修改合成草稿</button></div>;
} }));
// 这里验证 App 的共享保存回调；AITag 实际按钮的元数据与连点行为在图库组件测试中覆盖。
const source: PromptChain = {
  id: 'aitag-synthetic', type: 'style', userId: 'owner', name: '合成作品 P1', description: '', tags: [],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, characters: [] },
  previewImage: '/api/assets/aitag/source.png', createdAt: 1, updatedAt: 1,
};
const saved = { ...source, id: 'server-saved', previewImage: '/api/assets/covers/server-saved.png' };
const ExternalGallery = ({ onCreateArtistChain, notify }: any) => <button onClick={async () => {
  try { await onCreateArtistChain(source); notify('已保存到风格串'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>保存合成作品</button>;
vi.mock('../../components/AitagGallery', () => ({ AitagGallery: (props: any) => <ExternalGallery {...props} /> }));
vi.mock('../../components/InspirationGallery', () => ({ InspirationGallery: (props: any) => <><div data-testid="collection-items">{(props.inspirationsData || []).filter((item: any) => !item.archived).map((item: any) => item.title).join(',')}</div><ExternalGallery {...props} /></> }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.getMe.mockResolvedValue({ id: 'owner', username: '合成用户', role: 'admin' });
  mocks.getAllChains.mockResolvedValue([]); mocks.getAllArtists.mockResolvedValue([]); mocks.getAllInspirations.mockResolvedValue([]);
  mocks.createChain.mockResolvedValue(saved.id); mocks.createChainWithData.mockResolvedValue(saved);
  mocks.deleteChain.mockResolvedValue(undefined);
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
  await screen.findByRole('button', { name: '保存合成作品' });
};

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
  expect(mocks.confirm.mock.lastCall?.[0]).toMatchObject({ title: '有未保存的修改', cancelLabel: '继续编辑', onSave: expect.any(Function) });
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
    await setup('inspiration');
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
