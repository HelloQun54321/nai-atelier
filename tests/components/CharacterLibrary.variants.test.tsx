// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterLibrary } from '../../components/CharacterLibrary';
import * as libraryRandom from '../../services/libraryRandom';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import type { CharacterDictionaryEntry } from '../../services/tagDictionary';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({
  page: vi.fn(), all: vi.fn(), at: vi.fn(), coverCallbacks: new Map<string, any>(),
  collection: [] as any[], listeners: new Set<() => void>(), ensure: vi.fn(), favorite: vi.fn(),
  save: vi.fn(),
  state: { revision: 1, groups: [{ id: 'one', name: '甲组' }, { id: 'two', name: '乙组' }], memberships: {} as Record<string, string[]> },
}));

vi.mock('../../services/api', async original => ({
  ...await original<typeof import('../../services/api')>(),
  api: { get: async () => structuredClone(mocks.state), put: async (_path: string, value: any) => { await mocks.save(value); mocks.state = { ...value, revision: value.revision + 1 }; return mocks.state; } },
}));
vi.mock('../../services/tagDictionary', async original => ({
  ...await original<typeof import('../../services/tagDictionary')>(),
  getCharacterDictionaryPage: mocks.page,
  getCharacterDictionaryEntries: mocks.all,
  getCharacterDictionaryEntriesAt: mocks.at,
  searchCharacterDictionary: vi.fn(async () => []),
}));
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  collectionSnapshot: () => mocks.collection,
  subscribeCollection: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
  collectionTargetActive: () => false,
  ensureCollection: mocks.ensure,
  toggleCollectionTarget: mocks.favorite,
}));
vi.mock('../../components/DanbooruCover', () => ({ DanbooruCover: (props: any) => {
  mocks.coverCallbacks.set(props.tag, props);
  return <span data-testid={`cover-${props.tag}`}>{props.tag}</span>;
} }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('../../components/ShortestColumnMasonry', () => ({
  useMasonryColumnCount: () => 3,
  ShortestColumnMasonry: ({ items, renderItem }: any) => <div>{items.map(renderItem)}</div>,
}));

const baseTag = 'ulrich_von_hutten_(azur_lane)';
const maidTag = 'ulrich_von_hutten_(mayhem_maid)_(azur_lane)';
const ignitionTag = 'ulrich_von_hutten_(ignition_matrician)_(azur_lane)';
const characterEntries: CharacterDictionaryEntry[] = [
  { name: baseTag, chinese: '胡滕', postCount: 90 },
  { name: maidTag, chinese: '胡滕（女仆）', postCount: 80 },
  { name: ignitionTag, chinese: '胡滕（点火）', postCount: 70 },
  { name: 'independent_character_(other_series)', chinese: '独立角色', postCount: 60 },
];
const custom: PromptChain = {
  id: 'synthetic-custom', userId: 'owner', type: 'character', name: '手工角色', description: '', tags: [],
  basePrompt: 'custom prompt', negativePrompt: '', modules: [], variableValues: {},
  params: createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, createdAt: 1, updatedAt: 1,
};
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.coverCallbacks.clear(); mocks.collection = []; mocks.listeners.clear();
  mocks.ensure.mockReset().mockResolvedValue(undefined); mocks.favorite.mockReset().mockResolvedValue(true);
  mocks.state = { revision: 1, groups: [{ id: 'one', name: '甲组' }, { id: 'two', name: '乙组' }], memberships: {} };
  mocks.page.mockImplementation(async (page: number) => ({
    entries: page === 0 ? characterEntries.slice(0, 1) : characterEntries.slice(1),
    page, pageCount: 2, pageSize: 1, total: characterEntries.length,
  }));
  mocks.all.mockResolvedValue(characterEntries);
  mocks.at.mockImplementation(async (indices: number[]) => indices.map(index => characterEntries[index]));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { if (target.classList.contains('bg-gray-200')) this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {} disconnect() {}
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

function setup(width = 1280, chains: PromptChain[] = []) {
  vi.stubGlobal('innerWidth', width);
  return render(<CharacterLibrary chains={chains} onCreate={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn(async () => {})}
    onUpdateChain={vi.fn()} onNavigateToPlayground={vi.fn()} notify={vi.fn()} />);
}

async function selectGroup(id: string) {
  if (!screen.queryByRole('combobox', { name: '选择分组' })) fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: '选择分组' })).toBeTruthy());
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: id } });
}

const familyId = `catalog:${baseTag}`;
const itemKeys = (container: ParentNode) => [...container.querySelectorAll<HTMLElement>('[data-gallery-work-id]')].map(item => item.dataset.galleryWorkId);
const transfer = () => {
  const values = new Map<string, string>();
  return { get types() { return [...values.keys()]; }, setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || '', effectAllowed: '', dropEffect: '' };
};
const dragToDirectory = (key: string) => {
  if (!screen.queryByRole('complementary', { name: '分组导航' })) fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  const source = document.querySelector<HTMLElement>(`[data-gallery-work-id="${key}"]`)!;
  const target = within(screen.getByRole('complementary', { name: '分组导航' })).getByRole('button', { name: /^甲组(?: \(|$)/ });
  const dataTransfer = transfer();
  expect(source.getAttribute('draggable')).toBe('true');
  fireEvent.dragStart(source, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer }); fireEvent.dragEnd(source, { dataTransfer });
};

it.each([1280, 390])('宽度 %s 时普通列表按跨页完整目录折叠胡滕，键盘或触控展开不改变独立选择', async width => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  const view = setup(width, [custom]);
  const family = await screen.findByRole('group', { name: '角色变体：胡滕' });
  expect(mocks.all).toHaveBeenCalledOnce();
  expect(family.getAttribute('data-character-family')).toBe(familyId);
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`]);
  expect(screen.queryByRole('button', { name: `选择角色：胡滕（女仆）` })).toBeNull();
  expect(screen.getByRole('button', { name: '选择角色：手工角色' })).toBeTruthy();
  expect(view.container.querySelector('[data-return-item-id="synthetic-custom"]')?.closest('[data-character-family]')).toBeNull();

  const representative = within(family).getByRole('button', { name: '展开角色变体：胡滕' });
  expect(representative.getAttribute('aria-expanded')).toBe('false');
  if (width >= 768) {
    fireEvent.keyDown(representative, { key: 'Enter' });
    expect(representative.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(representative, { key: ' ' });
  } else {
    fireEvent.click(representative);
    expect(representative.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(representative);
  }
  expect(representative.getAttribute('aria-expanded')).toBe('false');
  expect(representative.getAttribute('aria-pressed')).toBe('false');
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`]);

  const chooseRepresentative = within(family).getByRole('button', { name: '选择角色：胡滕' });
  expect(chooseRepresentative.textContent).toBe('胡滕');
  expect(chooseRepresentative.querySelector('svg')).toBeNull();
  expect(chooseRepresentative.className).not.toContain('rounded-full');
  fireEvent.click(chooseRepresentative);
  expect(representative.getAttribute('aria-expanded')).toBe('false');
  expect(representative.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(representative);
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`, `catalog:${maidTag}`, `catalog:${ignitionTag}`]);
  const child = family.querySelector<HTMLElement>(`[data-gallery-work-id="catalog:${maidTag}"]`)!;
  fireEvent.click(child);
  expect(child.getAttribute('aria-pressed')).toBe('true');
  expect(representative.getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(representative);
  await screen.findByRole('button', { name: '继续向下滚动加载更多' });
  fireEvent.click(screen.getByRole('button', { name: '继续向下滚动加载更多' }));
  await screen.findByRole('button', { name: '选择角色：独立角色' });
  expect(screen.getAllByRole('group', { name: /角色变体/ })).toHaveLength(1);
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`]);

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '胡滕（女仆）' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '选择角色：胡滕（女仆）' })).toBeTruthy());
  expect(screen.queryByRole('group', { name: '角色变体：胡滕' })).toBeNull();
  expect(screen.queryByRole('button', { name: '选择角色：胡滕（点火）' })).toBeNull();
});

it('当前文件夹与收藏范围只展开各自匹配的族成员，不泄漏其他变体', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  localStorage.setItem('nai_character_favorites', JSON.stringify([`catalog:${ignitionTag}`]));
  mocks.state.memberships = { [`catalog:${maidTag}`]: ['one'], [`catalog:${ignitionTag}`]: ['one'] };
  setup();

  await selectGroup('one');
  const family = await screen.findByRole('group', { name: '角色变体：胡滕（女仆）' });
  expect(itemKeys(family)).toEqual([`catalog:${maidTag}`]);
  expect(screen.queryByRole('button', { name: '选择角色：胡滕' })).toBeNull();
  expect(screen.queryByRole('button', { name: '选择角色：胡滕（点火）' })).toBeNull();
  fireEvent.click(within(family).getByRole('button', { name: '展开角色变体：胡滕（女仆）' }));
  expect(itemKeys(family)).toEqual([`catalog:${maidTag}`, `catalog:${ignitionTag}`]);

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ignition' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '选择角色：胡滕（点火）' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '选择角色：胡滕（女仆）' })).toBeNull();
  expect(screen.queryByRole('group', { name: /角色变体/ })).toBeNull();

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await selectGroup('#favorites');
  await waitFor(() => expect(screen.getByRole('button', { name: '选择角色：胡滕（点火）' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: '选择角色：胡滕（女仆）' })).toBeNull();
  expect(screen.queryByRole('group', { name: /角色变体/ })).toBeNull();
});

it('随机浏览折叠族成员时只展开本批抽中的身份', async () => {
  const catalog: CharacterDictionaryEntry[] = [
    ...characterEntries,
    ...Array.from({ length: 9 }, (_, index) => ({ name: `solo_${index}`, chinese: `单体${index}`, postCount: 50 - index })),
  ];
  mocks.page.mockImplementation(async (page: number) => ({ entries: page ? catalog.slice(1) : catalog.slice(0, 1), page, pageCount: 2, pageSize: 1, total: catalog.length }));
  mocks.all.mockResolvedValue(catalog);
  mocks.at.mockImplementation(async (indices: number[]) => indices.map(index => catalog[index]));
  localStorage.setItem('nai_character_gacha_mode', 'catalog');
  localStorage.setItem('nai_character_gacha_count', '6');
  const draw = vi.spyOn(libraryRandom, 'drawLibraryIndices').mockReturnValue([0, 1, 3, 4, 5, 6]);
  setup();
  await screen.findByRole('button', { name: '选择角色：胡滕' });
  fireEvent.click(screen.getByRole('button', { name: '随机抽卡' }));
  await screen.findByRole('button', { name: '再抽一批' });
  expect(draw).toHaveBeenCalledOnce();
  expect(screen.getByText(/正在浏览随机抽取的 6 位角色/)).toBeTruthy();
  const family = screen.getByRole('group', { name: '角色变体：胡滕' });
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`]);
  fireEvent.click(within(family).getByRole('button', { name: '展开角色变体：胡滕' }));
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`, `catalog:${maidTag}`]);
  expect(screen.getByText(/正在浏览随机抽取的 6 位角色/)).toBeTruthy();
  fireEvent.click(within(family).getByRole('button', { name: '收起角色变体：胡滕' }));
  expect(screen.getByText(/正在浏览随机抽取的 6 位角色/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '选择角色：胡滕（点火）' })).toBeNull();
  expect(within(family).queryByRole('button', { name: '选择角色：独立角色' })).toBeNull();
  expect(screen.getByRole('button', { name: '选择角色：独立角色' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^选择角色：单体/ })).toHaveLength(3);
});


it('目录分页按族而非变体张数决定继续加载，展开不膨胀真实候选数', async () => {
  const many = [characterEntries[0], ...Array.from({ length: 61 }, (_, index) => ({ name: `ulrich_von_hutten_(costume_${index})_(azur_lane)`, chinese: `胡滕形态${index}`, postCount: 60 - index }))];
  mocks.all.mockResolvedValue(many);
  setup(); await selectGroup('#source:catalog');
  const family = await screen.findByRole('group', { name: '角色变体：胡滕' });
  expect(within(family).getByText('62 种形态')).toBeTruthy();
  expect(itemKeys(family)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '继续向下滚动加载更多' })).toBeNull();
  expect(screen.getByText('角色 62 · 显示 1 张卡片')).toBeTruthy();
  fireEvent.click(within(family).getByRole('button', { name: '展开角色变体：胡滕' }));
  expect(itemKeys(family)).toHaveLength(62);
  expect(screen.getByText('角色 62 · 显示 62 张卡片')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '继续向下滚动加载更多' })).toBeNull();
});


it('自动连续加载：全局完整目录搜索按60组触底显示第61个匹配', async () => {
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); } unobserve() {} disconnect() {} });
  const matches = Array.from({ length: 61 }, (_, index) => ({ name: `common_role_${index}`, chinese: `共同角色${index}`, postCount: 100 - index }));
  mocks.all.mockResolvedValue(matches);
  setup(); await waitFor(() => expect(mocks.all).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'common' } });
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^选择角色：共同角色/ })).toHaveLength(61));
  expect(screen.getByRole('button', { name: '选择角色：共同角色60' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '继续向下滚动加载更多' })).toBeNull();
});

it('拖动折叠代表入组会加入完整族（含未加载变体）并保留每个成员原有目录', async () => {
  mocks.state.memberships = {
    [`catalog:${baseTag}`]: ['two'], [`catalog:${maidTag}`]: ['two'], [`catalog:${ignitionTag}`]: ['two'],
  };
  setup();
  const family = await screen.findByRole('group', { name: '角色变体：胡滕' });
  expect(itemKeys(family)).toEqual([`catalog:${baseTag}`]);

  dragToDirectory(`catalog:${baseTag}`);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const saved = mocks.save.mock.calls[0][0].memberships;
  for (const tag of [baseTag, maidTag, ignitionTag]) expect(saved[`catalog:${tag}`]).toEqual(['two', 'one']);
});

it('把服装成员和自定义角色设组时按族去重，保留真实身份且不串入另一作品同名角色', async () => {
  localStorage.setItem('nai_character_link_variant_favorites', 'false');
  const otherWork: CharacterDictionaryEntry = { name: 'ulrich_von_hutten_(other_series)', chinese: '胡滕（女仆）', postCount: 65 };
  const catalog = [...characterEntries, otherWork];
  mocks.page.mockImplementation(async (page: number) => ({ entries: page ? catalog.slice(1) : catalog.slice(0, 1), page, pageCount: 2, pageSize: 1, total: catalog.length }));
  mocks.all.mockResolvedValue(catalog);
  mocks.at.mockImplementation(async (indices: number[]) => indices.map(index => catalog[index]));
  setup(1280, [custom]);
  const family = await screen.findByRole('group', { name: '角色变体：胡滕' });
  fireEvent.click(within(family).getByRole('button', { name: '展开角色变体：胡滕' }));
  const maid = family.querySelector<HTMLElement>(`[data-gallery-work-id="catalog:${maidTag}"]`)!;
  const ignition = family.querySelector<HTMLElement>(`[data-gallery-work-id="catalog:${ignitionTag}"]`)!;
  fireEvent.click(maid); fireEvent.click(ignition);
  fireEvent.click(screen.getByRole('button', { name: '选择角色：手工角色' }));
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '甲组' }));
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));

  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const saved = mocks.save.mock.calls[0][0].memberships;
  for (const tag of [baseTag, maidTag, ignitionTag]) expect(saved[`catalog:${tag}`]).toEqual(['one']);
  expect(saved['custom:synthetic-custom']).toEqual(['one']);
  expect(saved['catalog:ulrich_von_hutten_(other_series)']).toBeUndefined();
});

it('拖入已有部分成员的目录只补缺项，族已全归属时重复拖动不再保存', async () => {
  mocks.state.memberships = { [`catalog:${maidTag}`]: ['one', 'two'] };
  setup();
  await screen.findByRole('group', { name: '角色变体：胡滕' });
  dragToDirectory(`catalog:${baseTag}`);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const saved = mocks.save.mock.calls[0][0].memberships;
  expect(saved[`catalog:${baseTag}`]).toEqual(['one']);
  expect(saved[`catalog:${maidTag}`]).toEqual(['one', 'two']);
  expect(saved[`catalog:${ignitionTag}`]).toEqual(['one']);

  dragToDirectory(`catalog:${baseTag}`);
  await act(async () => {});
  expect(mocks.save).toHaveBeenCalledOnce();
});

it('词库失败时族成员设组明确报错且不部分保存，自定义角色仍可单独设组', async () => {
  const outside = { ...custom, id: 'custom-outside', name: '另一自定义角色' };
  mocks.all.mockRejectedValue(new Error('合成目录不可用'));
  setup(1280, [custom]);
  await screen.findByRole('button', { name: '重试' });
  fireEvent.click(screen.getByRole('button', { name: '选择角色：胡滕' }));
  fireEvent.click(screen.getByRole('button', { name: '选择角色：手工角色' }));
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '甲组' }));
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  expect((await screen.findAllByRole('alert')).some(node => node.textContent?.includes('角色 Tag 目录加载失败，请重试'))).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.state.memberships).toEqual({});

  cleanup();
  mocks.all.mockRejectedValue(new Error('合成目录不可用'));
  setup(1280, [custom, outside]);
  await screen.findByRole('button', { name: '重试' });
  fireEvent.click(screen.getByRole('button', { name: '选择角色：手工角色' }));
  fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '甲组' }));
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships['custom:synthetic-custom']).toEqual(['one']);
  expect(mocks.save.mock.calls[0][0].memberships['custom:custom-outside']).toBeUndefined();
});

it('自动连续加载：角色分页失败停住，明确重试成功后才继续', async () => {
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); } unobserve() {} disconnect() {} });
  mocks.page.mockImplementation(async (page: number) => {
    if (page === 1) throw new Error('合成分页失败');
    return { entries: characterEntries.slice(0, 1), page, pageCount: 2, total: 4, pageSize: 1 };
  });
  setup();
  await screen.findByText('加载更多角色失败，请稍后重试');
  const calls = mocks.page.mock.calls.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(mocks.page).toHaveBeenCalledTimes(calls);
  mocks.page.mockResolvedValue({ entries: characterEntries.slice(1), page: 1, pageCount: 2, total: 4, pageSize: 1 });
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.queryByText('加载更多角色失败，请稍后重试')).toBeNull());
  expect(mocks.page).toHaveBeenCalledTimes(calls + 1);
});
