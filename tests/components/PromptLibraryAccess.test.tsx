// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
const render = (ui: React.ReactNode) => renderView(ui, { wrapper: ConfirmDialogProvider });
import { LibraryDialog, PromptLibraryChooser, PromptLibraryContext, PromptLibraryRequestEnabledContext, PromptLibraryWorkspace, PromptLibraryUseDialog, PromptLibrarySaveDialog, PromptLibraryRandomButton, type WorkspaceAccess } from '../../components/PromptLibraryAccess';
import { ImageActivityProvider } from '../../components/SmartImage';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { prepareCollectedPrompt } from '../../services/collectedPrompt';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';

it('条目读取状态：实验室取用继承context加载失败和重试，不把未知当空', () => {
  const retry = vi.fn(), save = vi.fn();
  const page = (chainsLoading = false, chainsError = '') => <PromptLibraryContext.Provider value={{ chains: [], chainsLoading, chainsError, onRetryChains: retry, save }}><PromptLibraryChooser value="" onText={vi.fn()} onClose={vi.fn()} /></PromptLibraryContext.Provider>;
  const view = render(page(true));
  expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText('没有匹配的条目')).toBeNull();
  view.rerender(page(false, '读取提示词库失败'));
  expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(page()); expect(screen.getByText('没有匹配的条目')).toBeTruthy();
});

it('条目读取状态：实验室嵌套搭配沿用同一失败状态和重试，不显示未知0条', () => {
  const retry = vi.fn();
  render(<PromptLibraryContext.Provider value={{ chains: [], chainsError: '读取提示词库失败', onRetryChains: retry, save: vi.fn() }}><PromptLibraryWorkspace state={{ params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: true }} onChange={vi.fn()}><PromptLibraryRandomButton /></PromptLibraryWorkspace></PromptLibraryContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '随机搭配' }));
  expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  expect(screen.queryAllByText('该库当前 0 条，该栏留空')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
});
import type { PromptChain } from '../../types';

afterEach(cleanup);
it('手机等待编辑关闭确认时保留当前返回层，取消后仍可再次返回', async () => {
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.history.replaceState({}, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const close = vi.fn(() => false);
  try {
    render(<LibraryDialog title="编辑" onClose={close}>合成草稿</LibraryDialog>);
    await waitFor(() => expect(window.history.state?.__naiMobileLayer).toContain('prompt-library'));
    const marker = window.history.state.__naiMobileLayer;
    act(() => { window.history.replaceState({}, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    expect(close).toHaveBeenCalledOnce();
    expect(window.history.state.__naiMobileLayer).toBe(marker);
    act(() => { window.history.replaceState({}, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    expect(close).toHaveBeenCalledTimes(2);
    expect(window.history.state.__naiMobileLayer).toBe(marker);
  } finally { cleanup(); await Promise.resolve(); back.mockRestore(); window.matchMedia = previousMatchMedia; window.history.replaceState({}, ''); }
});
it('分栏收录组合可填写多个自定义标签并选择已有标签', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const chain = { id: 'existing', ...createCombinationData('组合', { scene: { kind: 'scene', text: 'rain', filled: true } }), tags: ['已有分类'] } as PromptChain;
  render(<PromptLibraryContext.Provider value={{ chains: [chain], categoryNames: ['预建分类'], save }}><PromptLibrarySaveDialog text="rain" initialParams={{ ...LAB_DEFAULT_PARAMS, _promptSections: { scene: 'rain' } }} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  fireEvent.change(screen.getByRole('combobox', { name: '保存为' }), { target: { value: 'combination' } });
  const tags = screen.getByRole('textbox', { name: '自定义标签' });
  fireEvent.change(tags, { target: { value: ' 新分类， 新分类, ' } });
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.getByRole('button', { name: '#预建分类' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '#已有分类' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].tags).toEqual(['新分类', '已有分类']);
  expect(save.mock.calls[0][0].params._rollContentSnapshot).toBeTruthy();
});
it('手机 StrictMode 新挂载使用面板不会被试挂载清理的返回事件关闭', async () => {
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.history.replaceState({}, '');
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })), 0);
  });
  const entry = { id: 'raw', ...prepareCollectedPrompt('snow', '雪夜') } as PromptChain;
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <PromptLibraryUseDialog entry={entry} state={{ params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: false }} onChange={vi.fn()} onApplied={vi.fn()} onClose={() => setOpen(false)} /> : null;
  }
  try {
    render(<React.StrictMode><Harness /></React.StrictMode>);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog', { name: '使用提示词' })).not.toBeNull();
  } finally { back.mockImplementation(() => {}); cleanup(); back.mockRestore(); window.matchMedia = previousMatchMedia; window.history.replaceState({}, ''); }
});

it('手机冷挂载实验室从等待态换为使用面板时，不被旧层迟到返回关闭', async () => {
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  window.history.replaceState({}, '');
  // 浏览器返回异步抵达：旧等待层清理后，新使用层已经完成挂载。
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    setTimeout(() => window.dispatchEvent(new PopStateEvent('popstate', { state: {} })), 0);
  });
  const entry = { id: 'raw', ...prepareCollectedPrompt('snow', '雪夜') } as PromptChain;
  function Harness() {
    const [open, setOpen] = useState(true), [ready, setReady] = useState(false);
    return <><button onClick={() => setReady(true)}>实验室就绪</button>{open && (ready
      ? <PromptLibraryUseDialog entry={entry} state={{ params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: false }} onChange={vi.fn()} onApplied={vi.fn()} onClose={() => setOpen(false)} />
      : <LibraryDialog title="使用" historyLayer={false} onClose={() => setOpen(false)}>正在读取实验室草稿</LibraryDialog>)}</>;
  }
  try {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '实验室就绪' }));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.queryByRole('dialog', { name: '使用提示词' })).not.toBeNull();
  } finally { back.mockImplementation(() => {}); cleanup(); back.mockRestore(); window.matchMedia = previousMatchMedia; window.history.replaceState({}, ''); }
});

it('隐藏的文生图工作区登记真实草稿且不重复登记，外部写入共享撤销', async () => {
  const before = { params: LAB_DEFAULT_PARAMS, base: 'draft artist', subject: 'draft scene', negative: 'draft negative', classified: true };
  let registered: WorkspaceAccess | null = null;
  const register = vi.fn((access: WorkspaceAccess | null) => { registered = access; });
  const activate = vi.fn();
  function Harness() {
    const [state, setState] = useState(before);
    const [, rerender] = useState(0);
    return <PromptLibraryContext.Provider value={{ chains: [], save: vi.fn(), registerWorkspace: register }}><PromptLibraryRequestEnabledContext.Provider value>
      <PromptLibraryWorkspace register active={false} state={{ ...state }} onExternalChange={activate} onChange={next => setState(next)}><button onClick={() => rerender(value => value + 1)}>重绘</button></PromptLibraryWorkspace>
    </PromptLibraryRequestEnabledContext.Provider></PromptLibraryContext.Provider>;
  }
  const { unmount } = render(<Harness />);
  expect(registered!.state).toMatchObject(before);
  const registrations = register.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '重绘' }));
  expect(register).toHaveBeenCalledTimes(registrations);
  await registered!.change({ ...before, base: 'new artist' });
  await waitFor(() => expect(registered!.canUndo).toBe(true));
  expect(activate).toHaveBeenCalledOnce();
  registered!.undo();
  await waitFor(() => expect(registered!.state.base).toBe('draft artist'));
  unmount();
  expect(register).toHaveBeenLastCalledWith(null);
});

it('普通编辑器与图片模式工作区不抢占实验室的文生图登记', () => {
  const register = vi.fn();
  const state = { params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: false };
  render(<PromptLibraryContext.Provider value={{ chains: [], save: vi.fn(), registerWorkspace: register }}><PromptLibraryRequestEnabledContext.Provider value>
    <PromptLibraryWorkspace state={state} onChange={vi.fn()}><span>图片模式</span></PromptLibraryWorkspace>
  </PromptLibraryRequestEnabledContext.Provider><PromptLibraryWorkspace register state={state} onChange={vi.fn()}><span>普通编辑器</span></PromptLibraryWorkspace></PromptLibraryContext.Provider>);
  expect(register).not.toHaveBeenCalled();
});

it('纯文本收录复用可编辑的通用表单，保留字段用途', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<PromptLibraryContext.Provider value={{ chains: [], save }}><PromptLibrarySaveDialog text="silver hair" field={{ kind: 'appearance' }} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  const input = await screen.findByRole('textbox', { name: '提示词原文' });
  expect(input.closest('.z-\\[2000\\]')).not.toBeNull();
  expect((input as HTMLTextAreaElement).value).toBe('silver hair');
  fireEvent.change(input, { target: { value: 'white hair' } });
  fireEvent.click(screen.getByRole('button', { name: '保存片段' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ type: 'appearance', basePrompt: 'white hair' });
});

it('库内使用原文先确认，等待写入成功后才离开，并保留逐字内容', async () => {
  const entry = { id: 'raw', ...prepareCollectedPrompt('  {{snow}}\r\nnight  ', '雪夜') } as PromptChain;
  let finish!: () => void;
  const changed = vi.fn((_next: { base: string }) => new Promise<void>(resolve => { finish = resolve; }));
  const applied = vi.fn(), close = vi.fn();
  render(<PromptLibraryUseDialog entry={entry} state={{ params: LAB_DEFAULT_PARAMS, base: 'artist', subject: '', negative: 'lowres', classified: false }} onChange={changed} onApplied={applied} onClose={close} />);
  expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '替换' }));
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  expect(changed.mock.calls[0][0].base).toBe(entry.basePrompt);
  expect(applied).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  expect(close).toHaveBeenCalledOnce();
});

it('库内使用失败留在确认面板，不进入实验室', async () => {
  const entry = { id: 'raw', ...prepareCollectedPrompt('snow', '雪夜') } as PromptChain;
  const applied = vi.fn(), close = vi.fn();
  render(<PromptLibraryUseDialog entry={entry} state={{ params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: false }} onChange={vi.fn().mockRejectedValue(new Error('保存失败'))} onApplied={applied} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  await screen.findByRole('alert');
  expect(applied).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '使用' }).hasAttribute('disabled')).toBe(false);
});

it('在取用弹窗标题栏下沿显示当前可选条目数', async () => {
  const entry = { id: 'entry', type: 'appearance', name: '银发', basePrompt: 'silver hair', params: {}, tags: [] } as unknown as PromptChain;
  render(<PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn() }}>
    <PromptLibraryChooser value="" onText={vi.fn()} onClose={vi.fn()} />
  </PromptLibraryContext.Provider>);
  const caption = await screen.findByText('共 1 条');
  expect(caption.getAttribute('data-toolbar-count-caption')).toBe('true');
  expect(caption.closest('header')).not.toBeNull();
});

it('切换到其他页面时隐藏取用弹窗并释放 Escape，回来保留草稿', () => {
  const close = vi.fn();
  const view = (active: boolean) => <ImageActivityProvider active={active}><LibraryDialog title="取用提示词" onClose={close}><input aria-label="草稿" defaultValue="选择中的内容" /></LibraryDialog></ImageActivityProvider>;
  const { rerender } = render(view(true));
  expect(screen.getByRole('dialog')).toBeTruthy();
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '修改中的内容' } });
  rerender(view(false));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  rerender(view(true));
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('修改中的内容');
});
it('从库页取用原文写入当前实验室，保留原文与生成参数，隐藏工作区不消费请求', async () => {
  const entry = { id: 'raw', ...prepareCollectedPrompt('  {{snow}}\r\nnight  ', '雪夜') } as PromptChain;
  const changed = vi.fn(), hidden = vi.fn();
  function Harness() {
    const [request, setRequest] = useState<PromptChain | null>(entry);
    const state = { params: { ...LAB_DEFAULT_PARAMS, seed: 37 }, base: 'artist', subject: '', negative: 'lowres', classified: false };
    return <PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn(), requestedEntry: request, clearRequest: () => setRequest(null) }}>
      <PromptLibraryRequestEnabledContext.Provider value={false}><PromptLibraryWorkspace state={state} onChange={hidden}><span>隐藏</span></PromptLibraryWorkspace></PromptLibraryRequestEnabledContext.Provider>
      <PromptLibraryRequestEnabledContext.Provider value><PromptLibraryWorkspace state={state} onChange={changed}><span>当前</span></PromptLibraryWorkspace></PromptLibraryRequestEnabledContext.Provider>
    </PromptLibraryContext.Provider>;
  }
  render(<Harness />);
  await screen.findByRole('dialog', { name: '使用提示词' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  expect(changed).toHaveBeenCalledOnce(); expect(changed.mock.calls[0][0].base).toBe('artist,   {{snow}}\r\nnight  ');
  expect(changed.mock.calls[0][0].params.seed).toBe(37); expect(hidden).not.toHaveBeenCalled();
});

it('角色入口取用组合仅写指定角色，包含负面与可撤销快照', async () => {
  const entry = { id: 'combo', ...createCombinationData('白裙', { wardrobe: { kind: 'wardrobe', text: 'white dress', negative: 'red dress', filled: true }, scene: { kind: 'scene', text: 'rain', filled: true } }) } as PromptChain;
  const changed = vi.fn();
  const before = { params: { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'one', prompt: 'one', x: 0.2, y: 0.5 }, { id: 'two', prompt: 'two', x: 0.8, y: 0.5 }] }, base: 'artist', subject: 'sunny', negative: '', classified: true };
  function Harness() { const [state, setState] = useState(before); return <PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn() }}><PromptLibraryWorkspace state={state} onChange={next => { changed(next); setState(next as typeof before); }}><PromptLibraryChooser initialEntry={entry} value="two" field={{ roleId: 'two' }} onText={vi.fn()} onClose={vi.fn()} /></PromptLibraryWorkspace></PromptLibraryContext.Provider>; }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  expect(changed.mock.calls[0][0].params.characters[0]).toEqual(before.params.characters[0]);
  expect(changed.mock.calls[0][0].params.characters[1].sections.wardrobe).toBe('white dress');
  expect(changed.mock.calls[0][0].params.characters[1].sectionNegatives.wardrobe).toBe('red dress');
  expect(changed.mock.calls[0][0].subject).toBe('sunny');
  fireEvent.click(await screen.findByRole('button', { name: '撤销上次填入' }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(before));
});

it('真实目录读取失败保留重试并禁用写入，不按旧分类保存', async () => {
  const save = vi.fn(), reloadDirectories = vi.fn().mockResolvedValue(undefined);
  render(<PromptLibraryContext.Provider value={{ chains: [], save, directoriesError: '目录读取失败', reloadDirectories }}><PromptLibrarySaveDialog text="silver sword" initialParams={LAB_DEFAULT_PARAMS} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  expect(screen.getByRole('alert').textContent).toContain('目录读取失败');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(reloadDirectories).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
});

it('组合收录分类候选显示完整路径而保存真实标签名', async () => {
  const save = vi.fn().mockResolvedValue(undefined), categoryTree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }] };
  render(<PromptLibraryContext.Provider value={{ chains: [], categoryTree, save }}><PromptLibrarySaveDialog text="night" initialParams={{ ...LAB_DEFAULT_PARAMS, _promptSections: { scene: 'night' } }} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  fireEvent.change(screen.getByRole('combobox', { name: '保存为' }), { target: { value: 'combination' } }); fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(screen.getByRole('button', { name: '#父类 / 子类' })); expect((screen.getByRole('textbox', { name: '自定义标签' }) as HTMLInputElement).value).toBe('子类');
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(save.mock.calls[0][0].tags).toEqual(['子类']);
});


it('混合片段整段取用保留正负词，不写入任何纯用途栏位', async () => {
  const entry = { id: 'mixed', type: 'preset', name: '混合片段', basePrompt: '1.3::dress, smiling::', negativePrompt: 'hat', params: { _collectedCategory: 'general', _promptLibraryPurposes: ['clothing', 'expression'] } } as unknown as PromptChain;
  const changed = vi.fn(), close = vi.fn();
  render(<PromptLibraryContext.Provider value={{ chains: [entry], save: vi.fn() }}>
    <PromptLibraryUseDialog entry={entry} state={{ params: { ...LAB_DEFAULT_PARAMS }, base: 'artist:test', subject: '', negative: 'lowres', classified: true }} onChange={changed} onApplied={vi.fn()} onClose={close} />
  </PromptLibraryContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(changed.mock.calls[0][0]).toMatchObject({ base: 'artist:test, 1.3::dress, smiling::', negative: 'lowres, hat', params: { _promptSections: {} } });
});

it('组合收录保存全局与所选角色同用途的两份正文和负面', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const params = { ...LAB_DEFAULT_PARAMS, _promptSections: { 'purpose:clothing': 'global cape', sectionNegatives: { 'purpose:clothing': 'global negative' } }, characters: [
    { id: 'one', prompt: 'keep', x: 0.5, y: 0.5, sections: { 'purpose:clothing': 'first dress' } },
    { id: 'two', prompt: '', x: 0.5, y: 0.5, sections: { 'purpose:clothing': 'selected dress' }, sectionNegatives: { 'purpose:clothing': 'selected negative' } },
  ] };
  render(<PromptLibraryContext.Provider value={{ chains: [], save }}><PromptLibrarySaveDialog text="global cape" initialParams={params} field={{ roleId: 'two' }} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  fireEvent.change(screen.getByRole('combobox', { name: '保存为' }), { target: { value: 'combination' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const items = save.mock.calls[0][0].params._rollContentSnapshot.items;
  expect(items).toEqual([
    expect.objectContaining({ itemId: 'global:purpose:clothing', unitId: 'purpose:clothing', scope: 'global', text: 'global cape', negative: 'global negative' }),
    expect.objectContaining({ itemId: 'character:purpose:clothing', unitId: 'purpose:clothing', scope: 'character', text: 'selected dress', negative: 'selected negative' }),
  ]);
  expect(JSON.stringify(items)).not.toContain('first dress');
});
