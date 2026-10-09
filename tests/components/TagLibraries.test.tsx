import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { mockGalleryGeometry } from '../support/galleryGeometry';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageShareOverlay } from '../../components/ImageShareActions';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import { CharacterLibrary } from '../../components/CharacterLibrary';
import type { PromptChain } from '../../types';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { generateImage } from '../../services/naiService';
import { copySharedImage, downloadSharedImage } from '../../services/imageSharing';
vi.mock('../../services/imageSharing', async original => ({ ...await original<typeof import('../../services/imageSharing')>(), copySharedImage: vi.fn(async () => {}), downloadSharedImage: vi.fn(async () => {}) }));
import {
  getArtistDictionaryEntriesAt, getArtistDictionaryPage,
  getCharacterDictionaryEntriesAt, getCharacterDictionaryPage,
} from '../../services/tagDictionary';

const fixtures = vi.hoisted(() => ({
  favorites: new Map<string, any>(), revision: 0, listeners: new Set<() => void>(),
  artists: [
    { name: 'sample_artist_a', chinese: '画师甲', postCount: 80 },
    { name: 'sample_artist_z', chinese: '画师乙', postCount: 20 },
  ],
  characters: [
    { name: 'sample_character_a', chinese: '角色甲', postCount: 80 },
    { name: 'sample_character_z', chinese: '角色乙', postCount: 20 },
  ],
}));

vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  collectionSnapshot: () => Array.from(fixtures.favorites.values()),
  collectionRevision: () => fixtures.revision,
  subscribeCollection: (listener: () => void) => { fixtures.listeners.add(listener); return () => { fixtures.listeners.delete(listener); }; },
  collectionTargetActive: (target: any) => fixtures.favorites.has(target.sourceType + ':' + target.sourceId),
  toggleCollectionTarget: vi.fn(async (target: any) => {
    const key = target.sourceType + ':' + target.sourceId, active = !fixtures.favorites.has(key);
    if (active) fixtures.favorites.set(key, { ...target, archived: false }); else fixtures.favorites.delete(key);
    fixtures.revision++; fixtures.listeners.forEach(listener => listener()); return active;
  }),
}));

// 只用合成目录和浏览器内存存储；禁止真实生图或网络图片读取。
vi.mock('../../services/naiService', () => ({ generateImage: vi.fn() }));
const confirmAction = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirmAction }));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: ({ tag, fixedSrc, kind, notify, onFavoriteChange }: any) =>
  <div data-testid={`cover-${tag}`} data-fixed-src={fixedSrc}>{tag}<ImageShareOverlay imageUrl={fixedSrc || '/synthetic/' + tag + '.png'} filename={tag + '.png'} notify={notify} favorite={{ imageUrl: fixedSrc || '/synthetic/' + tag + '.png', sourceType: kind, sourceId: tag }} onFavoriteChange={onFavoriteChange} /></div>,
}));
// jsdom 没有容器宽度；布局由既有测试覆盖，这里直接渲染条目以验证目录状态。
vi.mock('../../components/ShortestColumnMasonry', () => ({ useMasonryColumnCount: () => 6, ShortestColumnMasonry: ({ items, renderItem }: { items: unknown[]; renderItem: (item: unknown) => React.ReactNode }) =>
  <div>{items.map((item, index) => <React.Fragment key={index}>{renderItem(item)}</React.Fragment>)}</div>,
}));
vi.mock('../../services/danbooruService', () => ({ danbooruService: {
  getCoverSet: vi.fn(async () => ({ candidates: [] })),
} }));
vi.mock('../../services/tagDictionary', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/tagDictionary')>(),
  getArtistDictionaryPage: vi.fn(),
  getArtistDictionaryEntriesAt: vi.fn(),
  getCharacterDictionaryPage: vi.fn(),
  getCharacterDictionaryEntriesAt: vi.fn(),
  searchArtistDictionary: vi.fn(async (query: string) => fixtures.artists.filter(item => item.name.includes(query))),
  searchCharacterDictionary: vi.fn(async (query: string) => fixtures.characters.filter(item => item.name.includes(query))),
}));

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const copy = vi.fn(async (_text: string) => {});
const custom: PromptChain = {
  id: 'synthetic-custom', userId: 'synthetic', type: 'character', name: '合成自定义角色',
  description: '', tags: [], basePrompt: 'blue hair, red coat', negativePrompt: '', modules: [],
  params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 0 },
  createdAt: 1, updatedAt: 1,
};
type Kind = 'artist' | 'character';
it('自定义角色图片操作不选择或打开条目，手机与桌面预览沿用右上分享', async () => {
  const saved = { ...custom, previewImage: 'data:image/png;base64,c3ludGhldGlj' };
  const view = renderLibrary('character', 390, [saved]);
  const card = await screen.findByRole('button', { name: '选择角色：' + custom.name });
  const download = within(card).getByRole('button', { name: '下载图片' });
  expectCustomCardLayout(card, true);
  fireEvent.click(download);
  await waitFor(() => expect(downloadSharedImage).toHaveBeenLastCalledWith(saved.previewImage, 'character-' + custom.name + '.png', false));
  fireEvent.click(within(card).getByRole('button', { name: '复制图片' }));
  await waitFor(() => expect(copySharedImage).toHaveBeenLastCalledWith(saved.previewImage, false));
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(view.onSelect).not.toHaveBeenCalled();
  fireEvent.click(card.querySelector('button.h-full.w-full')!);
  expect(screen.getByRole('button', { name: '复制角色提示词' })).toBeTruthy();
  const imageCopies = screen.getAllByRole('button', { name: '复制图片' });
  expect(imageCopies).toHaveLength(5);
  imageCopies.forEach(button => expect(button.closest('.right-2')!.className).toContain('absolute right-2 top-2'));
  const desktop = screen.getByRole('button', { name: '关闭角色大图' }).closest('[role="dialog"]')!;
  fireEvent.click(desktop.querySelector('.press-reveal-surface')!);
  expect(screen.queryByRole('button', { name: '关闭角色大图' })).toBeNull();
});
const entriesFor = (kind: Kind) => kind === 'artist' ? fixtures.artists : fixtures.characters;
const getEntriesFor = (kind: Kind) => kind === 'artist' ? getArtistDictionaryEntriesAt : getCharacterDictionaryEntriesAt;
const favoritesKey = (kind: Kind) => kind === 'artist' ? 'nai_fav_artists' : 'nai_character_favorites';
const favoriteId = (kind: Kind, name: string) => kind === 'artist' ? name : `catalog:${name}`;

function renderLibrary(kind: Kind, width = 1280, chains: PromptChain[] = []) {
  vi.stubGlobal('innerWidth', width);
  const notify = vi.fn();
  const navigate = vi.fn();
  const onCreate = vi.fn();
  const onSelect = vi.fn();
  const onUpdateChain = vi.fn();
  const onDelete = vi.fn(async (_id: string) => {});
  const view = kind === 'artist'
    ? render(<ArtistLibrary artistsData={[]} notify={notify} onNavigateToPlayground={navigate} />)
    : render(<CharacterLibrary chains={chains} onCreate={onCreate} onSelect={onSelect} onDelete={onDelete} onUpdateChain={onUpdateChain} onNavigateToPlayground={navigate} notify={notify} />);
  return { ...view, navigate, onCreate, onSelect, onUpdateChain, onDelete, notify };
}

function expectCustomCardLayout(card: HTMLElement, hasPreview: boolean) {
  const remove = within(card).getByRole('button', { name: '删除这个自定义角色' });
  const edit = within(card).getByRole('button', { name: '编辑自定义角色信息' });
  const left = remove.parentElement!;
  const right = edit.parentElement!;
  expect(left.className).toContain('absolute left-2 top-2');
  expect(left.classList.contains('hover-reveal-md')).toBe(true);
  expect(within(left).getAllByRole('button')).toEqual([remove]);
  expect(right.className).toContain('absolute right-2 top-2');
  for (const token of ['flex', 'flex-col', 'gap-2']) expect(right.classList.contains(token)).toBe(true);
  expect(within(right).getAllByRole('button').map(button => button.getAttribute('aria-label')))
    .toEqual(hasPreview ? ['收藏', '下载图片', '复制图片', '编辑自定义角色信息'] : ['编辑自定义角色信息']);
  for (const button of within(right).getAllByRole('button')) {
    for (const token of ['mobile-size-locked', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'rounded-full', 'border-white/60', 'bg-black/45']) expect(button.classList.contains(token)).toBe(true);
  }
  const favorite = within(card).queryByRole('button', { name: '收藏' });
  if (hasPreview) { expect(right.contains(favorite)).toBe(true); expect(favorite!.classList.contains('hover-reveal-md')).toBe(false); }
  else expect(favorite).toBeNull();
  expect(edit.classList.contains('hover-reveal-md')).toBe(true);
}

beforeEach(() => {
  document.documentElement.dataset.motion = 'full';
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); fixtures.favorites.clear(); fixtures.revision++;
  confirmAction.mockResolvedValue(true);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('本测试禁止联网'); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  vi.mocked(getArtistDictionaryPage).mockImplementation(async () => ({ entries: fixtures.artists, total: 2, page: 0, pageSize: 500, pageCount: 1 }));
  vi.mocked(getCharacterDictionaryPage).mockImplementation(async () => ({ entries: fixtures.characters, total: 2, page: 0, pageSize: 500, pageCount: 1 }));
  vi.mocked(getArtistDictionaryEntriesAt).mockImplementation(async indices => indices.map(index => fixtures.artists[index]));
  vi.mocked(getCharacterDictionaryEntriesAt).mockImplementation(async indices => indices.map(index => fixtures.characters[index]));
});

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion;
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe.each<Kind>(['artist', 'character'])('%s 目录只负责 Tag 取用', kind => {
  it.each([1280, 390])('宽度 %s 多选保留已选亮度，其余沿用 AITag 暗度；取消、清空和导入后恢复', async width => {
    localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: width === 390 ? 'portrait' : 'masonry' }));
    const { container } = renderLibrary(kind, width, kind === 'character' ? [custom] : []);
    if (width === 390) container.classList.add('dark', 'safe-mode');
    const entries = entriesFor(kind);
    const first = (await screen.findByTestId(`cover-${entries[0].name}`)).closest<HTMLElement>('[aria-pressed]')!;
    const second = screen.getByTestId(`cover-${entries[1].name}`).closest<HTMLElement>('[aria-pressed]')!;
    const cards = screen.getAllByRole('button', { name: /^选择(?:画师|角色)：/ });
    const expectNormal = () => cards.forEach(card => expect(card.className).not.toContain('brightness-'));
    expectNormal();
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.className).not.toContain('brightness-');
    cards.filter(card => card !== first).forEach(card => expect(card.className).toContain('brightness-[.7]'));
    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.className).not.toContain('brightness-');
    expect(second.className).not.toContain('brightness-');
    fireEvent.click(first);
    expect(first.className).toContain('brightness-[.7]');
    fireEvent.keyDown(second, { key: ' ' });
    expectNormal();
    if (kind === 'character') {
      const customCard = screen.getByRole('button', { name: `选择角色：${custom.name}` });
      fireEvent.click(customCard);
      expect(customCard.className).not.toContain('brightness-');
      expect(first.className).toContain('brightness-[.7]');
      fireEvent.click(customCard);
      expectNormal();
    }
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(second.className).toContain('brightness-[.7]');
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expectNormal();
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
    expectNormal();
  });

  it.each([false, true])('抽卡=%s：点击居中但保留多选；切换筛选释放旧定位', async gacha => {
    renderLibrary(kind);
    const entries = entriesFor(kind);
    await screen.findByTestId(`cover-${entries[0].name}`);
    if (gacha) {
      fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
      await screen.findByRole('button', { name: '再抽一批' });
    }
    const cards = entries.map(entry => screen.getByTestId(`cover-${entry.name}`).closest<HTMLElement>('[aria-pressed]')!);
    const { root, scrollCalls } = mockGalleryGeometry(cards);
    fireEvent.click(cards[0]);
    expect(root.scrollTop).toBe(1650);
    expect(scrollCalls).toContainEqual({ top: 1650, behavior: 'smooth' });
    fireEvent.click(cards[1]);
    expect(root.scrollTop).toBe(2450);
    cards.forEach(card => { expect(card.getAttribute('aria-pressed')).toBe('true'); expect(card.className).not.toContain('brightness-'); });
    fireEvent.click(screen.getByRole('button', { name: /^筛选/ }));
    fireEvent.change(screen.getByRole('combobox', { name: kind === 'artist' ? '画师排序' : '角色排序' }), { target: { value: 'name-asc' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByTestId(`cover-${entries[0].name}`);
    const currentCards = entries.map(entry => screen.getByTestId(`cover-${entry.name}`).closest<HTMLElement>('[aria-pressed]')!);
    const currentGeometry = mockGalleryGeometry(currentCards);
    currentGeometry.tops[1] = 3000; root.scrollTop = 400;
    await act(async () => { root.style.paddingTop = '1px'; await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(root.scrollTop).toBe(400);
    expect(cards[0].getAttribute('aria-pressed')).toBe('true');
  });

  it.each([1280, 390])('Agent 在宽度 %s 选择卡片并读取真实状态，重复 check 不取消选择', async width => {
    const { container } = renderLibrary(kind, width); container.dataset.agentView = kind === 'artist' ? 'library' : 'characters';
    await screen.findByTestId(`cover-${entriesFor(kind)[0].name}`);
    const page = readAgentPage({ query: `选择${kind === 'artist' ? '画师' : '角色'}：` }), card = page.controls[0]; expect(card.pressed).toBe(false);
    let pending!: ReturnType<typeof operateAgentPage>;
    act(() => { pending = operateAgentPage({ action: 'check', snapshotId: page.snapshotId, controlId: card.id, checked: true }); }); await pending;
    let current = readAgentPage({ controlId: card.id }); expect(current.controls[0].pressed).toBe(true);
    act(() => { pending = operateAgentPage({ action: 'check', snapshotId: current.snapshotId, controlId: card.id, checked: true }); }); await pending;
    expect(readAgentPage({ controlId: card.id }).controls[0].pressed).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: card.label }), { key: ' ' });
    current = readAgentPage({ controlId: card.id }); expect(current.controls[0].pressed).toBe(false); expect(generateImage).not.toHaveBeenCalled();
  });
  it.each([1280, 390])('宽度 %s 保留核心入口，不藏起旧测试功能', async width => {
    const { container } = renderLibrary(kind, width);
    await screen.findByTestId(`cover-${entriesFor(kind)[0].name}`);
    const toolbar = within(container.querySelector('header')!);
    expect(toolbar.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      '筛选', '随机抽卡', '抽卡设置', ...(kind === 'character' ? ['新建自定义角色'] : []),
    ]);
    expect(toolbar.getByRole('searchbox')).toBeTruthy();
    const draw = toolbar.getByRole('button', { name: '随机抽卡' });
    expect(draw.className).toContain('bg-white');
    expect(draw.className).not.toContain('bg-indigo-600');
    for (const name of ['更多', '画师配置', '任务队列', '复制历史', '批量导入画师', '生成预览', '重新生成', '设为固定封面']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(generateImage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('无 Key 也能选中并复制 Tag，不新建复制历史', async () => {
    localStorage.setItem('nai_copy_history', '保留的旧记录');
    renderLibrary(kind);
    fireEvent.click(await screen.findByTestId(`cover-${entriesFor(kind)[0].name}`));
    expect(screen.queryByRole('dialog', { name: '画师权重与微调' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '角色槽位与站位排布' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制全部' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(`${kind === 'artist' ? 'artist:' : ''}${entriesFor(kind)[0].name}`));
    expect(localStorage.getItem('nai_copy_history')).toBe('保留的旧记录');
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('抽卡后收藏筛选退出抽卡，并显示完整收藏清单', async () => {
    const entry = entriesFor(kind)[0];
    localStorage.setItem(favoritesKey(kind), JSON.stringify([favoriteId(kind, entry.name)]));
    renderLibrary(kind);
    await screen.findByTestId(`cover-${entry.name}`);
    fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
    await screen.findByText(/正在浏览随机抽取的 2 位/);
    expect(screen.getByRole('button', { name: '再抽一批' }).className).toContain('bg-white');
    expect(screen.getByRole('button', { name: '再抽一批' }).className).not.toContain('bg-indigo-600');
    expect(vi.mocked(getEntriesFor(kind)).mock.calls.at(-1)?.[0]).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
    expect(screen.queryByText(/正在浏览随机抽取/)).toBeNull();
    expect(screen.getAllByTestId(/^cover-/)).toHaveLength(1);
    expect(screen.getByTestId(`cover-${entry.name}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getAllByTestId(/^cover-/)).toHaveLength(2);
  });

  it('收藏的名称与热度排序作用于实际卡片', async () => {
    const entries = entriesFor(kind);
    localStorage.setItem(favoritesKey(kind), JSON.stringify(entries.map(entry => favoriteId(kind, entry.name))));
    renderLibrary(kind);
    await screen.findByTestId(`cover-${entries[0].name}`);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '只看收藏' }));
    const sort = screen.getByRole('combobox', { name: kind === 'artist' ? '画师排序' : '角色排序' });
    for (const value of ['name-desc', 'least']) {
      fireEvent.change(sort, { target: { value } });
      await waitFor(() => expect(screen.getAllByTestId(/^cover-/).map(node => node.getAttribute('data-testid'))).toEqual([
        `cover-${entries[1].name}`, `cover-${entries[0].name}`,
      ]));
    }
  });

  it('在途抽卡结果不能覆盖后来输入的搜索', async () => {
    let resolve!: (entries: typeof fixtures.artists) => void;
    vi.mocked(getEntriesFor(kind)).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    renderLibrary(kind);
    await screen.findByTestId(`cover-${entriesFor(kind)[0].name}`);
    fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: entriesFor(kind)[1].name } });
    await act(async () => { resolve([entriesFor(kind)[0]]); });
    await waitFor(() => expect(screen.getAllByTestId(/^cover-/)).toHaveLength(1));
    expect(screen.getByTestId(`cover-${entriesFor(kind)[1].name}`)).toBeTruthy();
    expect(screen.queryByText(/正在浏览随机抽取/)).toBeNull();
    expect(screen.getByRole('button', { name: '随机抽卡' })).toBeTruthy();
  });
});

it('角色目录为空时仍能抽取自定义角色，不生成预览', async () => {
  vi.mocked(getCharacterDictionaryPage).mockResolvedValue({ entries: [], total: 0, page: 0, pageSize: 500, pageCount: 0 });
  const { onSelect } = renderLibrary('character', 1280, [custom]);
  fireEvent.click(screen.getByRole('button', { name: '抽卡设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '抽卡范围' }), { target: { value: 'custom' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByText(/正在浏览随机抽取的 1 位角色/);
  expect(getCharacterDictionaryEntriesAt).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '生成预览' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(onSelect).toHaveBeenCalledWith(custom.id);
});

it('自定义角色保留创建入口，画师选择仍能送往实验室', async () => {
  const view = renderLibrary('character');
  fireEvent.click(screen.getByRole('button', { name: '新建自定义角色' }));
  fireEvent.change(screen.getByPlaceholderText(/角色名称/), { target: { value: '合成新角色' } });
  fireEvent.click(screen.getByRole('button', { name: '创建并编辑' }));
  expect(view.onCreate).toHaveBeenCalledWith('合成新角色', '', 'character');
  view.unmount();
  const artistView = renderLibrary('artist');
  fireEvent.click(await screen.findByTestId('cover-sample_artist_a'));
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  expect(JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!)).toMatchObject({ prompt: 'artist:sample_artist_a', mode: 'append-prompt' });
  expect(artistView.navigate).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '复制全部' })).toBeNull();
  expect(generateImage).not.toHaveBeenCalled();
});

it.each([1280, 390])('宽度 %s 角色大图、手机详情与新建窗口覆盖侧栏，关闭不改资料', async width => {
  vi.stubGlobal('innerWidth', width);
  const onCreate = vi.fn(), onSelect = vi.fn(), onDelete = vi.fn(), onUpdateChain = vi.fn();
  const view = render(<div className="agent-stage safe-mode dark">
    <aside className="relative z-40">侧边栏</aside>
    <main className="isolate overflow-hidden"><CharacterLibrary chains={[{ ...custom, previewImage: '/synthetic.png' }]}
      onCreate={onCreate} onSelect={onSelect} onDelete={onDelete} onUpdateChain={onUpdateChain} onNavigateToPlayground={vi.fn()} notify={vi.fn()} /></main>
  </div>);
  const cover = view.container.querySelector<HTMLButtonElement>(`[data-return-item-id="${custom.id}"] button.h-full`)!;
  fireEvent.click(cover);
  const dialogs = screen.getAllByRole('dialog', { name: custom.name });
  expect(dialogs).toHaveLength(2);
  for (const dialog of dialogs) {
    expect(dialog.parentElement).toBe(view.container.firstElementChild);
    expect(dialog.closest('main')).toBeNull();
    expect(dialog.closest('.safe-mode.dark')).toBe(view.container.firstElementChild);
  }
  const desktop = dialogs.find(dialog => dialog.classList.contains('md:flex'))!;
  expect(desktop.classList.contains('hidden')).toBe(true);
  expect(desktop.classList.contains('z-[1500]')).toBe(true);
  expect(dialogs.find(dialog => dialog.classList.contains('mobile-detail'))?.classList.contains('md:hidden')).toBe(true);
  fireEvent.click(desktop);
  expect(screen.queryByRole('dialog', { name: custom.name })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新建自定义角色' }));
  const create = screen.getByRole('dialog', { name: '新建自定义还原角色' });
  expect(create.closest('.fixed')?.parentElement).toBe(view.container.firstElementChild);
  expect(create.closest('main')).toBeNull();
  fireEvent.click(within(create).getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  for (const action of [onCreate, onSelect, onDelete, onUpdateChain]) expect(action).not.toHaveBeenCalled();
});

it('角色送往独立槽位时默认 AI 构图，目录不强制站位', async () => {
  const view = renderLibrary('character');
  fireEvent.click(await screen.findByTestId(`cover-${fixtures.characters[0].name}`));
  fireEvent.click(await screen.findByTestId(`cover-${fixtures.characters[1].name}`));
  fireEvent.click(screen.getByRole('button', { name: '导入实验室' }));
  const imported = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
  expect(imported.params.useCoords).toBe(false);
  expect(imported.params.characters.map((character: { prompt: string; x: number; y: number }) => ({ prompt: character.prompt, x: character.x, y: character.y })))
    .toEqual(fixtures.characters.map(character => ({ prompt: character.name, x: 0.5, y: 0.5 })));
  expect(view.navigate).toHaveBeenCalledOnce();
  expect(generateImage).not.toHaveBeenCalled();
});

it('自定义角色卡片信息编辑不选中条目，抽卡结果随名称更新', async () => {
  const p = renderLibrary('character', 390, [custom]);
  await screen.findByRole('button', { name: '编辑自定义角色信息' });
  fireEvent.click(screen.getByRole('button', { name: '抽卡设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '抽卡范围' }), { target: { value: 'custom' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByText(/正在浏览随机抽取的 1 位角色/);
  const edit = screen.getByRole('button', { name: '编辑自定义角色信息' });
  expect(edit.className).not.toContain('md:hidden');
  expectCustomCardLayout(edit.closest('article')!, false);
  fireEvent.click(edit);
  expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '新的角色名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(p.onUpdateChain).toHaveBeenCalledWith(custom.id, { name: '新的角色名称', description: '', tags: [] }));
  p.rerender(<CharacterLibrary chains={[{ ...custom, name: '新的角色名称' }]} onCreate={p.onCreate} onSelect={p.onSelect} onDelete={vi.fn()} onUpdateChain={p.onUpdateChain} onNavigateToPlayground={p.navigate} notify={vi.fn()} />);
  expect(screen.getByRole('heading', { name: '新的角色名称' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: custom.name })).toBeNull();
  expect(generateImage).not.toHaveBeenCalled();
});

it.each<Kind>(['artist', 'character'])('%s 手机卡片爱心常驻，长按或收藏不改变所选 Tag', async kind => {
  renderLibrary(kind, 390);
  const entry = entriesFor(kind)[0];
  const card = await screen.findByRole('button', { name: `选择${kind === 'artist' ? '画师' : '角色'}：${kind === 'artist' ? entry.name : entry.chinese}` });
  longPress(card); expect(card.getAttribute('data-press-revealed')).toBe('true'); expect(card.getAttribute('aria-pressed')).toBe('false');
  const favorite = within(card).getByRole('button', { name: '收藏' });
  expect(favorite.parentElement!.className).toContain('absolute right-2 top-2');
  for (const token of ['mobile-size-locked', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'border-white/60', 'bg-black/45']) expect(favorite.classList.contains(token)).toBe(true);
  expect(favorite.classList.contains('hover-reveal-touch')).toBe(false); fireEvent.click(favorite);
  await waitFor(() => expect(within(card).getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe('true')); expect(card.getAttribute('aria-pressed')).toBe('false');
});
it('自定义角色长按显露编辑和收藏，松手不打开图或选择；编辑只走信息窗口', () => {
  renderLibrary('character', 390, [custom]); const card = screen.getByRole('button', { name: '选择角色：合成自定义角色' });
  longPress(card); expect(card.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(within(card).getByRole('button', { name: '编辑自定义角色信息' }));
  expect(screen.getByRole('dialog', { name: '编辑自定义角色信息' })).toBeTruthy();
});

it.each([
  { width: 1280, previewImage: undefined }, { width: 390, previewImage: undefined },
  { width: 1280, previewImage: '/synthetic.png' }, { width: 390, previewImage: '/synthetic.png' },
])('宽度 $width、封面 $previewImage 的自定义角色沿用风格串按钮布局，词库角色不可删除；取消不删除', async ({ width, previewImage }) => {
  const p = renderLibrary('character', width, [{ ...custom, previewImage }]);
  const card = screen.getByRole('button', { name: `选择角色：${custom.name}` });
  if (width === 390) { longPress(card); expect(card.getAttribute('data-press-revealed')).toBe('true'); }
  const remove = within(card).getByRole('button', { name: '删除这个自定义角色' });
  expectCustomCardLayout(card, Boolean(previewImage));
  for (const token of ['bg-red-500', 'text-white', 'rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'focus-visible:ring-white']) expect(remove.classList.contains(token)).toBe(true);
  if (previewImage) {
    fireEvent.click(within(card).getByRole('button', { name: '收藏' }));
    await waitFor(() => expect(within(card).getByRole('button', { name: '取消收藏' }).getAttribute('aria-pressed')).toBe('true'));
  }
  expect(card.getAttribute('aria-pressed')).toBe('false');
  const catalog = await screen.findByRole('button', { name: '选择角色：角色甲' });
  expect(within(catalog).queryByRole('button', { name: '删除这个自定义角色' })).toBeNull();
  confirmAction.mockResolvedValueOnce(false);
  fireEvent.click(remove);
  await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: `删除“${custom.name}”？`, tone: 'danger' })));
  expect(p.onDelete).not.toHaveBeenCalled();
  fireEvent.click(remove);
  await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith(custom.id));
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(generateImage).not.toHaveBeenCalled();
});

it('自定义角色删除失败保留选择和详情且只提示失败，重试成功关闭详情并清除选择', async () => {
  const p = renderLibrary('character', 390, [{ ...custom, previewImage: '/synthetic.png' }]);
  const card = screen.getByRole('button', { name: `选择角色：${custom.name}` });
  fireEvent.click(card);
  fireEvent.click(card.querySelector('button.h-full.w-full')!);
  const detail = screen.getAllByRole('dialog', { name: custom.name }).find(dialog => dialog.classList.contains('mobile-detail'))!;
  const remove = within(detail).getByRole('button', { name: '删除这个自定义角色' });
  p.onDelete.mockRejectedValueOnce(new Error('合成删除失败'));
  fireEvent.click(remove);
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('删除失败，请稍后重试', 'error'));
  expect(p.notify).not.toHaveBeenCalledWith('自定义角色已删除');
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByRole('dialog', { name: custom.name })).toHaveLength(2);
  fireEvent.click(remove);
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('自定义角色已删除'));
  expect(screen.queryByRole('dialog', { name: custom.name })).toBeNull();
  expect(card.getAttribute('aria-pressed')).toBe('false');
});

it('删除抽卡中的自定义角色后，父级刷新移除抽卡卡片且不打开工作台', async () => {
  const p = renderLibrary('character', 1280, [custom]);
  fireEvent.click(screen.getByRole('button', { name: '抽卡设置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '抽卡范围' }), { target: { value: 'custom' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByText(/正在浏览随机抽取的 1 位角色/);
  p.onDelete.mockImplementation(async () => {
    p.rerender(<CharacterLibrary chains={[]} onCreate={p.onCreate} onSelect={p.onSelect} onDelete={p.onDelete} onUpdateChain={p.onUpdateChain} onNavigateToPlayground={p.navigate} notify={p.notify} />);
  });
  fireEvent.click(screen.getByRole('button', { name: '删除这个自定义角色' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: `选择角色：${custom.name}` })).toBeNull());
  expect(p.onDelete).toHaveBeenCalledWith(custom.id);
  expect(p.onSelect).not.toHaveBeenCalled();
});
