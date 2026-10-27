// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GenerationTemplateEditor from '../../components/GenerationTemplateEditor';
import { createDefaultRollTemplate, type RollPreset, type RollTemplate } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), remove: vi.fn(), params: vi.fn() }));
vi.mock('../../services/styleRollApi', () => ({ loadRollPresets: mocks.load, saveRollPreset: mocks.save, deleteRollPreset: mocks.remove }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => DEFAULT_NAI_RUNTIME }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: (props: any) => { mocks.params(props); return null; } }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockResolvedValue([]); mocks.save.mockImplementation(async (value: RollPreset) => ({ ...value, revision: value.revision + 1 }));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('公共、角色及负面提示词均支持鼠标拉伸和框外触屏把手，调高不改模板', async () => {
  const value = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME), change = vi.fn();
  render(<GenerationTemplateEditor value={value} onChange={change} />);
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  const fields = Array.from(document.querySelectorAll('textarea'));
  expect(fields).toHaveLength(3);
  for (const field of fields) expect(field.classList.contains('resize-y')).toBe(true);
  const handles = screen.getAllByRole('button', { name: '调整输入框高度' });
  expect(handles).toHaveLength(3);
  fields[2].style.height = '80px';
  fireEvent.keyDown(handles[2], { key: 'ArrowDown' });
  expect(fields[2].style.height).toBe('112px');
  expect(change).not.toHaveBeenCalled();
});

it('指定推荐模板完整复制角色和参数，modelFilter只透传不改写所选预设模型', async () => {
  const original = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME);
  const recommended = { ...structuredClone(original), characterPrompt: 'custom recommended role' };
  const preset: RollPreset = { id: 'shared', name: '共享配置', revision: 3, createdAt: 1, updatedAt: 1,
    template: { ...structuredClone(original), characterPrompt: 'saved role', params: { ...original.params, model: 'nai-diffusion-5-full', characters: [{ id: 'role', prompt: 'person', x: .2, y: .8 }] } } };
  mocks.load.mockResolvedValue([preset]);
  const changed = vi.fn(), filter = (id: string) => id.includes('4-5');
  function Fixture() {
    const [value, setValue] = useState<RollTemplate>(original);
    return <GenerationTemplateEditor value={value} onChange={next => { setValue(next); changed(next); }} recommendedTemplate={recommended} modelFilter={filter} />;
  }
  render(<Fixture />); await screen.findByRole('option', { name: preset.name });
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: 'recommended' } });
  expect(changed).toHaveBeenLastCalledWith(recommended);
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: preset.id } });
  expect(changed).toHaveBeenLastCalledWith(preset.template);
  expect(changed.mock.calls.at(-1)![0]).not.toBe(preset.template);
  expect(mocks.params.mock.calls.at(-1)![0]).toMatchObject({ modelFilter: filter, params: preset.template.params });
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', 'saved role');
});

it('只读仍可另存完整预设，在途通知父级忙态，外层disabled禁止全部编辑与另存', async () => {
  const value = createDefaultRollTemplate(DEFAULT_NAI_RUNTIME), change = vi.fn(), busy = vi.fn();
  const { rerender } = render(<GenerationTemplateEditor value={value} onChange={change} readOnly onBusyChange={busy} />);
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value: '只读副本' } });
  let finish!: (preset: RollPreset) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ template: value, name: '只读副本' }));
  finish({ ...mocks.save.mock.calls[0][0], revision: 1 });
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
  expect(change).not.toHaveBeenCalled();
  rerender(<GenerationTemplateEditor value={value} onChange={change} disabled onBusyChange={busy} />);
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '另存新预设' })).toHaveProperty('disabled', true);
});
