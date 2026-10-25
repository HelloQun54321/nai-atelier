// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { PromptBrowseHighlight, PromptLibraryBrowser } from '../../components/PromptLibraryBrowser';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';

vi.mock('../../components/SmartImage', async importOriginal => ({ ...await importOriginal<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
const entries = [
  { id: 'dress', ...createFragmentData('night dress', '礼服', 'wardrobe'), tags: ['晚间', '正式'] },
  { id: 'raw', ...prepareCollectedPrompt('night garden', '花园'), tags: ['晚间'] },
] as PromptChain[];
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const use = vi.fn(); const edit = vi.fn();
const Harness = ({ focusEntryId }: { focusEntryId?: string }) => {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <><div ref={setSlot} /><PromptLibraryBrowser chains={entries} toolbarSlot={slot} onUse={use} onOpen={edit} notify={vi.fn()} focusEntryId={focusEntryId} /></>;
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
