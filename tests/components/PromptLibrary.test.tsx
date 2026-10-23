// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as libraries from '../../components/PromptLibrary';
import { promptAgentService } from '../../services/promptAgent';
import type { PromptChain } from '../../types';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';

const render = (ui: React.ReactNode) => renderView(<ConfirmDialogProvider>{ui}</ConfirmDialogProvider>);

vi.mock('../../components/HistoryImagePicker', () => ({HistoryImagePicker: () => null}));
afterEach(() => {cleanup(); localStorage.clear(); vi.restoreAllMocks();});
const chains = [
  {id:'a',type:'appearance',name:'形象甲',basePrompt:'silver_hair',params:{},tags:[]},
  {id:'s',type:'scene',name:'雨夜',basePrompt:'rainy_street',params:{},tags:[]},
  {id:'style',type:'style',name:'普通风格串',params:{},tags:[]},
] as unknown as PromptChain[];
const props = () => ({chains,onCreate:vi.fn(),onSelect:vi.fn(),onUpdateChain:vi.fn(),onDelete:vi.fn(),notify:vi.fn()});
const Hub = () => libraries.PromptLibraryHub;

describe('图片提示词库', () => {
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
    expect(controls[0].getAttribute('aria-label')).toBe('筛选');
    expect(controls[1].getAttribute('type')).toBe('search');
  });
  it('分类独立记住搜索、排序与位置，新搜索重置位置，默认内容视图可切换封面', async () => {
    const Component = Hub(); render(<Component {...props()} />);
    const search = screen.getByRole('searchbox', { name: '搜索名称、标签或提示词' });
    fireEvent.change(search, { target: { value: 'silver' } });
    const viewport = screen.getByRole('button', { name: '提示词：形象甲' }).closest('.workspace-scroll-viewport') as HTMLElement;
    expect(viewport.querySelector('.content-library-grid')).toBeTruthy();
    viewport.scrollTop = 250; fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'name' } });
    expect(viewport.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '封面视图' }));
    expect(viewport.querySelector('.workspace-character-grid')).toBeTruthy();
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
    expect(restored.querySelector('.workspace-character-grid')).toBeTruthy();
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
    expect(p.onCreate.mock.calls[0]).toEqual(['成功方案', '', 'appearance', expect.objectContaining({
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
