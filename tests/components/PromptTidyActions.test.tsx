// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagAutocompleteTextarea } from '../../components/TagAutocompleteTextarea';
import { DEFAULT_PROMPT_TIDY_SETTINGS, type PromptTidyResult } from '../../services/promptTidy';
import { reloadPromptTidyState } from '../../services/promptTidyPresets';
import { reloadPromptSampleSettings, type PromptSampleBridge } from '../../services/promptSampleSettings';
import type { NAIParams } from '../../types';

const mocks = vi.hoisted(() => ({ tidy: vi.fn() }));
vi.mock('../../services/promptTidy', async importOriginal => ({ ...await importOriginal<typeof import('../../services/promptTidy')>(), tidyPrompt: mocks.tidy }));

const result = (text: string, kept = 1, removed = 1): PromptTidyResult => ({ text, kept, removed, rewritten: false });
const Harness: React.FC<{ initial: string; notify: (message: string, type?: 'success' | 'error') => void; sample?: PromptSampleBridge }> = ({ initial, notify, sample }) => {
  const [value, setValue] = useState(initial);
  return <TagAutocompleteTextarea value={value} onValueChange={setValue} tagAssistEnabled={false} showTranslations={false} promptTidy={{ notify, sample }} aria-label="Prompt" />;
};
const params = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 7 } as NAIParams;
const bridge = () => ({ generate: vi.fn().mockResolvedValue(true), current: vi.fn(() => ({ params, negativePrompt: 'lowres' })), models: [{ id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' }, { id: 'nai-diffusion-5-full', label: 'V5 Full' }] });
const textarea = () => screen.getByLabelText('Prompt') as HTMLTextAreaElement;
const openPanel = () => { fireEvent.click(screen.getByRole('button', { name: '整理提示词' })); return screen.getByRole('dialog', { name: '整理提示词' }); };

beforeEach(() => {
  localStorage.clear();
  reloadPromptTidyState();
  reloadPromptSampleSettings();
  mocks.tidy.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('整理结果覆盖原文，撤销按钮只撤销这次整理，快捷键可以重做', async () => {
  mocks.tidy.mockResolvedValue(result('artist:a'));
  const notify = vi.fn();
  render(<Harness initial="artist:a, 1girl" notify={notify} />);
  openPanel();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '整理并覆盖' })); });
  expect(mocks.tidy).toHaveBeenCalledWith('artist:a, 1girl', DEFAULT_PROMPT_TIDY_SETTINGS);
  expect(textarea().value).toBe('artist:a');
  expect(notify).toHaveBeenCalledWith('已整理：保留 1 段，去掉 1 段，可以撤销', 'success');
  expect(screen.queryByRole('dialog', { name: '整理提示词' })).toBeNull();
  expect(screen.getByRole('button', { name: '清空当前提示词' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '撤销整理' }));
  expect(textarea().value).toBe('artist:a, 1girl');
  expect(screen.queryByRole('button', { name: '撤销整理' })).toBeNull();
  fireEvent.keyDown(textarea(), { key: 'y', ctrlKey: true });
  expect(textarea().value).toBe('artist:a');
});

it('设置面板把当前设置存成快捷按钮，工具栏一键按所存设置整理，可删除', async () => {
  mocks.tidy.mockResolvedValue(result('artist:a'));
  render(<Harness initial="artist:a, 1girl" notify={vi.fn()} />);
  const panel = openPanel();
  fireEvent.click(screen.getByRole('button', { name: '只留画师' }));
  expect(panel.textContent).toContain('这一项靠词库识别，不需要 AI。');
  expect(screen.getByRole('button', { name: /AI 精准/ })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: '快捷按钮名称' }), { target: { value: '画师' } });
  fireEvent.click(screen.getByRole('button', { name: '存为快捷按钮' }));
  expect(JSON.parse(localStorage.getItem('nai_prompt_tidy')!).presets[0]).toMatchObject({ name: '画师', settings: { keep: 'artists' } });
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '整理提示词' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '快捷整理：画师' })); });
  expect(mocks.tidy).toHaveBeenLastCalledWith('artist:a, 1girl', { ...DEFAULT_PROMPT_TIDY_SETTINGS, keep: 'artists' });
  expect(textarea().value).toBe('artist:a');
  openPanel();
  fireEvent.click(screen.getByRole('button', { name: '删除快捷按钮：画师' }));
  expect(screen.queryAllByRole('button', { name: '快捷整理：画师' })).toHaveLength(0);
});

it('自定义要求才显示要求输入与改写开关，改写时隐藏去重与补前缀', () => {
  render(<Harness initial="a" notify={vi.fn()} />);
  openPanel();
  expect(screen.queryByRole('textbox', { name: '整理要求' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '自定义要求' }));
  expect(screen.getByRole('button', { name: '规则（本地）' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: '整理要求' }), { target: { value: '只留光影' } });
  expect(screen.getByRole('checkbox', { name: '去掉重复词' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /允许 AI 改写词句/ }));
  expect(screen.queryByRole('checkbox', { name: '去掉重复词' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai_prompt_tidy')!).draft).toMatchObject({ keep: 'custom', instruction: '只留光影', rewrite: true });
});

it('模型返回前提示词被改动时放弃结果；失败与空结果如实提示且不覆盖', async () => {
  let finish!: (value: PromptTidyResult) => void;
  mocks.tidy.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockRejectedValueOnce(new Error('请先在设置中配置创作助手的模型服务'))
    .mockResolvedValueOnce(result(''));
  const notify = vi.fn();
  render(<Harness initial="artist:a, 1girl" notify={notify} />);
  openPanel();
  fireEvent.click(screen.getByRole('button', { name: '整理并覆盖' }));
  fireEvent.change(textarea(), { target: { value: 'artist:a, 1girl, smile' } });
  await act(async () => { finish(result('artist:a')); });
  expect(textarea().value).toBe('artist:a, 1girl, smile');
  expect(notify).toHaveBeenLastCalledWith('整理期间提示词有改动，这次结果没有覆盖', 'error');
  expect(screen.getByRole('dialog', { name: '整理提示词' })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '整理并覆盖' })); });
  expect(notify).toHaveBeenLastCalledWith('请先在设置中配置创作助手的模型服务', 'error');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '整理并覆盖' })); });
  expect(notify).toHaveBeenLastCalledWith('没有找到要保留的内容，提示词没有改动', 'error');
  expect(textarea().value).toBe('artist:a, 1girl, smile');
  expect(screen.queryByRole('button', { name: '撤销整理' })).toBeNull();
});

it('没有出图通道时不显示样张按钮，也不显示整理后出图的勾选', () => {
  render(<Harness initial="artist:a" notify={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '生成样张' })).toBeNull();
  openPanel();
  expect(screen.queryByRole('checkbox', { name: /整理后生成样张/ })).toBeNull();
});

it('样张面板自动提取画风串交给编辑器出图，提示词框不变；我的设置直接在面板里选', async () => {
  mocks.tidy.mockResolvedValue(result('artist:a'));
  const notify = vi.fn(), sample = bridge();
  render(<Harness initial="artist:a, 1girl" notify={notify} sample={sample} />);
  fireEvent.click(screen.getByRole('button', { name: '生成样张' }));
  let panel = screen.getByRole('dialog', { name: '生成样张' });
  fireEvent.change(within(panel).getByLabelText('main 提示词'), { target: { value: 'solo, upper body' } });
  fireEvent.click(within(panel).getByRole('button', { name: '添加角色' }));
  fireEvent.change(within(panel).getByRole('textbox', { name: '角色 1 提示词' }), { target: { value: 'blue hair' } });
  await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: '生成样张' })); });
  expect(mocks.tidy).toHaveBeenCalledWith('artist:a, 1girl', { ...DEFAULT_PROMPT_TIDY_SETTINGS, keep: 'style' });
  expect(sample.generate).toHaveBeenCalledWith('artist:a');
  expect(textarea().value).toBe('artist:a, 1girl');
  expect(screen.queryByRole('dialog', { name: '生成样张' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai_prompt_sample')!)).toMatchObject({ main: 'solo, upper body', characters: ['blue hair'] });

  fireEvent.click(screen.getByRole('button', { name: '生成样张' }));
  panel = screen.getByRole('dialog', { name: '生成样张' });
  fireEvent.click(within(panel).getByRole('button', { name: '用我的样张设置' }));
  const stored = () => JSON.parse(localStorage.getItem('nai_prompt_sample')!).snapshot;
  expect(stored()).toMatchObject({ params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, seed: 7 }, negativePrompt: '' });
  expect((within(panel).getByLabelText('尺寸') as HTMLSelectElement).value).toBe('832x1216');
  fireEvent.change(within(panel).getByLabelText('模型'), { target: { value: 'nai-diffusion-5-full' } });
  fireEvent.change(within(panel).getByLabelText('尺寸'), { target: { value: '1024x1024' } });
  const steps = within(panel).getByLabelText('步数') as HTMLInputElement;
  fireEvent.change(steps, { target: { value: '20' } });
  fireEvent.change(steps, { target: { value: '99' } });
  expect(steps.value).toBe('99');
  fireEvent.blur(steps);
  expect(steps.value).toBe('20');
  fireEvent.change(within(panel).getByLabelText('CFG'), { target: { value: '6.5' } });
  fireEvent.change(within(panel).getByLabelText('采样器'), { target: { value: 'k_dpmpp_2m' } });
  fireEvent.change(within(panel).getByLabelText('种子'), { target: { value: '' } });
  fireEvent.change(within(panel).getByLabelText('负面提示词'), { target: { value: 'bad hands' } });
  expect(stored()).toMatchObject({ params: { model: 'nai-diffusion-5-full', width: 1024, height: 1024, steps: 20, scale: 6.5, sampler: 'k_dpmpp_2m' }, negativePrompt: 'bad hands' });
  expect(stored().params.seed).toBeUndefined();
  fireEvent.click(within(panel).getByRole('button', { name: '从当前参数填入' }));
  expect(notify).toHaveBeenLastCalledWith('已填入当前参数', 'success');
  expect(stored()).toMatchObject({ params: { width: 832, steps: 28, seed: 7 }, negativePrompt: '' });
  expect(within(panel).getByRole('button', { name: '生成样张' })).toHaveProperty('disabled', false);
});

it('勾选沿用原图角色时收起样张角色编辑，取消后原来填的角色还在', () => {
  render(<Harness initial="artist:a" notify={vi.fn()} sample={bridge()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成样张' }));
  const panel = screen.getByRole('dialog', { name: '生成样张' });
  fireEvent.click(within(panel).getByRole('button', { name: '添加角色' }));
  fireEvent.change(within(panel).getByRole('textbox', { name: '角色 1 提示词' }), { target: { value: 'blue hair' } });
  const keep = within(panel).getByRole('checkbox', { name: /沿用原图角色/ });
  fireEvent.click(keep);
  expect(within(panel).queryByRole('button', { name: '添加角色' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai_prompt_sample')!)).toMatchObject({ keepOriginalCharacters: true, characters: ['blue hair'] });
  fireEvent.click(keep);
  expect((within(panel).getByRole('textbox', { name: '角色 1 提示词' }) as HTMLTextAreaElement).value).toBe('blue hair');
});

it('勾选整理后生成样张：先覆盖原文，再用整理结果出图', async () => {
  mocks.tidy.mockResolvedValue(result('artist:a'));
  const sample = bridge();
  render(<Harness initial="artist:a, 1girl" notify={vi.fn()} sample={sample} />);
  openPanel();
  fireEvent.click(screen.getByRole('checkbox', { name: /整理后生成样张/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '整理并覆盖' })); });
  expect(textarea().value).toBe('artist:a');
  expect(sample.generate).toHaveBeenCalledWith('artist:a');
  expect(mocks.tidy).toHaveBeenCalledWith('artist:a, 1girl', { ...DEFAULT_PROMPT_TIDY_SETTINGS, sample: true });
});
