import { longPress } from '../support/touchEvents';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistLibrary } from '../../components/ArtistLibrary';
import { CharacterLibrary } from '../../components/CharacterLibrary';
import type { PromptChain } from '../../types';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { generateImage } from '../../services/naiService';
import {
  getArtistDictionaryEntriesAt, getArtistDictionaryPage,
  getCharacterDictionaryEntriesAt, getCharacterDictionaryPage,
} from '../../services/tagDictionary';

const fixtures = vi.hoisted(() => ({
  artists: [
    { name: 'sample_artist_a', chinese: '画师甲', postCount: 80 },
    { name: 'sample_artist_z', chinese: '画师乙', postCount: 20 },
  ],
  characters: [
    { name: 'sample_character_a', chinese: '角色甲', postCount: 80 },
    { name: 'sample_character_z', chinese: '角色乙', postCount: 20 },
  ],
}));

// 只用合成目录和浏览器内存存储；禁止真实生图或网络图片读取。
vi.mock('../../services/naiService', () => ({ generateImage: vi.fn() }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: ({ tag, fixedSrc }: { tag: string; fixedSrc?: string }) =>
  <div data-testid={`cover-${tag}`} data-fixed-src={fixedSrc}>{tag}</div>,
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
  const view = kind === 'artist'
    ? render(<ArtistLibrary artistsData={[]} notify={notify} onNavigateToPlayground={navigate} />)
    : render(<CharacterLibrary chains={chains} onCreate={onCreate} onSelect={onSelect} onDelete={vi.fn()} onUpdateChain={onUpdateChain} onNavigateToPlayground={navigate} notify={notify} />);
  return { ...view, navigate, onCreate, onSelect, onUpdateChain };
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
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
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
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
  expect(edit.classList.contains('hover-reveal-md')).toBe(true);
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

it.each<Kind>(['artist', 'character'])('%s 手机卡片长按显露收藏，松手不选择 Tag；收藏不改变所选', async kind => {
  renderLibrary(kind, 390);
  const entry = entriesFor(kind)[0];
  const card = await screen.findByRole('button', { name: `选择${kind === 'artist' ? '画师' : '角色'}：${kind === 'artist' ? entry.name : entry.chinese}` });
  longPress(card); expect(card.getAttribute('data-press-revealed')).toBe('true'); expect(card.getAttribute('aria-pressed')).toBe('false');
  const favorite = within(card).getByRole('button', { name: '收藏' });
  expect(favorite.classList.contains('hover-reveal-touch')).toBe(true); fireEvent.click(favorite);
  expect(within(card).getByRole('button', { name: '取消收藏' })).toBeTruthy(); expect(card.getAttribute('aria-pressed')).toBe('false');
});
it('自定义角色长按显露编辑和收藏，松手不打开图或选择；编辑只走信息窗口', () => {
  renderLibrary('character', 390, [custom]); const card = screen.getByRole('button', { name: '选择角色：合成自定义角色' });
  longPress(card); expect(card.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(within(card).getByRole('button', { name: '编辑自定义角色信息' }));
  expect(screen.getByRole('dialog', { name: '编辑自定义角色信息' })).toBeTruthy();
});
