// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} }));
import type { PromptChain } from '../../types';
import { PromptBrowseHighlight, PromptLibraryBrowser, type PromptLibraryBrowserProps } from '../../components/PromptLibraryBrowser';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { longPress } from '../support/touchEvents';
import { mockGalleryGeometry } from '../support/galleryGeometry';

vi.mock('../../components/SmartImage', async importOriginal => ({ ...await importOriginal<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt, className, containerClassName = 'relative h-full w-full overflow-hidden' }: { src: string; alt: string; className?: string; containerClassName?: string }) => <div className={containerClassName}><img src={src} alt={alt} className={className} /></div> }));
vi.mock('../../components/ImageShareActions', async importOriginal => ({ ...await importOriginal<typeof import('../../components/ImageShareActions')>(), ImageShareActions: ({ favorite }: { favorite: { sourceType: string; sourceId: string } }) => <div data-card-action="true" data-testid="image-share" data-source-type={favorite.sourceType} data-source-id={favorite.sourceId} onClick={event => event.stopPropagation()}><button aria-label="收藏">收藏</button><button aria-label="下载图片">下载</button><button aria-label="复制图片">复制图</button></div> }));
const entries = [
  { id: 'dress', ...createFragmentData('night dress', '礼服', 'wardrobe'), tags: ['晚间', '正式'] },
  { id: 'raw', ...prepareCollectedPrompt('night garden', '花园'), tags: ['晚间'] },
] as PromptChain[];
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); delete document.documentElement.dataset.galleryFrostedCaption; });
const use = vi.fn(); const edit = vi.fn();
const Harness = ({ chains = entries, notify = vi.fn(), ...props }: Partial<Pick<PromptLibraryBrowserProps, 'chains' | 'focusEntryId' | 'categoryNames' | 'onMoveDirectory' | 'directoriesBusy' | 'categoryTree' | 'onCreateCategory' | 'onCreateDirectory' | 'onRenameCategory' | 'onDeleteCategory' | 'onRenameDirectory' | 'onDeleteDirectory' | 'onMoveCategory' | 'categoriesBusy' | 'onMoveDirectory' | 'directoriesBusy' | 'onExtract' | 'categoryChange' | 'onUpdateTags' | 'onDelete' | 'notify'>>) => {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <><div ref={setSlot} data-toolbar-caption-host /><PromptLibraryBrowser {...props} chains={chains} toolbarSlot={slot} onUse={use} onOpen={edit} notify={notify} /></>;
};

it('已选详情遇到主动搜索从顶部显示，旧作品锚点不抢回位置', async () => {
  render(<Harness chains={[entries[0], { ...entries[0], id: 'second', name: '另一条礼服' }]} />);
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-gallery-work-id]'));
  const { root } = mockGalleryGeometry(cards);
  fireEvent.click(screen.getByRole('button', { name: '查看礼服' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(root.scrollTop).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '礼服' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(root.scrollTop).toBe(0);
  expect(screen.getByRole('complementary', { name: '礼服' })).toBeTruthy();
});

it('默认片段，只保留片段组合两项，切范围保留查询并正确取用', () => {
  const combo = { id: 'combo', ...createCombinationData('夜间组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }) } as PromptChain;
  render(<Harness chains={[...entries, combo]} />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement;
  expect(scope.value).toBe('items'); expect(Array.from(scope.options).map(option => option.value)).toEqual(['items', 'saved']);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  expect(document.querySelector('[data-prompt-library-entry="raw"]')).toBeNull();
  fireEvent.change(scope, { target: { value: 'saved' } });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('night');
  fireEvent.click(screen.getByRole('button', { name: '查看夜间组合' }));
  const detail = screen.getByRole('complementary', { name: '夜间组合' });
  fireEvent.click(within(detail).getByRole('button', { name: '编辑' })); expect(edit).toHaveBeenLastCalledWith(combo);
  fireEvent.click(within(detail).getByRole('button', { name: '使用' })); expect(use).toHaveBeenLastCalledWith(combo);
});

it('带封面详情沿用图库侧栏，图片外层按内容收缩，关闭后保留列表与位置', () => {
  const covered = { ...entries[0], previewImage: '/api/assets/synthetic-cover.png' };
  render(<Harness chains={[covered]} />);
  const scroll = document.querySelector('.workspace-scroll-viewport') as HTMLDivElement;
  scroll.scrollTop = 130; fireEvent.scroll(scroll);
  fireEvent.click(screen.getByRole('button', { name: '查看礼服' }));
  const detail = screen.getByRole('complementary', { name: '礼服' });
  const split = detail.parentElement!;
  expect(split).toBe(scroll.parentElement);
  expect(split.classList.contains('lg:grid-cols-[minmax(0,1fr)_460px]')).toBe(true);
  expect(detail.classList.contains('fixed')).toBe(true);
  expect(detail.classList.contains('lg:static')).toBe(true);
  const image = within(detail).getByRole('img', { name: '礼服' });
  expect(image.parentElement?.classList.contains('h-full')).toBe(false);
  expect(image.classList.contains('h-auto')).toBe(true);
  expect(image.classList.contains('max-h-[40vh]')).toBe(true);
  expect(image.closest('.rounded-2xl')).toBeTruthy();
  expect(within(detail).getByText('night dress')).toBeTruthy();
  expect(within(detail).getByRole('button', { name: '下载图片' })).toBeTruthy();
  expect(within(detail).getByRole('button', { name: '复制图片' })).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: '放大查看：礼服' }));
  expect(screen.getByRole('dialog', { name: '图片预览' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '放大图片' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回图片详情' }));
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
  expect(scroll.scrollTop).toBe(130);
  fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('complementary', { name: '礼服' })).toBeNull();
  expect(document.querySelector('.workspace-scroll-viewport')).toBe(scroll);
  expect(scroll.scrollTop).toBe(130);
  expect(split.classList.contains('lg:grid-cols-[minmax(0,1fr)_460px]')).toBe(false);
});

it('新目录组合展示路径正文负面与约束，没有封面不预留图片区，旧组合继续展示', () => {
  const combo = { id: 'dynamic', ...createCombinationData('目录组合', {
    'directory:person-wardrobe': { kind: 'directory:person-wardrobe', directoryId: 'person-wardrobe', directoryName: '服饰与配件', directoryPath: ['人物整体', '服饰与配件'], scope: 'character', filled: true, text: 'winter coat', negative: 'summer dress', constraintNotes: '保留围巾' },
    scene: { kind: 'scene', filled: true, text: 'snowy street', negative: 'beach' },
  }) } as PromptChain;
  render(<Harness chains={[combo]} focusEntryId="dynamic" />);
  const detail = screen.getByRole('complementary', { name: '目录组合' });
  expect(within(detail).queryByRole('img')).toBeNull();
  for (const text of ['人物整体 / 服饰与配件', 'winter coat', '负面提示词：summer dress', '保留围巾', 'snowy street', '负面提示词：beach']) expect(within(detail).getByText(text)).toBeTruthy();
});

it.each(['auto', 4])('列数偏好%s：详情按剩余宽度减少列数，关闭恢复且不改偏好', desktopColumns => {
  const preferences = JSON.stringify({ layout: 'masonry', columns: 2, desktopColumns });
  localStorage.setItem('nai_mobile_image_display', preferences);
  const resizes = new Map<object, (width: number) => void>();
  const resize = (width: number) => resizes.forEach(callback => callback(width));
  const OriginalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      if (target.classList.contains('workspace-scroll-viewport')) resizes.set(this, width => this.callback([{ target, contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver));
    }
    disconnect() { resizes.delete(this); }
    unobserve() { resizes.delete(this); }
  } as unknown as typeof ResizeObserver;
  const view = render(<Harness />);
  try {
    const grid = document.querySelector<HTMLElement>('.chain-masonry')!;
    act(() => resize(800));
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
    expect(localStorage.getItem('nai_mobile_image_display')).toBe(preferences);
    fireEvent.click(screen.getByRole('button', { name: '查看礼服' }));
    act(() => resize(280));
    expect(grid.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    fireEvent.click(within(screen.getByRole('complementary', { name: '礼服' })).getByRole('button', { name: '关闭' }));
    act(() => resize(800));
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  } finally { view.unmount(); globalThis.ResizeObserver = OriginalObserver; }
});

it('定位刚收录的条目清除查询并打开详情，不调用编辑或修改条目', () => {
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  view.rerender(<Harness focusEntryId="raw" />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  expect(screen.getByRole('complementary', { name: '花园' })).toBeTruthy();
});

it('只跨重启记住范围排序，不记住关键词和标签', () => {
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  view.unmount(); render(<Harness />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('saved');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('只读迁移旧用途偏好到目录筛选，不自动重写本地偏好', () => {
  localStorage.setItem('nai-prompt-library-browse', JSON.stringify({ scope: 'items', kind: 'wardrobe', sort: 'name' }));
  render(<Harness />);
  expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeTruthy();
  expect(document.querySelector('[data-prompt-library-entry="raw"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai-prompt-library-browse') || '{}')).toMatchObject({ kind: 'wardrobe' });
  expect(JSON.parse(localStorage.getItem('nai-prompt-library-browse') || '{}').directoryIds).toBeUndefined();
});

it('目录选择显式切到片段，所有选中标签按交集过滤', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.click(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  fireEvent.click(screen.getByRole('button', { name: '晚间' }));
  fireEvent.click(screen.getByRole('button', { name: '正式' }));
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeTruthy();
});

it('范围往返恢复各自位置，重开仍恢复上次范围位置', () => {
  const view = render(<Harness />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' });
  const scroll = document.querySelector('.workspace-scroll-viewport') as HTMLDivElement;
  scroll.scrollTop = 240; fireEvent.scroll(scroll);
  fireEvent.change(scope, { target: { value: 'saved' } });
  expect(scroll.scrollTop).toBe(0);
  scroll.scrollTop = 80; fireEvent.scroll(scroll);
  fireEvent.change(scope, { target: { value: 'items' } });
  expect(scroll.scrollTop).toBe(240);
  view.unmount(); render(<Harness />);
  expect((document.querySelector('.workspace-scroll-viewport') as HTMLDivElement).scrollTop).toBe(240);
});

it('中英文多空白命中按原串范围高亮，保留正文且正则符号按字面匹配', () => {
  const english = '前缀  NIGHT' + String.fromCharCode(9) + ' dress 后缀 night   dress';
  const view = render(<PromptBrowseHighlight text={english} query=" night   dress " />);
  expect(view.container.textContent).toBe(english);
  expect(Array.from(view.container.querySelectorAll('mark')).map(node => node.textContent)).toEqual(['NIGHT' + String.fromCharCode(9) + ' dress', 'night   dress']);
  view.rerender(<PromptBrowseHighlight text="前缀 夜间   花园 后缀" query="夜间 花园" />);
  expect(view.container.querySelector('mark')?.textContent).toBe('夜间   花园');
  view.rerender(<PromptBrowseHighlight text="a (dress)+ b" query="(dress)+" />);
  expect(view.container.querySelector('mark')?.textContent).toBe('(dress)+');
});

it('管理入口先关闭筛选层，避免其遮挡后打开的管理对话框', () => {
  const ManageHarness = () => {
    const [slot, setSlot] = useState<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    return <><div ref={setSlot} /><PromptLibraryBrowser chains={entries} toolbarSlot={slot} onUse={use} onOpen={edit} notify={vi.fn()} onManage={() => setOpen(true)} />{open && <div role="dialog" aria-label="资料管理" />}</>;
  };
  render(<ManageHarness />);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('dialog', { name: '筛选提示词库' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '管理提示词' }));
  expect(screen.queryByRole('dialog', { name: '筛选提示词库' })).toBeNull();
  expect(screen.getByRole('dialog', { name: '资料管理' })).toBeTruthy();
});

it('目录仅保留统一新建编辑删除，筛选与导航不再提供重复管理入口', () => {
  render(<Harness onCreateDirectory={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(screen.getByRole('button', { name: '新建目录' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '管理目录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.queryByRole('button', { name: '管理分类' })).toBeNull();
});

it('主浏览片段目录拖动接入持久化回调，保存期间禁用拖动且不更改当前筛选', () => {
  const move = vi.fn(); const before = JSON.stringify(entries);
  const view = render(<Harness onMoveDirectory={move} />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const source = screen.getByRole('button', { name: '人物整体 / 外貌与身体' });
  const target = screen.getByRole('button', { name: '场景环境' });
  const values = new Map<string, string>();
  const dataTransfer = { setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) || '', get types() { return [...values.keys()]; }, effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(move).toHaveBeenCalledWith('person-appearance', 'environment');
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-current')).toBe('page');
  expect(JSON.stringify(entries)).toBe(before);
  view.rerender(<Harness onMoveDirectory={move} directoriesBusy />);
  expect(screen.getByRole('button', { name: '人物整体 / 外貌与身体' }).getAttribute('draggable')).not.toBe('true');
});

it('手机管理等待筛选历史返回完成后才打开，避免迟到返回误关新窗口', async () => {
  const originalWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;
  const originalState = window.history.state;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const manage = vi.fn();
  const MobileHarness = () => {
    const [slot, setSlot] = useState<HTMLDivElement | null>(null);
    return <><div ref={setSlot} /><PromptLibraryBrowser chains={entries} toolbarSlot={slot} onUse={use} onOpen={edit} notify={vi.fn()} onManage={manage} /></>;
  };
  const view = render(<MobileHarness />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(window.history.state.__naiMobileLayer).toMatch(/^sheet-/);
    fireEvent.click(screen.getByRole('button', { name: '管理提示词' }));
    expect(screen.queryByRole('dialog', { name: '筛选提示词库' })).toBeNull();
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(manage).not.toHaveBeenCalled();
    window.history.replaceState(originalState, '');
    fireEvent(window, new PopStateEvent('popstate', { state: originalState }));
    await waitFor(() => expect(manage).toHaveBeenCalledTimes(1));
  } finally {
    view.unmount(); back.mockRestore();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    window.matchMedia = originalMatchMedia;
    window.history.replaceState(originalState, '');
  }
});

it('组合详情只提交自定义标签，切换条目隔离草稿；组合筛选不显示预设用途且支持交集与清除', async () => {
  const one = { id: 'one', ...createCombinationData('组合一', { scene: { kind: 'scene', filled: true, text: 'moon garden' } }, ['旧']) } as PromptChain;
  const two = { id: 'two', ...createCombinationData('组合二', { scene: { kind: 'scene', filled: true, text: 'sun garden' } }, ['夜晚']) } as PromptChain;
  const update = vi.fn(async (_chain: PromptChain, _tags: string[]) => {});
  const TagHarness = () => {
    const [chains, setChains] = useState([one, two]);
    const [slot, setSlot] = useState<HTMLDivElement | null>(null);
    return <><div ref={setSlot} /><PromptLibraryBrowser chains={chains} toolbarSlot={slot} onUse={use} onOpen={edit} notify={vi.fn()}
      onUpdateTags={async (chain, tags) => { await update(chain, tags); setChains(previous => previous.map(item => item.id === chain.id ? { ...item, tags } : item)); }} /></>;
  };
  render(<TagHarness />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '查看组合一' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '另一条草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '查看组合二' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  expect((screen.getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('夜晚');
  fireEvent.click(screen.getByRole('button', { name: '查看组合一' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  expect((screen.getByRole('textbox', { name: '编辑自定义标签' }) as HTMLInputElement).value).toBe('旧');
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '夜晚，城市, 夜晚' } });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(one, ['夜晚', '城市']));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑自定义标签' })).toBeNull());
  const detail = screen.getByRole('complementary', { name: '组合一' });
  expect(within(detail).getByText('moon garden')).toBeTruthy();
  expect(within(detail).getByText('城市')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('dialog', { name: '筛选组合' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: '片段用途' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '夜晚' }));
  fireEvent.click(screen.getByRole('button', { name: '城市' }));
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  expect(document.querySelector('[data-prompt-library-entry="one"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除标签筛选' }));
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2);
});

it('顶栏范围、搜索、筛选统一手机44与桌面40高度，宽栏范围容器不再使用36高度', () => {
  const narrow = render(<Harness />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' });
  expect(scope.classList.contains('h-11')).toBe(true);
  expect(scope.classList.contains('md:h-10')).toBe(true);
  const search = screen.getByRole('searchbox');
  expect(search.classList.contains('!h-11')).toBe(true);
  expect(search.classList.contains('md:!h-10')).toBe(true);
  const filterHost = screen.getByRole('button', { name: '筛选' }).parentElement!;
  expect(filterHost.classList.contains('[&>button]:!h-11')).toBe(true);
  expect(filterHost.classList.contains('md:[&>button]:!h-10')).toBe(true);
  narrow.unmount();
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 40, top: 0, left: 0, right: 800, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  const wide = render(<Harness />);
  try {
    const tabs = screen.getByRole('tablist', { name: '提示词库分区' });
    expect(tabs.classList.contains('h-11')).toBe(true);
    expect(tabs.classList.contains('md:h-10')).toBe(true);
    expect(tabs.classList.contains('h-9')).toBe(false);
    expect(screen.getByRole('button', { name: '筛选' }).parentElement?.classList.contains('md:[&>button]:!h-10')).toBe(true);
  } finally { wide.unmount(); rect.mockRestore(); }
});

it('目录独立于筛选，收展保留搜索、标签、详情和同一列表滚动节点', () => {
  render(<Harness />);
  const folder = screen.getByRole('button', { name: '展开目录' });
  expect(folder.parentElement?.firstElementChild).toBe(folder);
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('complementary', { name: '提示词目录导航' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(within(screen.getByRole('dialog', { name: '筛选提示词库' })).queryByText('片段目录')).toBeNull();
  expect(within(screen.getByRole('dialog', { name: '筛选提示词库' })).queryByRole('button', { name: '管理目录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '晚间' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(folder);
  const nav = screen.getByRole('complementary', { name: '提示词目录导航' });
  const scroll = document.querySelector('.workspace-scroll-viewport') as HTMLDivElement;
  expect(nav.nextElementSibling).toBe(scroll.parentElement); expect(nav.parentElement?.style.getPropertyValue('--workspace-chrome-height')).toBe('0px');
  expect(nav.classList.contains('md:w-52')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }));
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  fireEvent.click(screen.getByRole('button', { name: '查看礼服' }));
  const detail = screen.getByRole('complementary', { name: '礼服' });
  scroll.scrollTop = 210; fireEvent.scroll(scroll);
  fireEvent.click(screen.getByRole('button', { name: '收起目录' }));
  expect(document.querySelector('.workspace-scroll-viewport')).toBe(scroll); expect(scroll.scrollTop).toBe(210);
  expect(screen.getByRole('complementary', { name: '礼服' })).toBe(detail);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('night');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('button', { name: '晚间' }).getAttribute('aria-pressed')).toBe('true');
});

it('范围往返保留目录选择，组合不套目录限制，手机使用紧凑选择框', () => {
  const combo = { id: 'combo', ...createCombinationData('夜间组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }) } as PromptChain;
  render(<Harness chains={[...entries, combo]} />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const select = screen.getByRole('combobox', { name: '选择提示词目录' });
  expect(select.classList.contains('md:hidden')).toBe(true);
  fireEvent.change(select, { target: { value: 'person-wardrobe' } });
  const scope = screen.getByRole('combobox', { name: '提示词库范围' });
  fireEvent.change(scope, { target: { value: 'saved' } });
  expect(document.querySelector('[data-prompt-library-entry="combo"]')).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: '提示词目录导航' })).toBeNull();
  fireEvent.change(scope, { target: { value: 'items' } });
  expect((screen.getByRole('combobox', { name: '选择提示词目录' }) as HTMLSelectElement).value).toBe('person-wardrobe');
  expect(screen.getByRole('button', { name: '收起目录' }).title).toContain('人物整体 / 服饰与配件');
  expect(screen.getByRole('button', { name: '筛选' }).textContent).not.toContain('服饰');
});

it('展开偏好跨重挂载保留，旧多目录偏好在新点选前不被改写', () => {
  const preference = { scope: 'items', directoryIds: ['person-wardrobe', 'person-pose'], allDirectories: false, unclassified: false, sort: 'updated' };
  localStorage.setItem('nai-prompt-library-browse', JSON.stringify(preference));
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(localStorage.getItem('nai-prompt-library-browse')).toBe(JSON.stringify(preference));
  expect((screen.getByRole('combobox', { name: '选择提示词目录' }) as HTMLSelectElement).value).toBe('#selected');
  view.unmount(); render(<Harness />);
  expect(screen.getByRole('button', { name: '收起目录' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }));
  expect(JSON.parse(localStorage.getItem('nai-prompt-library-browse') || '{}').directoryIds).toEqual(['person-wardrobe']);
});

it('组合分类仅列组合标签与预建目录，详情候选同源，重命名合并同步所选分类并去重', () => {
  const combo = { id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }, ['旧分类', '目标分类']) } as PromptChain;
  const chains = [...entries, combo];
  const view = render(<Harness chains={chains} categoryNames={['预建空分类']} onUpdateTags={async () => {}} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '查看组合' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.getByRole('button', { name: '#预建空分类' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '#晚间' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('button', { name: '预建空分类' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '晚间' })).toBeNull();
  expect(screen.queryByRole('button', { name: '正式' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '旧分类' }));
  fireEvent.click(screen.getByRole('button', { name: '目标分类' }));
  const merged = { ...combo, tags: ['目标分类'] };
  view.rerender(<Harness chains={[...entries, merged]} categoryNames={['预建空分类']} categoryChange={{ from: '旧分类', to: '目标分类', token: 1 }} onUpdateTags={async () => {}} />);
  expect(screen.queryByRole('button', { name: '旧分类' })).toBeNull();
  expect(screen.getByRole('button', { name: '目标分类' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('[data-prompt-library-entry="combo"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '目标分类' }));
  expect(screen.queryByRole('button', { name: '清除标签筛选' })).toBeNull();
});

it.each([390, 1280])('宽度%d组合筛选只负责筛选，文件夹统一入口可预建空分类', width => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const create = vi.fn();
  const view = render(<Harness categoryNames={['空分类']} onCreateCategory={create} />);
  try {
    if (width < 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
    if (width >= 768) fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    expect(screen.queryByRole('button', { name: '管理分类' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
    expect(screen.queryByRole('button', { name: '管理组合分类' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
    expect(create).toHaveBeenCalledWith(null);
  } finally { view.unmount(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
});

it('组合详情仍使用组合专属标签候选，包含预建空分类且排除片段原文标签', () => {
  const combo = { id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }, ['组合分类']) } as PromptChain;
  render(<Harness chains={[...entries, combo]} categoryNames={['预建空分类']} onUpdateTags={async () => {}} />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '查看组合' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.getByRole('button', { name: '#预建空分类' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '#晚间' })).toBeNull();
  expect(screen.queryByRole('button', { name: '#正式' })).toBeNull();
});

it('组合候选复用分类目录规则，隐藏内部及自动来源标记，保留真实分类且不改原标签', () => {
  const tagged = { id: 'tagged', ...createCombinationData('有分类组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }) , tags: ['待实测', '__内部__', 'Pixiv', '普通分类'] } as PromptChain;
  const empty = { id: 'empty', ...createCombinationData('空分类组合', { scene: { kind: 'scene', filled: true, text: 'day sky' } }) } as PromptChain;
  const before = JSON.stringify(tagged);
  const save = vi.fn(async () => {});
  render(<Harness chains={[...entries, tagged, empty]} categoryNames={['预建空分类']} onUpdateTags={save} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('button', { name: '普通分类' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '预建空分类' })).toBeTruthy();
  for (const name of ['待实测', '__内部__', 'Pixiv', '晚间']) expect(screen.queryByRole('button', { name })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '查看空分类组合' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.getByRole('button', { name: '#普通分类' })).toBeTruthy();
  for (const name of ['#待实测', '#__内部__', '#Pixiv', '#晚间']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(JSON.stringify(tagged)).toBe(before);
  expect(save).not.toHaveBeenCalled();
});

it('片段统一封面与caption卡片，空封面只展示一次摘要，真实图片才有分享动作', () => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry', columns: 1, desktopColumns: 3 }));
  const combo = { id: 'combo', ...createCombinationData('搭配', { scene: { kind: 'scene', filled: true, text: 'rainy garden' } }) } as PromptChain;
  const image = { ...entries[0], previewImage: 'data:image/png;base64,synthetic' };
  render(<Harness chains={[image, { id: 'raw', ...createFragmentData('night garden', '花园', 'general') } as PromptChain, combo]} onDelete={async () => {}} />);
  const grid = document.querySelector('.chain-masonry') as HTMLElement;
  expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  expect(grid.querySelector('.chain-masonry-column')).toBeTruthy();
  for (const card of document.querySelectorAll<HTMLElement>('[data-prompt-library-entry]')) {
    expect(card.classList.contains('gallery-image-card')).toBe(true);
    expect(card.classList.contains('gallery-card-visual')).toBe(true);
    // 磨砂叠图须在卡片本身覆盖瀑布流 inline-flex；关闭时恢复原正常流。
    expect(card.style.display).toBe('grid');
    expect(card.children[0].classList.contains('mobile-gallery-frame')).toBe(true);
    expect(card.children[1].classList.contains('gallery-card-caption')).toBe(true);
    expect(card.querySelector('.image-card-actions')).toBeTruthy();
    const remove = within(card).getByRole('button', { name: /^删除「/ });
    expect(remove.closest('[data-image-action-left]')).toBeTruthy();
    expect(remove.closest('.image-card-actions')).toBeNull();
    const left = remove.closest('[data-image-action-left]')!;
    for (const value of ['hover-reveal-md', 'absolute', 'left-2', 'top-2', 'z-20']) expect(left.classList.contains(value)).toBe(true);
    for (const value of ['mobile-size-locked', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'bg-red-500']) expect(remove.classList.contains(value)).toBe(true);
    expect(within(card).getByRole('button', { name: /^编辑/ }).closest('.image-card-actions')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /^复制(?:礼服|花园|组合数据)/ }).closest('.image-card-actions')).toBeTruthy();
    expect(within(card).getByRole('button', { name: '使用' })).toBeTruthy();
    // 叠图 caption 统一白字，常驻主操作须配强调底以保持浅色主题对比度。
    expect(within(card).getByRole('button', { name: '使用' }).getAttribute('data-tone')).toBe('primary');
  }
  const raw = document.querySelector('[data-prompt-library-entry="raw"]') as HTMLElement;
  expect(raw.querySelector('.mobile-gallery-frame')?.classList.contains('dark:bg-gray-800')).toBe(true);
  expect(within(raw).getAllByText('night garden')).toHaveLength(1);
  expect(raw.querySelector('.gallery-card-caption')?.textContent).not.toContain('night garden');
  expect(within(raw).queryByRole('button', { name: '收藏' })).toBeNull();
  const share = screen.getByTestId('image-share');
  expect(share.dataset.sourceType).toBe('other');
  expect(share.dataset.sourceId).toBe('dress');
  expect(share.closest('[data-prompt-library-entry]')?.getAttribute('data-prompt-library-entry')).toBe('dress');
  expect(share.closest('.image-card-actions')).toBeTruthy();
  expect(share.closest('[data-image-action-left]')).toBeNull();
  act(() => { document.documentElement.dataset.galleryFrostedCaption = 'false'; window.dispatchEvent(new Event('nai-gallery-caption-change')); });
  for (const card of document.querySelectorAll<HTMLElement>('[data-prompt-library-entry]')) expect(card.style.display).toBe('');
  act(() => { document.documentElement.dataset.galleryFrostedCaption = 'true'; window.dispatchEvent(new Event('nai-gallery-caption-change')); });
  for (const card of document.querySelectorAll<HTMLElement>('[data-prompt-library-entry]')) expect(card.style.display).toBe('grid');
});

it('编辑、复制与使用各自执行，不冒泡打开详情，复制正文保持原文', async () => {
  use.mockClear(); edit.mockClear();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Harness chains={[entries[0]]} />);
  fireEvent.click(screen.getByRole('button', { name: '编辑礼服' }));
  expect(edit).toHaveBeenCalledWith(entries[0]);
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '复制礼服' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('night dress'));
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  expect(use).toHaveBeenCalledWith(entries[0]);
  expect(screen.queryByRole('complementary')).toBeNull();
});

it.each([
  entries[0], { id: 'garden', ...createFragmentData('night garden', '花园', 'general') } as PromptChain, { id: 'combo', ...createCombinationData('搭配', { scene: { kind: 'scene', filled: true, text: 'rainy garden' } }) } as PromptChain,
])('删除$name取消和失败保留原详情，实际移除只跟随资料刷新，不误使用', async chain => {
  use.mockClear(); edit.mockClear();
  const notify = vi.fn();
  const remove = vi.fn(async (_chain: PromptChain) => {});
  const view = render(<Harness chains={[chain]} onDelete={remove} notify={notify} />);
  if (chain.id === 'combo') fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: `查看${chain.name}` }));
  fireEvent.click(screen.getByRole('button', { name: `删除「${chain.name}」` }));
  await waitFor(() => expect(screen.getByRole('button', { name: `查看${chain.name}` }).getAttribute('aria-busy')).toBe('false'));
  expect(remove).toHaveBeenCalledWith(chain);
  expect(screen.getByRole('complementary', { name: chain.name })).toBeTruthy();
  expect(notify).not.toHaveBeenCalled();
  remove.mockRejectedValueOnce(new Error('synthetic failure'));
  fireEvent.click(screen.getByRole('button', { name: `删除「${chain.name}」` }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('删除失败：synthetic failure', 'error'));
  expect(screen.getByRole('complementary', { name: chain.name })).toBeTruthy();
  expect(screen.getByRole('button', { name: `查看${chain.name}` })).toBeTruthy();
  expect(use).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
  view.rerender(<Harness chains={[]} onDelete={remove} notify={notify} />);
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(screen.queryByRole('button', { name: `查看${chain.name}` })).toBeNull();
});

it('删除在途只提交一次，等待结束前卡片动作禁用，不提前关闭或报告成功', async () => {
  let complete!: () => void;
  const remove = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const notify = vi.fn();
  render(<Harness chains={[entries[0]]} onDelete={remove} notify={notify} />);
  const button = screen.getByRole('button', { name: '删除「礼服」' });
  fireEvent.click(button); fireEvent.click(button);
  expect(remove).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '查看礼服' }).getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { name: '使用' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => complete());
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('button', { name: '查看礼服' })).toBeTruthy();
  expect(notify).not.toHaveBeenCalled();
});

it('空封面正文长按只显露辅助动作，不误开详情或使用，键盘仍能打开卡片', () => {
  use.mockClear(); edit.mockClear();
  render(<Harness chains={[entries[0]]} />);
  const card = screen.getByRole('button', { name: '查看礼服' });
  try {
    longPress(within(card).getByText('night dress'));
    expect(card.getAttribute('data-press-revealed')).toBe('true');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(use).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByRole('complementary', { name: '礼服' })).toBeTruthy();
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('320手机顶栏保留目录搜索筛选，范围与AI提取收进筛选且等待历史返回', async () => {
  const originalWidth = window.innerWidth, originalMatchMedia = window.matchMedia, originalState = window.history.state;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {}), extract = vi.fn();
  const view = render(<Harness onExtract={extract} />);
  try {
    expect(screen.getByRole('button', { name: '展开目录' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: '提示词库范围' })).toBeNull();
    const search = screen.getByRole('searchbox');
    expect(search.classList.contains('max-[360px]:!pl-2')).toBe(true);
    expect(search.parentElement?.classList.contains('max-[360px]:[&>svg]:hidden')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
    expect(document.querySelector('[data-prompt-library-entry="raw"]')).toBeNull();
    expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeNull();
    expect(document.body.textContent).toContain('组合 · 匹配');
    expect(Array.from((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).options).map(option => option.value)).toEqual(['items', 'saved']);
    fireEvent.click(screen.getByRole('button', { name: 'AI 提取分类' }));
    expect(screen.queryByRole('dialog', { name: '筛选提示词库' })).toBeNull();
    await waitFor(() => expect(back).toHaveBeenCalledOnce()); expect(extract).not.toHaveBeenCalled();
    window.history.replaceState(originalState, ''); fireEvent(window, new PopStateEvent('popstate', { state: originalState }));
    await waitFor(() => expect(extract).toHaveBeenCalledOnce());
  } finally { view.unmount(); back.mockRestore(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); window.matchMedia = originalMatchMedia; window.history.replaceState(originalState, ''); }
});

it('目录全部仅统计和展示片段，排除组合原文与风格串角色', () => {
  const combo = { id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', text: 'night sky', filled: true } }) } as PromptChain;
  const style = { id: 'style', name: '风格串', type: 'style', basePrompt: 'artist:test' } as PromptChain;
  const character = { id: 'character', name: '角色配方', type: 'character', basePrompt: '1girl' } as unknown as PromptChain;
  render(<Harness chains={[...entries, combo, style, character]} />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const nav = screen.getByRole('complementary', { name: '提示词目录导航' });
  expect(within(nav).getByRole('button', { name: '全部' }).textContent).toBe('全部1');
  fireEvent.click(within(nav).getByRole('button', { name: '人物整体 / 服饰与配件' }));
  fireEvent.click(within(nav).getByRole('button', { name: '全部' }));
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
});

it.each(['all', 'originals'])('旧范围%s只读回落片段，保留原文资料与旧本端偏好', scope => {
  const memory = JSON.stringify({ scope, sort: 'name' }), before = JSON.stringify(entries);
  localStorage.setItem('nai-prompt-library-browse', memory);
  render(<Harness />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  expect(document.querySelector('[data-prompt-library-entry="raw"]')).toBeNull();
  expect(localStorage.getItem('nai-prompt-library-browse')).toBe(memory); expect(JSON.stringify(entries)).toBe(before);
});

it('宽桌面只有两个范围tab，键盘往返与Home End遵循两项顺序', () => {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 40, top: 0, left: 0, right: 800, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  try {
    render(<Harness />);
    const tabs = within(screen.getByRole('tablist', { name: '提示词库分区' })).getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['片段', '组合']);
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' }); expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' }); expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0], { key: 'End' }); expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[1], { key: 'Home' }); expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  } finally { rect.mockRestore(); }
});

it('定位原文可独立打开详情并继续编辑取用，定位组合切到组合范围', () => {
  const combo = { id: 'combo', ...createCombinationData('组合定位', { scene: { kind: 'scene', text: 'sky', filled: true } }) } as PromptChain;
  localStorage.setItem('nai-prompt-library-browse', JSON.stringify({ scope: 'items', directoryIds: ['person-pose'], allDirectories: false }));
  const view = render(<Harness chains={[...entries, combo]} focusEntryId="raw" />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('items');
  const detail = screen.getByRole('complementary', { name: '花园' }); expect(within(detail).getByText('night garden')).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: '编辑' })); expect(edit).toHaveBeenLastCalledWith(entries[1]);
  fireEvent.click(within(detail).getByRole('button', { name: '使用' })); expect(use).toHaveBeenLastCalledWith(entries[1]);
  expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeTruthy();
  view.rerender(<Harness chains={[...entries, combo]} focusEntryId="combo" />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('saved');
  expect(screen.getByRole('complementary', { name: '组合定位' })).toBeTruthy();
});

const categoryCombo = (id: string, name: string, tags: string[], prompt = 'night garden') => ({ id, ...createCombinationData(name, { scene: { kind: 'scene', text: prompt, filled: true } }, tags) }) as PromptChain;

it('组合文件夹显示完整计数、空分类与未归类，多分类组合只展示一次且叠加搜索标签', () => {
  const first = categoryCombo('first', '礼服组合', ['夜景', '正式']), second = categoryCombo('second', '街景组合', ['夜景']), empty = { ...categoryCombo('empty', '无分类组合', []), tags: ['待实测', '__内部__', 'Pixiv'] };
  const chains = [...entries, first, second, empty], before = JSON.stringify(chains);
  render(<Harness chains={chains} categoryNames={['空分类']} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const nav = screen.getByRole('complementary', { name: '组合分类导航' });
  expect(within(nav).getByRole('button', { name: '全部' }).textContent).toBe('全部3');
  expect(within(nav).getByRole('button', { name: '未归类' }).textContent).toBe('未归类1');
  expect(within(nav).getByRole('button', { name: '分类「夜景」' }).textContent).toBe('夜景2');
  expect(within(nav).getByRole('button', { name: '分类「空分类」' }).textContent).toBe('空分类0');
  for (const name of ['待实测', '__内部__', 'Pixiv', '晚间']) expect(within(nav).queryByRole('button', { name: '分类「' + name + '」' })).toBeNull();
  expect(within(nav).queryByRole('button', { name: '管理组合分类' })).toBeNull();
  fireEvent.click(within(nav).getByRole('button', { name: '分类「夜景」' })); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '正式' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  expect(within(nav).getByRole('button', { name: '分类「夜景」' }).textContent).toBe('夜景2');
  fireEvent.click(screen.getByRole('button', { name: '查看礼服组合' }));
  const detail = screen.getByRole('complementary', { name: '礼服组合' }), scroll = document.querySelector('.workspace-scroll-viewport') as HTMLDivElement;
  scroll.scrollTop = 88; fireEvent.click(screen.getByRole('button', { name: '收起目录' }));
  expect(screen.getByRole('complementary', { name: '礼服组合' })).toBe(detail); expect(scroll.scrollTop).toBe(88);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' })); expect(screen.getByRole('button', { name: '分类「夜景」' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '清除标签筛选' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '分类「空分类」' })); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '未归类' })); expect(document.querySelector('[data-prompt-library-entry="empty"]')).toBeTruthy();
  expect(JSON.stringify(chains)).toBe(before);
});

it('片段与组合分别保留文件夹、展开偏好和会话标签，关键词继续共用', () => {
  const combo = categoryCombo('combo', '组合', ['组合标签']);
  render(<Harness chains={[...entries, combo]} />);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' })); fireEvent.click(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); expect(screen.queryByRole('button', { name: '组合标签' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '晚间' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  const scope = screen.getByRole('combobox', { name: '提示词库范围' }); fireEvent.change(scope, { target: { value: 'saved' } });
  expect(screen.queryByRole('complementary', { name: '组合分类导航' })).toBeNull(); expect(screen.getByRole('button', { name: '展开目录' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开目录' })); fireEvent.click(screen.getByRole('button', { name: '分类「组合标签」' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '组合标签' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '收起目录' }));
  fireEvent.change(scope, { target: { value: 'items' } }); expect(screen.getByRole('complementary', { name: '提示词目录导航' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '人物整体 / 服饰与配件' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); expect(screen.getByRole('button', { name: '晚间' }).getAttribute('aria-pressed')).toBe('true'); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(scope, { target: { value: 'saved' } }); expect(screen.queryByRole('complementary', { name: '组合分类导航' })).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('night');
  fireEvent.click(screen.getByRole('button', { name: '展开目录' })); expect(screen.getByRole('button', { name: '分类「组合标签」' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); expect(screen.getByRole('button', { name: '组合标签' }).getAttribute('aria-pressed')).toBe('true');
});

it('组合分类改名与合并同步其文件夹和标签，名单中间变化不清选择且不改片段同名筛选', () => {
  const fragment = { ...entries[0], tags: ['旧分类'] }, first = categoryCombo('first', '组合一', ['旧分类', '目标分类']), second = categoryCombo('second', '组合二', ['目标分类']);
  const view = render(<Harness chains={[fragment, first, second]} />);
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '旧分类' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const scope = screen.getByRole('combobox', { name: '提示词库范围' }); fireEvent.change(scope, { target: { value: 'saved' } });
  fireEvent.click(screen.getByRole('button', { name: '展开目录' })); fireEvent.click(screen.getByRole('button', { name: '分类「旧分类」' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.click(screen.getByRole('button', { name: '旧分类' })); fireEvent.click(screen.getByRole('button', { name: '目标分类' })); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const renamed = { ...first, tags: ['新分类', '目标分类'] };
  view.rerender(<Harness chains={[fragment, renamed, second]} categoryNames={['新分类']} />);
  expect(screen.getByRole('button', { name: '分类「旧分类」' }).getAttribute('aria-current')).toBe('page');
  view.rerender(<Harness chains={[fragment, renamed, second]} categoryNames={['新分类']} categoryChange={{ from: '旧分类', to: '新分类', token: 1 }} />);
  expect(screen.getByRole('button', { name: '分类「新分类」' }).getAttribute('aria-current')).toBe('page'); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  const merged = { ...first, tags: ['目标分类'] };
  view.rerender(<Harness chains={[fragment, merged, second]} categoryChange={{ from: '新分类', to: '目标分类', token: 2 }} />);
  expect(screen.getByRole('button', { name: '分类「目标分类」' }).getAttribute('aria-current')).toBe('page'); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2);
  fireEvent.change(scope, { target: { value: 'items' } }); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  expect(screen.getByRole('button', { name: '旧分类' }).getAttribute('aria-pressed')).toBe('true'); expect(screen.queryByRole('button', { name: '目标分类' })).toBeNull();
  expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeTruthy(); expect(fragment.tags).toEqual(['旧分类']);
});

it('手机组合分类选择器区分星号与未归类等真实名称，空分类保留独立选项', () => {
  const originalWidth = window.innerWidth; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const star = categoryCombo('star', '星号组合', ['*']), named = categoryCombo('named', '具名未归类组合', ['未归类']), empty = categoryCombo('empty', '真正未归类组合', []);
  const view = render(<Harness chains={[...entries, star, named, empty]} categoryNames={['空分类', '全部']} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '筛选' })); fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
    const select = screen.getByRole('combobox', { name: '选择组合分类' }) as HTMLSelectElement;
    expect(select.classList.contains('md:hidden')).toBe(true); expect(Array.from(select.options).find(option => option.value === 'category:空分类')?.textContent).toBe('空分类 (0)');
    fireEvent.change(select, { target: { value: 'category:*' } }); expect(document.querySelector('[data-prompt-library-entry="star"]')).toBeTruthy(); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
    fireEvent.change(select, { target: { value: 'category:未归类' } }); expect(document.querySelector('[data-prompt-library-entry="named"]')).toBeTruthy(); expect(document.querySelector('[data-prompt-library-entry="empty"]')).toBeNull();
    fireEvent.change(select, { target: { value: '' } }); expect(document.querySelector('[data-prompt-library-entry="empty"]')).toBeTruthy(); expect(document.querySelector('[data-prompt-library-entry="named"]')).toBeNull();
    fireEvent.change(select, { target: { value: 'category:全部' } }); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(0);
    fireEvent.change(select, { target: { value: '*' } }); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(3);
  } finally { view.unmount(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
});

it('定位回执只清目标范围文件夹，不抹掉另一套选择', () => {
  const combo = categoryCombo('combo', '目标组合', ['夜景']);
  localStorage.setItem('nai-prompt-library-browse', JSON.stringify({ scope: 'items', directoryIds: ['person-pose'], allDirectories: false, unclassified: false }));
  const view = render(<Harness chains={[...entries, combo]} />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' }); fireEvent.change(scope, { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.click(screen.getByRole('button', { name: '分类「夜景」' }));
  view.rerender(<Harness chains={[...entries, combo]} focusEntryId="dress" />);
  fireEvent.change(scope, { target: { value: 'saved' } }); expect(screen.getByRole('button', { name: '分类「夜景」' }).getAttribute('aria-current')).toBe('page');
  fireEvent.change(scope, { target: { value: 'items' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' })); fireEvent.click(screen.getByRole('button', { name: '人物整体 / 动作与姿态' }));
  view.rerender(<Harness chains={[...entries, combo]} focusEntryId="combo" />);
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-current')).toBe('page');
  fireEvent.change(scope, { target: { value: 'items' } }); expect(screen.getByRole('button', { name: '人物整体 / 动作与姿态' }).getAttribute('aria-current')).toBe('page');
});

it('组合树父级汇总任意深度后代并按组合去重，路径只影响展示', () => {
  const first = categoryCombo('first', '父子多归属', ['父类', '子类']), second = categoryCombo('second', '孙类组合', ['孙类']);
  const categoryTree = { revision: 3, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }, { id: '孙类', name: '孙类', parentId: '子类' }, { id: '*', name: '*', parentId: '父类' }] };
  const before = JSON.stringify([first, second]); render(<Harness chains={[...entries, first, second]} categoryTree={categoryTree} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(screen.getByRole('button', { name: '分类「父类」' }).textContent).toBe('父类2'); fireEvent.click(screen.getByRole('button', { name: '分类「父类」' })); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2);
  const select = screen.getByRole('combobox', { name: '选择组合分类' }) as HTMLSelectElement;
  expect(Array.from(select.options).find(option => option.value === 'category:孙类')?.textContent).toBe('父类 / 子类 / 孙类 (1)');
  fireEvent.change(select, { target: { value: 'category:子类' } }); expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2); expect(screen.getByRole('button', { name: '收起目录' }).title).toContain('父类 / 子类');
  fireEvent.click(screen.getByRole('button', { name: '筛选' })); expect(screen.getByRole('button', { name: '父类 / 子类 / 孙类' })).toBeTruthy();
  expect(JSON.stringify([first, second])).toBe(before);
});


it('组合主导航拖动转换真实分类身份，根层与忙碌状态不混入片段目录', () => {
  const combo = categoryCombo('combo', '星号组合', ['*']);
  const categoryTree = { revision: 2, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '*', name: '*', parentId: null }] };
  const onMoveCategory = vi.fn(), onMoveDirectory = vi.fn();
  const view = render(<Harness chains={[...entries, combo]} categoryTree={categoryTree} onMoveCategory={onMoveCategory} onMoveDirectory={onMoveDirectory} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const data = new Map<string, string>();
  const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key), get types() { return [...data.keys()]; } };
  fireEvent.dragStart(screen.getByRole('button', { name: '分类「*」' }), { dataTransfer });
  fireEvent.drop(screen.getByRole('button', { name: '分类「父类」' }), { dataTransfer });
  expect(onMoveCategory).toHaveBeenLastCalledWith('*', '父类'); expect(onMoveDirectory).not.toHaveBeenCalled();
  const moved = { ...categoryTree, nodes: categoryTree.nodes.map(node => node.id === '*' ? { ...node, parentId: '父类' } : node) };
  view.rerender(<Harness chains={[...entries, combo]} categoryTree={moved} onMoveCategory={onMoveCategory} onMoveDirectory={onMoveDirectory} />);
  fireEvent.dragStart(screen.getByRole('button', { name: '分类「*」' }), { dataTransfer }); fireEvent.drop(screen.getByRole('group', { name: '移到根目录' }), { dataTransfer });
  expect(onMoveCategory).toHaveBeenLastCalledWith('*', null);
  view.rerender(<Harness chains={[...entries, combo]} categoryTree={moved} onMoveCategory={onMoveCategory} categoriesBusy onMoveDirectory={onMoveDirectory} />);
  expect(screen.getByRole('button', { name: '分类「*」' }).getAttribute('draggable')).toBe('false');
  fireEvent.dragStart(screen.getByRole('button', { name: '分类「*」' }), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name: '分类「父类」' }), { dataTransfer });
  expect(onMoveCategory).toHaveBeenCalledTimes(2); expect(combo.tags).toEqual(['*']);
});


it('共享标题新建按当前组合分类预填真实父级，全部或未归类创建根层且与片段隔离', () => {
  const categoryTree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '*', name: '*', parentId: '父类' }] };
  const onCreateCategory = vi.fn(), onCreateDirectory = vi.fn();
  render(<Harness categoryTree={categoryTree} onCreateCategory={onCreateCategory} onCreateDirectory={onCreateDirectory} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.click(screen.getByRole('button', { name: '新建目录' })); expect(onCreateCategory).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByRole('combobox', { name: '选择组合分类' }), { target: { value: 'category:*' } }); fireEvent.click(screen.getByRole('button', { name: '新建目录' })); expect(onCreateCategory).toHaveBeenLastCalledWith('*');
  fireEvent.click(screen.getByRole('button', { name: '全部' })); fireEvent.click(screen.getByRole('button', { name: '新建目录' })); expect(onCreateCategory).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: '未归类' })); fireEvent.click(screen.getByRole('button', { name: '新建目录' })); expect(onCreateCategory).toHaveBeenLastCalledWith(null); expect(onCreateDirectory).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'items' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' })); fireEvent.click(screen.getByRole('button', { name: '新建目录' })); expect(onCreateDirectory).toHaveBeenLastCalledWith(null);
});


it('组合共享标题编辑删除透传真实分类ID且不触发片段动作', () => {
  const onRenameCategory = vi.fn(), onDeleteCategory = vi.fn(), onRenameDirectory = vi.fn(), onDeleteDirectory = vi.fn();
  render(<Harness categoryNames={['*']} onRenameCategory={onRenameCategory} onDeleteCategory={onDeleteCategory} onRenameDirectory={onRenameDirectory} onDeleteDirectory={onDeleteDirectory} />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } }); fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择组合分类' }), { target: { value: 'category:*' } }); fireEvent.click(screen.getByRole('button', { name: '重命名目录' })); fireEvent.click(screen.getByRole('button', { name: '删除目录' }));
  expect(onRenameCategory).toHaveBeenCalledWith('*'); expect(onDeleteCategory).toHaveBeenCalledWith('*'); expect(onRenameDirectory).not.toHaveBeenCalled(); expect(onDeleteDirectory).not.toHaveBeenCalled();
});
