// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentRollWorkspace } from '../../components/ContentRollWorkspace';
import { KINDS } from '../../services/contentRoll';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { ContentRollApplyPlan } from '../../services/contentRollApply';
import type { PromptChain } from '../../types';

const chains: PromptChain[] = KINDS.map(kind => ({ id: kind, type: kind as PromptChain['type'], name: kind, userId: 'owner', description: '', basePrompt: `${kind}_tag`, negativePrompt: '',
  params: LAB_DEFAULT_PARAMS, modules: [], tags: [], variableValues: {}, createdAt: 1, updatedAt: 1 }));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it('范围与参与开关一致，切范围后可抽取、保存和应用对应内容，历史恢复原范围', async () => {
  const onSaveRoll = vi.fn(async (_name: string, _picks: Record<string, unknown>) => 'saved');
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS}
    onSaveRoll={onSaveRoll} onApplyRoll={onApplyRoll} />);
  const scene = screen.getByRole('checkbox', { name: '参与「场景环境」的抽取' }) as HTMLInputElement;
  expect(scene.checked).toBe(false); expect(scene.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  fireEvent.change(screen.getByRole('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  expect(scene.checked).toBe(true); expect(scene.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  fireEvent.click(screen.getByRole('button', { name: '存为 Roll 内容…' }));
  fireEvent.change(screen.getByRole('textbox', { name: '给这条记录起名' }), { target: { value: '场景搭配' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onSaveRoll).toHaveBeenCalledOnce());
  expect(Object.keys(onSaveRoll.mock.calls[0][1])).toEqual(['scene', 'camera']);
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0]).toMatchObject({ roleWrites: [], globalSections: { scene: 'scene_tag', camera: 'camera_tag' } });
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  expect((screen.getByRole('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('character');
  expect(scene.checked).toBe(false);
});

it('仅有全局内容的已存搭配载入后自动采用全局范围，保留负面与约束', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  const picks = { scene: { kind: 'scene', filled: true, text: 'night', negative: 'day', constraints: { notes: '保留夜景' } } };
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS}
    seedRecord={{ picks, seed: 'saved', seeds: {} }} onSeedConsumed={vi.fn()} onApplyRoll={onApplyRoll} />);
  expect((screen.getByRole('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('global');
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0]).toMatchObject({ globalSections: { scene: 'night' }, globalNegatives: { scene: 'day' } });
});

it('Roll 写入已有串保留未分栏主体，并传递角色与全局分类负面', async () => {
  const onWriteRollToChain = vi.fn(async (_payload: unknown) => 'style-1');
  const style = { ...chains[0], id: 'style-1', type: 'style' as const, variableValues: { subject: 'beside a red car' } };
  const picks = {
    wardrobe: { kind: 'wardrobe', filled: true, text: 'white dress', negative: 'black dress' },
    scene: { kind: 'scene', filled: true, text: 'night', negative: 'day' },
  };
  render(<ContentRollWorkspace active chains={[...chains, style]} notify={vi.fn()}
    seedRecord={{ picks, seed: 'saved', seeds: {} }} onSeedConsumed={vi.fn()} onWriteRollToChain={onWriteRollToChain} />);
  fireEvent.change(screen.getByRole('combobox', { name: '选择写入的风格串' }), { target: { value: 'style-1' } });
  fireEvent.click(screen.getByRole('button', { name: '写入风格串…' }));
  fireEvent.click(screen.getByRole('button', { name: '写入这条风格串' }));
  await waitFor(() => expect(onWriteRollToChain).toHaveBeenCalledOnce());
  expect(onWriteRollToChain.mock.calls[0][0]).toMatchObject({
    variableValues: { subject: 'night, beside a red car' },
    params: { characters: [{ sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'black dress' } }],
      _promptSections: { scene: 'night', sectionNegatives: { scene: 'day' } } },
  });
});
