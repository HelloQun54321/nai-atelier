// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, ChainEditorPromptInputsProps } from '../../../components/chain/ChainEditorPromptInputs';
import { PromptLibraryContext, PromptLibraryWorkspace } from '../../../components/PromptLibraryAccess';
import { LAB_DEFAULT_PARAMS } from '../../../services/labWorkspace';

afterEach(cleanup);

const setup = (overrides: Partial<ChainEditorPromptInputsProps> = {}) => {
  const props: ChainEditorPromptInputsProps = {
    prompt: 'original prompt', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
    promptClassificationEnabled: true,
    copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
    activeLabLayout: { collapsed: {} }, mobileEditorTab: 'global', ...overrides,
  };
  const slot = document.createElement('div');
  props.toolbarSlot = { element: slot, variant: 'icon' };
  render(<><div data-testid="prompt-tools" ref={element => { element?.appendChild(slot); }} /><ChainEditorPromptInputs {...props} /></>);
  return props;
};

describe('提示词上下文工具隔离', () => {
  it('顶栏槽位替换或临时移除不丢失随机搭配的真实候选编辑', async () => {
    const first = document.createElement('div'), second = document.createElement('div');
    document.body.append(first, second);
    const changed = vi.fn();
    const content = (element: HTMLDivElement | null) => <PromptLibraryContext.Provider value={{ chains: [], save: vi.fn() }}>
      <PromptLibraryWorkspace state={{ params: LAB_DEFAULT_PARAMS, base: 'artist', subject: '', negative: '', classified: true }} onChange={changed}>
        <ChainEditorPromptInputs promptClassificationEnabled prompt="artist" setPrompt={changed} presetSources={{}} tagAssistEnabled={false} canEdit
          toolbarSlot={element ? { element, variant: element === first ? 'icon' : 'menu' } : null}
          copyPromptToClipboard={vi.fn()} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
          activeLabLayout={{ collapsed: {} }} mobileEditorTab="global" />
      </PromptLibraryWorkspace>
    </PromptLibraryContext.Provider>;
    const view = render(content(first));
    try {
      fireEvent.click(screen.getByRole('button', { name: '随机搭配' }));
      const dialog = await screen.findByRole('dialog', { name: '搭配' });
      const candidate = within(dialog).getByRole('textbox', { name: '场景内容' }) as HTMLTextAreaElement;
      fireEvent.change(candidate, { target: { value: '保留这次候选 night forest' } });
      const participate = within(dialog).getByRole('checkbox', { name: '参与「场景」的抽取' }) as HTMLInputElement;
      fireEvent.click(participate);
      expect(participate.checked).toBe(false);
      view.rerender(content(second));
      expect(within(screen.getByRole('dialog', { name: '搭配' })).getByRole('textbox', { name: '场景内容' })).toBe(candidate);
      expect(candidate.value).toBe('保留这次候选 night forest');
      expect(participate.checked).toBe(false);
      expect(second.contains(screen.getByRole('button', { name: '随机搭配' }))).toBe(true);
      view.rerender(content(null));
      expect(screen.getByRole('dialog', { name: '搭配' })).toBe(dialog);
      expect(candidate.value).toBe('保留这次候选 night forest');
      expect(participate.checked).toBe(false);
      expect(screen.queryByRole('button', { name: '随机搭配' })).toBeNull();
      view.rerender(content(first));
      expect(within(screen.getByRole('dialog', { name: '搭配' })).getByRole('textbox', { name: '场景内容' })).toBe(candidate);
      expect(candidate.value).toBe('保留这次候选 night forest');
      expect(changed).not.toHaveBeenCalled();
    } finally { view.unmount(); first.remove(); second.remove(); }
  });
  it('有真实词库上下文时整段也不显示随机入口，分类按钮移入顶栏且不改提示词', () => {
    const slot = document.createElement('div'), changed = vi.fn();
    const props: ChainEditorPromptInputsProps = { prompt: '保留原文', setPrompt: changed, presetSources: {}, tagAssistEnabled: false, canEdit: true,
      toolbarSlot: { element: slot, variant: 'icon' }, copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(), activeLabLayout: { collapsed: {} }, mobileEditorTab: 'global' };
    const content = (classified: boolean, canEdit = true) => <PromptLibraryContext.Provider value={{ chains: [], save: vi.fn() }}>
      <PromptLibraryWorkspace state={{ params: LAB_DEFAULT_PARAMS, base: props.prompt, subject: '', negative: '', classified }} onChange={changed}>
        <div data-testid="topbar" ref={element => { element?.appendChild(slot); }} />
        <ChainEditorPromptInputs {...props} canEdit={canEdit} promptClassificationEnabled={classified} />
      </PromptLibraryWorkspace></PromptLibraryContext.Provider>;
    const view = render(content(false));
    expect(screen.queryByRole('button', { name: '随机搭配' })).toBeNull();
    expect(screen.getByPlaceholderText('全局正面提示词')).toBeTruthy();
    expect(screen.getByLabelText('全局正面提示词', { selector: 'textarea' })).toBe(screen.getByPlaceholderText('全局正面提示词'));
    view.rerender(content(true));
    expect(screen.getByTestId('topbar').contains(screen.getByRole('button', { name: '随机搭配' }))).toBe(true);
    expect(screen.getByRole('button', { name: '随机搭配' }).textContent).toBe('');
    expect(screen.getByRole('button', { name: '随机搭配' }).querySelector('.lucide-dice-5')).not.toBeNull();
    expect(document.querySelector('.lab-module-section')?.contains(screen.getByRole('button', { name: '随机搭配' }))).toBe(false);
    props.toolbarSlot = { element: slot, variant: 'menu' };
    view.rerender(content(true));
    const menuButton = screen.getByRole('button', { name: '随机搭配' });
    expect(menuButton.textContent).toBe('随机搭配');
    expect(menuButton.classList.contains('w-full')).toBe(true);
    expect(menuButton.classList.contains('text-left')).toBe(true);
    view.rerender(content(true, false));
    expect((screen.getByRole('button', { name: '随机搭配' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(content(false)); expect(screen.queryByRole('button', { name: '随机搭配' })).toBeNull();
    expect((screen.getByPlaceholderText('全局正面提示词') as HTMLTextAreaElement).value).toBe(props.prompt);
    expect(changed).not.toHaveBeenCalled();
  });
  it.each([false, true])('全局提示词沿用模块默认收起=%s，编辑内容保持挂载', collapsed => {
    setup({ activeLabLayout: { collapsed: { prompt: collapsed } } });
    expect(document.querySelector('details')?.open).toBe(!collapsed);
    expect(screen.getByDisplayValue('original prompt')).toBeTruthy();
  });
  it.each([[false, true, false], [true, true, true], [true, false, false]])('分类编辑=%s、可编辑=%s 时场景镜头 Roll 入口显示=%s', (promptClassificationEnabled, canEdit, visible) => {
    const onContentRollForGlobal = vi.fn();
    const props = setup({ promptClassificationEnabled, canEdit, onContentRollForGlobal });
    const button = screen.queryByRole('button', { name: '随机搭配' });
    expect(Boolean(button)).toBe(visible);
    if (button) { expect(screen.getByTestId('prompt-tools').contains(button)).toBe(true); fireEvent.click(button); expect(onContentRollForGlobal).toHaveBeenCalledOnce(); }
    else expect(onContentRollForGlobal).not.toHaveBeenCalled();
    expect(props.setPrompt).not.toHaveBeenCalled();
    expect(props.markChange).not.toHaveBeenCalled();
  });
  it('整段与分类切换只改变展示，编辑整段后清除旧分栏，不丢逗号与换行', () => {
    const Harness = () => {
      const [classified, setClassified] = useState(false);
      const [prompt, setPrompt] = useState('artist:test');
      const [subject, setSubject] = useState('blue dress');
      const [sections, setSections] = useState<import('../../../types').PromptSections>({ wardrobe: 'blue dress' });
      return <><button onClick={() => setClassified(value => !value)}>切换</button><ChainEditorPromptInputs
        prompt={prompt} setPrompt={setPrompt} supplementPrompt={subject} setSupplementPrompt={setSubject}
        sections={sections} setSections={setSections} promptClassificationEnabled={classified} presetSources={{}} tagAssistEnabled={false} canEdit
        copyPromptToClipboard={vi.fn()} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
        activeLabLayout={{ collapsed: {} }} mobileEditorTab="global" /></>;
    };
    render(<Harness />);
    expect((screen.getByRole('textbox', { name: '全局正面提示词' }) as HTMLTextAreaElement).value).toBe('artist:test, blue dress');
    fireEvent.click(screen.getByText('切换'));
    expect((screen.getByRole('textbox', { name: '服饰' }) as HTMLTextAreaElement).value).toBe('blue dress');
    fireEvent.click(screen.getByText('切换'));
    fireEvent.change(screen.getByRole('textbox', { name: '全局正面提示词' }), { target: { value: 'red dress, \n' } });
    expect((screen.getByRole('textbox', { name: '全局正面提示词' }) as HTMLTextAreaElement).value).toBe('red dress, \n');
    fireEvent.click(screen.getByText('切换'));
    expect((screen.getByRole('textbox', { name: '服饰' }) as HTMLTextAreaElement).value).toBe('');
  });
  it('清空和撤销位于既有复制旁，仅更新当前全局文本并恢复焦点', () => {
    const mark = vi.fn(), preset = vi.fn();
    const Harness = () => {
      const [prompt, setPrompt] = useState('global prompt');
      return <ChainEditorPromptInputs promptClassificationEnabled prompt={prompt} setPrompt={setPrompt} presetSources={{}} tagAssistEnabled={false} canEdit
        copyPromptToClipboard={vi.fn()} markPresetSectionModified={preset} markChange={mark}
        activeLabLayout={{ collapsed: {} }} mobileEditorTab="global" />;
    };
    render(<Harness />);
    const group = within(screen.getByRole('group', { name: '画师串' }));
    const textarea = group.getByRole('textbox') as HTMLTextAreaElement;
    const clear = group.getByRole('button', { name: '清空当前提示词' });
    expect(clear.parentElement!.parentElement!.contains(screen.getByTitle('复制画师串'))).toBe(true);
    expect(textarea.parentElement!.contains(clear)).toBe(false);
    fireEvent.click(clear); expect(textarea.value).toBe(''); expect(document.activeElement).toBe(textarea);
    expect(preset).toHaveBeenLastCalledWith('base'); expect(mark).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '撤销清空' })); expect(textarea.value).toBe('global prompt');
  });
  it('实验室未传入资料工具时维持复制按钮，输入及复制行为不变', () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    fireEvent.click(screen.getByTitle('复制画师串'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '画师串');
    fireEvent.change(screen.getByRole('textbox', { name: '画师串' }), { target: { value: 'updated prompt' } });
    expect(props.setPrompt).toHaveBeenCalledWith('updated prompt');
    expect(props.markPresetSectionModified).toHaveBeenCalledWith('base');
    expect(props.markChange).toHaveBeenCalledOnce();
  });

  it('提示词区不重复顶栏的识别和辅助入口，只读时仍可复制', () => {
    const props = setup({ canEdit: false });
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    expect(screen.getAllByRole('textbox').every(input => (input as HTMLTextAreaElement).disabled)).toBe(true);
    expect(screen.getAllByRole('button', { name: '清空当前提示词' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: '库导入' })).toBeNull();
    fireEvent.click(screen.getByTitle('复制画师串'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '画师串');
  });

  it('旧主体首次编辑保留在补充栏，各分栏清空与撤销只改变本栏', () => {
    const Harness = () => {
      const [subject, setSubject] = useState('legacy subject');
      const [sections, setSections] = useState<import('../../../types').PromptSections>();
      return <><ChainEditorPromptInputs {...{
        prompt: 'artist', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
        promptClassificationEnabled: true,
        copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
        activeLabLayout: { collapsed: {} }, mobileEditorTab: 'global' as const,
      }} sections={sections} setSections={setSections} supplementPrompt={subject} setSupplementPrompt={setSubject} />
      <output>{subject}</output></>;
    };
    render(<Harness />);
    expect((screen.getByRole('textbox', { name: '补充' }) as HTMLTextAreaElement).value).toBe('legacy subject');
    fireEvent.change(screen.getByRole('textbox', { name: '外貌' }), { target: { value: 'silver_hair' } });
    fireEvent.change(screen.getByRole('textbox', { name: '服饰' }), { target: { value: 'blue_dress' } });
    expect(screen.getByRole('status').textContent).toBe('silver_hair, blue_dress, legacy subject');
    const group = within(screen.getByRole('group', { name: '外貌' }));
    fireEvent.click(group.getByRole('button', { name: '清空当前提示词' }));
    expect(screen.getByRole('status').textContent).toBe('blue_dress, legacy subject');
    fireEvent.click(group.getByRole('button', { name: '撤销清空' }));
    expect(screen.getByRole('status').textContent).toBe('silver_hair, blue_dress, legacy subject');
  });

  it('助手只改合并文本后，不显示旧分栏；继续编辑也不覆盖助手的新内容', () => {
    const setSubject = vi.fn();
    setup({ sections: { wardrobe: 'red_dress' }, supplementPrompt: 'blue_dress', setSupplementPrompt: setSubject });
    expect((screen.getByRole('textbox', { name: '服饰' }) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: '补充' }) as HTMLTextAreaElement).value).toBe('blue_dress');
    fireEvent.change(screen.getByRole('textbox', { name: '动作' }), { target: { value: 'sitting' } });
    expect(setSubject).toHaveBeenCalledWith('sitting, blue_dress');
  });
});
