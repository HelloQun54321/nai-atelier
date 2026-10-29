// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChainTagManager } from '../../../components/chain/ChainTagManager';
import type { PromptChain } from '../../../types';

const mocks = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../services/dbService', () => ({ db: { updateChain: mocks.save } }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
const fixture = (): PromptChain[] => {
  const original: PromptChain = {
    id: 'one', userId: 'synthetic', type: 'style', name: '第一条', description: '合成描述',
    tags: ['逆光', '逆光', '原创', '待实测', '__character_catalog__', 'NAI', 'Pixiv'],
    basePrompt: 'original prompt', negativePrompt: 'original negative', modules: [], previewImage: '/synthetic.png',
    params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 1, qualityToggle: true, ucPreset: 4 },
    variableValues: { subject: 'original subject' }, createdAt: 1, updatedAt: 1,
  };
  return [original, { ...original, id: 'two', name: '第二条', tags: ['逆光', '风景'] }, { ...original, id: 'three', name: '第三条', tags: ['独有', '收集中', 'aitag'] }];
};
let stored: PromptChain[];
const save = async (id: string, updates: Partial<PromptChain>) => { stored = stored.map(chain => chain.id === id ? { ...chain, ...updates } : chain); };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.confirm.mockResolvedValue(true); mocks.save.mockImplementation(save);
});
afterEach(cleanup);
const setup = (data = fixture()) => {
  stored = structuredClone(data);
  const onClose = vi.fn(), notify = vi.fn(), onTagChanged = vi.fn();
  const onRefresh = vi.fn(async (): Promise<void> => { view.rerender(<ChainTagManager {...props} chains={[...stored]} />); });
  const props = { chains: stored, onClose, notify, onTagChanged, onRefresh };
  const view = render(<ChainTagManager {...props} />);
  return { ...view, onRefresh, onClose, notify, onTagChanged };
};
const rename = (from: string, to: string) => {
  fireEvent.click(screen.getByRole('button', { name: '重命名标签：' + from }));
  fireEvent.change(screen.getByRole('textbox', { name: '标签名称' }), { target: { value: to } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
};

it('链库未读完时不显示无标签，失败可重试且缓存标签保持可见', () => {
  const props = { chains: [] as PromptChain[], onClose: vi.fn(), onRefresh: vi.fn(), onTagChanged: vi.fn(), notify: vi.fn() };
  const view = render(<ChainTagManager {...props} isLoading />);
  expect(screen.getByRole('status').textContent).toContain('加载中…');
  expect(screen.queryByText('没有匹配的标签')).toBeNull();
  view.rerender(<ChainTagManager {...props} loadError="风格串列表加载失败，请稍后重试" />);
  expect(screen.getByRole('alert').textContent).toContain('风格串列表加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  view.rerender(<ChainTagManager {...props} chains={fixture()} isLoading />);
  expect(screen.getByText('#逆光')).toBeTruthy();
  expect((screen.getByRole('button', { name: '重命名标签：逆光' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ChainTagManager {...props} />);
  expect(screen.getByText('没有匹配的标签')).toBeTruthy();
});

it('搜索框取得焦点，关闭后归还真实管理入口', () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger); trigger.focus();
  const view = setup();
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索标签' }));
  view.unmount(); expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('统计每条资料的有效分类一次，隐藏来源和内部标记，仅搜索标签且打开不写入', () => {
  const view = setup();
  const dialog = screen.getByRole('dialog', { name: '管理标签' });
  expect(view.container.contains(dialog)).toBe(false);
  expect(within(dialog).getByText('#逆光').closest('li')!.textContent).toContain('2条');
  for (const name of ['NAI', 'Pixiv', 'aitag', '收集中', '待实测', '__character_catalog__']) expect(screen.queryByText('#' + name)).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标签' }), { target: { value: ' 风景 ' } });
  expect(screen.getByText('#风景')).toBeTruthy(); expect(screen.queryByText('#逆光')).toBeNull();
  expect(screen.queryByRole('button', { name: '添加标签' })).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('重命名确认全类别影响条数，仅逐条提交 tags，保留内部状态及完整创作资料', async () => {
  const data = fixture(), original = structuredClone(data);
  const { onTagChanged, onRefresh, notify } = setup(data);
  rename('逆光', '  日落  ');
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '将「逆光」重命名为「日落」？', message: '将更新 2 条资料的标签，提示词、图片和参数保持原样。' }));
  expect(mocks.save.mock.calls).toEqual([
    ['one', { tags: ['日落', '原创', '待实测', '__character_catalog__'] }], ['two', { tags: ['日落', '风景'] }],
  ]);
  stored.forEach((chain, index) => expect({ ...chain, tags: original[index].tags }).toEqual(original[index]));
  expect(data).toEqual(original); expect(onRefresh).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith('标签已更新');
});

it('目标已存在时明确合并并去重，不丢其他自定义标签或状态', async () => {
  const { onTagChanged } = setup(); rename('逆光', '风景');
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '风景'));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '将「逆光」合并到「风景」？', confirmLabel: '合并标签' }));
  expect(stored[0].tags).toEqual(['风景', '原创', '待实测', '__character_catalog__']);
  expect(stored[1].tags).toEqual(['风景']);
});

it('取消重命名保留草稿、不保存不刷新；取消编辑恢复原标签', async () => {
  mocks.confirm.mockResolvedValue(false);
  const { onRefresh, onTagChanged } = setup(); rename('逆光', '日落');
  await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('false'));
  expect((screen.getByRole('textbox', { name: '标签名称' }) as HTMLInputElement).value).toBe('日落');
  expect(mocks.save).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled(); expect(onTagChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(screen.getByText('#逆光')).toBeTruthy();
});

it('移除只摘标签，确认期间重复点击、关闭、遮罩和 Esc 均不能绕过锁定', async () => {
  let finish!: (value: boolean) => void;
  mocks.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { onClose, onTagChanged } = setup();
  const remove = screen.getByRole('button', { name: '移除标签：逆光' });
  fireEvent.click(remove); fireEvent.click(remove);
  fireEvent.click(screen.getByRole('button', { name: '关闭' })); fireEvent.click(screen.getByRole('dialog').parentElement!); fireEvent.keyDown(window, { key: 'Escape' });
  expect(mocks.confirm).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => finish(false));
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(remove);
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', undefined));
  expect(stored[0].tags).toEqual(['原创', '待实测', '__character_catalog__']);
  expect(stored[1].tags).toEqual(['风景']);
});

it('保存期间同样锁定全部写入和关闭，完成才回读并映射筛选', async () => {
  let finish!: () => void;
  mocks.save.mockImplementationOnce(async (id, updates) => {
    await new Promise<void>(resolve => { finish = resolve; });
    await save(id, updates);
  });
  const { onClose, onRefresh, onTagChanged } = setup();
  fireEvent.click(screen.getByRole('button', { name: '重命名标签：逆光' }));
  fireEvent.change(screen.getByRole('textbox', { name: '标签名称' }), { target: { value: '日落' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: '标签名称' }), { key: 'Enter' });
  fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(screen.getByRole('dialog').parentElement!);
  expect(mocks.save).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled(); expect(onTagChanged).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
  const completed = new Promise<void>(resolve => { onTagChanged.mockImplementationOnce(() => resolve()); });
  await act(async () => { finish(); await completed; });
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
});

it('部分失败回读实际条目、保留输入和旧筛选，主动重试仅处理仍有旧标签的条目', async () => {
  mocks.save.mockImplementationOnce(save).mockRejectedValueOnce(new Error('合成保存失败'));
  const { notify, onRefresh, onTagChanged } = setup(); rename('逆光', '日落');
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(onRefresh).toHaveBeenCalledOnce(); expect(onTagChanged).not.toHaveBeenCalled();
  expect(stored[0].tags).toContain('日落'); expect(stored[1].tags).toContain('逆光');
  expect((screen.getByRole('textbox', { name: '标签名称' }) as HTMLInputElement).value).toBe('日落');
  expect(mocks.save).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(mocks.save.mock.calls.slice(2)).toEqual([['two', { tags: ['日落', '风景'] }]]);
});

it('保存和回读均失败时不伪报成功，保留输入且禁止旧快照重试，重载后再主动保存', async () => {
  mocks.save.mockImplementationOnce(save).mockRejectedValueOnce(new Error('合成保存失败'));
  const { notify, onRefresh, onTagChanged } = setup();
  onRefresh.mockRejectedValueOnce(new Error('合成回读失败'));
  rename('逆光', '日落');
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败 · 标签回读失败，请重新加载后再操作', 'error'));
  expect(onRefresh).toHaveBeenCalledOnce(); expect(onTagChanged).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: '标签名称' }) as HTMLInputElement).value).toBe('日落');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('textbox', { name: '标签名称' }), { key: 'Enter' }); expect(mocks.save).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '重新加载标签' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(mocks.save.mock.calls.slice(2)).toEqual([['two', { tags: ['日落', '风景'] }]]);
});

it('全部写入成功但回读失败也不能报成功或变更筛选，不重复回读或自动保存', async () => {
  const { notify, onRefresh, onTagChanged } = setup();
  onRefresh.mockRejectedValueOnce(new Error('合成刷新失败'));
  rename('逆光', '日落');
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成刷新失败 · 标签回读失败，请重新加载后再操作', 'error'));
  expect(onRefresh).toHaveBeenCalledOnce(); expect(onTagChanged).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect((screen.getByRole('textbox', { name: '标签名称' }) as HTMLInputElement).value).toBe('日落');
});

it('空名和同名不可保存，来源、状态与内部名拒绝写入，输入法回车不提交', async () => {
  const { notify, onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: '重命名标签：逆光' }));
  const input = screen.getByRole('textbox', { name: '标签名称' });
  for (const value of ['   ', ' 逆光 ']) {
    fireEvent.change(input, { target: { value } });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
  }
  for (const value of ['NAI', '待实测', '__character_catalog__', '收集中']) {
    fireEvent.change(input, { target: { value } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  }
  expect(notify).toHaveBeenCalledTimes(4);
  expect(notify).toHaveBeenLastCalledWith('来源、图片类型和状态不用作自定义标签', 'error');
  fireEvent.change(input, { target: { value: '日落' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
});

it('自定义角色使用相同标签管理且不改角色内容，空资料仅展示空状态', async () => {
  const { onTagChanged } = setup(fixture().map(chain => ({ ...chain, type: 'character' })));
  rename('逆光', '日落'); await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(stored.every(chain => chain.type === 'character')).toBe(true);
  cleanup(); setup([]);
  expect(screen.getByText('没有匹配的标签')).toBeTruthy(); expect(screen.queryByRole('button', { name: '添加标签' })).toBeNull();
});
