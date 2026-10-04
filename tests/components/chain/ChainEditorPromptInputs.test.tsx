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

describe('提示词上下文工具隔离', () => {
  it('实验室未传入资料工具时维持复制按钮，输入及复制行为不变', () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    fireEvent.click(screen.getByTitle('复制全局提示词'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '全局提示词');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated prompt' } });
    expect(props.setPrompt).toHaveBeenCalledWith('updated prompt');
    expect(props.markPresetSectionModified).toHaveBeenCalledWith('base');
    expect(props.markChange).toHaveBeenCalledOnce();
  });

  it('提示词区不重复顶栏的识别和辅助入口，只读时仍可复制', () => {
    const props = setup({ canEdit: false });
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle('复制全局提示词'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '全局提示词');
  });
});
