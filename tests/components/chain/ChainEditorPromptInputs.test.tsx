// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, ChainEditorPromptInputsProps } from '../../../components/chain/ChainEditorPromptInputs';

vi.mock('../../../components/LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('../../../components/TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, disabled }: { value: string; onValueChange: (value: string) => void; disabled: boolean }) => <textarea aria-label="全局提示词" value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)} /> }));
afterEach(cleanup);

const setup = (overrides: Partial<ChainEditorPromptInputsProps> = {}) => {
  const props: ChainEditorPromptInputsProps = {
    prompt: 'original prompt', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
    copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
    activeLabLayout: { order: ['prompt'], collapsed: {} }, mobileEditorTab: 'global', ...overrides,
  };
  render(<ChainEditorPromptInputs {...props} />);
  return props;
};

// 全局提示词已拆成五栏（画师串 / 人物 / 服饰 / 姿势 / 补充）；
// mock 给每个输入框同样的 aria-label，因此按顺序取第 1 栏（画师串）来断言旧行为。
describe('提示词上下文工具隔离', () => {
  it('清空补充栏同步保存分栏与合并文本，保留其余栏目', () => {
    const props=setup({sections:{appearance:'silver_hair',extra:'rain'},supplementPrompt:'silver_hair, rain',setSections:vi.fn(),setSupplementPrompt:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'清空补充'}));
    expect(props.setSections).toHaveBeenCalledWith({appearance:'silver_hair',extra:''});
    expect(props.setSupplementPrompt).toHaveBeenCalledWith('silver_hair');
    expect(screen.getByRole('button',{name:'从场景库导入提示词'})).toBeTruthy();
  });

  it('旧主体整段可以清空，空栏目与只读模式禁用清空按钮', () => {
    const props=setup({supplementPrompt:'旧主体',setSections:vi.fn(),setSupplementPrompt:vi.fn()});
    fireEvent.click(screen.getByRole('button',{name:'清空补充'}));
    expect(props.setSupplementPrompt).toHaveBeenCalledWith('');
    expect((screen.getByRole('button',{name:'清空人物'}) as HTMLButtonElement).disabled).toBe(true);
    cleanup(); setup({canEdit:false});
    expect((screen.getByRole('button',{name:'清空画师串'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('实验室未传入资料工具时维持复制按钮，输入及复制行为不变', () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    fireEvent.click(screen.getByTitle('复制画师串'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '画师串');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'updated prompt' } });
    expect(props.setPrompt).toHaveBeenCalledWith('updated prompt');
    expect(props.markPresetSectionModified).toHaveBeenCalledWith('base');
    expect(props.markChange).toHaveBeenCalledOnce();
  });

  it('提示词区不重复顶栏的识别和辅助入口，只读时仍可复制', () => {
    const props = setup({ canEdit: false });
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    expect((screen.getAllByRole('textbox')[0] as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle('复制画师串'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '画师串');
  });
});
