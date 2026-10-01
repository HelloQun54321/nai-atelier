// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, ChainEditorPromptInputsProps } from './ChainEditorPromptInputs';

vi.mock('../LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
vi.mock('../TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, disabled }: { value: string; onValueChange: (value: string) => void; disabled: boolean }) => <textarea aria-label="全局提示词" value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)} /> }));
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

  it('资料编辑器工具回调不改写提示词，只读时不能追加识别结果', () => {
    const onRecognizeImage = vi.fn(); const onTagAssistEnabledChange = vi.fn();
    const props = setup({ onRecognizeImage, onTagAssistEnabledChange });
    fireEvent.click(screen.getByRole('button', { name: '从图片识别 Tag' }));
    expect(onRecognizeImage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '开启 Tag 辅助' }));
    expect(onTagAssistEnabledChange).toHaveBeenCalledWith(true);
    expect(props.setPrompt).not.toHaveBeenCalled();
    cleanup();
    setup({ canEdit: false, onRecognizeImage, onTagAssistEnabledChange });
    expect(screen.queryByRole('button', { name: '从图片识别 Tag' })).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
