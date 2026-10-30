import { openPurposeGroup } from '../support/promptPurposeGroups';
import { PromptLibraryBrowser } from '../../components/PromptLibraryBrowser';
// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains('chain-masonry')) this.callback([{ target, contentRect: { width: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} }));
import * as libraries from '../../components/PromptLibrary';
import { promptAgentService } from '../../services/promptAgent';
import type { PromptChain } from '../../types';
import { PromptLibraryContext } from '../../components/PromptLibraryAccess';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';

const render = (ui: React.ReactNode) => renderView(<ConfirmDialogProvider>{ui}</ConfirmDialogProvider>);

vi.mock('../../components/HistoryImagePicker', () => ({HistoryImagePicker: () => null}));
vi.mock('../../services/promptLibraryUsage', () => ({
  PROMPT_LIBRARY_USAGE_PAGE_SIZE: 24,
  PROMPT_LIBRARY_USAGE_PREVIEW_SIZE: 6,
  fetchPromptLibraryUsageSummary: async () => ({ items: [], linkedImages: 0, entries: 0 }),
  fetchPromptLibraryUsageImages: async () => ({ items: [], count: 0, limit: 24, offset: 0 }),
}));
afterEach(() => {cleanup(); localStorage.clear(); vi.restoreAllMocks();});
const chains = [
  {id:'a',type:'appearance',name:'形象甲',basePrompt:'silver_hair',params:{},tags:[]},
  {id:'s',type:'scene',name:'雨夜',basePrompt:'rainy_street',params:{},tags:[]},
  {id:'style',type:'style',name:'普通风格串',params:{},tags:[]},
] as unknown as PromptChain[];
const props = () => ({chains,onCreate:vi.fn(),onSelect:vi.fn(),onUpdateChain:vi.fn(),onDelete:vi.fn(),notify:vi.fn()});
const Hub = () => libraries.PromptLibraryHub;

it('条目读取状态：片段管理从context继承延迟错误重试，缓存卡片继续显示', () => {
  const Manager = Hub(), retry = vi.fn();
  const page = (items: PromptChain[], chainsLoading = false, chainsError = '') => <ConfirmDialogProvider><PromptLibraryContext.Provider value={{ chains: items, chainsLoading, chainsError, onRetryChains: retry, save: vi.fn() }}><Manager {...props()} chains={items} /></PromptLibraryContext.Provider></ConfirmDialogProvider>;
  const view = renderView(page([], true));
  expect(screen.getByText('加载中…')).toBeTruthy(); expect(screen.queryByText('图片提示词库还是空的')).toBeNull();
  view.rerender(page([], false, '读取提示词库失败'));
  expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(page([])); expect(screen.getByText('图片提示词库还是空的')).toBeTruthy();
  view.rerender(page(chains, true)); expect(screen.getByText('形象甲')).toBeTruthy();
  expect(screen.queryByText('加载中…')).toBeNull();
});

it('独立编辑只保留一个窗口标题和滚动正文，名称正文在目录前，封面不强制竖幅', () => {
  const directories = { revision: 1, nodes: [{ id: 'light', parentId: null, name: '光照' }] };
  const entry = { ...chains[0], previewImage: '/synthetic/cover.png' };
  render(<PromptLibraryContext.Provider value={{ chains: [entry], directories, save: vi.fn() }}><libraries.PromptLibraryEntryEditor {...props()} chains={[entry]} entry={entry} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  const dialog = screen.getByRole('dialog', { name: entry.name });
  expect(dialog.querySelectorAll('header')).toHaveLength(1);
  expect(dialog.querySelector('.workspace-command-bar')).toBeNull();
  expect(dialog.querySelectorAll('.overflow-y-auto').length).toBe(2); // 正文与仅展开时可见的目录选择区。
  const prompt = screen.getByRole('textbox', { name: '英文提示词' });
  expect(prompt.compareDocumentPosition(screen.getByText('选择目录')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const cover = screen.getByRole('img', { name: '封面预览' });
  expect(cover.classList.contains('max-h-48')).toBe(true);
  expect(cover.closest('.aspect-\\[2\\/3\\]')).toBeNull();
  expect(screen.getByRole('button', { name: '保存' }).getAttribute('data-tone')).toBe('save');
});

it('片段关闭可保存最新草稿后离开，取消确认不覆盖后续输入', async () => {
  const p = props(), close = vi.fn();
  render(<libraries.PromptLibraryEntryEditor {...p} entry={chains[0]} onClose={close} />);
  fireEvent.change(screen.getByRole('textbox', { name: '形象名称' }), { target: { value: '第一次修改' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  fireEvent.change(screen.getByRole('textbox', { name: '形象名称' }), { target: { value: '最后修改' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并离开' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(p.onUpdateChain).toHaveBeenCalledExactlyOnceWith(chains[0].id, expect.objectContaining({ name: '最后修改' }));
});

describe('图片提示词库', () => {
  beforeEach(() => localStorage.setItem('nai-prompt-library-categories-expanded', 'true'));
  it.each(['name', 'prompt'])('已有超过12个标签的片段只改%s，编辑保存仍保留全部标签', async field => {
    const tags = Array.from({ length: 15 }, (_, index) => `标签${index + 1}`);
    const entry = { ...chains[0], tags };
    const p = { ...props(), chains: [entry] };
    render(<libraries.PromptLibraryEntryEditor {...p} entry={entry} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: field === 'name' ? '形象名称' : '英文提示词' }),
      { target: { value: field === 'name' ? '改名后' : 'updated prompt' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.onUpdateChain).toHaveBeenCalledOnce());
    expect(p.onUpdateChain).toHaveBeenCalledWith(entry.id, expect.objectContaining({
      tags, ...(field === 'name' ? { name: '改名后' } : { basePrompt: 'updated prompt' }),
    }));
  });

  it.each(['editor', 'hub'])('%s外层关闭请求沿用脏草稿确认，卸载清理关闭句柄', async mode => {
    const requestCloseRef = { current: null as (() => void) | null }, onClose = vi.fn();
    const view = render(mode === 'editor'
      ? <libraries.PromptLibraryEntryEditor {...props()} entry={chains[0]} onClose={onClose} requestCloseRef={requestCloseRef} />
      : <libraries.PromptLibraryHub {...props()} embedded onClose={onClose} requestCloseRef={requestCloseRef} />);
    if (mode === 'hub') {
      fireEvent.click(screen.getByRole('tab', { name: '外貌 1' }));
      fireEvent.click(await screen.findByRole('button', { name: '形象：形象甲' }));
    }
    fireEvent.change(screen.getByRole('textbox', { name: '形象名称' }), { target: { value: '未保存' } });
    act(() => requestCloseRef.current?.());
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '形象名称' }) as HTMLInputElement).value).toBe('未保存');
    act(() => requestCloseRef.current?.());
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    view.unmount();
    expect(requestCloseRef.current).toBeNull();
  });

  it('嵌入的低频管理仍可打开并关闭AI生成搭配', async () => {
    render(<libraries.PromptLibraryHub {...props()} embedded />);
    fireEvent.click(screen.getByRole('tab', { name: '外貌 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI 生成搭配' }));
    expect(screen.getByRole('dialog', { name: 'AI 生成搭配' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: 'AI 生成搭配' })).toBeNull();
  });

  it.each(['appearance', 'general'] as const)('统一浏览直接复用%s片段详情，保存原参数并关闭', async kind => {
    const entry = { ...chains[0], type: kind === 'general' ? 'preset' : kind, params: {
      seed: 42, _collectedCategory: kind === 'general' ? 'general' : undefined,
      _promptLibrary: { bilingual: '银发', references: [] },
    }, negativePrompt: 'blur', tags: ['旧自由标签'] } as unknown as PromptChain;
    const p = { ...props(), chains: [entry] }, onClose = vi.fn();
    render(<libraries.PromptLibraryEntryEditor {...p} entry={entry} onClose={onClose} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
    const name = screen.getByRole('textbox', { name: kind === 'general' ? '片段名称' : '形象名称' });
    expect((name as HTMLInputElement).value).toBe(entry.name);
    fireEvent.change(name, { target: { value: '修改后的名称' } });
    openPurposeGroup('主体与外观'); fireEvent.click(screen.getByRole('button', { name: '外貌与身体' }));
    openPurposeGroup('动作与关系'); fireEvent.click(screen.getByRole('button', { name: '表情与情绪' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(p.onUpdateChain).toHaveBeenCalledWith(entry.id, expect.objectContaining({
      name: '修改后的名称', basePrompt: 'silver_hair', negativePrompt: 'blur', tags: ['旧自由标签'],
      params: expect.objectContaining({ seed: 42, _promptLibraryPurposes: ['appearance', 'expression'], _promptLibrary: { bilingual: '银发', references: [] } }),
    }));
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it('独立详情保存失败保留草稿，返回取消也保留编辑', async () => {
    const p = props(), onClose = vi.fn();
    p.onUpdateChain.mockRejectedValue(new Error('synthetic failure'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<libraries.PromptLibraryEntryEditor {...p} entry={chains[0]} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox', { name: '形象名称' }), { target: { value: '未保存内容' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('保存失败，请稍后重试', 'error'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect((screen.getByRole('textbox', { name: '形象名称' }) as HTMLInputElement).value).toBe('未保存内容');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('在顶栏下沿显示当前分类的条目数', async () => {
    const Component = Hub(); render(<Component {...props()} />);
    const caption = await screen.findByText('共 2 条');
    expect(caption.getAttribute('data-toolbar-count-caption')).toBe('true');
  });

  it('顶栏按筛选、搜索排列，新建与 AI 生成留在分类内容区', async () => {
    const Component = Hub(); render(<Component {...props()} />);
    fireEvent.click(screen.getByRole('tab', { name: '外貌 1' }));
    const create = await screen.findByRole('button', { name: '新建形象' });
    const generate = screen.getByRole('button', { name: '✦ AI 生成人物形象' });
    const bundle = screen.getByRole('button', { name: 'AI 生成搭配' });
    expect(bundle.closest('header')).toBeNull();
    expect(bundle.closest('.workspace-scroll-viewport')).toBeTruthy();
    fireEvent.click(bundle);
    expect(screen.getByRole('dialog', { name: 'AI 生成搭配' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(create.closest('header')).toBeNull(); expect(generate.closest('header')).toBeNull();
    expect(create.closest('.workspace-scroll-viewport')).toBeTruthy();
    const toolbar = screen.getByRole('banner');
    const controls = toolbar.querySelectorAll('button,input');
    expect(controls[0].getAttribute('aria-label')).toBe('收起分类');
    expect(controls[1].getAttribute('aria-label')).toBe('筛选');
    expect(controls[2].getAttribute('type')).toBe('search');
  });
  it('分类独立记住搜索、排序与位置，新搜索重置位置，统一使用图库卡片', async () => {
    const Component = Hub(); render(<Component {...props()} />);
    const search = screen.getByRole('searchbox', { name: '搜索名称、标签或提示词' });
    fireEvent.change(search, { target: { value: 'silver' } });
    const viewport = screen.getByRole('button', { name: '提示词：形象甲' }).closest('.workspace-scroll-viewport') as HTMLElement;
    expect(viewport.querySelector('.chain-masonry')).toBeTruthy();
    viewport.scrollTop = 250; fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'name' } });
    expect(viewport.scrollTop).toBe(0);
    expect(screen.queryByRole('button', { name: '封面视图' })).toBeNull();
    expect(viewport.querySelector('.chain-masonry')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    viewport.scrollTop = 180; fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('tab', { name: '场景 1' }));
    await screen.findByRole('button', { name: '场景：雨夜' });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('tab', { name: '全部 2' }));
    await screen.findByRole('button', { name: '提示词：形象甲' });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('silver');
    const restored = screen.getByRole('button', { name: '提示词：形象甲' }).closest('.workspace-scroll-viewport') as HTMLElement;
    expect(restored.scrollTop).toBe(180);
    expect(restored.querySelector('.chain-masonry')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rainy' } });
    expect(restored.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: '提示词：雨夜' })).toBeTruthy();
  });
  it('候选一次创建完整条目，部分失败保留候选，重试不重复已成功条目', async () => {
    vi.spyOn(promptAgentService, 'generateLibraryPrompt').mockResolvedValue({ items: [
      { name: '成功方案', prompt: 'silver_hair', bilingual: '银发', tags: [] },
      { name: '失败方案', prompt: 'blue_eyes', bilingual: '蓝眼', tags: [] },
    ], provider: 'synthetic', model: 'synthetic', count: 2, kind: 'appearance' });
    const p = props(), Component = Hub();
    p.onCreate.mockResolvedValueOnce('created').mockRejectedValueOnce(new Error('synthetic save failure')).mockResolvedValueOnce('retried');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Component {...p} />);
    fireEvent.click(screen.getByRole('tab', { name: '外貌 1' }));
    fireEvent.click(await screen.findByRole('button', { name: '✦ AI 生成人物形象' }));
    fireEvent.change(screen.getByRole('textbox', { name: '想要什么人物形象' }), { target: { value: 'synthetic' } });
    fireEvent.change(screen.getByRole('combobox', { name: '生成数量' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存选中（2）' }));
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('已保存 1 条形象，1 条失败'));
    expect(p.onCreate.mock.calls[0]).toEqual(['成功方案', '', 'preset', expect.objectContaining({
      basePrompt: 'silver_hair', variableValues: { subject: '' }, params: expect.objectContaining({ _promptLibrary: { bilingual: '银发', references: [] } }),
    })]);
    expect(p.onUpdateChain).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '方案 1 名称' }) as HTMLInputElement).value).toBe('失败方案');
    fireEvent.click(screen.getByRole('button', { name: '保存选中（1）' }));
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(3));
    expect(p.onCreate.mock.calls[2][0]).toBe('失败方案');
    await waitFor(() => expect(screen.queryByRole('button', { name: '关闭生成面板' })).toBeNull());
  });

  it('全部视图只汇总四库，分类计数准确，选择分类刷新后保留', async () => {
    const Component = Hub();
    render(<Component {...props()} />);
    expect(screen.getByRole('tab',{name:'全部 2'})).toBeTruthy();
    expect(screen.queryByText('普通风格串')).toBeNull();
    expect(screen.queryByRole('button',{name:'新建场景'})).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'场景 1'}));
    await waitFor(() => expect(screen.getByRole('button',{name:'新建场景'})).toBeTruthy());
    expect(localStorage.getItem('nai-prompt-library-kind')).toBe('scene');
    cleanup(); render(<Component {...props()} />);
    expect(screen.getByRole('tab',{name:'场景 1'}).getAttribute('aria-selected')).toBe('true');
  });

  it('卡片改名回车后只更新名称且不进入详情，Esc 后失焦不会保存', async () => {
    const Component = Hub(), p = props(); render(<Component {...p} />);
    fireEvent.click(screen.getByRole('button',{name:'重命名形象甲'}));
    let input=screen.getByRole('textbox',{name:'条目名称'});
    fireEvent.change(input,{target:{value:'新名称'}}); fireEvent.keyDown(input,{key:'Enter'});
    await waitFor(() => expect(p.onUpdateChain).toHaveBeenCalledWith('a',{name:'新名称'}));
    fireEvent.click(screen.getByRole('button',{name:'重命名形象甲'}));
    input=screen.getByRole('textbox',{name:'条目名称'});
    fireEvent.change(input,{target:{value:'取消名称'}}); fireEvent.keyDown(input,{key:'Escape'}); fireEvent.blur(input);
    expect(p.onUpdateChain).toHaveBeenCalledTimes(1);
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it('多选条件显示摘要而不改写需求，默认一条并传递组合条件', async () => {
    vi.spyOn(promptAgentService,'getLibraryPrompts').mockResolvedValue({spec:'',extra:''});
    const generate=vi.spyOn(promptAgentService,'generateLibraryPrompt').mockResolvedValue({items:[{name:'奇幻',prompt:'silver_hair, red_eyes, elf_ears',bilingual:'',tags:[]}],provider:'test',model:'test',kind:'appearance',count:1});
    const Component=Hub(); render(<Component {...props()} />);
    fireEvent.click(screen.getByRole('tab',{name:'外貌 1'}));
    fireEvent.click(await screen.findByRole('button',{name:'✦ AI 生成人物形象'}));
    const brief=screen.getByRole('textbox',{name:'想要什么人物形象'});
    fireEvent.change(brief,{target:{value:'奇幻人物'}});
    fireEvent.click(screen.getByRole('button',{name:'精灵耳'}));
    fireEvent.click(screen.getByRole('button',{name:'兽耳'}));
    expect(screen.getByText('限定：特征 精灵耳、兽耳')).toBeTruthy();
    expect((brief as HTMLTextAreaElement).value).toBe('奇幻人物');
    expect((screen.getByRole('combobox',{name:'生成数量'}) as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button',{name:'开始生成'}));
    await waitFor(() => expect(generate).toHaveBeenCalledWith(expect.objectContaining({brief:'奇幻人物',count:1,traits:'精灵耳, 兽耳'})));
  });

  it('分类切换不保留会覆盖新版数据的旧详情快照', async () => {
    const Component=Hub();
    const Harness=()=>{
      const [items,setItems]=React.useState(chains);
      return <Component {...props()} chains={items} onUpdateChain={async(id,patch)=>setItems(previous=>previous.map(item=>item.id===id?{...item,...patch}:item))} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button',{name:'提示词：雨夜'}));
    fireEvent.click(screen.getByRole('tab',{name:'场景 1'}));
    fireEvent.click(await screen.findByRole('button',{name:'场景：雨夜'}));
    fireEvent.change(screen.getByRole('textbox',{name:'场景名称'}),{target:{value:'新的雨夜'}});
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    await screen.findByRole('button',{name:'重命名新的雨夜'});
    fireEvent.click(screen.getByRole('tab',{name:'全部 2'}));
    await screen.findByRole('button',{name:'提示词：新的雨夜'});
    expect(screen.queryByRole('button',{name:'保存'})).toBeNull();
  });

  it('详情有改动时切换分类先确认，取消保留文本和当前分类', async () => {
    const Component=Hub(); render(<Component {...props()} />);
    fireEvent.click(screen.getByRole('button',{name:'提示词：雨夜'}));
    fireEvent.change(screen.getByRole('textbox',{name:'英文提示词'}),{target:{value:'未保存的场景'}});
    fireEvent.click(screen.getByRole('tab',{name:'场景 1'}));
    fireEvent.click(await screen.findByRole('button',{name:'取消'}));
    expect((screen.getByRole('textbox',{name:'英文提示词'}) as HTMLTextAreaElement).value).toBe('未保存的场景');
    expect(screen.getByRole('tab',{name:'全部 2'}).getAttribute('aria-selected')).toBe('true');
  });

  it('改名保存期间禁用第二条目的改名入口，避免较早请求关闭新编辑', async () => {
    let finish!: () => void;
    const p=props(), Component=Hub();
    p.onUpdateChain=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    render(<Component {...p} />);
    fireEvent.click(screen.getByRole('button',{name:'重命名形象甲'}));
    const input=screen.getByRole('textbox',{name:'条目名称'});
    fireEvent.change(input,{target:{value:'新名称'}}); fireEvent.blur(input);
    const other=screen.getByRole('button',{name:'重命名雨夜'}) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    fireEvent.click(other);
    expect(screen.getAllByRole('textbox',{name:'条目名称'})).toHaveLength(1);
    await act(async()=>finish());
    expect((screen.getByRole('button',{name:'重命名雨夜'}) as HTMLButtonElement).disabled).toBe(false);
  });
});


describe('管理提示词分类按需展开', () => {
  it('用途导航沿用风格串侧栏材质和选中色，仍保留固定用途图标与计数', async () => {
    render(<libraries.PromptLibraryHub {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '展开分类' }));
    const navigation = screen.getByRole('tablist', { name: '提示词分类' });
    expect(navigation.classList.contains('appearance-panel')).toBe(true);
    expect(navigation.classList.contains('md:w-52')).toBe(true);
    const appearance = screen.getByRole('tab', { name: '外貌 1' });
    expect(appearance.querySelector('svg')).toBeTruthy();
    fireEvent.click(appearance);
    await waitFor(() => expect(appearance.getAttribute('aria-selected')).toBe('true'));
    expect(appearance.classList.contains('bg-indigo-100')).toBe(true);
    expect(appearance.classList.contains('dark:bg-indigo-950/50')).toBe(true);
    expect(appearance.classList.contains('!bg-indigo-600')).toBe(false);
    expect(appearance.textContent).toContain('1');
    expect(screen.queryByRole('button', { name: '新建文件夹' })).toBeNull();
  });

  it.each([false, true])('embedded=%s默认收起，记住本端偏好且保持原手机横排/桌面纵排', embedded => {
    const view = render(<libraries.PromptLibraryHub {...props()} embedded={embedded} />);
    const toggle = screen.getByRole('button', { name: '展开分类' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const navigation = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(navigation.hidden).toBe(true); expect(navigation.className).toBe('hidden');
    expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
    expect(toggle.textContent).toBe(''); expect(toggle.title).toContain('全部');
    fireEvent.click(toggle);
    expect(navigation.hidden).toBe(false);
    expect(navigation.className).toContain('overflow-x-auto');
    expect(navigation.className).toContain('md:flex-col');
    expect(localStorage.getItem('nai-prompt-library-categories-expanded')).toBe('true');
    view.unmount();
    render(<libraries.PromptLibraryHub {...props()} embedded={embedded} />);
    expect(screen.getByRole('button', { name: '收起分类' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '收起分类' }));
    cleanup(); render(<libraries.PromptLibraryHub {...props()} embedded={embedded} />);
    expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  });
  it('切分类后收起保留搜索、标签、未存编辑，按钮继续标明当前用途', async () => {
    render(<libraries.PromptLibraryHub {...props()} chains={[{ ...chains[0], params: { ...chains[0].params, _promptLibraryPurposes: ['appearance'] }, tags: ['保留标签'] }, chains[1]]} />);
    fireEvent.click(screen.getByRole('button', { name: '展开分类' }));
    fireEvent.click(screen.getByRole('tab', { name: '外貌 1' }));
    await screen.findByRole('button', { name: '新建形象' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'silver' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    openPurposeGroup('主体与外观');
    fireEvent.click(screen.getByRole('button', { name: '外貌与身体（1）' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '收起分类' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('silver');
    expect(screen.getByRole('button', { name: '展开分类' }).title).toContain('外貌');
    expect(screen.getByRole('button', { name: '展开分类' }).getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /形象：形象甲/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '形象名称' }), { target: { value: '未保存草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '展开分类' }));
    fireEvent.click(screen.getByRole('button', { name: '收起分类' }));
    expect((screen.getByRole('textbox', { name: '形象名称' }) as HTMLInputElement).value).toBe('未保存草稿');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('嵌入portal工具栏与独立Hub各有唯一控制id，分类展开不重挂载搜索', () => {
    const slot = document.createElement('div'); document.body.appendChild(slot);
    const view = render(<><libraries.PromptLibraryHub {...props()} embedded toolbarSlot={slot} /><libraries.PromptLibraryHub {...props()} /></>);
    const toggles = screen.getAllByRole('button', { name: '展开分类' });
    expect(slot.contains(toggles[0])).toBe(true);
    expect(toggles[0].getAttribute('aria-controls')).not.toBe(toggles[1].getAttribute('aria-controls'));
    const searches = screen.getAllByRole('searchbox');
    fireEvent.change(searches[0], { target: { value: '保留查询' } });
    fireEvent.click(toggles[0]);
    expect(screen.getAllByRole('searchbox')[0]).toBe(searches[0]);
    expect((searches[0] as HTMLInputElement).value).toBe('保留查询');
    expect(screen.getAllByRole('button', { name: '展开分类' })).toHaveLength(1);
    view.unmount(); slot.remove();
  });
});

it('编辑自定义目录片段可调整目录归属，保留原提示词和生成参数', async () => {
  const directories = { revision: 1, nodes: [{ id: 'a', parentId: null, name: '道具', target: 'global' as const }, { id: 'b', parentId: 'a', name: '武器' }] };
  const entry = { ...chains[0], type: 'preset', params: { seed: 42, _collectedCategory: 'general', _promptLibraryDirectoryIds: ['a'] } } as unknown as PromptChain;
  const p = { ...props(), chains: [entry] };
  render(<PromptLibraryContext.Provider value={{ chains: [entry], directories, save: vi.fn() }}><libraries.PromptLibraryEntryEditor {...p} entry={entry} onClose={vi.fn()} /></PromptLibraryContext.Provider>);
  fireEvent.click(screen.getByRole('checkbox', { name: '道具' }));
  fireEvent.click(screen.getByText('选择目录'));
  fireEvent.click(screen.getByRole('button', { name: '展开目录「道具」' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '道具 / 武器' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(p.onUpdateChain).toHaveBeenCalledOnce());
  expect(p.onUpdateChain.mock.calls[0][1]).toMatchObject({ basePrompt: 'silver_hair', params: { seed: 42, _promptLibraryDirectoryIds: ['b'] } });
});

it('有当前目录时管理页按真实目录筛选、新建和生成，不显示固定用途导航', async () => {
  const directories = { revision: 1, nodes: [{ id: 'props', parentId: null, name: '道具', target: 'global' as const }, { id: 'weather', parentId: null, name: '天气', target: 'global' as const }] };
  const custom = [{ ...chains[0], id: 'sword', type: 'preset', name: '剑', params: { _promptLibraryDirectoryIds: ['props'] } }, { ...chains[0], id: 'rain', type: 'preset', name: '雨', params: { _promptLibraryDirectoryIds: ['weather'] } }, { ...chains[0], id: 'other', type: 'preset', name: '未归类片段', params: { _collectedCategory: 'general', _promptLibraryDirectoryIds: [] } }] as unknown as PromptChain[];
  const p = { ...props(), chains: custom }; p.onCreate.mockResolvedValue('new');
  const generate = vi.spyOn(promptAgentService, 'generateLibraryPrompt').mockResolvedValue({ items: [{ name: '银剑', prompt: 'silver sword', bilingual: '', tags: [] }], provider: 'test', model: 'test', count: 1 });
  render(<PromptLibraryContext.Provider value={{ chains: custom, directories, save: vi.fn() }}><libraries.PromptLibraryHub {...p} embedded /></PromptLibraryContext.Provider>);
  expect(screen.queryByRole('tablist', { name: '提示词分类' })).toBeNull();
  expect(screen.getByRole('button', { name: '片段：剑' })).toBeTruthy(); expect(screen.getByRole('button', { name: '片段：雨' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(screen.queryByRole('button', { name: '管理目录' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '道具' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '片段：雨' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'AI 生成片段' }));
  const generator = screen.getByRole('dialog', { name: 'AI 生成片段' }); expect(generator.parentElement!.style.zIndex).toBe('1950');
  fireEvent.change(screen.getByRole('textbox', { name: '描述你想要的内容' }), { target: { value: '银剑' } });
  fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
  await waitFor(() => expect(generate).toHaveBeenCalledWith(expect.objectContaining({ directoryId: 'props', directories, brief: '银剑' })));
  expect(generate.mock.calls[0][0]).not.toHaveProperty('kind');
  fireEvent.click(screen.getByRole('button', { name: '关闭生成面板' }));
  fireEvent.click(screen.getByRole('button', { name: '新建片段' }));
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith('新片段', '', 'preset', expect.objectContaining({ params: expect.objectContaining({ _promptLibraryDirectoryIds: ['props'] }) })));
});

it('管理树导航与列表并排，收展保留同一编辑草稿与滚动节点', async () => {
  const directories = { revision: 1, nodes: [{ id: 'props', parentId: null, name: '道具', target: 'global' as const }] };
  const entry = { ...chains[0], type: 'preset', params: { _promptLibraryDirectoryIds: ['props'] } } as unknown as PromptChain;
  render(<PromptLibraryContext.Provider value={{ chains: [entry], directories, save: vi.fn() }}><libraries.PromptLibraryHub {...props()} chains={[entry]} embedded /></PromptLibraryContext.Provider>);
  const search = screen.getByRole('searchbox'); fireEvent.change(search, { target: { value: 'silver' } });
  const scroll = document.querySelector('.workspace-scroll-viewport') as HTMLDivElement;
  scroll.scrollTop = 140; fireEvent.scroll(scroll);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  const nav = screen.getByRole('complementary', { name: '提示词目录导航' });
  expect(nav.parentElement?.nextElementSibling).toBe(scroll); expect(nav.parentElement?.classList.contains('md:w-52')).toBe(true); expect(scroll.classList.contains('min-w-0')).toBe(true); expect(nav.classList.contains('workspace-fixed-pane')).toBe(false);
  expect(scroll.scrollTop).toBe(140); expect(screen.getByRole('searchbox')).toBe(search);
  fireEvent.click(screen.getByRole('button', { name: '片段：形象甲' }));
  const name = screen.getByRole('textbox', { name: '片段名称' }); fireEvent.change(name, { target: { value: '未保存草稿' } });
  scroll.scrollTop = 75;
  fireEvent.click(screen.getByRole('button', { name: '收起目录' }));
  expect(screen.getByRole('textbox', { name: '片段名称' })).toBe(name); expect((name as HTMLInputElement).value).toBe('未保存草稿');
  expect(document.querySelector('.workspace-scroll-viewport')).toBe(scroll); expect(scroll.scrollTop).toBe(75);
  fireEvent.click(screen.getByRole('button', { name: '展开目录' }));
  expect(screen.getByRole('textbox', { name: '片段名称' })).toBe(name);
});


it('片段详情直接编辑，封面位于名称和正文前；保存留在原位并保留元数据', async () => {
  const entry = { ...chains[0], description: '纸张效果', previewImage: '/synthetic/cover.png', negativePrompt: 'lowres', params: { seed: 42, _promptLibraryPurposes: ['style'], _promptLibrary: { bilingual: '银发', references: [] } }, tags: ['旧标签'] } as unknown as PromptChain;
  const save = vi.fn();
  function Harness() {
    const [items, setItems] = React.useState([entry]);
    return <libraries.PromptLibraryEntryEditor panel entry={items[0]} chains={items} onClose={vi.fn()} onCreate={vi.fn()} onDelete={vi.fn()} notify={vi.fn()}
      onUpdateChain={async (id, updates) => { save(id, updates); setItems(previous => previous.map(item => item.id === id ? { ...item, ...updates } : item)); }} />;
  }
  render(<Harness />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
  const prompt = screen.getByRole('textbox', { name: '英文提示词' });
  const cover = screen.getByRole('button', { name: '查看封面原图' });
  expect(cover.compareDocumentPosition(screen.getByRole('textbox', { name: '形象名称' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cover.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(prompt.closest('fieldset')?.className).not.toContain('lg:grid-cols');
  fireEvent.change(prompt, { target: { value: 'watercolor, paper texture' } });
  fireEvent.change(screen.getByRole('textbox', { name: '备注' }), { target: { value: '更新备注' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][1]).toMatchObject({ basePrompt: 'watercolor, paper texture', description: '更新备注', negativePrompt: 'lowres', tags: ['旧标签'], params: { seed: 42, _promptLibraryPurposes: ['style'] } });
  expect(screen.getByRole('complementary', { name: entry.name })).toBeTruthy();
  await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.change(prompt, { target: { value: 'latest prompt' } });
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '保存并使用' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][1].basePrompt).toBe('latest prompt');
  expect(screen.getByRole('complementary', { name: entry.name })).toBeTruthy();
});

it('就地编辑切换条目先处理未保存内容；取消与保存失败保留草稿', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('synthetic failure')).mockResolvedValue(undefined);
  const use = vi.fn();
  function Harness() {
    const [items, setItems] = React.useState(chains);
    return <PromptLibraryBrowser chains={items} toolbarSlot={null} onUse={use} onOpen={vi.fn()} notify={vi.fn()}
      renderEntryEditor={(entry, controls) => <libraries.PromptLibraryEntryEditor panel entry={entry} chains={items} onClose={controls.onClose} panelActionsRef={controls.actionsRef} onCreate={vi.fn()} onDelete={vi.fn()} notify={vi.fn()}
        onUpdateChain={async (id, updates) => { await save(id, updates); setItems(previous => previous.map(item => item.id === id ? { ...item, ...updates } : item)); }} />} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '查看形象甲' }));
  fireEvent.change(screen.getByRole('textbox', { name: '英文提示词' }), { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: '查看雨夜' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  expect((screen.getByRole('textbox', { name: '英文提示词' }) as HTMLTextAreaElement).value).toBe('unsaved');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(use).not.toHaveBeenCalled();
  await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole('textbox', { name: '英文提示词' }) as HTMLTextAreaElement).value).toBe('unsaved');
  fireEvent.click(screen.getByRole('button', { name: '查看雨夜' }));
  fireEvent.click(await screen.findByRole('button', { name: '保存并离开' }));
  await screen.findByRole('complementary', { name: '雨夜' });
  expect(save).toHaveBeenCalledTimes(2);
  expect((screen.getByRole('textbox', { name: '英文提示词' }) as HTMLTextAreaElement).value).toBe('rainy_street');
});
