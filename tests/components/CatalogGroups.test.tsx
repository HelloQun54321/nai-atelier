// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCatalogGroupBrowser } from '../../components/CatalogGroups';
import { ImageActivityContext } from '../../components/SmartImage';
import type { CatalogGroupKind, CatalogGroupState } from '../../services/catalogGroups';

const mocks = vi.hoisted(() => ({ save: vi.fn(), reload: vi.fn(), confirm: vi.fn(), state: {} as CatalogGroupState, ready: true, error: '' }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/useCatalogGroups', () => ({ useCatalogGroups: () => ({ state: mocks.state, ready: mocks.ready, busy: false, error: mocks.error, save: mocks.save, reload: mocks.reload }) }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));
const completeKeys = ['artist:a', 'artist:b', 'artist:c', 'artist:d', 'artist:e'];
function Harness({ selected = ['artist:a', 'artist:b'], active = true, scope = 'artist', kind = 'artist', catalogKeys = completeKeys }: { selected?: string[]; active?: boolean; scope?: string; kind?: CatalogGroupKind; catalogKeys?: readonly string[] | null }) {
  return <ImageActivityContext.Provider value={active}><Browser selected={selected} scope={scope} kind={kind} catalogKeys={catalogKeys ?? undefined} /></ImageActivityContext.Provider>;
}
function Browser({ selected, scope, kind, catalogKeys }: { selected: string[]; scope: string; kind: CatalogGroupKind; catalogKeys?: readonly string[] }) {
  const groups = useCatalogGroupBrowser(kind, selected, vi.fn(), scope, catalogKeys);
  const [draft, setDraft] = useState('草稿');
  return <><header>{groups.toolbar}</header>{groups.navigation}{['artist:a', 'artist:b', 'artist:c', 'catalog:same', 'custom:same'].map(key => <article key={key} data-testid={key} {...groups.cardDragProps(key)}>{key}</article>)}<input aria-label="业务草稿" value={draft} onChange={event => setDraft(event.target.value)} /><output>{groups.activeGroup}</output><span data-testid="matches">{String(groups.matches('artist:a'))}/{String(groups.matches('artist:b'))}</span></>;
}
beforeEach(() => {
  localStorage.clear(); mocks.save.mockReset(); mocks.reload.mockReset(); mocks.ready = true; mocks.error = '';
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.state = { revision: 2, groups: [{ id: 'one', name: '组一' }, { id: 'two', name: '组二' }], memberships: { 'artist:a': ['one'], 'artist:b': ['two'], 'artist:outside': ['one', 'two'] } };
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function transfer(extraTypes: string[] = []) {
  const values = new Map<string, string>();
  return { get types() { return [...values.keys(), ...extraTypes]; }, effectAllowed: '', dropEffect: '', setData(type: string, value: string) { values.set(type, value); }, getData(type: string) { return values.get(type) || ''; } };
}
const openNavigation = () => fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
const shownCount = (name: string) => {
  const row = screen.getByRole('button', { name });
  return document.getElementById(row.getAttribute('aria-describedby')!)?.textContent;
};

it('业务范围嵌入已有导航，收起保留筛选与分组，按钮提示范围且不改归属计数', () => {
  function StatusBrowser() {
    const [range, setRange] = useState('all');
    const groups = useCatalogGroupBrowser('artist', [], vi.fn(), 'artist', completeKeys, {
      navigationHeader: <select aria-label="画师范围" value={range} onChange={event => setRange(event.target.value)}><option value="all">全部画师</option><option value="preferred">偏好画师</option></select>,
      activeFilterLabel: range === 'preferred' ? '偏好画师' : undefined,
    });
    return <>{groups.toolbar}{groups.navigation}</>;
  }
  render(<StatusBrowser />); openNavigation();
  fireEvent.change(screen.getByRole('combobox', { name: '画师范围' }), { target: { value: 'preferred' } });
  fireEvent.click(screen.getByRole('button', { name: '组二' }));
  expect(shownCount('全部')).toBe('5'); expect(shownCount('组二')).toBe('1');
  openNavigation();
  const trigger = screen.getByRole('button', { name: '分组导航' });
  expect(screen.queryByRole('combobox', { name: '画师范围' })).toBeNull();
  expect(trigger).toHaveProperty('title', '展开分类 · 组二 · 偏好画师');
  expect(trigger.dataset.active).toBe('true');
  openNavigation();
  expect(screen.getByRole('combobox', { name: '画师范围' })).toHaveProperty('value', 'preferred');
  expect(screen.getByRole('button', { name: '组二' }).getAttribute('aria-current')).toBe('page');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('完整目录单次计数，跨组各记一次，去重并排除幽灵和无效键，不随业务搜索或选择减少', () => {
  mocks.state.memberships['artist:a'] = ['one', 'two'];
  const view = render(<Harness catalogKeys={[...completeKeys, 'artist:a', 'artist: ', 'catalog:a', 'artist:bad\nkey']} selected={['artist:a']} />); openNavigation();
  expect(shownCount('全部')).toBe('5'); expect(shownCount('未分组')).toBe('3'); expect(shownCount('组一')).toBe('1'); expect(shownCount('组二')).toBe('2');
  expect(screen.getByRole('option', { name: '组二 (2)' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('业务草稿'), { target: { value: '仅搜索一项' } });
  view.rerender(<Harness selected={[]} />);
  expect(shownCount('全部')).toBe('5'); expect(shownCount('组二')).toBe('2');
});

it('目录未知、分组未就绪或失败显示破折号，真实空目录显示0', () => {
  const view = render(<Harness catalogKeys={null} />); openNavigation(); expect(shownCount('全部')).toBe('—'); expect(shownCount('组一')).toBe('—');
  view.rerender(<Harness catalogKeys={[]} />); expect(shownCount('全部')).toBe('0'); expect(shownCount('组一')).toBe('0');
  mocks.ready = false; view.rerender(<Harness />); expect(shownCount('全部')).toBe('—');
  mocks.ready = true; mocks.error = '合成读取失败'; view.rerender(<Harness />); expect(shownCount('全部')).toBe('—');
});

it('拖放真实保存回执更新归属计数，不改变完整目录总量', async () => {
  const view = render(<Harness selected={[]} />); openNavigation(); expect(shownCount('组二')).toBe('1');
  mocks.save.mockImplementation(async next => { mocks.state = { ...next, revision: next.revision + 1 }; });
  const dataTransfer = transfer(); fireEvent.dragStart(screen.getByTestId('artist:c'), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer });
  await act(async () => {}); view.rerender(<Harness selected={[]} />);
  expect(shownCount('组二')).toBe('2'); expect(shownCount('未分组')).toBe('2'); expect(shownCount('全部')).toBe('5');
});

it('未分组默认及普通选择不出现拖放ring，无效全部/未分组目标不高亮也不写入', () => {
  render(<Harness selected={[]} />); openNavigation();
  const rows = ['全部', '未分组', '组一', '组二'].map(name => screen.getByRole('button', { name }));
  const ungrouped = rows[1];
  expect(ungrouped.className).not.toContain('ring-2');
  fireEvent.click(ungrouped);
  expect(ungrouped.getAttribute('aria-current')).toBe('page'); expect(ungrouped.className).not.toContain('ring-2');
  for (const name of ['全部', '未分组']) {
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByTestId('artist:c'), { dataTransfer });
    const target = screen.getByRole('button', { name });
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('none');
    expect(rows.every(row => !row.className.includes('ring-2'))).toBe(true);
    fireEvent.drop(target, { dataTransfer });
    expect(rows.every(row => !row.className.includes('ring-2'))).toBe(true);
  }
  expect(mocks.save).not.toHaveBeenCalled();
});

it('有效分组拖入仅亮目标行，离开、拖动结束和成功投放清除所有ring', async () => {
  render(<Harness selected={[]} />); openNavigation();
  const rows = ['全部', '未分组', '组一', '组二'].map(name => screen.getByRole('button', { name }));
  const source = screen.getByTestId('artist:c'), target = rows[2];

  let dataTransfer = transfer(); fireEvent.dragStart(source, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer });
  expect(target.className).toContain('ring-2'); expect(rows.filter(row => row !== target).every(row => !row.className.includes('ring-2'))).toBe(true);
  fireEvent.dragLeave(target); expect(rows.every(row => !row.className.includes('ring-2'))).toBe(true);

  dataTransfer = transfer(); fireEvent.dragStart(source, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer });
  fireEvent.dragEnd(source); expect(rows.every(row => !row.className.includes('ring-2'))).toBe(true);

  dataTransfer = transfer(); fireEvent.dragStart(source, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer }); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(rows.every(row => !row.className.includes('ring-2'))).toBe(true);
});

it('拖已选卡带全部选中键，追加组保留原归属，内部混合Files优先并阻止冒泡', async () => {
  const outer = vi.fn(); render(<div onDrop={outer}><Harness selected={['artist:a', 'artist:b', 'artist:b']} /></div>); openNavigation();
  const dataTransfer = transfer(['Files']); fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer });
  expect(dataTransfer.effectAllowed).toBe('copy');
  const target = screen.getByRole('button', { name: '组一' }); fireEvent.dragOver(target, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe('copy'); expect(target.className).toContain('ring-2');
  fireEvent.drop(target, { dataTransfer }); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(outer).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][0].memberships).toEqual({ 'artist:a': ['one'], 'artist:b': ['two', 'one'], 'artist:outside': ['one', 'two'] });
});

it('拖未选卡只加单项，精确区分词库与自建角色键', async () => {
  render(<Harness kind="character" selected={['catalog:same']} />); openNavigation();
  const dataTransfer = transfer(); fireEvent.dragStart(screen.getByTestId('custom:same'), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer });
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships['custom:same']).toEqual(['two']);
  expect(mocks.save.mock.calls[0][0].memberships['catalog:same']).toBeUndefined();
});

it('已在目标组不重复保存，全部与未分组不作为移除归属的目标', () => {
  render(<Harness selected={[]} />); openNavigation();
  for (const name of ['组一', '全部', '未分组']) {
    const dataTransfer = transfer(); fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name }), { dataTransfer });
  }
  expect(mocks.save).not.toHaveBeenCalled();
});

it('外部payload、取消拖动与跨类型均不写入任意归属', () => {
  const view = render(<Harness />); openNavigation();
  const external = transfer(['Files', 'text/uri-list']); external.setData('application/x-nai-catalog-group-entries', JSON.stringify(['artist:outside']));
  fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer: external });
  const cancelled = transfer(); fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer: cancelled }); fireEvent.dragEnd(screen.getByTestId('artist:a')); fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer: cancelled });
  const old = transfer(); fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer: old }); view.rerender(<Harness kind="character" />);
  fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer: old }); expect(mocks.save).not.toHaveBeenCalled();
});

it('资料未就绪时卡片不可拖动，合成强制事件也不能开始保存', () => {
  mocks.ready = false; render(<Harness />); openNavigation();
  const dataTransfer = transfer(); expect(screen.getByTestId('artist:a')).toHaveProperty('draggable', false);
  fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer });
  expect(dataTransfer.types).toEqual([]); expect(mocks.save).not.toHaveBeenCalled();
});

it('拖放失败保留源条目与选择可重拖，挂起保存拒绝重复，隐藏和管理窗口禁止拖', async () => {
  mocks.save.mockRejectedValueOnce(new Error('合成拖放失败'));
  const view = render(<Harness selected={['artist:a']} />); openNavigation();
  const drop = () => { const dataTransfer = transfer(); fireEvent.dragStart(screen.getByTestId('artist:a'), { dataTransfer }); fireEvent.drop(screen.getByRole('button', { name: '组二' }), { dataTransfer }); };
  drop(); await screen.findByText('合成拖放失败'); expect(screen.getByTestId('artist:a')).toBeTruthy(); expect(screen.getByRole('button', { name: '设置分组' })).toBeTruthy();
  let finish!: () => void; mocks.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  drop(); expect(mocks.save).toHaveBeenCalledTimes(2); expect(screen.getByTestId('artist:a')).toHaveProperty('draggable', false); drop(); expect(mocks.save).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  fireEvent.click(screen.getByRole('button', { name: '设置分组' })); expect(screen.getByTestId('artist:a')).toHaveProperty('draggable', false);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  view.rerender(<Harness selected={['artist:a']} active={false} />); expect(screen.getByTestId('artist:a')).toHaveProperty('draggable', false); drop(); expect(mocks.save).toHaveBeenCalledTimes(2);
});

it('导航默认收起，选择与收展保留业务节点和本端范围偏好', () => {
  render(<Harness />); const draft = screen.getByLabelText('业务草稿');
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(screen.getByRole('button', { name: '分组导航' }).title).toBe('展开分类 · 全部');
  fireEvent.change(draft, { target: { value: '正在编辑' } });
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'one' } });
  expect(screen.getByRole('button', { name: '分组导航' }).title).toBe('收起分类 · 组一');
  fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  expect(screen.getByLabelText('业务草稿')).toBe(draft); expect(draft).toHaveProperty('value', '正在编辑');
  expect(JSON.parse(localStorage.getItem('nai_catalog_groups_artist')!)).toMatchObject({ active: 'one', expanded: false });
  expect(mocks.save).not.toHaveBeenCalled();
});

it('部分归属使用indeterminate，只改触及的组并保留跨筛选条目和其它归属', async () => {
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  const one = screen.getByRole('checkbox', { name: '组一' });
  expect(one).toHaveProperty('indeterminate', true);
  fireEvent.click(one); fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0].memberships).toEqual({ 'artist:a': ['one'], 'artist:b': ['two', 'one'], 'artist:outside': ['one', 'two'] });
});

it('保存失败保留弹窗与勾选草稿，重试不丢未触及组', async () => {
  mocks.save.mockRejectedValueOnce(new Error('合成保存失败')).mockResolvedValueOnce(undefined);
  render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '组一' })); fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await screen.findByText('合成保存失败'); expect(screen.getByRole('checkbox', { name: '组一' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2)); expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
});

it('删除需要明确确认，只移除分组和归属，条目其它组仍保留', async () => {
  render(<Harness selected={[]} />); fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'one' } });
  mocks.confirm.mockResolvedValueOnce(false);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '删除分组' })); });
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: '删除分组仅移除分组归属，条目和图片仍保留。', rememberKey: 'delete-catalog-group' }));
  fireEvent.click(screen.getByRole('button', { name: '删除分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.save.mock.calls[0][0]).toEqual({ revision: 2, groups: [{ id: 'two', name: '组二' }], memberships: { 'artist:b': ['two'], 'artist:outside': ['two'] } });
});

it('侧栏标题行直接Plus新建，当前组显示Pencil和Trash，导航行有Folder图标', async () => {
  const view = render(<Harness selected={[]} />); fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  const create = screen.getByRole('button', { name: '新建分组' });
  expect(create.querySelector('svg.lucide-plus')).toBeTruthy(); expect(create.textContent).toBe('');
  expect(create.parentElement?.parentElement?.textContent).toBe('分组');
  expect(screen.queryByRole('button', { name: '管理分组' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重命名分组' })).toBeNull();
  expect(screen.getByRole('button', { name: '组一' }).querySelector('svg.lucide-folder')).toBeTruthy();
  fireEvent.click(create); expect(screen.getByRole('dialog', { name: '新建分组' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), { target: { value: '直接新建' } });
  mocks.save.mockImplementation(async next => { mocks.state = { ...next, revision: next.revision + 1 }; });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); view.rerender(<Harness selected={[]} />);
  const created = mocks.state.groups.find(group => group.name === '直接新建')!;
  expect(screen.getByRole('combobox', { name: '选择分组' })).toHaveProperty('value', created.id);
  expect(screen.getByRole('button', { name: '重命名分组' }).querySelector('svg.lucide-pencil')).toBeTruthy();
  expect(screen.getByRole('button', { name: '删除分组' }).querySelector('svg.lucide-trash-2')).toBeTruthy();
  expect(mocks.state.memberships).toEqual({ 'artist:a': ['one'], 'artist:b': ['two'], 'artist:outside': ['one', 'two'] });
});

it('标题行改名保存失败保留草稿，取消不写，隐藏恢复保留同一编辑输入', async () => {
  const view = render(<Harness selected={[]} />); fireEvent.click(screen.getByRole('button', { name: '分组导航' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择分组' }), { target: { value: 'one' } });
  fireEvent.click(screen.getByRole('button', { name: '重命名分组' }));
  const input = screen.getByRole('textbox', { name: '分组名称' }); expect(input).toHaveProperty('value', '组一');
  fireEvent.change(input, { target: { value: '改后的名称' } }); view.rerender(<Harness selected={[]} active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull(); view.rerender(<Harness selected={[]} />);
  expect(screen.getByRole('textbox', { name: '分组名称' })).toBe(input); expect(input).toHaveProperty('value', '改后的名称');
  mocks.save.mockRejectedValueOnce(new Error('合成改名失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('合成改名失败');
  expect(input).toHaveProperty('value', '改后的名称'); expect(mocks.save.mock.calls[0][0].groups[0]).toEqual({ id: 'one', name: '改后的名称' });
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(screen.queryByRole('dialog')).toBeNull(); expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.state.groups[0].name).toBe('组一');
});

it('保存中禁止重复与关闭，隐藏后移除窗口，焦点返回触发入口', async () => {
  let finish!: () => void; mocks.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Harness />); const trigger = screen.getByRole('button', { name: '设置分组' }); trigger.focus(); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: '组一' })); fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  expect(screen.getByRole('button', { name: '关闭' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存分组' })); expect(mocks.save).toHaveBeenCalledOnce();
  await act(async () => finish()); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); view.rerender(<Harness active={false} />); expect(screen.queryByRole('dialog')).toBeNull();
});

it('隐藏与恢复保留同一分组输入节点、名称及勾选草稿', () => {
  const view = render(<Harness />); const trigger = screen.getByRole('button', { name: '设置分组' }); trigger.focus(); fireEvent.click(trigger);
  const input = screen.getByRole('textbox', { name: '新分组名称' });
  fireEvent.change(input, { target: { value: '未保存的新组' } }); fireEvent.click(screen.getByRole('checkbox', { name: '组一' }));
  view.rerender(<Harness active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('textbox', { name: '新分组名称', hidden: true })).toBe(input);
  view.rerender(<Harness />);
  expect(screen.getByRole('textbox', { name: '新分组名称' })).toBe(input); expect(input).toHaveProperty('value', '未保存的新组');
  expect(screen.getByRole('checkbox', { name: '组一' })).toHaveProperty('checked', true); expect(mocks.save).not.toHaveBeenCalled();
});

it('记住的非全部分组未就绪时不匹配整库，就绪后按真实归属匹配', () => {
  localStorage.setItem('nai_catalog_groups_artist', JSON.stringify({ active: 'one', expanded: true })); mocks.ready = false;
  const view = render(<Harness />);
  expect(screen.getByTestId('matches').textContent).toBe('false/false'); expect(screen.getByText('加载中…')).toBeTruthy();
  mocks.ready = true; view.rerender(<Harness />);
  expect(screen.getByTestId('matches').textContent).toBe('true/false'); expect(screen.queryByText('加载中…')).toBeNull();
});

it('没有分组时可先新建，重命名只保存元数据并保留已有归属', async () => {
  mocks.state = { revision: 0, groups: [], memberships: {} };
  mocks.save.mockImplementation(async next => { mocks.state = { ...next, revision: next.revision + 1 }; });
  const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: '设置分组' }));
  fireEvent.change(screen.getByRole('textbox', { name: '新分组名称' }), { target: { value: '新组' } });
  fireEvent.click(screen.getByRole('button', { name: '新建分组' }));
  await act(async () => {}); view.rerender(<Harness />);
  const checkbox = await screen.findByRole('checkbox', { name: '新组' }); expect(checkbox).toHaveProperty('checked', false);
  const groupId = mocks.state.groups[0].id;
  fireEvent.change(screen.getByRole('textbox', { name: '分组名称：新组' }), { target: { value: '改名' } });
  fireEvent.click(screen.getByRole('button', { name: '重命名' }));
  await act(async () => {}); view.rerender(<Harness />);
  await screen.findByRole('checkbox', { name: '改名' });
  expect(mocks.save.mock.calls[1][0]).toMatchObject({ groups: [{ id: groupId, name: '改名' }], memberships: {} });
  fireEvent.click(screen.getByRole('checkbox', { name: '改名' })); fireEvent.click(screen.getByRole('button', { name: '保存分组' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(mocks.save.mock.calls[2][0].memberships).toEqual({ 'artist:a': [groupId], 'artist:b': [groupId] });
});

it('手机返回只关闭分组子层，保留父历史与焦点，Tab圈禁在窗口内', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState({ __naiMobileLayer: 'parent', __naiMobileLayers: ['parent'] }, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  render(<Harness />); const trigger = screen.getByRole('button', { name: '设置分组' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  const last = screen.getByRole('button', { name: '保存分组' });
  // 保存未编辑时禁用，取消是最后一个可聚焦按钮。
  const cancel = screen.getByRole('button', { name: '取消' }); cancel.focus(); fireEvent.keyDown(cancel, { key: 'Tab' });
  expect(dialog.contains(document.activeElement)).toBe(true); expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }));
  expect(last).toHaveProperty('disabled', true);
  fireEvent.click(cancel); expect(back).toHaveBeenCalledOnce();
  act(() => { window.history.replaceState({ __naiMobileLayer: 'parent', __naiMobileLayers: ['parent'] }, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })); });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(window.history.state.__naiMobileLayer).toBe('parent'); expect(document.activeElement).toBe(trigger);
});
