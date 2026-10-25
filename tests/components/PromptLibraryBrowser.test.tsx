// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { PromptBrowseHighlight, PromptLibraryBrowser, type PromptLibraryBrowserProps } from '../../components/PromptLibraryBrowser';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { longPress } from '../support/touchEvents';

vi.mock('../../components/SmartImage', async importOriginal => ({ ...await importOriginal<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../../components/ImageShareActions', async importOriginal => ({ ...await importOriginal<typeof import('../../components/ImageShareActions')>(), ImageShareActions: ({ favorite }: { favorite: { sourceType: string; sourceId: string } }) => <div data-card-action="true" data-testid="image-share" data-source-type={favorite.sourceType} data-source-id={favorite.sourceId} onClick={event => event.stopPropagation()}><button aria-label="收藏">收藏</button><button aria-label="下载图片">下载</button><button aria-label="复制图片">复制图</button></div> }));
const entries = [
  { id: 'dress', ...createFragmentData('night dress', '礼服', 'wardrobe'), tags: ['晚间', '正式'] },
  { id: 'raw', ...prepareCollectedPrompt('night garden', '花园'), tags: ['晚间'] },
] as PromptChain[];
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); delete document.documentElement.dataset.galleryFrostedCaption; });
const use = vi.fn(); const edit = vi.fn();
const Harness = ({ chains = entries, notify = vi.fn(), ...props }: Partial<Pick<PromptLibraryBrowserProps, 'chains' | 'focusEntryId' | 'categoryNames' | 'onManageCategories' | 'categoryChange' | 'onUpdateTags' | 'onDelete' | 'notify'>>) => {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <><div ref={setSlot} /><PromptLibraryBrowser {...props} chains={chains} toolbarSlot={slot} onUse={use} onOpen={edit} notify={notify} /></>;
};

it('默认全部，搜索跨原文和片段，切范围保留查询，卡片打开详情而编辑和使用各自回调', () => {
  render(<Harness />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' });
  expect((scope as HTMLSelectElement).value).toBe('all');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(2);
  expect(document.querySelectorAll('mark').length).toBeGreaterThan(0);
  fireEvent.change(scope, { target: { value: 'originals' } });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('night');
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '查看花园' }));
  const detail = screen.getByRole('complementary', { name: '花园' });
  expect(within(detail).getByText('night garden')).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: '编辑' }));
  expect(edit).toHaveBeenLastCalledWith(entries[1]);
  fireEvent.click(within(detail).getByRole('button', { name: '使用' }));
  expect(use).toHaveBeenLastCalledWith(entries[1]);
});

it('定位刚收录的条目清除查询并打开详情，不调用编辑或修改条目', () => {
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
  view.rerender(<Harness focusEntryId="raw" />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('all');
  expect(screen.getByRole('complementary', { name: '花园' })).toBeTruthy();
});

it('只跨重启记住范围排序，不记住关键词和标签', () => {
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'originals' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  view.unmount(); render(<Harness />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('originals');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('用途选择显式切到片段，所有选中标签按交集过滤', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '片段用途' }), { target: { value: 'wardrobe' } });
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
  fireEvent.change(scope, { target: { value: 'originals' } });
  expect(scroll.scrollTop).toBe(0);
  scroll.scrollTop = 80; fireEvent.scroll(scroll);
  fireEvent.change(scope, { target: { value: 'all' } });
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

it('片段分类只在筛选内选择，切类别保留搜索标签，清搜索及范围往返保留类别', () => {
  const pose = { id: 'pose', ...createFragmentData('day pose', '站姿', 'pose'), tags: ['晚间'] } as PromptChain;
  render(<Harness chains={[...entries, pose]} />);
  const scope = screen.getByRole('combobox', { name: '提示词库范围' });
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  fireEvent.change(scope, { target: { value: 'items' } });
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'night' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '晚间' }));
  fireEvent.change(screen.getByRole('combobox', { name: '片段用途' }), { target: { value: 'pose' } });
  fireEvent.click(screen.getByRole('button', { name: /^动作/ }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('night');
  expect(document.querySelectorAll('[data-prompt-library-entry]')).toHaveLength(0);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(document.querySelector('[data-prompt-library-entry="pose"]')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^动作/ }).textContent).toContain('动作');
  fireEvent.change(scope, { target: { value: 'saved' } });
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  fireEvent.change(scope, { target: { value: 'items' } });
  fireEvent.click(screen.getByRole('button', { name: /^动作/ }));
  expect((screen.getByRole('combobox', { name: '片段用途' }) as HTMLSelectElement).value).toBe('pose');
  expect(screen.getByRole('button', { name: '晚间' }).getAttribute('aria-pressed')).toBe('true');
});

it('手机用途筛选保持纯图标，不增加片段侧栏或横栏，切为电脑时显示已选类别', () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const view = render(<Harness />);
  try {
  fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'items' } });
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const select = screen.getByRole('combobox', { name: '片段用途' });
  expect(select.closest('label')?.classList.contains('md:hidden')).toBe(false);
  fireEvent.change(select, { target: { value: 'wardrobe' } });
  expect(JSON.parse(localStorage.getItem('nai-prompt-library-browse') || '{}').kind).toBe('wardrobe');
  expect((select as HTMLSelectElement).value).toBe('wardrobe');
  expect(document.querySelector('[data-prompt-library-entry="dress"]')).toBeTruthy();
  const filter = screen.getByRole('button', { name: '筛选' });
  expect(filter.textContent).toBe('');
  expect(filter.parentElement?.classList.contains('[&>button]:!w-11')).toBe(true);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('button', { name: /^服饰/ }).textContent).toContain('服饰');
  } finally { view.unmount(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
});

it.each([300, 800])('电脑工具区宽%d时选中类别都在原筛选按钮显示，保留自然宽度', toolWidth => {
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: toolWidth, height: 40, top: 0, left: 0, right: toolWidth, bottom: 40, x: 0, y: 0, toJSON: () => ({}) });
  const view = render(<Harness />);
  try {
    const scope = screen.queryByRole('combobox', { name: '提示词库范围' });
    if (scope) fireEvent.change(scope, { target: { value: 'items' } });
    else fireEvent.click(screen.getByRole('tab', { name: '片段' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const select = screen.getByRole('combobox', { name: '片段用途' });
    expect(select.closest('label')?.classList.contains('md:hidden')).toBe(false);
    fireEvent.change(select, { target: { value: 'wardrobe' } });
    const filter = screen.getByRole('button', { name: /^服饰/ });
    expect(filter.querySelector('span')?.textContent).toContain('服饰');
    expect(filter.parentElement?.classList.contains('[&>button]:!w-11')).toBe(false);
    expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  } finally { view.unmount(); rect.mockRestore(); }
});

it('组合分类仅列组合标签与预建目录，详情候选同源，重命名合并同步所选分类并去重', () => {
  const combo = { id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }, ['旧分类', '目标分类']) } as PromptChain;
  const chains = [...entries, combo];
  const view = render(<Harness chains={chains} categoryNames={['预建空分类']} onUpdateTags={async () => {}} />);
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

it.each([390, 1280])('宽度%d组合标签标题旁管理分类先关闭筛选，不增加导航或顶栏', width => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const manage = vi.fn(() => expect(screen.queryByRole('dialog', { name: '筛选组合' })).toBeNull());
  const view = render(<Harness categoryNames={['空分类']} onManageCategories={manage} />);
  try {
    fireEvent.change(screen.getByRole('combobox', { name: '提示词库范围' }), { target: { value: 'saved' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    const button = screen.getByRole('button', { name: '管理分类' });
    expect(button.closest('legend')?.textContent).toContain('自定义标签');
    expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
    fireEvent.click(button);
    expect(manage).toHaveBeenCalledTimes(1);
  } finally { view.unmount(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }); }
});

it('从全部打开组合详情仍使用组合专属标签候选，包含预建空分类且排除片段原文标签', () => {
  const combo = { id: 'combo', ...createCombinationData('组合', { scene: { kind: 'scene', filled: true, text: 'night sky' } }, ['组合分类']) } as PromptChain;
  render(<Harness chains={[...entries, combo]} categoryNames={['预建空分类']} onUpdateTags={async () => {}} />);
  expect((screen.getByRole('combobox', { name: '提示词库范围' }) as HTMLSelectElement).value).toBe('all');
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

it('三种资产统一封面与caption卡片，空封面只展示一次摘要，真实图片才有分享动作', () => {
  localStorage.setItem('nai_mobile_image_display', JSON.stringify({ layout: 'masonry', columns: 1, desktopColumns: 3 }));
  const combo = { id: 'combo', ...createCombinationData('搭配', { scene: { kind: 'scene', filled: true, text: 'rainy garden' } }) } as PromptChain;
  const image = { ...entries[0], previewImage: 'data:image/png;base64,synthetic' };
  render(<Harness chains={[image, entries[1], combo]} onDelete={async () => {}} />);
  const grid = document.querySelector('.mobile-gallery') as HTMLElement;
  expect(grid.classList.contains('mobile-gallery--masonry')).toBe(true);
  expect(grid.classList.contains('workspace-card-grid')).toBe(true);
  expect(grid.style.getPropertyValue('--mobile-gallery-cols-setting')).toBe('1');
  expect(grid.style.getPropertyValue('--mobile-gallery-cols-desktop')).toBe('3');
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
  entries[0], entries[1], { id: 'combo', ...createCombinationData('搭配', { scene: { kind: 'scene', filled: true, text: 'rainy garden' } }) } as PromptChain,
])('删除$name取消和失败保留原详情，实际移除只跟随资料刷新，不误使用', async chain => {
  use.mockClear(); edit.mockClear();
  const notify = vi.fn();
  const remove = vi.fn(async (_chain: PromptChain) => {});
  const view = render(<Harness chains={[chain]} onDelete={remove} notify={notify} />);
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
