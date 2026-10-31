// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, type ChainEditorPromptInputsProps } from '../../../components/chain/ChainEditorPromptInputs';
import { getEditableGlobalNegative } from '../../../services/promptUtils';
import type { PromptSections } from '../../../types';

afterEach(cleanup);
const defaults = (): ChainEditorPromptInputsProps => ({
  prompt: 'original prompt', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
  copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
  activeLabLayout: { collapsed: {} }, mobileEditorTab: 'global',
});

it('只保留完整全局正面输入，原字和权重保留且没有分类或正文骰子', () => {
  const props = { ...defaults(), prompt: 'artist:test, {{style}},\n1.2::blue dress::, ' };
  render(<ChainEditorPromptInputs {...props} />);
  expect((screen.getByRole('textbox', { name: '全局正面提示词' }) as HTMLTextAreaElement).value).toBe(props.prompt);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.queryByText('已有画风分栏')).toBeNull();
  expect(screen.queryByText('原有分类')).toBeNull();
  expect(screen.queryByRole('button', { name: '随机搭配' })).toBeNull();
  expect(props.setPrompt).not.toHaveBeenCalled(); expect(props.markChange).not.toHaveBeenCalled();
});

it('未传旧主体时完整显示旧全局用途目录与呈现形式，不在读取时写回', () => {
  const props = { ...defaults(), prompt: 'artist:test', sections: { wardrobe: '{{blue dress}}', extra: 'manual\nwords',
    'purpose:lighting': 'backlight', 'directory:scene': '1.2::forest, mist::', presentation: 'comic panel' }, setSections: vi.fn() };
  render(<ChainEditorPromptInputs {...props} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('artist:test, {{blue dress}}, manual\nwords, backlight, 1.2::forest, mist::, comic panel');
  expect(props.setSections).not.toHaveBeenCalled(); expect(props.setPrompt).not.toHaveBeenCalled();
});

it.each(['blue dress', ''])('明确传入主体%s时不恢复可能已过时的旧分栏', supplementPrompt => {
  render(<ChainEditorPromptInputs {...defaults()} sections={{ wardrobe: 'red dress' }} supplementPrompt={supplementPrompt} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(supplementPrompt ? 'original prompt, blue dress' : 'original prompt');
});

it('原整段默认编辑合并一次后清旧分栏，末尾逗号和换行不丢', () => {
  const Harness = () => {
    const [prompt, setPrompt] = useState('artist:test'), [subject, setSubject] = useState('manual, forest');
    const [sections, setSections] = useState<PromptSections>({ extra: 'manual', 'directory:scene': 'forest' });
    return <><ChainEditorPromptInputs {...defaults()} prompt={prompt} setPrompt={setPrompt}
      supplementPrompt={subject} setSupplementPrompt={setSubject} sections={sections} setSections={setSections} />
      <output>{JSON.stringify({ subject, sections })}</output></>;
  };
  render(<Harness />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input.value).toBe('artist:test, manual, forest');
  fireEvent.change(input, { target: { value: 'new prompt, \n' } });
  expect(input.value).toBe('new prompt, \n');
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({ subject: '', sections: {} });
});

it('生产整段回调先保留全局与旧分类负面，再清旧结构，原正词仍完整', () => {
  const Harness = () => {
    const [prompt, setPrompt] = useState('artist:test'), [subject, setSubject] = useState('{{white dress}}, forest');
    const [negative, setNegative] = useState('global bad');
    const [sections, setSections] = useState<PromptSections>({ wardrobe: '{{white dress}}', 'directory:scene': 'forest',
      sectionNegatives: { wardrobe: 'coat', 'directory:scene': 'city' } });
    return <><ChainEditorPromptInputs {...defaults()} prompt={prompt} setPrompt={setPrompt} supplementPrompt={subject}
      sections={sections} setSections={setSections} setSupplementPrompt={setSubject}
      onPlainPromptChange={value => {
        setNegative(getEditableGlobalNegative(negative, sections)); setPrompt(value); setSubject(''); setSections({});
      }} /><output>{JSON.stringify({ negative, subject, sections })}</output></>;
  };
  render(<Harness />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(input.value).toBe('artist:test, {{white dress}}, forest');
  fireEvent.change(input, { target: { value: input.value + ', rain,\n' } });
  expect(input.value).toBe('artist:test, {{white dress}}, forest, rain,\n');
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({ negative: 'global bad, coat, city', subject: '', sections: {} });
  fireEvent.change(input, { target: { value: input.value + 'night' } });
  expect(JSON.parse(screen.getByRole('status').textContent!).negative).toBe('global bad, coat, city');
});

it('显式整段回调保持原样，组件不另行清分栏或修改独立主体', () => {
  const props = { ...defaults(), onPlainPromptChange: vi.fn(), setSections: vi.fn(), setSupplementPrompt: vi.fn() };
  render(<ChainEditorPromptInputs {...props} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'plain edit,\n' } });
  expect(props.onPlainPromptChange).toHaveBeenCalledWith('plain edit,\n');
  expect(props.setPrompt).not.toHaveBeenCalled(); expect(props.setSections).not.toHaveBeenCalled(); expect(props.setSupplementPrompt).not.toHaveBeenCalled();
  expect(props.markPresetSectionModified).toHaveBeenCalledWith('base');
  expect(props.markPresetSectionModified).toHaveBeenCalledWith('subject');
});

it.each([false, true])('全局提示词沿用模块默认收起=%s，编辑内容保持挂载', collapsed => {
  render(<ChainEditorPromptInputs {...defaults()} activeLabLayout={{ collapsed: { prompt: collapsed } }} />);
  expect(document.querySelector('details')?.open).toBe(!collapsed);
  expect(screen.getByDisplayValue('original prompt')).toBeTruthy();
});

it('切页仅隐藏不卸载完整输入，不调用保存或合并', () => {
  const props = defaults();
  const view = render(<ChainEditorPromptInputs {...props} />);
  const input = screen.getByRole('textbox');
  view.rerender(<ChainEditorPromptInputs {...props} mobileEditorTab="character" />);
  expect(screen.queryByRole('textbox')).toBeNull(); expect(document.body.contains(input)).toBe(true);
  view.rerender(<ChainEditorPromptInputs {...props} />);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(props.setPrompt).not.toHaveBeenCalled(); expect(props.markChange).not.toHaveBeenCalled();
});

it('完整主输入清空撤销与复制沿用既有操作，复制在只读时仍可用', () => {
  const props = defaults();
  const Harness = () => {
    const [prompt, setPrompt] = useState('global prompt');
    return <ChainEditorPromptInputs {...props} prompt={prompt} setPrompt={setPrompt} />;
  };
  const view = render(<Harness />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  const clear = screen.getByRole('button', { name: '清空当前提示词' });
  expect(clear.parentElement!.parentElement!.contains(screen.getByTitle('复制全局正面提示词'))).toBe(true);
  fireEvent.click(clear); expect(input.value).toBe(''); expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '撤销清空' })); expect(input.value).toBe('global prompt');
  view.rerender(<ChainEditorPromptInputs {...props} canEdit={false} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '清空当前提示词' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: /识别|辅助|库导入/ })).toBeNull();
  fireEvent.click(screen.getByTitle('复制全局正面提示词'));
  expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '全局正面提示词');
});

it('分区标题已是「全局正面提示词」时不再显示第二行同名标题，读屏名称与右侧操作保留', () => {
  const { container, rerender } = render(<ChainEditorPromptInputs {...defaults()} />);
  // 曾在手机上与分区标题重复，并被右侧工具挤成「全局正面提…」。
  const label = container.querySelector('label[for]')!;
  expect(label.className).toBe('sr-only');
  expect(screen.getByRole('textbox', { name: '全局正面提示词' })).toBeTruthy();
  expect(label.nextElementSibling!.className).toContain('ml-auto');
  rerender(<ChainEditorPromptInputs {...defaults()} embedded />);
  expect(container.querySelector('label[for]')!.className).not.toContain('sr-only');
});
