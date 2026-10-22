// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, ChainEditorPromptInputsProps } from '../../../components/chain/ChainEditorPromptInputs';

vi.mock('../../../components/LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
afterEach(cleanup);

const setup = (overrides: Partial<ChainEditorPromptInputsProps> = {}) => {
  const props: ChainEditorPromptInputsProps = {
    prompt: 'original prompt', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
    promptClassificationEnabled: true,
    copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
    activeLabLayout: { order: ['prompt'], collapsed: {} }, mobileEditorTab: 'global', ...overrides,
  };
  render(<ChainEditorPromptInputs {...props} />);
  return props;
};

describe('提示词上下文工具隔离', () => {
  it.each([[false, true, false], [true, true, true], [true, false, false]])('分类编辑=%s、可编辑=%s 时场景镜头 Roll 入口显示=%s', (promptClassificationEnabled, canEdit, visible) => {
    const onContentRollForGlobal = vi.fn();
    const props = setup({ promptClassificationEnabled, canEdit, onContentRollForGlobal });
    const button = screen.queryByRole('button', { name: '随机搭配' });
    expect(Boolean(button)).toBe(visible);
    if (button) { fireEvent.click(button); expect(onContentRollForGlobal).toHaveBeenCalledOnce(); }
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
        activeLabLayout={{ order: ['prompt'], collapsed: {} }} mobileEditorTab="global" /></>;
    };
    render(<Harness />);
    expect((screen.getByRole('textbox', { name: '全局正向提示词' }) as HTMLTextAreaElement).value).toBe('artist:test, blue dress');
    fireEvent.click(screen.getByText('切换'));
    expect((screen.getByRole('textbox', { name: '服饰' }) as HTMLTextAreaElement).value).toBe('blue dress');
    fireEvent.click(screen.getByText('切换'));
    fireEvent.change(screen.getByRole('textbox', { name: '全局正向提示词' }), { target: { value: 'red dress, \n' } });
    expect((screen.getByRole('textbox', { name: '全局正向提示词' }) as HTMLTextAreaElement).value).toBe('red dress, \n');
    fireEvent.click(screen.getByText('切换'));
    expect((screen.getByRole('textbox', { name: '服饰' }) as HTMLTextAreaElement).value).toBe('');
  });
  it('清空和撤销位于既有复制旁，仅更新当前全局文本并恢复焦点', () => {
    const mark = vi.fn(), preset = vi.fn();
    const Harness = () => {
      const [prompt, setPrompt] = useState('global prompt');
      return <ChainEditorPromptInputs promptClassificationEnabled prompt={prompt} setPrompt={setPrompt} presetSources={{}} tagAssistEnabled={false} canEdit
        copyPromptToClipboard={vi.fn()} markPresetSectionModified={preset} markChange={mark}
        activeLabLayout={{ order: ['prompt'], collapsed: {} }} mobileEditorTab="global" />;
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
        activeLabLayout: { order: ['prompt'], collapsed: {} }, mobileEditorTab: 'global' as const,
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
