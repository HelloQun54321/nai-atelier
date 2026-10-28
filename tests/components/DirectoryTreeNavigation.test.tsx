// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { DIRECTORY_FAVORITES_ID, DirectoryTreeNavigation } from '../../components/DirectoryTreeNavigation';
import { applyThemeDetails } from '../../services/themeDetails';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const nodes = [{ id: 'root', name: '根' }, { id: 'child', parentId: 'root', name: '子项' }, { id: 'leaf', parentId: 'child', name: '末层' }, { id: 'other', name: '另一根' }];
const props = () => ({ nodes, label: '业务文件夹', title: '文件夹', selectedId: '*', onSelect: vi.fn(), expanded: true, preferenceKey: 'first-business', totalCount: 5, unclassifiedCount: 1, counts: new Map([['root', 3], ['child', 2]]) });

it('使用统一侧栏与手机完整路径选择，折叠箭头不选择且按业务分别记忆', () => {
  const p = props(); const view = render(<DirectoryTreeNavigation {...p} />);
  expect(screen.getByRole('complementary').className).toContain('workspace-fixed-pane');
  expect(screen.getByRole('complementary').className).toContain('appearance-panel');
  expect(screen.getByRole('complementary').className).toContain('workspace-category-navigation');
  expect(screen.getByRole('complementary').className).toContain('md:w-52');
  expect(screen.getByRole('navigation').className).toBe('hidden space-y-1 md:block');
  expect(screen.getByRole('combobox').className).toContain('md:hidden');
  expect(screen.getByRole('option', { name: '根 / 子项 / 末层' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '根 / 子项 / 末层' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开目录「根 / 子项」' }));
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '根 / 子项 / 末层' }));
  expect(p.onSelect).toHaveBeenCalledWith('leaf');
  view.unmount();
  const again = render(<DirectoryTreeNavigation {...p} />);
  expect(screen.getByRole('button', { name: '根 / 子项 / 末层' })).toBeTruthy();
  again.rerender(<DirectoryTreeNavigation {...p} preferenceKey="second-business" />);
  expect(screen.queryByRole('button', { name: '根 / 子项 / 末层' })).toBeNull();
});

it('选中深层节点自动展开祖先，支持旧多选与全库数量', () => {
  const p = props();
  render(<DirectoryTreeNavigation {...p} selectedId="#selected" selectedIds={['leaf', 'other']} />);
  expect(screen.getByRole('button', { name: '根 / 子项 / 末层' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '另一根' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('option', { name: '已选 2 个目录' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '全部 (5)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '根 / 子项 (2)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'child' } });
  expect(p.onSelect).toHaveBeenCalledWith('child');
});

it('虚拟来源行可从桌面和手机选择，但不会变成可移动的真实目录', () => {
  const p = props(), onMove = vi.fn();
  const virtualNodes = [{ id: '#source:catalog', name: 'danbooru' }, { id: '#source:custom', name: '自定义' }];
  render(<DirectoryTreeNavigation {...p} selectedId="#source:catalog" virtualNodes={virtualNodes} counts={new Map([['#source:catalog', 3], ['#source:custom', 1]])} onMove={onMove} />);
  const source = screen.getByRole('button', { name: 'danbooru' });
  expect(source.getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '自定义' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'danbooru (3)' })).toBeTruthy();
  expect(screen.getByRole('option', { name: '自定义 (1)' })).toBeTruthy();
  expect(source.getAttribute('draggable')).not.toBe('true');
  expect(screen.queryByRole('button', { name: '重命名目录' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除目录' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '#source:custom' } });
  expect(p.onSelect).toHaveBeenCalledWith('#source:custom');
  const values = new Map<string, string>();
  const transfer = { get types() { return [...values.keys()]; }, setData(type: string, value: string) { values.set(type, value); }, getData(type: string) { return values.get(type) || ''; }, effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(screen.getByRole('button', { name: '根' }), { dataTransfer: transfer });
  fireEvent.drop(screen.getByRole('button', { name: 'danbooru' }), { dataTransfer: transfer });
  expect(onMove).not.toHaveBeenCalled();
});

it('收藏排在全部和未归类后，桌面手机共用且不可编辑或作为目录移动目标', () => {
  const p = props(), onMove = vi.fn(), onCreate = vi.fn();
  render(<DirectoryTreeNavigation {...p} selectedId={DIRECTORY_FAVORITES_ID} virtualNodes={[{ id: DIRECTORY_FAVORITES_ID, name: '收藏' }, { id: '#source', name: '来源' }]} counts={new Map([[DIRECTORY_FAVORITES_ID, 2]])} onMove={onMove} onCreate={onCreate} onRename={vi.fn()} onDelete={vi.fn()} />);
  expect(Array.from(screen.getByRole('combobox').querySelectorAll('option')).slice(0, 4).map(option => option.value)).toEqual(['*', '', DIRECTORY_FAVORITES_ID, '#source']);
  const favorite = screen.getByRole('button', { name: '收藏' });
  expect(favorite.getAttribute('aria-current')).toBe('page');
  expect(favorite.getAttribute('draggable')).not.toBe('true');
  expect(screen.getByRole('option', { name: '收藏 (2)' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重命名目录' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除目录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  expect(onCreate).toHaveBeenCalledWith(null);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: DIRECTORY_FAVORITES_ID } });
  expect(p.onSelect).toHaveBeenCalledWith(DIRECTORY_FAVORITES_ID);
});

it('标题动作把当前目录交回业务，拖放属性与额外行控件原样可用', () => {
  const p = props(), onCreate = vi.fn(), onRename = vi.fn(), onDelete = vi.fn(), onDrop = vi.fn();
  render(<DirectoryTreeNavigation {...p} selectedId="child" onCreate={onCreate} onRename={onRename} onDelete={onDelete} header={<p>业务抬头</p>} footer={<p>业务状态</p>} nodeProps={id => ({ onDrop, 'data-directory-id': id } as React.HTMLAttributes<HTMLButtonElement>)} nodeLeading={id => id === 'child' ? <span>排序把手</span> : null} nodeActions={id => id === 'child' ? <button type="button">颜色</button> : null} />);
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  fireEvent.click(screen.getByRole('button', { name: '重命名目录' }));
  fireEvent.click(screen.getByRole('button', { name: '删除目录' }));
  expect(screen.queryByRole('button', { name: '管理目录' })).toBeNull();
  expect(onCreate).toHaveBeenCalledWith('child'); expect(onRename).toHaveBeenCalledWith('child'); expect(onDelete).toHaveBeenCalledWith('child');
  const row = screen.getByRole('button', { name: '根 / 子项' });
  expect(row.getAttribute('data-directory-id')).toBe('child'); fireEvent.drop(row); expect(onDrop).toHaveBeenCalledOnce();
  expect(screen.getByText('排序把手')).toBeTruthy(); expect(screen.getByRole('button', { name: '颜色' })).toBeTruthy();
  expect(screen.getByText('业务抬头')).toBeTruthy(); expect(screen.getByText('业务状态')).toBeTruthy();
});

it('禁用后不改变选择或分支，收起不占空间，嵌入窗口避开页面固定偏移', () => {
  const p = props(), onCreate = vi.fn(); const view = render(<DirectoryTreeNavigation {...p} disabled onCreate={onCreate} />);
  fireEvent.click(screen.getByRole('button', { name: '根' }));
  fireEvent.click(screen.getByRole('button', { name: '收起目录「根」' }));
  fireEvent.click(screen.getByRole('button', { name: '新建目录' }));
  expect(p.onSelect).not.toHaveBeenCalled(); expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '根 / 子项' })).toBeTruthy();
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  view.rerender(<DirectoryTreeNavigation {...p} embedded hideSpecial />);
  expect(screen.getByRole('complementary').className).not.toContain('workspace-fixed-pane');
  expect(screen.getByRole('complementary').className).toContain('w-full');
  for (const value of ['appearance-panel', 'workspace-category-navigation', 'md:overflow-y-auto', 'flex-none', 'p-3', 'border-b']) expect(screen.getByRole('complementary').classList.contains(value)).toBe(false);
  expect(screen.getByRole('complementary').className).not.toContain('md:w-52');
  expect(screen.queryByRole('button', { name: '全部' })).toBeNull();
  view.rerender(<DirectoryTreeNavigation {...p} expanded={false} />);
  expect(screen.queryByRole('complementary')).toBeNull();
});

it('明暗玻璃和磨砂主题仅给外层或独立导航施加面板材质，嵌入内容不生成第二个表面', () => {
  const css = readFileSync('components/themeDetails.css', 'utf8') + readFileSync('index.css', 'utf8');
  const selectors: string[] = [];
  parse(css).walkRules(rule => {
    if (!rule.nodes.some(node => node.type === 'decl' && ['background-color', 'background-image', 'backdrop-filter', 'box-shadow', 'border-radius'].includes(node.prop))) return;
    selectors.push(...rule.selectors.filter(selector => selector.includes('.appearance-panel')));
  });
  const root = document.documentElement;
  const previous = { style: root.getAttribute('style'), className: root.getAttribute('class'), details: root.getAttribute('data-theme-details'), material: root.getAttribute('data-theme-material'), design: root.getAttribute('data-design-theme') };
  const view = render(<aside aria-label="外层面板" className="appearance-panel"><DirectoryTreeNavigation {...props()} embedded /></aside>);
  try {
    root.dataset.designTheme = 'nai-atelier';
    for (const material of ['glass', 'frosted'] as const) for (const dark of [false, true]) {
      root.classList.toggle('dark', dark);
      applyThemeDetails(root, { material }, { fontScale: 'standard', density: 'standard', surfaces: 'translucent' });
      view.rerender(<aside aria-label="外层面板" className="appearance-panel"><DirectoryTreeNavigation {...props()} embedded /></aside>);
      const embedded = screen.getByRole('complementary', { name: '业务文件夹' });
      expect(selectors.some(selector => embedded.matches(selector))).toBe(false);
      expect(selectors.some(selector => screen.getByRole('complementary', { name: '外层面板' }).matches(selector))).toBe(true);
      view.rerender(<DirectoryTreeNavigation {...props()} />);
      expect(selectors.some(selector => screen.getByRole('complementary').matches(selector))).toBe(true);
    }
  } finally {
    for (const [attribute, value] of [['style', previous.style], ['class', previous.className], ['data-theme-details', previous.details], ['data-theme-material', previous.material], ['data-design-theme', previous.design]] as const) {
      if (value === null) root.removeAttribute(attribute); else root.setAttribute(attribute, value);
    }
  }
});

it('旧多选包含未归类时保留各行高亮与手机混合选择', () => {
  render(<DirectoryTreeNavigation {...props()} selectedId="#selected" selectedIds={['child', '']} />);
  expect(screen.getByRole('button', { name: '未归类' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('button', { name: '根 / 子项' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('option', { name: '已选 2 个目录' })).toBeTruthy();
});

it('业务名称可覆写，管理禁用不妨碍浏览，外围拖放透传且行禁用拦截外部按钮', () => {
  const p = props(), onCreate = vi.fn(), onDrop = vi.fn(), onExtra = vi.fn();
  const view = render(<DirectoryTreeNavigation {...p} selectedId="child" actionDisabled onCreate={onCreate} createLabel="新建分组" selectLabel="选择分组" className="business-navigation" asideProps={{ onDrop }} nodeActions={value => value === 'child' ? <button type="button" onClick={onExtra}>额外操作</button> : null} />);
  expect(screen.getByRole('complementary').className).toContain('business-navigation');
  expect((screen.getByRole('button', { name: '新建分组' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '新建分组' }).title).toBe('新建分组');
  expect(screen.getByRole('combobox', { name: '选择分组' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '另一根' }));
  expect(p.onSelect).toHaveBeenCalledWith('other');
  fireEvent.drop(screen.getByRole('complementary')); expect(onDrop).toHaveBeenCalledOnce();
  view.rerender(<DirectoryTreeNavigation {...p} disabled nodeActions={value => value === 'child' ? <button type="button" onClick={onExtra}>额外操作</button> : null} />);
  fireEvent.click(screen.getByRole('button', { name: '额外操作' }));
  expect(onExtra).not.toHaveBeenCalled();
});

it('深层树仍完整可选，视觉缩进不把目录移出侧栏', () => {
  const deepNodes = Array.from({ length: 72 }, (_, index) => ({ id: `d${index}`, name: `层${index}`, parentId: index ? `d${index - 1}` : null }));
  render(<DirectoryTreeNavigation {...props()} nodes={deepNodes} selectedId="d71" />);
  const path = deepNodes.map(node => node.name).join(' / ');
  expect(screen.getByRole('button', { name: path }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('option', { name: path })).toBeTruthy();
  expect(screen.getByRole('button', { name: path }).parentElement?.style.paddingLeft).toBe('92px');
});

it('业务ID含空格和特殊字符时计数关联仍为唯一有效DOM ID', () => {
  const value = 'category: 夜景 & 雨 / #50%';
  const p = props();
  render(<DirectoryTreeNavigation {...p} nodes={[{ id: value, name: '夜景 & 雨 / #50%' }, { id: 'unclassified', name: '同名内部项' }]} counts={new Map([[value, 3], ['unclassified', 2]])} />);
  const links = [
    ['全部', '5'], ['未归类', '1'], ['夜景 & 雨 / #50%', '3'], ['同名内部项', '2'],
  ].map(([name, expected]) => {
    const button = screen.getByRole('button', { name });
    const describedBy = button.getAttribute('aria-describedby')!;
    expect(describedBy.split(/\s+/)).toHaveLength(1);
    expect(document.getElementById(describedBy)?.textContent).toBe(expected);
    return describedBy;
  });
  expect(new Set(links).size).toBe(4);
  fireEvent.click(screen.getByRole('button', { name: '夜景 & 雨 / #50%' }));
  expect(p.onSelect).toHaveBeenCalledWith(value);
});

const dataTransfer = () => {
  const data = new Map<string, string>();
  return { get types() { return [...data.keys()]; }, setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) || '', effectAllowed: '', dropEffect: '' };
};
const startDirectoryDrag = (source: HTMLElement) => {
  const transfer = dataTransfer(); fireEvent.dragStart(source, { dataTransfer: transfer }); return transfer;
};

it('拖动目录移为子级或移回独立根层目标，不改选择及原树', () => {
  const p = props(), onMove = vi.fn(), original = JSON.stringify(nodes);
  render(<DirectoryTreeNavigation {...p} onMove={onMove} />);
  const source = screen.getByRole('button', { name: '根 / 子项' });
  const destination = screen.getByRole('button', { name: '另一根' });
  expect(source.getAttribute('draggable')).toBe('true');
  const transfer = startDirectoryDrag(source);
  expect(transfer.types).toHaveLength(1);
  expect(transfer.types[0]).toMatch(/^application\/x-nai-directory-node-/);
  fireEvent.dragOver(destination, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe('move');
  expect(destination.parentElement?.className).toContain('ring-2');
  expect(screen.getByRole('status').textContent).toBe('移入目录「另一根」');
  fireEvent.drop(destination, { dataTransfer: transfer });
  expect(onMove).toHaveBeenLastCalledWith('child', 'other');
  expect(screen.queryByRole('group', { name: '移到根目录' })).toBeNull();
  const rootTransfer = startDirectoryDrag(source);
  const root = screen.getByRole('group', { name: '移到根目录' });
  expect(screen.getByRole('navigation').firstElementChild).toBe(root);
  fireEvent.dragOver(root, { dataTransfer: rootTransfer });
  expect(rootTransfer.dropEffect).toBe('move');
  fireEvent.drop(root, { dataTransfer: rootTransfer });
  expect(onMove).toHaveBeenLastCalledWith('child', null);
  expect(screen.queryByRole('button', { name: '根 / 子项 / 末层' })).toBeNull();
  const collapsedTransfer = startDirectoryDrag(destination);
  fireEvent.drop(source, { dataTransfer: collapsedTransfer });
  expect(onMove).toHaveBeenLastCalledWith('other', 'child');
  expect(screen.getByRole('button', { name: '根 / 子项 / 末层' })).toBeTruthy();
  expect(p.onSelect).not.toHaveBeenCalled(); expect(JSON.stringify(nodes)).toBe(original);
});

it('目录拖放拒绝自己、后代、当前上级与特殊筛选项，根层无变化也不保存', () => {
  const p = props(), onMove = vi.fn();
  render(<DirectoryTreeNavigation {...p} onMove={onMove} selectedId="leaf" />);
  const move = (sourceName: string, targetName: string) => {
    const transfer = startDirectoryDrag(screen.getByRole('button', { name: sourceName }));
    const target = screen.getByRole('button', { name: targetName });
    fireEvent.dragOver(target, { dataTransfer: transfer }); expect(transfer.dropEffect).toBe('none');
    fireEvent.drop(target, { dataTransfer: transfer });
  };
  move('根', '根'); move('根', '根 / 子项'); move('根', '根 / 子项 / 末层'); move('根 / 子项', '根'); move('根 / 子项', '全部'); move('根 / 子项', '未归类');
  const transfer = startDirectoryDrag(screen.getByRole('button', { name: '根' }));
  const root = screen.getByRole('group', { name: '移到根目录' });
  fireEvent.dragOver(root, { dataTransfer: transfer }); expect(transfer.dropEffect).toBe('none'); fireEvent.drop(root, { dataTransfer: transfer });
  expect(onMove).not.toHaveBeenCalled();
});

it('相同业务ID的不同导航实例互不接受目录拖放，不把目录误交卡片归属处理', () => {
  const firstMove = vi.fn(), secondMove = vi.fn(), cardDrop = vi.fn();
  render(<><DirectoryTreeNavigation {...props()} label="第一导航" onMove={firstMove} /><DirectoryTreeNavigation {...props()} label="第二导航" onMove={secondMove} nodeProps={() => ({ onDrop: cardDrop })} /></>);
  const first = within(screen.getByRole('complementary', { name: '第一导航' })), second = within(screen.getByRole('complementary', { name: '第二导航' }));
  const transfer = startDirectoryDrag(first.getByRole('button', { name: '根 / 子项' }));
  const destination = second.getByRole('button', { name: '另一根' });
  fireEvent.dragOver(destination, { dataTransfer: transfer }); expect(transfer.dropEffect).toBe('none'); fireEvent.drop(destination, { dataTransfer: transfer });
  expect(firstMove).not.toHaveBeenCalled(); expect(secondMove).not.toHaveBeenCalled(); expect(cardDrop).not.toHaveBeenCalled();
});

it('目录拖放优先拦截，作品卡片拖入与收藏夹独立排序把手继续走原事件', () => {
  const onMove = vi.fn(), cardOver = vi.fn(), cardDrop = vi.fn(), asideDrop = vi.fn(), sortStart = vi.fn(event => event.dataTransfer.setData('application/x-collection-order', 'child'));
  render(<DirectoryTreeNavigation {...props()} onMove={onMove} nodeProps={() => ({ onDragOver: cardOver, onDrop: cardDrop })} asideProps={{ onDrop: asideDrop }} nodeLeading={id => id === 'child' ? <span draggable onDragStart={sortStart}>排序把手</span> : null} />);
  const destination = screen.getByRole('button', { name: '另一根' });
  const transfer = startDirectoryDrag(screen.getByRole('button', { name: '根 / 子项' }));
  fireEvent.dragOver(destination, { dataTransfer: transfer }); fireEvent.drop(destination, { dataTransfer: transfer });
  expect(onMove).toHaveBeenCalledWith('child', 'other'); expect(cardOver).not.toHaveBeenCalled(); expect(cardDrop).not.toHaveBeenCalled(); expect(asideDrop).not.toHaveBeenCalled();
  const cards = dataTransfer(); cards.setData('application/x-business-card', 'image-1');
  fireEvent.dragOver(destination, { dataTransfer: cards }); fireEvent.drop(destination, { dataTransfer: cards });
  expect(cardOver).toHaveBeenCalledOnce(); expect(cardDrop).toHaveBeenCalledOnce(); expect(asideDrop).toHaveBeenCalledOnce();
  const sorting = dataTransfer(); fireEvent.dragStart(screen.getByText('排序把手'), { dataTransfer: sorting });
  expect(sortStart).toHaveBeenCalledOnce(); expect(sorting.types).toEqual(['application/x-collection-order']); expect(screen.queryByRole('group', { name: '移到根目录' })).toBeNull();
});

it('禁用和仅管理禁用均拒绝目录移动，拖动中变为忙碌也不能提交', () => {
  const p = props(), onMove = vi.fn();
  const view = render(<DirectoryTreeNavigation {...p} onMove={onMove} actionDisabled />);
  let source = screen.getByRole('button', { name: '根 / 子项' });
  expect(source.getAttribute('draggable')).toBe('false');
  expect(startDirectoryDrag(source).types).toHaveLength(0);
  view.rerender(<DirectoryTreeNavigation {...p} onMove={onMove} disabled />);
  source = screen.getByRole('button', { name: '根 / 子项' }); expect(startDirectoryDrag(source).types).toHaveLength(0);
  view.rerender(<DirectoryTreeNavigation {...p} onMove={onMove} />);
  const transfer = startDirectoryDrag(screen.getByRole('button', { name: '根 / 子项' }));
  view.rerender(<DirectoryTreeNavigation {...p} onMove={onMove} actionDisabled />);
  fireEvent.drop(screen.getByRole('button', { name: '另一根' }), { dataTransfer: transfer });
  expect(onMove).not.toHaveBeenCalled(); expect(screen.queryByRole('group', { name: '移到根目录' })).toBeNull();
});


it('全部、来源和独立用户根目录对齐，真实子目录保留缩进及手机完整路径', () => {
  const p = props();
  const virtualNodes = [{ id: '#source:catalog', name: 'danbooru' }, { id: '#source:custom', name: '自定义' }];
  render(<DirectoryTreeNavigation {...p} virtualNodes={virtualNodes} selectedId="#source:custom" />);
  const row = (name: string) => screen.getByRole('button', { name }).parentElement!;
  const root = row('根');
  for (const name of ['全部', '未归类', 'danbooru', '自定义', '根', '另一根']) {
    const current = row(name);
    expect(current.style.paddingLeft).toBe('8px');
    expect(current.firstElementChild?.classList.contains('w-4')).toBe(true);
    expect(current.firstElementChild?.classList.contains('flex-none')).toBe(true);
    expect(current.querySelector('svg.lucide-folder')?.parentElement?.className).toBe(root.querySelector('svg.lucide-folder')?.parentElement?.className);
  }
  expect(row('根 / 子项').style.paddingLeft).toBe('22px');
  expect(screen.getByRole('button', { name: '收起目录「根」' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '展开目录「根 / 子项」' }));
  expect(row('根 / 子项 / 末层').style.paddingLeft).toBe('36px');
  const options = Array.from((screen.getByRole('combobox') as HTMLSelectElement).options);
  expect(options.map(option => option.textContent)).toEqual(['全部 (5)', '未归类 (1)', 'danbooru', '自定义', '根 (3)', '根 / 子项 (2)', '根 / 子项 / 末层', '另一根']);
  expect(options.find(option => option.value === 'other')?.textContent).toBe('另一根');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } });
  expect(p.onSelect).toHaveBeenCalledWith('other');
  expect(nodes.find(node => node.id === 'other')).toEqual({ id: 'other', name: '另一根' });
});
