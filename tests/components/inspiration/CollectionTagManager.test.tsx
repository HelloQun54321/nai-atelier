// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollectionTagManager } from '../../../components/inspiration/CollectionTagManager';
import type { Inspiration, User } from '../../../types';

const mocks = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../services/dbService', () => ({ db: { bulkUpdateInspirations: mocks.save } }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
const user: User = { id: 'owner', username: 'owner', role: 'user', createdAt: 1 };
const fixture = (): Inspiration[] => [
  { id: 'one', userId: user.id, title: '第一张', imageUrl: '/one.png', prompt: 'original', sourceType: 'history', boardId: 'folder', tags: ['生成历史', '逆光', '原创'], createdAt: 1 },
  { id: 'two', userId: user.id, title: '第二张', imageUrl: '/two.png', prompt: '', sourceType: 'pixiv', tags: ['Pixiv', '逆光', '风景'], createdAt: 2 },
  { id: 'archived', userId: user.id, title: '旧收藏', imageUrl: '/old.png', prompt: '', tags: ['逆光', '归档标签'], archived: true, createdAt: 3 },
  { id: 'readonly', userId: 'another', title: '只读', imageUrl: '/readonly.png', prompt: '', tags: ['只读标签', '逆光'], createdAt: 4 },
];
let stored: Inspiration[];
let tagNames: string[];
let saveTagNames: ReturnType<typeof vi.fn>;
const save = async (ids: string[], updates: Partial<Inspiration>) => { stored = stored.map(item => ids.includes(item.id) ? { ...item, ...updates } : item); };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.confirm.mockResolvedValue(true); mocks.save.mockImplementation(save);
});
afterEach(() => cleanup());
const setup = (data = fixture(), currentUser = user, catalog: string[] | null = []) => {
  tagNames = catalog || [];
  stored = data.map(item => ({ ...item, tags: [...(item.tags || [])] }));
  const onClose = vi.fn(), notify = vi.fn(), onTagChanged = vi.fn();
  const onRefresh = vi.fn(async (): Promise<void> => { view.rerender(<CollectionTagManager {...props} items={[...stored]} tagNames={tagNames} />); });
  saveTagNames = vi.fn(async (tags: string[]): Promise<void> => { tagNames = [...new Set(tags)]; await onRefresh(); });
  const onReloadTagNames = vi.fn(async (): Promise<void> => {});
  const props = { items: stored, tagNames: catalog, onSaveTagNames: saveTagNames, onReloadTagNames, currentUser, onClose, notify, onTagChanged, onRefresh };
  const view = render(<CollectionTagManager {...props} />);
  return { ...view, onRefresh, onClose, notify, onTagChanged, onReloadTagNames };
};
const rename = (from: string, to: string) => {
  fireEvent.click(screen.getByRole('button', { name: '重命名标签：' + from }));
  fireEvent.change(screen.getByRole('combobox', { name: '标签名称' }), { target: { value: to } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
};

it('管理展示全库有效标签与页数，可搜索，旧来源和归档标签不混入，打开不写入', () => {
  setup();
  const dialog = screen.getByRole('dialog', { name: '管理标签' });
  expect(within(dialog).getByText('#逆光').closest('li')!.textContent).toContain('3页');
  expect(within(dialog).queryByText('#生成历史')).toBeNull();
  expect(within(dialog).queryByText('#Pixiv')).toBeNull();
  expect(within(dialog).queryByText('#归档标签')).toBeNull();
  expect((screen.getByRole('button', { name: '移除标签：只读标签' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索标签' }), { target: { value: '风景' } });
  expect(screen.getByText('#风景')).toBeTruthy(); expect(screen.queryByText('#逆光')).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it('全库重命名需确认影响页数，规范化名称，保留其他标签、图片与分类，排除只读和归档', async () => {
  const data = fixture(), original = JSON.stringify(data);
  const { onTagChanged, onRefresh } = setup(data);
  rename('逆光', '  #日落  ');
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '将「逆光」重命名为「日落」？', message: '将更新收藏库中 2 页的标签，图片和收藏夹保持原样。' }));
  expect(stored[0]).toEqual(expect.objectContaining({ tags: ['日落', '原创'], imageUrl: '/one.png', boardId: 'folder', prompt: 'original' }));
  expect(stored[1].tags).toEqual(['日落', '风景']);
  expect(stored[2].tags).toContain('逆光'); expect(stored[3].tags).toContain('逆光');
  expect(JSON.stringify(data)).toBe(original); expect(onRefresh).toHaveBeenCalledOnce();
});

it('重命名到已有标签时明确合并并去重，不丢其他内容标签', async () => {
  const { onTagChanged } = setup(); rename('逆光', '风景');
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '风景'));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '将「逆光」合并到「风景」？', confirmLabel: '合并标签' }));
  expect(stored[0].tags).toEqual(['风景', '原创']); expect(stored[1].tags).toEqual(['风景']);
});

it('移除需确认，重复点击只开一次确认；取消不保存，确认只移除标签', async () => {
  let finish!: (value: boolean) => void;
  mocks.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { onClose, onTagChanged } = setup();
  const remove = screen.getByRole('button', { name: '移除标签：逆光' });
  fireEvent.click(remove); fireEvent.click(remove); fireEvent.keyDown(window, { key: 'Escape' });
  expect(mocks.confirm).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish(false); });
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(remove);
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', undefined));
  expect(stored[0].tags).toEqual(['原创']); expect(stored[0].imageUrl).toBe('/one.png');
  expect(stored[0].boardId).toBe('folder'); expect(stored[0].archived).not.toBe(true);
});

it('部分保存失败回读实际结果、保留编辑输入，重试仅处理剩余旧标签', async () => {
  let calls = 0;
  mocks.save.mockImplementation(async (ids, updates) => { if (++calls === 2) throw new Error('合成保存失败'); await save(ids, updates); });
  const { notify, onTagChanged } = setup(); rename('逆光', '日落');
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成保存失败', 'error'));
  expect(stored[0].tags).toEqual(['日落', '原创']); expect(stored[1].tags).toContain('逆光');
  expect((screen.getByRole('combobox', { name: '标签名称' }) as HTMLInputElement).value).toBe('日落');
  expect(onTagChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('逆光', '日落'));
  expect(mocks.save).toHaveBeenLastCalledWith(['two'], { tags: ['日落', '风景'] });
});

it('空名、同名与来源同名不保存；访客只能查看，Esc 可关闭空闲窗口', async () => {
  const { notify, onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: '重命名标签：逆光' }));
  const input = screen.getByRole('combobox', { name: '标签名称' });
  for (const value of [' # ', '#逆光']) {
    fireEvent.change(input, { target: { value } });
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.change(input, { target: { value: '生成历史' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('标签名称与图片来源重复，请使用其他名称', 'error'));
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  cleanup(); setup(fixture(), { ...user, role: 'guest' });
  expect((screen.getByRole('button', { name: '重命名标签：逆光' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '移除标签：逆光' }) as HTMLButtonElement).disabled).toBe(true);
});

it('相同标签组合复用一次批量保存，由共用服务处理接口批次限制', async () => {
  setup(Array.from({ length: 601 }, (_, index) => ({ ...fixture()[0], id: 'bulk-' + index })));
  fireEvent.click(screen.getByRole('button', { name: '移除标签：逆光' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0]).toHaveLength(601);
  expect(mocks.save.mock.calls[0][1]).toEqual({ tags: ['原创'] });
});

it('创建独立标签显示 0 页，规范化名称、拒绝同名，保留未成功输入，不给图片自动打标签', async () => {
  const { notify, onReloadTagNames } = setup();
  const input = screen.getByRole('textbox', { name: '新标签名称' });
  expect((screen.getByRole('button', { name: '添加标签' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: ' #构图 ' } });
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  await waitFor(() => expect(screen.getByText('#构图').closest('li')!.textContent).toContain('0页'));
  expect(tagNames).toEqual(['构图']); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: ' #构图 ' } }); fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('标签已存在', 'error'));
  expect(saveTagNames).toHaveBeenCalledOnce();
  saveTagNames.mockRejectedValueOnce(new Error('合成目录写入失败'));
  fireEvent.change(input, { target: { value: '夜景' } }); fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith('合成目录写入失败', 'error'));
  expect(onReloadTagNames).toHaveBeenCalledOnce(); expect((input as HTMLInputElement).value).toBe('夜景');
  expect(screen.queryByText('#夜景')).toBeNull();
});

it('0 页标签可以改名、显式合并和移除，已使用的目录标签同时更新图片，重开保留结果', async () => {
  const { unmount, onTagChanged } = setup(fixture(), user, ['构图', '光影', '逆光']);
  rename('构图', '光影');
  await waitFor(() => expect(onTagChanged).toHaveBeenCalledWith('构图', '光影'));
  expect(tagNames).toEqual(['光影', '逆光']); expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: '将「构图」合并到「光影」？', message: expect.stringContaining('0 页') }));
  rename('逆光', '日落');
  await waitFor(() => expect(tagNames).toEqual(['光影', '日落']));
  expect(stored[0].tags).toEqual(['日落', '原创']);
  fireEvent.click(screen.getByRole('button', { name: '移除标签：光影' }));
  await waitFor(() => expect(tagNames).toEqual(['日落']));
  unmount(); setup(stored, user, tagNames);
  expect(screen.getByText('#日落')).toBeTruthy(); expect(screen.queryByText('#光影')).toBeNull();
});

it('目录未读取成功或访客时不可创建，读取失败提供原位重试，不覆盖未知目录', async () => {
  const { onReloadTagNames } = setup(fixture(), user, null);
  expect((screen.getByRole('textbox', { name: '新标签名称' }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重命名标签：逆光' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载标签' }));
  expect(onReloadTagNames).toHaveBeenCalledOnce(); expect(saveTagNames).not.toHaveBeenCalled();
  cleanup(); setup(fixture(), { ...user, role: 'guest' }, ['构图']);
  expect((screen.getByRole('button', { name: '添加标签' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '移除标签：构图' }) as HTMLButtonElement).disabled).toBe(true);
});
