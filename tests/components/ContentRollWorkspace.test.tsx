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

it('全局随机搭配提供五类选择，未选栏不进入保存与填入计划，全不选时禁止抽取', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active entryTarget={{ mode: 'global' }} chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS} onApplyRoll={onApplyRoll} />);
  expect(screen.queryByRole('combobox', { name: '选择抽取范围' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '参与「表情状态」的抽取' })).toBeNull();
  const checks = screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(checks).toHaveLength(5);
  for (const check of checks) fireEvent.click(check);
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「服饰穿搭」的抽取' }));
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(screen.queryByRole('combobox', { name: '选择写入的目标角色' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  expect(document.querySelectorAll('[data-content-roll-apply-row]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0]).toMatchObject({ target: { mode: 'global' }, globalSections: { wardrobe: 'wardrobe_tag' }, roleWrites: [] });
});

it('全局与角色入口切换和恢复历史不会串目标，角色只能选四类，删除目标后不能确认', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  const params = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'current', prompt: '', x: .5, y: .5 }] };
  const props = { active: true, chains, notify: vi.fn(), playgroundParams: params, onApplyRoll };
  const view = render(<ContentRollWorkspace {...props} entryTarget={{ mode: 'global' }} />);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  const entryTarget = { mode: 'existing' as const, id: 'current' };
  view.rerender(<ContentRollWorkspace {...props} entryTarget={entryTarget} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  expect(screen.queryByRole('checkbox', { name: '参与「场景环境」的抽取' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0].target).toEqual(entryTarget);
  expect(onApplyRoll.mock.calls[0][0].globalSections).toEqual({});
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  view.rerender(<ContentRollWorkspace {...props} entryTarget={entryTarget} playgroundParams={{ ...params, characters: [] }} />);
  expect((screen.getByRole('button', { name: '确认填入' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  expect(onApplyRoll).toHaveBeenCalledOnce();
  view.rerender(<ContentRollWorkspace {...props} entryTarget={null} />);
  expect((screen.getByRole('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('checkbox', { name: '参与「表情状态」的抽取' }) as HTMLInputElement).checked).toBe(false);
});

it('首次抽取之前可选全局范围，锁定项不能单栏重抽，填入前显示旧值和新值', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={{ ...LAB_DEFAULT_PARAMS, _promptSections: { scene: 'old_scene' } }} onApplyRoll={onApplyRoll} />);
  fireEvent.change(screen.getByRole('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(document.querySelector('[data-content-roll-name="appearance"]')).toBeNull();
  const scene = document.querySelector('[data-content-roll-row="scene"]')!;
  fireEvent.click(scene.querySelector('[title="固定这一条"]')!);
  expect((Array.from(scene.querySelectorAll('button')).find(button => button.textContent === '换一个') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('combobox', { name: '选择写入的目标角色' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '填入实验室…' }));
  expect(screen.getByText('old_scene → scene_tag')).toBeTruthy();
  expect(onApplyRoll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
});

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
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
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
