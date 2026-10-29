import { openPurposeGroup } from '../support/promptPurposeGroups';
import { PromptLibraryContext, PromptLibraryWorkspace, PromptLibraryRandomButton, PromptLibraryFieldActions } from '../../components/PromptLibraryAccess';
import { normalizeAppearancePreferences, saveAppearancePreferences } from '../../services/appearancePreferences';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { api, NAI_ACCOUNTING_ERROR_EVENT } from '../../services/api';
import { localHistory } from '../../services/localHistory';
import { consumeEditorSessionDiscarded } from '../../services/labWorkspace';
import { contentSnapshotOf } from '../../services/contentRoll';
import { ImageActivityContext } from '../../components/SmartImage';
import { getLanguage, setLanguage } from '../../services/i18n';
import type { ConfirmDialogOptions } from '../../components/ConfirmDialog';
import { promptAgentService } from '../../services/promptAgent';
import { createDefaultPromptLibraryTree, LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS } from '../../services/promptLibraryTree.mjs';

const mocks = vi.hoisted(() => ({
  artistRenders: 0,
  loadDirectories: vi.fn(), saveDirectories: vi.fn(),
  loadCategoryTree: vi.fn(), saveCategoryTree: vi.fn(),
  getMe: vi.fn(), getAllChains: vi.fn(), getAllInspirations: vi.fn(),
  createChain: vi.fn(), createChainWithData: vi.fn(), deleteChain: vi.fn(),
  updateChain: vi.fn(),
  getPromptLibraryTagNames: vi.fn(), savePromptLibraryTagNames: vi.fn(),
  editorDraft: null as PromptChain | null,
  updatePlayground: null as ((id: string, updates: Partial<PromptChain>) => Promise<void>) | null,
  confirm: vi.fn(), save: vi.fn(), canSave: true, bulkProgress: vi.fn(), bulkResult: vi.fn(),
}));
vi.mock('../../services/promptLibraryDirectories', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/promptLibraryDirectories')>()), loadPromptLibraryDirectories: mocks.loadDirectories, savePromptLibraryDirectories: mocks.saveDirectories }));
vi.mock('../../services/promptLibraryCategoryTree', async importOriginal => ({ ...(await importOriginal<typeof import('../../services/promptLibraryCategoryTree')>()), loadPromptLibraryCategoryTree: mocks.loadCategoryTree, savePromptLibraryCategoryTree: mocks.saveCategoryTree }));
vi.mock('../../services/dbService', () => ({ db: mocks }));
vi.mock('../../services/collectorAppearance', () => ({ useCollectorAppearance: () => {} }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../components/Layout', () => ({ Layout: ({ children, onNavigate, currentView, toast, appearancePreferences, setAppearancePreferences }: any) => <>
  <div data-testid="view">{currentView}</div>
  {['aitag', 'inspiration', 'list', 'prompts', 'roll', 'library', 'playground', 'content-roll', 'content-roll-library'].map(view => <button key={view} onClick={() => onNavigate(view)}>{view}</button>)}
  {toast && <div role="status" data-type={toast.type}>{toast.message}</div>}{children}
  <button onClick={() => setAppearancePreferences({ ...appearancePreferences, gallerySelectionFocus: !appearancePreferences.gallerySelectionFocus })}>切换合成选中聚焦</button>
</> }));
vi.mock('../../components/ChainList', () => ({ ChainList: ({ chains, onCreate, onDelete, onBulkDelete, onReloadTags, onBundleImported, onSelect, returnTargetId, notify }: { chains: PromptChain[]; onCreate: (name: string, description: string, type: string, folderId?: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onBulkDelete?: (ids: string[], onProgress: (completed: number) => void) => Promise<unknown>; onReloadTags?: () => Promise<void>; onBundleImported?: () => Promise<void>; onSelect: (id: string) => void; returnTargetId?: string; notify: (message: string, type?: string) => void }) => <div data-testid="list" data-return-target={returnTargetId}>{chains.map(chain => chain.id).join(',')}<button onClick={() => void onCreate('目录中新串', '', 'style', 'synthetic-folder')}>在合成目录中新建</button>{onBundleImported && <button onClick={async () => {
  try { await onBundleImported(); notify('合成分享包已回读'); }
  catch (error: any) { notify('风格串已保存，列表刷新失败：' + error.message, 'error'); }
}}>回读合成分享包</button>}{onReloadTags && <button onClick={async () => {
  try { await onReloadTags(); notify('合成标签已回读'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>回读合成分类标签</button>}{onBulkDelete && <button onClick={async () => {
  try { mocks.bulkResult(await onBulkDelete(chains.map(chain => chain.id), mocks.bulkProgress)); }
  catch (error: any) { notify(error.message, 'error'); }
}}>批量删除合成风格串</button>}{chains[0] && <><button onClick={async () => {
  try { await onDelete(chains[0].id); notify('合成删除成功'); }
  catch { notify('合成删除失败', 'error'); }
}}>删除合成风格串</button><button onClick={() => onSelect(chains[0].id)}>编辑合成风格串</button></>}</div> }));
vi.mock('../../components/ChainEditor', () => ({ ChainEditor: ({ chain, onUpdateChain, onBack, onFork, saveRef, setIsDirty, onContentRollForGlobal, onContentRollForRole }: any) => {
  mocks.editorDraft = chain;
  mocks.updatePlayground = onUpdateChain;
  React.useImperativeHandle(saveRef, () => ({ canSave: mocks.canSave, save: mocks.save }));
  return <PromptLibraryWorkspace register state={{ params: chain.params, base: chain.basePrompt || '', subject: chain.variableValues?.subject || '', negative: chain.negativePrompt || '', classified: true }} onChange={next => onUpdateChain(chain.id, { params: next.params, basePrompt: next.base, negativePrompt: next.negative, variableValues: { ...chain.variableValues, subject: next.subject } })}><PromptLibraryRandomButton /><PromptLibraryFieldActions value={chain.variableValues?.subject || ''} onText={text => onUpdateChain(chain.id, { variableValues: { ...chain.variableValues, subject: text } })} field={{ purposeId: 'place' }} /><div data-testid="editor">{chain.id}|{chain.basePrompt}|{chain.previewImage}<button onClick={onContentRollForGlobal}>全局随机搭配</button><button onClick={() => onContentRollForRole(1)}>角色二随机搭配</button><button onClick={onBack}>返回资料库</button><button onClick={() => { void Promise.resolve(onUpdateChain(chain.id, { basePrompt: 'edited style', previewImage: '/api/assets/covers/edited.png', tags: [] })).catch(() => {}); }}>保存合成内容及封面</button><button onClick={() => setIsDirty(true)}>修改合成草稿</button><button onClick={() => void onFork(chain, 'style')}>另存为新串</button><button onClick={() => void onFork(chain, 'character')}>另存为角色</button></div></PromptLibraryWorkspace>;
} }));
// 这里验证 App 的共享保存回调；AITag 实际按钮的元数据与连点行为在图库组件测试中覆盖。
const source: PromptChain = {
  id: 'aitag-synthetic', type: 'style', userId: 'owner', name: '合成作品 P1', description: '', tags: [],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, characters: [] },
  previewImage: '/api/assets/aitag/source.png', createdAt: 1, updatedAt: 1,
};
let categoryTree: { revision: number; nodes: Array<{ id: string; name: string; parentId: string | null }> };
let directoryTree: ReturnType<typeof createDefaultPromptLibraryTree>;
const saved = { ...source, id: 'server-saved', previewImage: '/api/assets/covers/server-saved.png' };
const ExternalGallery = ({ onCreateArtistChain, onNavigateToChains, onImportRefresh, notify }: any) => <><button onClick={async () => {
  try { await onCreateArtistChain(source); notify('已保存到风格串'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>保存合成作品</button><button onClick={async () => {
  try {
    await onCreateArtistChain(source, { openEditor: false });
    await onCreateArtistChain({ ...source, id: 'aitag-synthetic-2', name: '合成作品 P2', basePrompt: 'second synthetic prompt' }, { openEditor: false });
    notify('合成组已保存');
  } catch (error: any) { notify(error.message, 'error'); }
}}>批量保存合成作品</button>{onNavigateToChains && <button onClick={async () => {
  const complete = onNavigateToChains;
  try {
    await onCreateArtistChain(source, { openEditor: false });
    await onCreateArtistChain({ ...source, id: 'aitag-synthetic-2', name: '合成作品 P2' }, { openEditor: false });
    complete();
  } catch (error: any) { notify(error.message, 'error'); }
}}>批量保存后跳转</button>}{onImportRefresh && <button onClick={async () => {
  try { await onImportRefresh(); notify('合成导入已刷新'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>回读合成导入图片</button>}</>;
vi.mock('../../components/AitagGallery', () => ({ AitagGallery: (props: any) => <ExternalGallery {...props} /> }));
vi.mock('../../components/ArtistLibrary', () => ({ ArtistLibrary: (props: any) => {
  mocks.artistRenders++;
  const library = React.useContext(PromptLibraryContext);
  const active = React.useContext(ImageActivityContext);
  const [draft, setDraft] = React.useState('');
  const [progress, setProgress] = React.useState(0);
  React.useEffect(() => {
    const advance = () => setProgress(value => value + 1);
    window.addEventListener('synthetic-artist-progress', advance);
    return () => window.removeEventListener('synthetic-artist-progress', advance);
  }, []);
  return <div data-testid="artist-library" data-legacy-prop={String(Object.hasOwn(props, 'artistsData'))}>
    画师词库<input aria-label="合成画师筛选" value={draft} onChange={event => setDraft(event.target.value)} />
    <span data-testid="artist-chain-count">{library?.chains.length}</span>
    <span data-testid="artist-focus">{String(props.selectionFocusEnabled)}</span>
    <span data-testid="artist-active">{String(active)}</span>
    <span data-testid="artist-progress">{progress}</span>
    <button onClick={props.onNavigateToPlayground}>画师进入实验室</button>
  </div>;
} }));
vi.mock('../../components/InspirationGallery', () => ({ InspirationGallery: (props: any) => <><div data-testid="collection-items" data-has-lab-order={String(Object.hasOwn(props, 'labModuleOrder'))}>{(props.inspirationsData || []).filter((item: any) => !item.archived).map((item: any) => item.title).join(',')}</div><ExternalGallery {...props} /></> }));
vi.mock('../../components/StyleRollPage', () => ({ StyleRollPage: ({ onSaveChain, onNavigateToPlayground, chains }: any) => <div><span data-testid="roll-chains">{chains.map((chain: PromptChain) => chain.id).join(',')}</span><button onClick={() => void onSaveChain(source)}>保存 Roll 候选</button><button onClick={onNavigateToPlayground}>Roll 送往实验室</button></div> }));
vi.mock('../../components/PromptLibrary', async importOriginal => ({ ...(await importOriginal<typeof import('../../components/PromptLibrary')>()), PromptLibraryHub: ({ chains, onCreate }: any) => <div>
  <span data-testid="prompt-library-chains">{chains.map((chain: PromptChain) => chain.id).join(',')}</span>
  <button onClick={() => void onCreate('合成服饰', '', 'wardrobe')}>新建合成服饰</button>
</div> }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.createChainWithData.mockReset();
  directoryTree = createDefaultPromptLibraryTree();
  mocks.loadDirectories.mockReset().mockImplementation(async () => structuredClone(directoryTree));
  mocks.saveDirectories.mockReset().mockImplementation(async (next: typeof directoryTree) => {
    directoryTree = { ...next, revision: directoryTree.revision + 1 };
    const savedTree = structuredClone(directoryTree);
    window.dispatchEvent(new CustomEvent('prompt-library-directories-changed', { detail: savedTree }));
    return savedTree;
  });
  categoryTree = { revision: 0, nodes: [] };
  mocks.loadCategoryTree.mockReset().mockImplementation(async () => structuredClone(categoryTree));
  mocks.saveCategoryTree.mockReset().mockImplementation(async (next: { revision: number; nodes: Array<{ id: string; name: string; parentId: string | null }> }) => {
    categoryTree = { ...next, revision: categoryTree.revision + 1 };
    return structuredClone(categoryTree);
  });
  mocks.getPromptLibraryTagNames.mockReset().mockResolvedValue([]);
  mocks.savePromptLibraryTagNames.mockReset().mockImplementation(async (tags: string[]) => tags);
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
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = async (entry = 'aitag') => {
  const { default: App } = await import('../../App');
  render(<App />);
  await screen.findByTestId('list');
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: entry }));
  if (entry === 'prompts') await screen.findByRole('searchbox', { name: '搜索名称、正文或标签' });
  else await screen.findByRole('button', { name: '保存合成作品' });
};
const selectPromptScope = (scope: 'items' | 'saved') => {
  if (!screen.queryByRole('combobox', { name: '提示词库范围' })) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: scope } });
};

const makeDataTransfer = () => {
  const values = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type: string, value: string) { values.set(type, value); if (!types.includes(type)) types.push(type); },
    getData(type: string) { return values.get(type) || ''; },
  } as unknown as DataTransfer;
};

const dragDirectoryToRoot = async (nav: HTMLElement, sourceName: string) => {
  const dataTransfer = makeDataTransfer();
  const sourceButton = within(nav).getByRole('button', { name: sourceName });
  fireEvent.dragStart(sourceButton, { dataTransfer });
  expect(dataTransfer.types.length).toBeGreaterThan(0);
  expect(dataTransfer.getData(dataTransfer.types[0])).not.toBe('');
  const root = await within(nav).findByRole('group', { name: '移到根目录' });
  fireEvent.dragOver(root, { dataTransfer });
  fireEvent.drop(root, { dataTransfer });
  return root;
};

it('App 将共享串库的首读、失败与重试状态传入提示词浏览，成功后才报空', async () => {
  let rejectRead!: (error: Error) => void;
  mocks.getAllChains.mockReturnValue(new Promise<PromptChain[]>((_resolve, reject) => { rejectRead = reject; }));
  await setup('prompts');
  expect(screen.getByText('加载中…')).toBeTruthy();
  expect(screen.queryByText('提示词库还是空的')).toBeNull();
  await act(async () => { rejectRead(new Error('合成串库暂不可读')); });
  expect(screen.getByRole('alert').textContent).toContain('风格串列表加载失败，请稍后重试');
  expect(screen.queryByText('提示词库还是空的')).toBeNull();
  const attempts = mocks.getAllChains.mock.calls.length;
  mocks.getAllChains.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('提示词库还是空的');
  expect(mocks.getAllChains).toHaveBeenCalledTimes(attempts + 1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('当前目录读取失败时不以默认树开放写入，重试后才显示提示词库', async () => {
  mocks.loadDirectories.mockRejectedValueOnce(new Error('合成目录暂不可读'));
  const { default: App } = await import('../../App');
  render(<App />);
  await screen.findByTestId('list');
  fireEvent.click(screen.getByRole('button', { name: 'prompts' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '合成目录暂不可读');
  expect(screen.queryByRole('button', { name: '粘贴收录' })).toBeNull();
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('searchbox', { name: '搜索名称、正文或标签' });
  expect(mocks.loadDirectories).toHaveBeenCalledTimes(2);
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
});

const openCombinationCategories = async () => {
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  if (screen.queryByRole('button', { name: '展开目录' })) fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  const manager = await screen.findByRole('dialog', { name: '新建目录' });
  await waitFor(() => expect((within(manager).getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).disabled).toBe(false));
  return manager;
};

it('文件夹内新建通过真实App回调广播保存回执，返回时保留新串', async () => {
  const folders = { revision: 1, folders: [{ id: 'synthetic-folder', name: '合成文件夹', parentId: null }], assignments: {} };
  const persisted = { ...folders, revision: 2, assignments: { [saved.id]: ['synthetic-folder'] } };
  const get = vi.spyOn(api, 'get').mockResolvedValue(folders);
  const put = vi.spyOn(api, 'put').mockResolvedValue(persisted);
  const updated = vi.fn();
  window.addEventListener('nai-chain-folders-updated', updated);
  try {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'list' }));
    mocks.getAllChains.mockResolvedValue([saved]);
    fireEvent.click(screen.getByRole('button', { name: '在合成目录中新建' }));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('edit'));
    expect(put).toHaveBeenCalledWith('/chain-folders', { ...folders, assignments: persisted.assignments });
    expect(updated).toHaveBeenCalledTimes(1);
    expect((updated.mock.calls[0][0] as CustomEvent).detail).toEqual(persisted);
    expect(mocks.createChain).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: '返回资料库' }));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
    expect(screen.getByTestId('list').textContent).toContain(saved.id);
  } finally {
    window.removeEventListener('nai-chain-folders-updated', updated);
    get.mockRestore(); put.mockRestore();
  }
});

it('零条组合也能预建分类，冷回读后保存与详情均可选用', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  let directory: string[] = [];
  mocks.getPromptLibraryTagNames.mockImplementation(async () => [...directory]);
  mocks.savePromptLibraryTagNames.mockImplementation(async (tags: string[]) => { directory = [...tags]; return [...directory]; });
  await setup('prompts');
  const manager = await openCombinationCategories();
  fireEvent.change(within(manager).getByRole('textbox', { name: '新分类名称' }), { target: { value: '未来项目' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(directory).toEqual(['未来项目']));
  expect(mocks.updateChain).not.toHaveBeenCalled();
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建目录' })).toBeNull());
  const row = await screen.findByRole('button', { name: '分类「未来项目」' });
  expect(row.textContent).toContain('0');
  cleanup(); mocks.getAllChains.mockClear();
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  const combo = { ...saved, id: 'empty-directory-combo', name: '准备分类的组合', type: 'preset', tags: [], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([combo]);
  await setup('prompts');
  selectPromptScope('saved');
  expect(mocks.getPromptLibraryTagNames.mock.calls.length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole('button', { name: '编辑准备分类的组合' }));
  const roll = await screen.findByRole('dialog', { name: '搭配' });
  await waitFor(() => expect(roll.querySelector('[data-content-roll-row="directory:environment-scene"]')?.textContent).toContain('night'));
  fireEvent.click(within(roll).getByRole('button', { name: '保存组合' }));
  fireEvent.click(within(roll).getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(await screen.findByRole('button', { name: '#未来项目' }));
  expect((within(roll).getByRole('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('未来项目');
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  fireEvent.click(screen.getByRole('button', { name: '查看准备分类的组合' }));
  const detail = await screen.findByLabelText('准备分类的组合', { selector: 'aside' });
  fireEvent.click(within(detail).getByRole('button', { name: '编辑标签' }));
  fireEvent.click(within(detail).getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(await within(detail).findByRole('button', { name: '#未来项目' }));
  expect((within(detail).getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('未来项目');
});

it.each([false, true])('组合分类编辑只更新组合标签并同步已选筛选，合并=%s', async merge => {
  let directory = ['来源类', '目标类'];
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  let records = [
    { ...saved, id: 'both', name: '源目标共存', type: 'preset', tags: ['来源类', '目标类', '保留'], params: { ...saved.params, seed: 42, _rollContentSnapshot: snapshot } },
    { ...saved, id: 'source-only', name: '仅源组合', type: 'preset', tags: ['来源类', '另一标签'], params: { _rollContentSnapshot: snapshot } },
    { ...saved, id: 'fragment-same', name: '同名片段标签', type: 'scene', tags: ['来源类'], basePrompt: 'forest' },
    { ...saved, id: 'raw-same', name: '同名原文标签', type: 'preset', tags: ['来源类'], params: { _collectedPrompt: 1, _promptLibraryPurposes: [] }, basePrompt: 'raw forest' },
  ] as unknown as PromptChain[];
  const before = structuredClone(records);
  mocks.getAllChains.mockImplementation(async () => records);
  mocks.getPromptLibraryTagNames.mockImplementation(async () => [...directory]);
  mocks.savePromptLibraryTagNames.mockImplementation(async (tags: string[]) => { directory = [...tags]; return directory; });
  mocks.updateChain.mockImplementation(async (id: string, updates: Partial<PromptChain>) => { records = records.map(chain => chain.id === id ? { ...chain, ...updates } : chain); });
  try {
    await setup('prompts');
    selectPromptScope('items');
    fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
    const fragmentNavigation = await screen.findByRole('complementary', { name: '提示词目录导航' });
    fireEvent.click(within(fragmentNavigation).getByRole('button', { name: '场景环境 / 地点与布景' }));
    expect(within(fragmentNavigation).getByRole('button', { name: '场景环境 / 地点与布景' }).getAttribute('aria-current')).toBe('page');

    selectPromptScope('saved');
    expect(screen.getByRole('button', { name: '展开目录' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(await screen.findByRole('button', { name: '来源类' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const navigation = await screen.findByRole('complementary', { name: '组合分类导航' });
    fireEvent.click(within(navigation).getByRole('button', { name: '分类「来源类」' }));
    fireEvent.click(within(navigation).getByRole('button', { name: '重命名目录' }));
    const manager = await screen.findByRole('dialog', { name: '编辑目录' });
    await waitFor(() => expect((within(manager).getByRole('textbox', { name: '分类名称' }) as HTMLInputElement).disabled).toBe(false));
    if (merge) fireEvent.click(within(manager).getByText('合并分类', { selector: 'summary' }));
    const target = merge ? '目标类' : '新名称';
    if (merge) fireEvent.change(within(manager).getByRole('combobox', { name: '目标分类' }), { target: { value: target } });
    else fireEvent.change(within(manager).getByRole('textbox', { name: '分类名称' }), { target: { value: target } });
    fireEvent.click(within(manager).getByRole('button', { name: merge ? '合并' : '保存' }));
    await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(records[0].tags).toEqual(merge ? ['目标类', '保留'] : ['新名称', '目标类', '保留']));
    expect(records[1].tags).toEqual([target, '另一标签']);
    expect(mocks.updateChain.mock.calls.every(([, patch]) => Object.keys(patch).join(',') === 'tags')).toBe(true);
    for (const item of records) expect({ ...item, tags: [] }).toEqual({ ...before.find(chain => chain.id === item.id), tags: [] });
    expect(records[2].tags).toEqual(['来源类']); expect(records[3].tags).toEqual(['来源类']);
    await waitFor(() => expect(directory.includes('来源类')).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑目录' })).toBeNull());
    await waitFor(() => {
      const nav = screen.getByRole('complementary', { name: '组合分类导航' });
      const active = within(nav).getByRole('button', { name: `分类「${target}」` });
      expect(active.getAttribute('aria-current')).toBe('page');
      expect(active.textContent).toContain('2');
    });
    fireEvent.click(screen.getByRole('button', { name: '收起目录' }));
    selectPromptScope('items');
    expect(screen.getByRole('button', { name: '收起目录' }).getAttribute('aria-expanded')).toBe('true');
    const restoredFragments = screen.getByRole('complementary', { name: '提示词目录导航' });
    expect(within(restoredFragments).getByRole('button', { name: '场景环境 / 地点与布景' }).getAttribute('aria-current')).toBe('page');
    selectPromptScope('saved');
    expect(screen.getByRole('button', { name: '展开目录' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
    const restoredCategories = screen.getByRole('complementary', { name: '组合分类导航' });
    expect(within(restoredCategories).getByRole('button', { name: `分类「${target}」` }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect((await screen.findByRole('button', { name: target })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '来源类' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看源目标共存' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看仅源组合' })).toBeTruthy();
  } finally { mocks.updateChain.mockReset().mockResolvedValue(undefined); }
});

it('分类目录保存失败保留新增输入，不显示成功且不写组合', async () => {
  mocks.savePromptLibraryTagNames.mockRejectedValueOnce(new Error('合成目录不可写'));
  await setup('prompts');
  const manager = await openCombinationCategories();
  fireEvent.change(within(manager).getByRole('textbox', { name: '新分类名称' }), { target: { value: '失败后保留' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.savePromptLibraryTagNames).toHaveBeenCalledWith(['失败后保留']));
  await waitFor(() => expect(manager.textContent).toContain('合成目录不可写'));
  expect((within(manager).getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).value).toBe('失败后保留');
  expect(within(manager).queryByRole('button', { name: '重命名分类：失败后保留' })).toBeNull();
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('真实App组合分类可建子类、按父类浏览、移父后删除空父类且组合内容与片段目录保持原样', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night garden', filled: true } } }, '2026-10-21')!;
  const combo = { ...saved, id: 'nested-category-combo', name: '父子分类组合', type: 'preset', tags: ['父类'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  const fragment = { ...saved, id: 'nested-category-fragment', name: '片段目录保留', type: 'scene', tags: ['片段标签'], basePrompt: 'night walk', params: { _promptLibraryDirectoryIds: ['environment-scene'] } } as unknown as PromptChain;
  let records = [combo, fragment];
  let names = ['父类'];
  const originalSnapshot = structuredClone(snapshot), originalFragment = structuredClone(fragment);
  const recordSnapshot = (chain: PromptChain) => (chain.params as unknown as Record<string, unknown>)._rollContentSnapshot;
  mocks.getAllChains.mockImplementation(async () => records);
  mocks.updateChain.mockImplementation(async (id: string, updates: Partial<PromptChain>) => {
    records = records.map(chain => chain.id === id ? { ...chain, ...updates } : chain);
  });
  mocks.getPromptLibraryTagNames.mockImplementation(async () => [...names]);
  mocks.savePromptLibraryTagNames.mockImplementation(async (next: string[]) => { names = [...new Set(next)]; return names; });

  await setup('prompts');
  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const fragmentNav = screen.getByRole('complementary', { name: '提示词目录导航' });
  fireEvent.click(within(fragmentNav).getByRole('button', { name: '场景环境 / 地点与布景' }));
  expect(document.querySelector('[data-prompt-library-entry="nested-category-fragment"]')).toBeTruthy();

  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const categoryNav = screen.getByRole('complementary', { name: '组合分类导航' });
  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「父类」' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '新建目录' }));
  let manager = await screen.findByRole('dialog', { name: '新建目录' });
  await waitFor(() => expect(within(manager).getByRole('textbox', { name: '新分类名称' }).hasAttribute('disabled')).toBe(false));
  expect((within(manager).getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).value).toBe('父类');
  fireEvent.change(within(manager).getByRole('textbox', { name: '新分类名称' }), { target: { value: '子类' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建目录' })).toBeNull());
  expect(categoryTree.nodes).toContainEqual({ id: '子类', name: '子类', parentId: '父类' });

  fireEvent.click(await screen.findByRole('button', { name: '查看父子分类组合' }));
  const detail = await screen.findByLabelText('父子分类组合', { selector: 'aside' });
  fireEvent.click(within(detail).getByRole('button', { name: '编辑标签' }));
  fireEvent.change(within(detail).getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '子类' } });
  fireEvent.click(within(detail).getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(records[0].tags).toEqual(['子类']));
  expect(recordSnapshot(records[0])).toEqual(originalSnapshot);
  fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「父类」' }));
  expect(document.querySelector('[data-prompt-library-entry="nested-category-combo"]')).toBeTruthy();

  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「子类」' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '重命名目录' }));
  manager = await screen.findByRole('dialog', { name: '编辑目录' });
  await waitFor(() => expect((within(manager).getByRole('combobox', { name: '上级分类' }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(within(manager).getByRole('combobox', { name: '上级分类' }), { target: { value: '' } });
  fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(categoryTree.nodes.find(node => node.id === '子类')?.parentId).toBeNull());
  expect(records[0].tags).toEqual(['子类']);
  expect(recordSnapshot(records[0])).toEqual(originalSnapshot);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑目录' })).toBeNull());
  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「父类」' }));
  expect(document.querySelector('[data-prompt-library-entry="nested-category-combo"]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect(document.querySelector('[data-prompt-library-entry="nested-category-combo"]')).toBeTruthy();
  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「父类」' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '删除目录' }));
  await waitFor(() => expect(categoryTree.nodes.some(node => node.id === '父类')).toBe(false));
  await waitFor(() => expect((within(categoryNav).getByRole('button', { name: '新建目录' }) as HTMLButtonElement).disabled).toBe(false));

  selectPromptScope('items');
  expect(screen.getByRole('button', { name: '场景环境 / 地点与布景' }).getAttribute('aria-current')).toBe('page');
  expect(document.querySelector('[data-prompt-library-entry="nested-category-fragment"]')).toBeTruthy();
  expect(records[1]).toEqual(originalFragment);
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect(document.querySelector('[data-prompt-library-entry="nested-category-combo"]')).toBeTruthy();
  expect(recordSnapshot(records[0])).toEqual(originalSnapshot);
  expect(records[0].tags).toEqual(['子类']);
  expect(mocks.updateChain.mock.calls.map(([id]) => id)).toEqual([combo.id]);
});

it('真实主导航拖放只移动组合与片段目录的父级，保留子树和条目内容', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night garden', filled: true } } }, '2026-10-21')!;
  const combo = { ...saved, id: 'drag-combo', name: '拖动组合', type: 'preset', tags: ['子类'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  const fragment = { ...saved, id: 'drag-fragment', name: '拖动片段', type: 'scene', tags: ['片段标签'], basePrompt: 'night walk', params: { _promptLibraryDirectoryIds: ['片段子目录'] } } as unknown as PromptChain;
  const originalCombo = structuredClone(combo), originalFragment = structuredClone(fragment);
  mocks.getAllChains.mockResolvedValue([combo, fragment]);
  mocks.getPromptLibraryTagNames.mockResolvedValue(['父类', '子类']);
  categoryTree = { revision: 5, nodes: [
    { id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }, { id: '孙类', name: '孙类', parentId: '子类' },
  ] };
  directoryTree = { revision: 8, nodes: [
    { id: '片段根目录', name: '片段根目录', parentId: null }, { id: '片段子目录', name: '片段子目录', parentId: '片段根目录' }, { id: '片段孙目录', name: '片段孙目录', parentId: '片段子目录' },
  ] };

  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const categoryNav = screen.getByRole('complementary', { name: '组合分类导航' });
  await dragDirectoryToRoot(categoryNav, '分类「子类」');
  await waitFor(() => expect(mocks.saveCategoryTree).toHaveBeenCalledTimes(1));
  expect(mocks.saveCategoryTree.mock.calls[0][0].nodes).toEqual([
    { id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: null }, { id: '孙类', name: '孙类', parentId: '子类' },
  ]);
  expect(combo.tags).toEqual(originalCombo.tags);
  expect((combo.params as any)._rollContentSnapshot).toEqual((originalCombo.params as any)._rollContentSnapshot);

  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const fragmentNav = screen.getByRole('complementary', { name: '提示词目录导航' });
  await dragDirectoryToRoot(fragmentNav, '片段根目录 / 片段子目录');
  await waitFor(() => expect(mocks.saveDirectories).toHaveBeenCalledTimes(1));
  expect(mocks.saveDirectories.mock.calls[0][0].nodes).toEqual([
    { id: '片段根目录', name: '片段根目录', parentId: null }, { id: '片段子目录', name: '片段子目录', parentId: null }, { id: '片段孙目录', name: '片段孙目录', parentId: '片段子目录' },
  ]);
  expect(fragment.params).toEqual(originalFragment.params);
  expect(fragment.tags).toEqual(originalFragment.tags);
  expect(fragment.basePrompt).toBe(originalFragment.basePrompt);
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('目录拖放遇到CAS冲突会重新读取真实树，不显示保存成功且不改组合或片段数据', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'quiet room', filled: true } } }, '2026-10-21')!;
  const combo = { ...saved, id: 'cas-combo', name: '冲突组合', type: 'preset', tags: ['子类'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  const fragment = { ...saved, id: 'cas-fragment', name: '冲突片段', type: 'scene', tags: ['保留标签'], basePrompt: 'quiet room', params: { _promptLibraryDirectoryIds: ['片段子目录'] } } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([combo, fragment]);
  mocks.getPromptLibraryTagNames.mockResolvedValue(['子类']);
  categoryTree = { revision: 4, nodes: [{ id: '子类', name: '子类', parentId: '父类' }, { id: '父类', name: '父类', parentId: null }, { id: '远程组合父类', name: '远程组合父类', parentId: null }] };
  directoryTree = { revision: 6, nodes: [{ id: '片段子目录', name: '片段子目录', parentId: '片段根目录' }, { id: '片段根目录', name: '片段根目录', parentId: null }, { id: '远程片段父目录', name: '远程片段父目录', parentId: null }] };
  const originalRecords = structuredClone([combo, fragment]);

  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  mocks.saveCategoryTree.mockRejectedValueOnce(new Error('组合分类树已在其他窗口更新，请读取最新目录后重试'));
  categoryTree = { revision: 7, nodes: [{ id: '子类', name: '子类', parentId: '远程组合父类' }, { id: '父类', name: '父类', parentId: null }, { id: '远程组合父类', name: '远程组合父类', parentId: null }] };
  const categoryNav = screen.getByRole('complementary', { name: '组合分类导航' });
  await dragDirectoryToRoot(categoryNav, '分类「子类」');
  await waitFor(() => expect(screen.getByText('组合分类树已在其他窗口更新，请读取最新目录后重试', { selector: '[role="status"]' })).toBeTruthy());
  await waitFor(() => expect(within(categoryNav).getByRole('button', { name: '分类「子类」' }).title).toBe('远程组合父类 / 子类'));
  expect(document.querySelector('[role="status"][data-type="success"]')).toBeNull();

  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const fragmentNav = screen.getByRole('complementary', { name: '提示词目录导航' });
  mocks.saveDirectories.mockRejectedValueOnce(new Error('提示词目录已在其他窗口更新，请读取最新目录后重试'));
  directoryTree = { revision: 9, nodes: [{ id: '片段子目录', name: '片段子目录', parentId: '远程片段父目录' }, { id: '片段根目录', name: '片段根目录', parentId: null }, { id: '远程片段父目录', name: '远程片段父目录', parentId: null }] };
  await dragDirectoryToRoot(fragmentNav, '片段根目录 / 片段子目录');
  await waitFor(() => expect(screen.getByText('提示词目录已在其他窗口更新，请读取最新目录后重试', { selector: '[role="status"]' })).toBeTruthy());
  await waitFor(() => expect(within(fragmentNav).getByRole('button', { name: '远程片段父目录 / 片段子目录' })).toBeTruthy());
  expect(document.querySelector('[role="status"][data-type="success"]')).toBeNull();
  expect(combo.tags).toEqual(originalRecords[0].tags);
  expect((combo.params as any)._rollContentSnapshot).toEqual((originalRecords[0].params as any)._rollContentSnapshot);
  expect(fragment.params).toEqual(originalRecords[1].params);
  expect(fragment.tags).toEqual(originalRecords[1].tags);
  expect(fragment.basePrompt).toBe(originalRecords[1].basePrompt);
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('共享导航新增目录沿用当前上级，全部视图新增根目录，组合与片段内容归属不变', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'soft rain', filled: true } } }, '2026-10-21')!;
  const combo = { ...saved, id: 'create-child-combo', name: '新建测试组合', type: 'preset', tags: ['子分类'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  const fragment = { ...saved, id: 'create-child-fragment', name: '新建测试片段', type: 'scene', tags: ['片段标签'], basePrompt: 'soft rain street', params: { _promptLibraryDirectoryIds: ['片段子目录'] } } as unknown as PromptChain;
  const originalRecords = structuredClone([combo, fragment]);
  mocks.getAllChains.mockResolvedValue([combo, fragment]);
  let categoryNames = ['父分类', '子分类'];
  mocks.getPromptLibraryTagNames.mockImplementation(async () => [...categoryNames]);
  mocks.savePromptLibraryTagNames.mockImplementation(async (next: string[]) => { categoryNames = [...new Set(next)]; return categoryNames; });
  categoryTree = { revision: 2, nodes: [
    { id: '父分类', name: '父分类', parentId: null }, { id: '子分类', name: '子分类', parentId: '父分类' },
  ] };
  directoryTree = { revision: 3, nodes: [
    { id: 'fragment-root', name: '片段根目录', parentId: null }, { id: 'fragment-child', name: '片段子目录', parentId: 'fragment-root' },
  ] };

  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const categoryNav = screen.getByRole('complementary', { name: '组合分类导航' });
  fireEvent.click(within(categoryNav).getByRole('button', { name: '分类「子分类」' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '新建目录' }));
  let createDialog = await screen.findByRole('dialog', { name: '新建目录' });
  await waitFor(() => expect((within(createDialog).getByRole('textbox', { name: '新分类名称' }) as HTMLInputElement).disabled).toBe(false));
  expect((within(createDialog).getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).value).toBe('子分类');
  fireEvent.change(within(createDialog).getByRole('textbox', { name: '新分类名称' }), { target: { value: '孙分类' } });
  fireEvent.click(within(createDialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(categoryTree.nodes).toContainEqual({ id: '孙分类', name: '孙分类', parentId: '子分类' }));
  expect(combo.tags).toEqual(originalRecords[0].tags);
  expect((combo.params as any)._rollContentSnapshot).toEqual((originalRecords[0].params as any)._rollContentSnapshot);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建目录' })).toBeNull());
  fireEvent.click(within(categoryNav).getByRole('button', { name: '全部' }));
  fireEvent.click(within(categoryNav).getByRole('button', { name: '新建目录' }));
  createDialog = await screen.findByRole('dialog', { name: '新建目录' });
  await waitFor(() => expect((within(createDialog).getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).disabled).toBe(false));
  expect((within(createDialog).getByRole('combobox', { name: '新分类上级' }) as HTMLSelectElement).value).toBe('');
  fireEvent.change(within(createDialog).getByRole('textbox', { name: '新分类名称' }), { target: { value: '根组合分类' } });
  fireEvent.click(within(createDialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(categoryTree.nodes).toContainEqual({ id: '根组合分类', name: '根组合分类', parentId: null }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建目录' })).toBeNull());

  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const fragmentNav = screen.getByRole('complementary', { name: '提示词目录导航' });
  fireEvent.click(within(fragmentNav).getByRole('button', { name: '片段根目录 / 片段子目录' }));
  fireEvent.click(within(fragmentNav).getByRole('button', { name: '新建目录' }));
  let directoryDialog = await screen.findByRole('dialog', { name: '新建目录' });
  expect((within(directoryDialog).getByRole('combobox', { name: '上级目录' }) as HTMLSelectElement).value).toBe('fragment-child');
  fireEvent.change(within(directoryDialog).getByRole('textbox', { name: '名称' }), { target: { value: '片段孙目录' } });
  expect((within(directoryDialog).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('片段孙目录');
  fireEvent.click(within(directoryDialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(directoryTree.nodes).toContainEqual(expect.objectContaining({ name: '片段孙目录', parentId: 'fragment-child' })));
  fireEvent.click(within(fragmentNav).getByRole('button', { name: '全部' }));
  fireEvent.click(within(fragmentNav).getByRole('button', { name: '新建目录' }));
  directoryDialog = await screen.findByRole('dialog', { name: '新建目录' });
  expect((within(directoryDialog).getByRole('combobox', { name: '上级目录' }) as HTMLSelectElement).value).toBe('');
  fireEvent.change(within(directoryDialog).getByRole('textbox', { name: '名称' }), { target: { value: '片段根新目录' } });
  fireEvent.click(within(directoryDialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(directoryTree.nodes).toContainEqual(expect.objectContaining({ name: '片段根新目录', parentId: null })));

  expect(categoryTree.nodes.find(node => node.id === '子分类')?.parentId).toBe('父分类');
  expect(categoryNames).toEqual(['父分类', '子分类', '孙分类', '根组合分类']);
  expect(fragment.params).toEqual(originalRecords[1].params);
  expect(fragment.tags).toEqual(originalRecords[1].tags);
  expect(fragment.basePrompt).toBe(originalRecords[1].basePrompt);
  expect((combo.params as any)._rollContentSnapshot).toEqual((originalRecords[0].params as any)._rollContentSnapshot);
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('主导航标题编辑可改名和上级，删除取消或保存失败时保留目录及片段归属', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const fragment = { ...saved, id: 'edit-delete-fragment', name: '编辑删除保护片段', type: 'scene', tags: ['稳定标签'], basePrompt: 'unchanged body', params: { _promptLibraryDirectoryIds: ['fragment-child'] } } as unknown as PromptChain;
  const originalFragment = structuredClone(fragment);
  mocks.getAllChains.mockResolvedValue([fragment]);
  directoryTree = { revision: 11, nodes: [
    { id: 'fragment-root', name: '原上级', parentId: null }, { id: 'fragment-child', name: '待编辑目录', parentId: 'fragment-root' },
  ] };
  await setup('prompts');
  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const nav = screen.getByRole('complementary', { name: '提示词目录导航' });
  fireEvent.click(within(nav).getByRole('button', { name: '原上级 / 待编辑目录' }));
  fireEvent.click(within(nav).getByRole('button', { name: '重命名目录' }));
  const editDialog = await screen.findByRole('dialog', { name: '编辑目录' });
  expect((within(editDialog).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('待编辑目录');
  expect((within(editDialog).getByRole('combobox', { name: '上级目录' }) as HTMLSelectElement).value).toBe('fragment-root');
  fireEvent.change(within(editDialog).getByRole('textbox', { name: '名称' }), { target: { value: '已重命名目录' } });
  fireEvent.change(within(editDialog).getByRole('combobox', { name: '上级目录' }), { target: { value: '' } });
  fireEvent.click(within(editDialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(directoryTree.nodes.find(node => node.id === 'fragment-child')).toMatchObject({ name: '已重命名目录', parentId: null }));
  expect(fragment.params).toEqual(originalFragment.params);
  expect(fragment.basePrompt).toBe(originalFragment.basePrompt);

  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(within(nav).getByRole('button', { name: '删除目录' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(directoryTree.nodes.some(node => node.id === 'fragment-child')).toBe(true);
  expect(mocks.saveDirectories).toHaveBeenCalledTimes(1);

  mocks.confirm.mockResolvedValueOnce(true);
  mocks.saveDirectories.mockRejectedValueOnce(new Error('目录并发保存失败'));
  fireEvent.click(within(nav).getByRole('button', { name: '删除目录' }));
  await waitFor(() => expect(screen.getByText('目录并发保存失败', { selector: '[role="status"]' })).toBeTruthy());
  expect(directoryTree.nodes.some(node => node.id === 'fragment-child')).toBe(true);
  expect(document.querySelector('[role="status"][data-type="success"]')).toBeNull();
  expect(fragment.params).toEqual(originalFragment.params);
  expect(fragment.tags).toEqual(originalFragment.tags);
  expect(fragment.basePrompt).toBe(originalFragment.basePrompt);
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('片段目录独立导航保留搜索标签，其他范围不受目录限制且不残留重复管理入口', async () => {
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night sky', filled: true } } }, '2026-10-21')!;
  mocks.getAllChains.mockResolvedValue([
    { ...saved, id: 'night-scene', name: '夜景', type: 'scene', basePrompt: 'night street', params: { _promptLibraryPurposes: ['time'] }, tags: ['夜间'] },
    { ...saved, id: 'night-pose', name: '夜间动作', type: 'pose', basePrompt: 'night walk', params: { _promptLibraryPurposes: ['time'] }, tags: ['夜间'] },
    { ...saved, id: 'night-untagged', name: '未分类动作', type: 'pose', basePrompt: 'night sit', tags: [] },
    { ...saved, id: 'night-original', name: '夜间原文', type: 'preset', basePrompt: 'night fog', tags: ['夜间'], params: { _collectedPrompt: 1, _promptLibraryPurposes: [] } },
    { ...saved, id: 'night-combination', name: '夜间组合', type: 'preset', tags: ['夜间'], params: { _rollContentSnapshot: snapshot } },
  ]);
  await setup('prompts');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索名称、正文或标签' }), { target: { value: 'night' } });
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'items' } });
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  openPurposeGroup('场景与环境'); fireEvent.click(screen.getByRole('button', { name: '时间与季节' }));
  expect(screen.queryByRole('button', { name: '管理目录' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.click(screen.getByRole('button', { name: '全部' }));
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  expect(screen.queryByRole('button', { name: '查看夜间原文' })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看夜间组合' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '场景环境 / 地点与布景' }));
  expect(screen.getByRole('button', { name: '收起目录' }).title).toContain('场景环境 / 地点与布景');
  expect(screen.getByRole('button', { name: '查看夜景' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看夜间动作' })).toBeNull();
  expect((screen.getByRole('searchbox', { name: '搜索名称、正文或标签' }) as HTMLInputElement).value).toBe('night');
  fireEvent.click(screen.getByRole('button', { name: '人物 / 动作与姿态' }));
  expect(screen.getByRole('button', { name: '收起目录' }).title).toContain('人物 / 动作与姿态');
  expect(screen.getByRole('button', { name: '查看夜间动作' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看未分类动作' })).toBeNull();
  expect((screen.getByRole('searchbox', { name: '搜索名称、正文或标签' }) as HTMLInputElement).value).toBe('night');
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  openPurposeGroup('场景与环境'); expect(screen.getByRole('button', { name: '时间与季节' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: '查看夜间原文' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  expect(screen.getByRole('button', { name: '查看夜间组合' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
  expect(screen.getByRole('button', { name: '夜间' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('button', { name: '管理分类' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '片段用途' })).toBeNull();
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it.each(['all', 'originals'] as const)('旧浏览范围 %s 只读回落到片段，不重写本端旧偏好', async scope => {
  const preference = { scope, sort: 'name' };
  localStorage.setItem('nai-prompt-library-browse', JSON.stringify(preference));
  await setup('prompts');
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  expect(localStorage.getItem('nai-prompt-library-browse')).toBe(JSON.stringify(preference));
});

it.each(['items', 'saved'] as const)('提示词卡片删除%s：取消与失败保留详情，成功仅移除目标且不触发使用编辑', async scope => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  const target = { ...saved, id: 'delete-target', name: '删除目标', type: scope === 'items' ? 'scene' : 'preset',
    params: scope === 'saved' ? { _rollContentSnapshot: snapshot } : saved.params } as unknown as PromptChain;
  const other = { ...target, id: 'delete-other', name: '保留记录' };
  let records = [target, other];
  mocks.getAllChains.mockImplementation(async () => records);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await setup('prompts');
    fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: scope } });
    fireEvent.click(screen.getByRole('button', { name: '查看删除目标' }));
    const detail = await screen.findByLabelText('删除目标', { selector: 'aside' });
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '删除「删除目标」' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '删除“删除目标”？', confirmLabel: '确认删除', tone: 'danger' }));
    expect(mocks.deleteChain).not.toHaveBeenCalled();
    expect(screen.getByLabelText('删除目标', { selector: 'aside' })).toBe(detail);

    mocks.deleteChain.mockRejectedValueOnce(new Error('合成删除失败'));
    fireEvent.click(screen.getByRole('button', { name: '删除「删除目标」' }));
    expect(await screen.findByText('删除失败：合成删除失败')).toBeTruthy();
    expect(mocks.deleteChain).toHaveBeenCalledExactlyOnceWith(target.id);
    expect(screen.getByLabelText('删除目标', { selector: 'aside' })).toBe(detail);
    expect(screen.getByRole('button', { name: '查看删除目标' })).toBeTruthy();

    mocks.deleteChain.mockImplementationOnce(async (id: string) => { records = records.filter(chain => chain.id !== id); });
    fireEvent.click(screen.getByRole('button', { name: '删除「删除目标」' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '查看删除目标' })).toBeNull());
    expect(mocks.deleteChain.mock.calls).toEqual([[target.id], [target.id]]);
    expect(screen.queryByLabelText('删除目标', { selector: 'aside' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看保留记录' })).toBeTruthy();
    expect(records).toEqual([other]);
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '使用提示词' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '搭配' })).toBeNull();
    expect(mocks.updateChain).not.toHaveBeenCalled();
    expect(mocks.createChainWithData).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

it('收藏首次进入复用有效串快照，强制刷新不沿用旧串快照', async () => {
  const collection = await import('../../services/collectionFavorites');
  const revision = vi.spyOn(collection, 'collectionRevision').mockReturnValue(0);
  try {
    mocks.getAllChains.mockResolvedValue([saved]);
    await setup('inspiration');
    expect(mocks.getAllInspirations).toHaveBeenCalledWith(expect.objectContaining({ id: 'owner' }), [saved]);
    mocks.getAllInspirations.mockClear();
    await act(async () => { window.dispatchEvent(new Event('nai-collection-changed')); });
    expect(mocks.getAllInspirations).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'owner' }), undefined);
  } finally { revision.mockRestore(); }
});

it.each([false, true])('分享包回读使用真实刷新返回约定，刷新失败=%s 时明确报告已保存', async fails => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await screen.findByRole('button', { name: '回读合成分享包' });
  if (fails) mocks.getAllChains.mockRejectedValueOnce(new Error('合成列表查询失败'));
  else mocks.getAllChains.mockResolvedValueOnce([saved]);
  fireEvent.click(screen.getByRole('button', { name: '回读合成分享包' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(fails
    ? '风格串已保存，列表刷新失败：风格串列表加载失败，请稍后重试'
    : '合成分享包已回读'));
});

it('内容库粘贴原文直接保存，查看回执打开原文详情且不修改实验室或拆分提示词', async () => {
  const text = '  {{snow}}, 1.2::hair::\r\n[smile]  ';
  mocks.createChainWithData.mockImplementation(async (name, description, data, type) => ({ ...saved, ...data, id: data.params?._collectedCategory ? 'organized-fragment' : 'captured', name, description, type }));
  await setup('prompts');
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  fireEvent.paste(screen.getByRole('textbox', { name: '提示词原文' }), { clipboardData: { getData: () => text } });
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('{{snow}}, 1.2::hair::', '', { type: 'preset', name: '{{snow}}, 1.2::hair::', tags: [], basePrompt: text, params: { _collectedPrompt: 1, _promptLibraryPurposes: [] } }, 'preset'));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '粘贴收录' })).toBeNull());
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  fireEvent.click(await screen.findByRole('button', { name: '查看' }));
  const detail = await screen.findByRole('complementary', { name: '{{snow}}, 1.2::hair::' });
  expect(detail.textContent).toContain(text);
  expect(screen.queryByRole('button', { name: '查看{{snow}}, 1.2::hair::' })).toBeNull();
  fireEvent.click(within(detail).getByRole('button', { name: '编辑' }));
  const editor = await screen.findByRole('dialog', { name: '编辑原文' });
  fireEvent.change(within(editor).getByRole('combobox', { name: '分类' }), { target: { value: 'fragment' } });
  fireEvent.click(within(editor).getByText('选择目录'));
  fireEvent.click(within(editor).getByRole('button', { name: '展开目录「场景环境」' }));
  fireEvent.click(within(editor).getByRole('checkbox', { name: '场景环境 / 地点与布景' }));
  fireEvent.click(within(editor).getByRole('button', { name: '另存片段' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledTimes(2));
  expect(mocks.createChainWithData).toHaveBeenNthCalledWith(2, '{{snow}}, 1.2::hair::', '', expect.objectContaining({
    type: 'preset', basePrompt: text, params: expect.objectContaining({ _collectedPrompt: 1, _collectedCategory: 'general', _promptLibraryDirectoryIds: [LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS.scene], _promptLibraryPurposes: [] }),
  }), 'preset');
  expect(detail.textContent).toContain(text);
  expect(mocks.updateChain).not.toHaveBeenCalled();
  expect(mocks.deleteChain).not.toHaveBeenCalled();
  const originalDetail = await screen.findByRole('complementary', { name: '{{snow}}, 1.2::hair::' });
  fireEvent.click(within(originalDetail).getByRole('button', { name: '送到实验室' }));
  const useDialog = await screen.findByRole('dialog', { name: '使用提示词' });
  fireEvent.click(within(useDialog).getByRole('button', { name: '使用' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('playground'));
  expect(`${mocks.editorDraft?.basePrompt || ''} ${mocks.editorDraft?.variableValues?.subject || ''}`).toContain('{{snow}}');
  expect(screen.queryByRole('dialog', { name: '随机搭配' })).toBeNull();
});

it('提取候选接入现有列表，保存回执丢失后重试沿用身份且不重存成功项', async () => {
  const dictionary = await import('../../services/tagDictionary');
  const dictionarySpies = [
    vi.spyOn(dictionary, 'preloadTagDictionary').mockImplementation(() => {}),
    vi.spyOn(dictionary, 'searchTagDictionary').mockResolvedValue([]),
    vi.spyOn(dictionary, 'lookupTagTranslations').mockResolvedValue(new Map()),
    vi.spyOn(dictionary, 'lookupTagCatalogEntries').mockResolvedValue(new Map()),
  ];
  const config = vi.spyOn(promptAgentService, 'getConfig').mockResolvedValue({
    provider: 'test-provider', model: 'test-model', imageInput: false, configured: true,
    configuredProviders: ['test-provider'], policyVersion: 'test', policyFingerprint: 'test', runtimeStartedAt: 0,
  });
  const extract = vi.spyOn(promptAgentService, 'extractCandidates').mockResolvedValue({
    mode: 'text', provider: 'test-provider', model: 'test-model',
    items: [
      { kind: 'wardrobe', directoryIds: [LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS.wardrobe], name: '合成红裙', prompt: '1.2::red dress::' },
      { kind: 'scene', directoryIds: [LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS.scene], name: '合成咖啡馆', prompt: 'cafe' },
    ], unclassified: { name: '未归类内容', prompt: 'masterpiece' },
  });
  const stored = new Map<string, PromptChain>();
  let loseReceipt = true;
  mocks.createChainWithData.mockImplementation(async (name, description, data, type, creationId) => {
    expect(creationId).toMatch(/^[a-f\d-]{36}$/i);
    if (!stored.has(creationId)) stored.set(creationId, { ...saved, ...data, id: creationId, name, description, type });
    if (type === 'wardrobe' && loseReceipt) { loseReceipt = false; throw new Error('合成保存回执丢失'); }
    return stored.get(creationId);
  });
  try {
    await setup('prompts');
    fireEvent.click(screen.getByRole('button', { name: 'AI 提取分类' }));
    const dialog = await screen.findByRole('dialog', { name: 'AI 提取分类' });
    expect(extract).not.toHaveBeenCalled();
    expect(mocks.createChainWithData).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('提示词原文'), { target: { value: '1.2::red dress::, cafe, masterpiece' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '按文字分类' }));
    await within(dialog).findByDisplayValue('合成红裙');
    const listReadsBeforeSave = mocks.getAllChains.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: '保存所选片段（2）' }));
    await within(dialog).findByText(/合成保存回执丢失/);
    expect(mocks.createChainWithData).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByDisplayValue('合成咖啡馆')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '保存所选片段（1）' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 提取分类' })).toBeNull());
    const wardrobeCalls = mocks.createChainWithData.mock.calls.filter(call => call[3] === 'wardrobe');
    expect(wardrobeCalls).toHaveLength(2);
    expect(wardrobeCalls[0][4]).toBe(wardrobeCalls[1][4]);
    expect(mocks.createChainWithData.mock.calls.filter(call => call[3] === 'scene')).toHaveLength(1);
    expect(stored.size).toBe(2);
    expect(wardrobeCalls[1][2]).toMatchObject({ basePrompt: '1.2::red dress::', variableValues: { subject: '' }, modules: [] });
    expect(mocks.getAllChains).toHaveBeenCalledTimes(listReadsBeforeSave);
    expect(mocks.updateChain).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: '查看合成红裙' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看合成咖啡馆' })).toBeTruthy();
    expect(screen.getByTestId('view').textContent).toBe('content-library');
  } finally { config.mockRestore(); extract.mockRestore(); dictionarySpies.forEach(spy => spy.mockRestore()); }
});

it('App读取实际用户目录后，粘贴收录将所选深层目录归属保存到真实创建回调', async () => {
  const directories = { revision: 7, nodes: [{ id: 'own-root', parentId: null, name: '我的素材' }, { id: 'own-leaf', parentId: 'own-root', name: '局部描述', target: 'character' as const }] };
  mocks.loadDirectories.mockResolvedValue(directories);
  mocks.createChainWithData.mockImplementation(async (name, description, data, type) => ({ ...saved, ...data, id: 'custom-captured', name, description, type }));
  await setup('prompts');
  const reads = mocks.getAllChains.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  const dialog = await screen.findByRole('dialog', { name: '粘贴收录' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: '提示词原文' }), { target: { value: '1.2::blue eyes::' } });
  fireEvent.change(within(dialog).getByRole('combobox', { name: '分类' }), { target: { value: 'fragment' } });
  fireEvent.click(within(dialog).getByText('选择目录'));
  fireEvent.click(within(dialog).getByRole('button', { name: '展开目录「我的素材」' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '我的素材 / 局部描述' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存片段' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('1.2::blue eyes::', '', expect.objectContaining({ basePrompt: '1.2::blue eyes::', params: { _collectedPrompt: 1, _collectedCategory: 'general', _promptLibraryDirectoryIds: ['own-leaf'], _promptLibraryPurposes: [] } }), 'preset'));
  expect(mocks.loadDirectories).toHaveBeenCalled();
  expect(mocks.getAllChains).toHaveBeenCalledTimes(reads);
  expect(screen.getByTestId('view').textContent).toBe('content-library');
  expect(screen.queryByTestId('editor')).toBeNull();
});

it('粘贴原文可选指定分类，直接创建对应条目库记录', async () => {
  const text = 'snow, night';
  mocks.createChainWithData.mockImplementation(async (name, description, data, type) => ({ ...saved, ...data, id: 'captured-category', name, description, type }));
  await setup('prompts');
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  fireEvent.paste(screen.getByRole('textbox', { name: '提示词原文' }), { clipboardData: { getData: () => text } });
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'fragment' } });
  fireEvent.click(screen.getByText('选择目录'));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「人物」' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '人物 / 外貌与身体' }));
  fireEvent.click(screen.getByRole('button', { name: '保存片段' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('snow, night', '', { type: 'preset', name: 'snow, night', tags: [], basePrompt: text, params: { _collectedPrompt: 1, _collectedCategory: 'general', _promptLibraryDirectoryIds: [LEGACY_PROMPT_LIBRARY_DIRECTORY_IDS.appearance], _promptLibraryPurposes: [] } }, 'preset'));
});

it('主库默认只显示片段，真实收录回执可独立打开原文详情', async () => {
  mocks.getAllChains.mockResolvedValue([
    { ...saved, id: 'raw', name: '旧原文', type: 'preset', basePrompt: 'forest, 1.3::mist::', params: { _collectedPrompt: 1, _promptLibraryPurposes: [] }, tags: ['自然'] },
    { ...saved, id: 'fragment', name: '旧片段', type: 'scene', basePrompt: 'forest_path', tags: ['自然'] },
    { ...saved, id: 'other', name: '另一个片段', type: 'scene', basePrompt: 'beach' },
  ]);
  await setup('prompts');
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索名称、正文或标签' }), { target: { value: 'forest' } });
  expect(screen.queryByRole('button', { name: '查看旧原文' })).toBeNull();
  expect(screen.getByRole('button', { name: '查看旧片段' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看另一个片段' })).toBeNull();
  mocks.createChainWithData.mockImplementationOnce(async (name, description, data, type) => ({ ...saved, ...data, id: 'captured-with-tags', name, description, type }));
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: 'new_sky' } });
  openPurposeGroup('场景与环境'); fireEvent.click(screen.getByRole('button', { name: '自然与天气' }));
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('new_sky', '', expect.objectContaining({ tags: [], params: expect.objectContaining({ _promptLibraryPurposes: ['nature'] }), basePrompt: 'new_sky' }), 'preset'));
  fireEvent.click(await screen.findByRole('button', { name: '查看' }));
  const detail = await screen.findByRole('complementary', { name: 'new_sky' });
  expect(detail.textContent).toContain('new_sky');
  expect((screen.getByRole('searchbox', { name: '搜索名称、正文或标签' }) as HTMLInputElement).value).toBe('');
  expect(document.querySelector('[data-prompt-library-entry="captured-with-tags"]')).toBeNull();
  expect(mocks.updateChain).not.toHaveBeenCalled();
});

it('库页片段只维护资料，从实验室目标取用可撤销且不修改源记录', async () => {
  const entry = { ...saved, id: 'use-entry', name: '待用资料', type: 'scene', basePrompt: 'silent_night', negativePrompt: '', params: { ...saved.params, _promptLibraryPurposes: ['place'] } } as PromptChain;
  mocks.getAllChains.mockResolvedValue([entry]);
  await setup('prompts');
  expect(screen.queryByTestId('editor')).toBeNull();
  selectPromptScope('items');
  fireEvent.click(screen.getByRole('button', { name: '查看待用资料' }));
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '保存并使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '送到实验室' })).toBeNull();
  expect(mocks.updateChain).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  await screen.findByTestId('editor');
  const before = structuredClone(mocks.editorDraft);
  fireEvent.click(screen.getByRole('button', { name: '使用提示词' }));
  const dialog = await screen.findByRole('dialog', { name: '使用提示词' });
  fireEvent.click(within(dialog).getByRole('button', { name: /待用资料/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '使用' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues?.subject).toContain('silent_night'));
  expect(screen.getByTestId('view').textContent).toBe('playground');
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues).toEqual(before?.variableValues));
  expect(mocks.editorDraft?.basePrompt).toBe(before?.basePrompt);
  expect(mocks.editorDraft?.params).toEqual(before?.params);
  expect(mocks.updateChain).not.toHaveBeenCalled();
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
});

it('旧多人组合编辑先选择角色，所选角色另存新组合不覆盖旧组合', async () => {
  const snapshot = contentSnapshotOf({ picks: { appearance: { kind: 'appearance', text: 'silver_hair', filled: true }, scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  snapshot.roles = [ { ...snapshot.roles[0], key: 'one', name: '人物甲' }, { ...snapshot.roles[0], key: 'two', name: '人物乙', sections: { appearance: 'black_hair' } } ];
  const original = { ...saved, id: 'old-multiple', name: '双人旧组合', type: 'preset', tags: ['旧组合标签'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([original]);
  mocks.createChainWithData.mockImplementationOnce(async (name, description, data, type) => ({ ...saved, ...data, id: 'new-combination', name, description, type }));
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '编辑双人旧组合' }));
  const dialog = await screen.findByRole('dialog', { name: '选择组合中的角色' });
  expect(screen.queryByRole('dialog', { name: '搭配' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '人物乙' }));
  const roll = await screen.findByRole('dialog', { name: '搭配' });
  await waitFor(() => expect(roll.querySelector('[data-content-roll-row="directory:person-appearance"]')?.textContent).toContain('black_hair'));
  expect(roll.querySelector('[data-content-roll-row="directory:person-appearance"]')?.textContent).not.toContain('silver_hair');
  expect(roll.querySelector('[data-content-roll-row="directory:environment-scene"]')?.textContent).toContain('night');
  fireEvent.click(within(roll).getByRole('button', { name: '保存组合' }));
  expect((within(roll).getByRole('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('旧组合标签');
  fireEvent.click(within(roll).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledOnce());
  expect(mocks.createChainWithData.mock.calls[0][2]).toMatchObject({ tags: ['旧组合标签'] });
  expect(mocks.updateChain).not.toHaveBeenCalled();
  expect(snapshot.roles[0].sections.appearance).toBe('silver_hair');
  expect(snapshot.roles).toHaveLength(2);
});

it.each([[' 夜景，常用,夜景 ', ['夜景', '常用']], ['', []]] as const)('新组合保存标签 %s，创建回执可直接用于库页筛选', async (text, tags) => {
  mocks.getAllChains.mockResolvedValue([{ ...saved, id: 'scene-fragment', name: '夜景片段', type: 'scene', basePrompt: 'night', params: { ...saved.params, _promptLibraryPurposes: ['place'] } }]);
  mocks.createChainWithData.mockImplementationOnce(async (name, description, data, type) => ({ ...saved, ...data, id: 'tagged-combination', name, description, type }));
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '搭配' }));
  const roll = await screen.findByRole('dialog', { name: '搭配' });
  fireEvent.change(within(roll).getByRole('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  fireEvent.click(within(roll).getByRole('button', { name: '抽一次' }));
  fireEvent.click(within(roll).getByRole('button', { name: '保存组合' }));
  fireEvent.change(within(roll).getByRole('textbox', { name: '给这条记录起名' }), { target: { value: '带标签组合' } });
  fireEvent.change(within(roll).getByRole('textbox', { name: '组合标签' }), { target: { value: text } });
  fireEvent.click(within(roll).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('带标签组合', expect.any(String), expect.objectContaining({ tags: [...tags] }), 'preset'));
  expect(mocks.updateChain).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  selectPromptScope('saved');
  expect(await screen.findByRole('button', { name: '查看带标签组合' })).toBeTruthy();
  if (tags.length) {
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '夜景' }));
    expect(screen.getByRole('button', { name: '查看带标签组合' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看夜景片段' })).toBeNull();
  }
});

it.each([false, true])('编辑已有组合保存时继承标签，另存=%s', async copy => {
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  const original = { ...saved, id: 'existing-combination', name: '有标签旧组合', type: 'preset', tags: ['夜景', '保留'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([original]);
  mocks.createChainWithData.mockImplementationOnce(async (name, description, data, type) => ({ ...saved, ...data, id: 'copied-combination', name, description, type }));
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '编辑有标签旧组合' }));
  const roll = await screen.findByRole('dialog', { name: '搭配' });
  await waitFor(() => expect(roll.querySelector('[data-content-roll-row="directory:environment-scene"]')?.textContent).toContain('night'));
  fireEvent.click(within(roll).getByRole('button', { name: '保存组合' }));
  expect((within(roll).getByRole('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('夜景, 保留');
  fireEvent.click(within(roll).getByRole('button', { name: copy ? '另存为新组合' : '保存修改' }));
  if (copy) {
    await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledWith('有标签旧组合', expect.any(String), expect.objectContaining({ tags: ['夜景', '保留'] }), 'preset'));
    expect(mocks.updateChain).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledWith(original.id, expect.objectContaining({ tags: ['夜景', '保留'] })));
    expect(mocks.createChainWithData).not.toHaveBeenCalled();
  }
  expect(original.tags).toEqual(['夜景', '保留']);
});

it('组合详情只修改标签，保留全部内容与封面并即时进入更新后的标签筛选', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', negative: 'day', filled: true } } }, '2026-10-21')!;
  const original = { ...saved, id: 'detail-combination', name: '详情标签组合', type: 'preset', tags: ['旧标签'],
    params: { ...saved.params, seed: 42, _rollContentSnapshot: snapshot }, previewImage: '/api/assets/covers/keep.png' } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([original]);
  mocks.updateChain.mockImplementationOnce(async (_id: string, updates: Partial<PromptChain>) => {
    mocks.getAllChains.mockResolvedValue([{ ...original, ...updates }]);
  });
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '查看详情标签组合' }));
  const detail = await screen.findByLabelText('详情标签组合', { selector: 'aside' });
  fireEvent.click(within(detail).getByRole('button', { name: '编辑标签' }));
  fireEvent.change(within(detail).getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '新标签，常用,新标签' } });
  fireEvent.click(within(detail).getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledExactlyOnceWith(original.id, { tags: ['新标签', '常用'] }));
  await within(detail).findByRole('button', { name: '编辑标签' });
  expect(within(detail).getByText('新标签')).toBeTruthy();
  expect(within(detail).getByText('night')).toBeTruthy();
  expect(decodeURIComponent(within(detail).getByRole('img', { name: '详情标签组合' }).getAttribute('src') || '')).toContain('/api/assets/covers/keep.png');
  fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(await screen.findByRole('button', { name: '新标签' }));
  expect(screen.getByRole('button', { name: '查看详情标签组合' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '旧标签' })).toBeNull();
  expect(original.params).toEqual(expect.objectContaining({ _rollContentSnapshot: snapshot }));
  expect(original.tags).toEqual(['旧标签']);
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
});

it('组合详情清空自定义标签仍保留内部状态且不改创作内容', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', negative: 'day', filled: true } } }, '2026-10-21')!;
  const original = { ...saved, id: 'internal-tag-combination', name: '带内部状态组合', type: 'preset',
    tags: ['__内部__', '旧分类', '另一分类'], basePrompt: 'keep original prompt', negativePrompt: 'keep negative',
    params: { ...saved.params, seed: 42, _rollContentSnapshot: snapshot }, previewImage: '/api/assets/covers/internal-keep.png' } as unknown as PromptChain;
  let stored = structuredClone(original);
  mocks.getAllChains.mockImplementation(async () => [stored]);
  mocks.updateChain.mockImplementationOnce(async (_id: string, updates: Partial<PromptChain>) => { stored = { ...stored, ...updates }; });
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: '查看带内部状态组合' }));
  const detail = await screen.findByLabelText('带内部状态组合', { selector: 'aside' });
  expect(within(detail).queryByText('__内部__')).toBeNull();
  expect(within(detail).getByText('旧分类')).toBeTruthy();
  expect(within(detail).getByText('另一分类')).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: '编辑标签' }));
  const field = within(detail).getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement;
  expect(field.value).toBe('旧分类, 另一分类');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.click(within(detail).getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledExactlyOnceWith(original.id, { tags: ['__内部__'] }));
  await within(detail).findByText('暂无标签');
  expect(stored).toEqual({ ...original, tags: ['__内部__'] });
  expect(within(detail).getByText('night')).toBeTruthy();
  expect(decodeURIComponent(within(detail).getByRole('img', { name: '带内部状态组合' }).getAttribute('src') || '')).toContain(original.previewImage);
  expect(mocks.createChainWithData).not.toHaveBeenCalled();
});

it.each(['global', 'character'] as const)('实验室 %s 按五组用途填入当前目标，保留其它内容并可撤销', async entry => {
  const directoryId = 'custom-clothing';
  const key = 'purpose:clothing' as const;
  mocks.loadDirectories.mockResolvedValue({ revision: 4, nodes: [{ id: directoryId, parentId: null, name: '本次自选服装', target: entry }, { id: 'custom-scene', parentId: null, name: '当前背景', target: 'global' }] });
  mocks.getAllChains.mockResolvedValue([
    { ...saved, id: 'wardrobe', type: 'preset', basePrompt: 'new_dress', negativePrompt: 'new_negative', params: { _promptLibraryDirectoryIds: [directoryId], _promptLibraryPurposes: ['clothing'] } },
    { ...saved, id: 'scene', type: 'preset', basePrompt: 'new_scene', params: { _promptLibraryDirectoryIds: ['custom-scene'], _promptLibraryPurposes: ['place'] } },
  ]);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  await screen.findByTestId('editor');
  const params = { ...source.params, seed: 42, _promptSections: { scene: 'keep_scene', extra: 'keep_extra', ...(entry === 'global' ? { [key]: 'old_dress' } : {}) }, characters: [
    { id: 'first', prompt: 'first text', x: .2, y: .5 },
    { id: 'second', prompt: 'second text', x: .8, y: .5, sections: { [key]: 'role_dress', appearance: 'keep_role_hair' } },
  ] };
  const originalSubject = entry === 'global' ? 'keep_scene, keep_extra, old_dress' : 'keep_scene, keep_extra';
  await act(async () => { await mocks.updatePlayground!('playground', { basePrompt: 'keep_artist', negativePrompt: 'keep_negative', variableValues: { subject: originalSubject }, params }); });
  fireEvent.click(screen.getByRole('button', { name: entry === 'global' ? '全局随机搭配' : '角色二随机搭配' }));
  const roll = await screen.findByRole('dialog', { name: '随机搭配' });
  for (const label of ['主体与外观', '动作与关系', '场景与环境', '镜头与光影', '画风与表现']) openPurposeGroup(label, roll);
  const participation = within(roll).getAllByRole('checkbox', { name: /^参与「/ });
  expect(participation.some(check => check.getAttribute('aria-label')?.includes('服饰与配件'))).toBe(true);
  for (const check of participation) if (!check.getAttribute('aria-label')?.includes('服饰与配件')) fireEvent.click(check);
  fireEvent.click(within(roll).getByRole('button', { name: '抽一次' }));
  fireEvent.click(within(roll).getByRole('button', { name: '使用' }));
  expect(within(roll).getByText((entry === 'global' ? 'old_dress' : 'role_dress') + ' → new_dress')).toBeTruthy();
  fireEvent.click(within(roll).getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(entry === 'global' ? mocks.editorDraft?.params._promptSections?.[key] : mocks.editorDraft?.params.characters?.[1].sections?.[key]).toBe('new_dress'));
  expect(mocks.editorDraft?.basePrompt).toBe('keep_artist');
  expect(mocks.editorDraft?.negativePrompt).toBe('keep_negative');
  expect(mocks.editorDraft?.params.seed).toBe(42);
  expect(mocks.editorDraft?.params._promptSections).toMatchObject({ scene: 'keep_scene', extra: 'keep_extra' });
  if (entry === 'global') {
    expect(mocks.editorDraft?.params.characters).toEqual(params.characters);
    expect(mocks.editorDraft?.variableValues?.subject).toBe('keep_scene, keep_extra, new_dress');
  } else {
    expect(mocks.editorDraft?.params._promptSections).toEqual(params._promptSections);
    expect(mocks.editorDraft?.params.characters?.[0]).toEqual(params.characters[0]);
    expect(mocks.editorDraft?.params.characters?.[1].sections?.appearance).toBe('keep_role_hair');
    expect(mocks.editorDraft?.variableValues?.subject).toBe(originalSubject);
  }
  fireEvent.click(screen.getByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(mocks.editorDraft?.params).toEqual(params));
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  fireEvent.click(screen.getByRole('button', { name: '搭配' }));
  expect(await screen.findByRole('dialog', { name: '搭配' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '选择抽取范围' })).toBeTruthy();
});

it('内容 Roll 保留旧手写正文与参数，使用统一确认后可完整撤销并返回库页', async () => {
  mocks.getAllChains.mockResolvedValue([{ ...saved, id: 'scene', type: 'scene', basePrompt: 'night', params: { ...saved.params, _promptLibraryPurposes: ['place'] }, negativePrompt: 'day' }]);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  await screen.findByTestId('editor');
  await act(async () => { await mocks.updatePlayground!('playground', { variableValues: { subject: 'legacy_subject' }, params: { ...source.params, seed: 42 } }); });
  fireEvent.click(screen.getByRole('button', { name: 'content-roll' }));
  fireEvent.click(await screen.findByRole('button', { name: '抽一次' }));
  expect(screen.getByRole('dialog', { name: '搭配' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '搭配' })).getByRole('button', { name: '送到实验室' }));
  const useDialog = await screen.findByRole('dialog', { name: '使用提示词' });
  expect(screen.getByTestId('view').textContent).toBe('content-library');
  expect(within(useDialog).queryByRole('searchbox')).toBeNull();
  fireEvent.click(within(useDialog).getByRole('button', { name: '使用' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues?.subject).toBe('legacy_subject, night'));
  expect(mocks.editorDraft?.params).toMatchObject({ seed: 42, _promptSections: { extra: 'legacy_subject', 'purpose:place': 'night', sectionNegatives: { 'purpose:place': 'day' } } });
  fireEvent.click(screen.getByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(mocks.editorDraft?.variableValues?.subject).toBe('legacy_subject'));
  expect(mocks.editorDraft?.params.seed).toBe(42);
  expect(mocks.editorDraft?.params._promptSections?.['purpose:place']).toBeUndefined();
  expect(screen.getByTestId('view').textContent).toBe('playground');
  fireEvent.click(await screen.findByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('content-library'));
});

it('旧组合库入口映射到组合库，载入打开面板，关闭保留原库和已载入组合', async () => {
  mocks.getAllChains.mockResolvedValue([{ ...saved, id: 'combo', type: 'preset', name: '已存夜景', params: {
    _rollContentSnapshot: contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21'),
  } }]);
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: 'content-roll-library' }));
  fireEvent.click(await screen.findByRole('button', { name: /编辑(已存夜景|合成内容组合)/ }));
  expect(await screen.findByRole('dialog', { name: '搭配' })).toBeTruthy();
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('saved');
  expect(document.querySelector('[data-content-roll-row="directory:environment-scene"]')?.textContent).toContain('night');
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  expect(screen.queryByRole('dialog', { name: '搭配' })).toBeNull();
  expect(screen.getByRole('button', { name: '编辑已存夜景' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '搭配' }));
  expect(document.querySelector('[data-content-roll-row="directory:environment-scene"]')?.textContent).toContain('night');
});

it('内容库 Roll 弹窗可将组合写入已有风格串并保留原主体', async () => {
  mocks.getAllChains.mockResolvedValue([
    { ...saved, variableValues: { subject: 'beside a red car' } },
    { ...saved, id: 'saved-content', type: 'preset', name: '合成内容组合', params: {
      _rollContentSnapshot: contentSnapshotOf({ picks: { scene: { kind: 'scene', text: 'night', negative: 'day', filled: true } } }, '2026-10-21'),
    } },
  ]);
  await setup('prompts');
  selectPromptScope('saved');
  fireEvent.click(screen.getByRole('button', { name: 'content-roll-library' }));
  fireEvent.click(await screen.findByRole('button', { name: /编辑(已存夜景|合成内容组合)/ }));
  await screen.findByRole('dialog', { name: '搭配' });
  fireEvent.change(screen.getByRole('combobox', { name: '选择写入的风格串' }), { target: { value: saved.id } });
  fireEvent.click(screen.getByRole('button', { name: '写入风格串…' }));
  fireEvent.click(screen.getByRole('button', { name: '写入这条风格串' }));
  await waitFor(() => expect(mocks.updateChain).toHaveBeenCalledWith(saved.id, expect.objectContaining({
    variableValues: { subject: 'beside a red car, night' },
    params: expect.objectContaining({ _promptSections: expect.objectContaining({ 'directory:environment-scene': 'night', sectionNegatives: { 'directory:environment-scene': 'day' } }) }),
  })));
  expect(screen.getByRole('dialog', { name: '搭配' })).toBeTruthy();
});

it('提示词库创建使用完整回执并留在当前库，不重新下载整库或打开实验室', async () => {
  await setup('prompts');
  const readsBeforeCreate = mocks.getAllChains.mock.calls.length;
  mocks.createChainWithData.mockResolvedValueOnce({ ...saved, id: 'new-wardrobe', type: 'wardrobe' });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '管理提示词' }));
  fireEvent.click(await screen.findByRole('button', { name: '新建合成服饰' }));
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

it('外部组内连续保存独立风格串时更新本地列表，不跳编辑器也不等整库刷新', async () => {
  await setup();
  const secondSaved = { ...saved, id: 'server-saved-2', name: '合成作品 P2', basePrompt: 'second synthetic prompt' };
  mocks.createChainWithData.mockResolvedValueOnce(saved).mockResolvedValueOnce(secondSaved);
  mocks.getAllChains.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: '批量保存合成作品' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('合成组已保存'));
  expect(mocks.createChainWithData).toHaveBeenCalledTimes(2);
  expect(mocks.createChainWithData).toHaveBeenNthCalledWith(1, source.name, source.description, source, 'style');
  expect(mocks.createChainWithData).toHaveBeenNthCalledWith(2, secondSaved.name, source.description, expect.objectContaining({ id: 'aitag-synthetic-2', basePrompt: secondSaved.basePrompt }), 'style');
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(mocks.getAllChains).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await screen.findByTestId('list');
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain(secondSaved.id);
  expect(screen.queryByTestId('editor')).toBeNull();
});

it.each(['stay', 'leave', 'return'] as const)('批量完成导航仅作用于原来源会话：%s', async route => {
  await setup();
  mocks.getAllChains.mockImplementation(() => new Promise(() => {}));
  let resolveSecond!: (value: PromptChain) => void;
  const secondSaved = { ...saved, id: 'server-saved-2', name: '合成作品 P2' };
  mocks.createChainWithData.mockResolvedValueOnce(saved).mockImplementationOnce(() => new Promise<PromptChain>(done => { resolveSecond = done; }));
  fireEvent.click(screen.getByRole('button', { name: '批量保存后跳转' }));
  await waitFor(() => expect(mocks.createChainWithData).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
  if (route !== 'stay') {
    fireEvent.click(screen.getByRole('button', { name: 'inspiration' }));
    await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('inspiration'));
    if (route === 'return') {
      fireEvent.click(screen.getByRole('button', { name: 'aitag' }));
      await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('aitag'));
    }
  }
  await act(async () => resolveSecond(secondSaved));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe(route === 'stay' ? 'list' : route === 'leave' ? 'inspiration' : 'aitag'));
  expect(screen.queryByTestId('editor')).toBeNull();
  if (route !== 'stay') fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await screen.findByTestId('list');
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain(secondSaved.id);
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
    expect(screen.getByTestId('collection-items').dataset.hasLabOrder).toBe('false');
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

it('实验室输入及通知不刷新保活画师页，真实资料更新并保留草稿及最新返回目标', async () => {
  await setup('aitag');
  fireEvent.click(screen.getByRole('button', { name: 'library' }));
  await screen.findByTestId('artist-library');
  fireEvent.change(screen.getByRole('textbox', { name: '合成画师筛选' }), { target: { value: '保留筛选' } });
  fireEvent.click(screen.getByRole('button', { name: 'playground' }));
  await screen.findByTestId('editor');
  const before = mocks.artistRenders;
  for (const subject of ['a', 'ab', 'abc']) {
    await act(async () => { await mocks.updatePlayground!('playground', { variableValues: { subject } }); });
  }
  expect(mocks.artistRenders - before, '三次实验室输入造成的隐藏画师页渲染').toBe(0);
  await act(async () => { window.dispatchEvent(new CustomEvent(NAI_ACCOUNTING_ERROR_EVENT, { detail: { message: '合成无关通知' } })); });
  expect(mocks.artistRenders).toBe(before);
  expect(screen.getByTestId('artist-active').textContent).toBe('false');
  await act(async () => { window.dispatchEvent(new Event('synthetic-artist-progress')); });
  expect(screen.getByTestId('artist-progress').textContent).toBe('1');
  expect(mocks.artistRenders).toBe(before + 1);
  mocks.getAllChains.mockResolvedValue([saved]);
  await act(async () => { window.dispatchEvent(new Event('nai-project-data-changed')); });
  await waitFor(() => expect(screen.getByTestId('artist-chain-count').textContent).toBe('1'));
  const focusBefore = screen.getByTestId('artist-focus').textContent;
  fireEvent.click(screen.getByRole('button', { name: '切换合成选中聚焦' }));
  expect(screen.getByTestId('artist-focus').textContent).not.toBe(focusBefore);
  await act(async () => { window.dispatchEvent(new CustomEvent('nai-agent-safe-mode-change', { detail: false })); });
  expect(document.querySelector('[data-agent-view]')?.classList.contains('safe-mode')).toBe(false);
  const language = getLanguage();
  await act(async () => { setLanguage(language === 'en' ? 'zh-CN' : 'en'); });
  expect(document.documentElement.lang).not.toBe(language);
  await act(async () => { setLanguage(language); });
  fireEvent.click(screen.getByRole('button', { name: 'library' }));
  expect(screen.getByTestId('artist-active').textContent).toBe('true');
  expect((screen.getByRole('textbox', { name: '合成画师筛选' }) as HTMLInputElement).value).toBe('保留筛选');
  fireEvent.click(screen.getByRole('button', { name: '画师进入实验室' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('playground'));
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('library'));
});
it('320px 已开关过搭配后，从单角色组合详情编辑仍打开搭配并保留内容标签', async () => {
  localStorage.setItem('nai_safe_mode_startup', 'false');
  vi.stubGlobal('innerWidth', 320);
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  window.history.replaceState({}, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    const stack = window.history.state?.__naiMobileLayers || [];
    const layers = stack.slice(0, -1);
    setTimeout(() => {
      const state = { __naiMobileLayers: layers, __naiMobileLayer: layers.at(-1) };
      window.history.replaceState(state, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state }));
    }, 0);
  });
  const snapshot = contentSnapshotOf({ picks: { wardrobe: { kind: 'wardrobe', text: 'white dress', filled: true }, scene: { kind: 'scene', text: 'night', filled: true } } }, '2026-10-21')!;
  const original = { ...saved, id: 'mobile-combination', name: '手机详情组合', type: 'preset', tags: ['夜景', '手机'], params: { _rollContentSnapshot: snapshot } } as unknown as PromptChain;
  mocks.getAllChains.mockResolvedValue([original]);
  try {
    const { default: App } = await import('../../App');
    render(<React.StrictMode><App /></React.StrictMode>);
    await screen.findByTestId('list');
    fireEvent.click(screen.getByRole('button', { name: 'prompts' }));
    await screen.findByRole('searchbox', { name: '搜索名称、正文或标签' });
    selectPromptScope('saved');
    fireEvent.click(screen.getByRole('button', { name: '搭配' }));
    await screen.findByRole('dialog', { name: '搭配' });
    fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搭配' })).toBeNull());
    await act(() => new Promise(resolve => setTimeout(resolve, 30)));
    fireEvent.click(screen.getByRole('button', { name: '查看手机详情组合' }));
    const detail = await screen.findByLabelText('手机详情组合', { selector: 'aside' });
    fireEvent.click(within(detail).getByRole('button', { name: '编辑' }));
    const roll = await screen.findByRole('dialog', { name: '搭配' });
    await waitFor(() => expect(roll.querySelector('[data-content-roll-row="directory:person-wardrobe"]')?.textContent).toContain('white dress'));
    await act(() => new Promise(resolve => setTimeout(resolve, 30)));
    expect(screen.queryByRole('dialog', { name: '搭配' })).not.toBeNull();
    fireEvent.click(within(roll).getByRole('button', { name: '保存组合' }));
    expect((within(roll).getByRole('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('夜景, 手机');
  } finally { back.mockImplementation(() => {}); cleanup(); back.mockRestore(); window.history.replaceState({}, ''); }
});
