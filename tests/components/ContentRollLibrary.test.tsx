// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} }));
import { ContentRollLibrary } from '../../components/ContentRollLibrary';
import { contentSnapshotOf } from '../../services/contentRoll';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptChain } from '../../types';
import { PromptLibraryContext } from '../../components/PromptLibraryAccess';

vi.mock('../../components/HistoryImagePicker', () => ({ HistoryImagePicker: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = contentSnapshotOf({ picks: { scene: { kind: 'scene', filled: true, name: '夜景', text: 'moonlight', negative: 'daylight', constraints: { notes: '保留月光' } } } }, '2026-10-21');
const record = { id: 'saved', type: 'style', name: '夜游', tags: [], params: { ...LAB_DEFAULT_PARAMS, _rollContentSnapshot: snapshot }, updatedAt: 1 } as unknown as PromptChain;
const props = () => ({ active: true, chains: [record], notify: vi.fn(), onLoad: vi.fn(), onRename: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onSetCover: vi.fn(async () => {}) });

it.each(['saved', 'originals'] as const)('条目读取状态：%s列表区分延迟失败真空并保留缓存', section => {
  const retry = vi.fn();
  const page = (items: PromptChain[], chainsLoading = false, chainsError = '') => <ContentRollLibrary {...props()} chains={items} section={section} chainsLoading={chainsLoading} chainsError={chainsError} onRetryChains={retry} />;
  const empty = section === 'saved' ? '组合库还是空的' : '原文还是空的';
  const view = render(page([], true));
  expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText(empty)).toBeNull();
  view.rerender(page([], false, '读取提示词库失败')); expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(page([])); expect(screen.getByText(empty)).toBeTruthy();
  if (section === 'saved') {
    view.rerender(page([record], true)); expect(screen.getByRole('button', { name: '查看夜游' })).toBeTruthy();
    view.rerender(page([record], false, '读取提示词库失败')); expect(screen.getByRole('button', { name: '查看夜游' })).toBeTruthy();
  }
});

it('在顶栏下沿显示当前组合分区条目数', async () => {
  render(<ContentRollLibrary {...props()} />);
  const caption = await screen.findByText('共 1 条');
  expect(caption.getAttribute('data-toolbar-count-caption')).toBe('true');
});

it('组合分类候选显示完整路径，筛选仍使用原分类标签', () => {
  const p = props();
  p.chains = [{ ...record, tags: ['子类'] }];
  const categoryTree = { revision: 1, nodes: [
    { id: '父类', name: '父类', parentId: null },
    { id: '子类', name: '子类', parentId: '父类' },
    { id: '空类', name: '空类', parentId: '父类' },
  ] };
  render(<PromptLibraryContext.Provider value={{ chains: p.chains, categoryTree, save: vi.fn() }}><ContentRollLibrary {...p} /></PromptLibraryContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '筛选' }));
  const select = screen.getByRole('combobox', { name: '自定义标签' });
  expect((screen.getByRole('option', { name: '父类 / 子类' }) as HTMLOptionElement).value).toBe('子类');
  expect((screen.getByRole('option', { name: '父类 / 空类' }) as HTMLOptionElement).value).toBe('空类');
  fireEvent.change(select, { target: { value: '子类' } });
  expect(screen.getByRole('button', { name: '查看夜游' })).toBeTruthy();
  fireEvent.change(select, { target: { value: '空类' } });
  expect(screen.queryByRole('button', { name: '查看夜游' })).toBeNull();
});

it('动态组合展示完整目录路径、正负词与备注，搜索和复制保留所有动态项', async () => {
  const dynamic = contentSnapshotOf({ picks: {
    'directory:cloth': { kind: 'directory:cloth', directoryId: 'cloth', directoryName: '服装', directoryPath: ['人物', '服装'], scope: 'character', filled: true, text: 'white blouse', negative: 'red shirt', constraintNotes: '保留袖口' },
    'directory:light': { kind: 'directory:light', directoryId: 'light', directoryName: '光线', directoryPath: ['环境', '光线'], scope: 'global', filled: true, text: 'moonlight' },
  } }, '2026-10-27');
  const p = props(); const chain = { ...record, params: { ...LAB_DEFAULT_PARAMS, _rollContentSnapshot: dynamic } } as PromptChain;
  p.chains = [chain];
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<ContentRollLibrary {...p} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '保留袖口' } });
  fireEvent.click(screen.getByRole('button', { name: '查看夜游' }));
  expect(screen.getByText('人物 / 服装')).toBeTruthy();
  expect(screen.getByText('环境 / 光线')).toBeTruthy();
  expect(screen.getByText('white blouse')).toBeTruthy();
  expect(screen.getByText(/red shirt/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '编辑组合' }));
  expect(p.onLoad).toHaveBeenCalledWith(chain);
  fireEvent.click(screen.getByRole('button', { name: '复制组合数据' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(dynamic, null, 2)));
});

it('原文与组合分区独立，可按原文搜索、查看与逐字复制，不载入抽取器', async () => {
  const text = '  {{winter}}, 1.2::hair::\r\n[smile]  ';
  const collected = { ...record, ...prepareCollectedPrompt(text, '冬日'), type: 'preset', id: 'collected' } as PromptChain;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const p = props(); p.chains.push(collected); render(<ContentRollLibrary {...p} section="originals" />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'winter' } });
  expect(screen.queryByRole('button', { name: '编辑组合' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看冬日' }));
  expect(document.querySelector('[data-content-roll-preview="collected"] p')?.textContent).toBe(text);
  fireEvent.click(screen.getByRole('button', { name: '复制冬日' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
  expect(p.onLoad).not.toHaveBeenCalled();
});

it('搜索组合内提示词与负面，在本卡片展开详情，原快照交给载入且不写库', () => {
  const p = props(); render(<ContentRollLibrary {...p} />);
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'daylight' } });
  const title = screen.getByRole('button', { name: '查看夜游' });
  fireEvent.click(title);
  const article = title.closest('[data-content-roll-record]')!;
  expect(article.querySelector('[data-content-roll-preview="saved"]')?.textContent).toContain('daylight');
  fireEvent.click(screen.getByRole('button', { name: '编辑组合' }));
  expect(p.onLoad).toHaveBeenCalledWith(record);
  expect(p.onRename).not.toHaveBeenCalled(); expect(p.onDelete).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(screen.queryByRole('button', { name: '查看夜游' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('button', { name: '查看夜游' })).toBeTruthy();
});

it('切走不移除组合卡片，返回保留预览节点和滚动位置', () => {
  const p = props(); const view = render(<ContentRollLibrary {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '查看夜游' }));
  const preview = document.querySelector('[data-content-roll-preview="saved"]');
  const viewport = document.querySelector('.workspace-scroll-viewport')!;
  viewport.scrollTop = 180;
  view.rerender(<ContentRollLibrary {...p} active={false} />);
  expect(document.querySelector('[data-content-roll-preview="saved"]')).toBe(preview);
  view.rerender(<ContentRollLibrary {...p} />);
  expect(viewport.scrollTop).toBe(180);
});

it('改名回车与失焦只提交一次，失败保留输入，Esc 不提交', async () => {
  const p = props(); let fail!: (error: Error) => void;
  p.onRename = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  render(<ContentRollLibrary {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '查看夜游' }));
  fireEvent.click(screen.getByRole('button', { name: '改名' }));
  const input = screen.getByRole('textbox', { name: '重命名这条记录' });
  fireEvent.change(input, { target: { value: '月下' } });
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.blur(input);
  expect(p.onRename).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('synthetic')));
  await waitFor(() => expect(p.notify).toHaveBeenCalledWith('改名失败，请重试', 'error'));
  expect((screen.getByRole('textbox', { name: '重命名这条记录' }) as HTMLInputElement).value).toBe('月下');
  fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.blur(input);
  expect(p.onRename).toHaveBeenCalledTimes(1);
});

it('旧组合管理标签显式保存与清空自定义项，保留内部状态且只patch标签', async () => {
  const p = props();
  p.chains = p.chains.map(chain => chain.id === 'saved' ? { ...chain, tags: ['__内部__', '旧分类', '另一类'] } : chain);
  const save = vi.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValue(undefined);
  render(<PromptLibraryContext.Provider value={{ chains: p.chains, save }}><ContentRollLibrary {...p} /></PromptLibraryContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '查看夜游' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  const input = screen.getByRole('textbox', { name: '编辑自定义标签' });
  expect((input as HTMLInputElement).value).not.toContain('__内部__');
  fireEvent.change(input, { target: { value: ' 城市,城市，夜晚 ' } }); fireEvent.blur(input);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await screen.findByRole('alert');
  expect((input as HTMLInputElement).value).toBe(' 城市,城市，夜晚 ');
  expect(save).toHaveBeenLastCalledWith({ id: 'saved', tags: ['__内部__', '城市', '夜晚'] });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑自定义标签' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '编辑标签' }));
  fireEvent.change(screen.getByRole('textbox', { name: '编辑自定义标签' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存标签' }));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith({ id: 'saved', tags: ['__内部__'] }));
  expect(record.params).toEqual(p.chains[0].params);
});
