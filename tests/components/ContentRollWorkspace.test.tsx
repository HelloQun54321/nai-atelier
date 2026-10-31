// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentRollWorkspace } from '../../components/ContentRollWorkspace';
import { KINDS } from '../../services/contentRoll';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import { combinationPicks, createCombinationData, workspacePicks } from '../../services/promptLibraryEntries';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES } from '../../services/promptPurposes.mjs';
import { LAB_PICTURE_PURPOSES, LAB_SUBJECT_PURPOSES } from '../../services/labPromptLayout';
import type { ContentRollApplyPlan } from '../../services/contentRollApply';
import type { PromptChain } from '../../types';
import type { PromptLibraryTreeState } from '../../services/promptLibraryDirectories';
import { createDefaultPromptLibraryTree } from '../../services/promptLibraryDirectories';

// 编辑控件按真实点击入口展开；默认收起由三段布局回归单独断言。
function editorControl(role: 'textbox' | 'combobox', options: Parameters<typeof screen.getByRole>[1]) {
  if (!screen.queryByRole(role, options) && typeof options?.name === 'string') {
    const label = options.name.replace(/^选择/, '').replace(/片段$|内容$|负面$/, '');
    const edit = screen.queryByRole('button', { name: '编辑' + label });
    if (edit) fireEvent.click(edit);
  }
  return screen.getByRole(role, options);
}
function chooseDirectory(label: string) {
  const done = screen.queryByRole('button', { name: '完成' }); if (done) fireEvent.click(done);
  fireEvent.click(screen.getByTitle('选择目录'));
  fireEvent.click(screen.getByRole('checkbox', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
}
function openPurposeGroup(label: string) { expect(screen.getByText(label, { selector: '[data-prompt-purpose-group] > p' })).toBeTruthy(); }
function applicationButton() { return screen.queryByRole('button', { name: /^填入全局$|^填入角色 / }) || screen.getByRole('button', { name: '确认填入' }); }
function openApply() { const button = screen.queryByRole('button', { name: '使用' }); if (button) fireEvent.click(button); }
function confirmApply() { fireEvent.click(applicationButton()); }

const chains: PromptChain[] = KINDS.map(kind => ({ id: kind, type: kind as PromptChain['type'], name: kind, userId: 'owner', description: '', basePrompt: `${kind}_tag`, negativePrompt: '',
  params: LAB_DEFAULT_PARAMS, modules: [], tags: [], variableValues: {}, createdAt: 1, updatedAt: 1 }));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it('零候选禁用抽取但保留勾选与手写，编辑浮层关闭后返回原按钮且不替换用途行', () => {
  render(<ContentRollWorkspace active embedded entryTarget={{ mode: 'global' }} allowedPurposes={LAB_PICTURE_PURPOSES} chains={[]} notify={vi.fn()} />);
  const rows = Array.from(document.querySelectorAll('[data-content-roll-row]'));
  expect(rows).toHaveLength(7);
  expect(screen.getByRole('button', { name: '抽一次' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '填入全局' })).toHaveProperty('disabled', true);
  const participation = screen.getByRole('checkbox', { name: '参与「地点与布景」的抽取' });
  expect(participation).toHaveProperty('checked', true);
  fireEvent.click(participation);
  const trigger = screen.getByRole('button', { name: '编辑地点与布景' });
  fireEvent.click(trigger);
  const editor = screen.getByRole('dialog', { name: '编辑地点与布景' });
  expect(rows[1].contains(editor)).toBe(false);
  fireEvent.change(within(editor).getByRole('textbox', { name: '地点与布景内容' }), { target: { value: 'manual lake' } });
  fireEvent.click(within(editor).getByRole('button', { name: '完成' }));
  expect(document.activeElement).toBe(trigger);
  expect(Array.from(document.querySelectorAll('[data-content-roll-row]'))).toEqual(rows);
  expect(participation).toHaveProperty('checked', false);
  expect(rows[1].textContent).toContain('manual lake');
});

it('切目录和重抽保留未参与的结果及勾选，固定项不移动，保存浮层不挤入滚动区', async () => {
  const save = vi.fn(async () => 'saved');
  render(<ContentRollWorkspace active embedded directories={directories} chains={directoryChains} notify={vi.fn()} onSaveRoll={save} />);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  const clothing = document.querySelector('[data-content-roll-row="purpose:clothing"]')!;
  const pose = document.querySelector('[data-content-roll-row="purpose:pose"]')!;
  fireEvent.click(within(clothing as HTMLElement).getByRole('button', { name: '固定' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「动作与姿态」的抽取' }));
  chooseDirectory('人物');
  expect(screen.getByRole('checkbox', { name: '参与「动作与姿态」的抽取' })).toHaveProperty('checked', false);
  chooseDirectory('全部目录');
  expect(screen.getByRole('checkbox', { name: '参与「动作与姿态」的抽取' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect(document.querySelector('[data-content-roll-row="purpose:clothing"]')).toBe(clothing);
  expect(clothing.getAttribute('data-locked')).toBe('true');
  expect(pose.textContent).toContain('standing');
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  const dialog = screen.getByRole('dialog', { name: '保存组合' });
  expect(document.querySelector('.content-roll-scroll')!.contains(dialog)).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect((save.mock.calls[0] as unknown[])[1]).not.toHaveProperty('purpose:pose');
});

it('实验室固定用途行和完整预览从空状态保留，一次填入且执行中不能重复', async () => {
  let finish!: (success: boolean) => void;
  const apply = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<ContentRollWorkspace active embedded={false} entryTarget={{ mode: 'global' }} allowedPurposes={LAB_PICTURE_PURPOSES}
    chains={directoryChains} directories={directories} notify={vi.fn()} onApplyRoll={apply}
    renderApplyPreview={picks => <p data-full-preview>{Object.values(picks).map(row => row.text).join(', ')}</p>} />);
  expect(document.querySelector('[data-content-roll-layout="vertical"]')).toBeTruthy();
  expect(document.querySelector('aside')).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: /^参与「/ })).toHaveLength(7);
  expect(document.querySelector('[data-content-roll-choices] details')).toBeNull();
  expect(document.querySelectorAll('[data-content-roll-row][data-filled="true"]')).toHaveLength(0);
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(document.querySelectorAll('[data-content-roll-row]')).toHaveLength(7);
  expect(document.querySelectorAll('[data-content-roll-row][data-filled="true"]')).toHaveLength(1);
  const result = document.querySelector('[data-content-roll-row="purpose:place"]')!;
  expect(result.textContent).toContain('lake');
  expect(within(result as HTMLElement).getByRole('button', { name: '固定' })).toBeTruthy();
  expect(within(result as HTMLElement).getByRole('button', { name: '换一个' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(document.querySelector('[data-content-roll-apply-preview]')!.textContent).toContain('lake');
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '确认填入' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「地点与布景」的抽取' }));
  expect(document.querySelector('[data-content-roll-row="purpose:place"]')).toBe(result);
  expect(result.getAttribute('data-content-roll-on')).toBe('false');
  expect(result.textContent).toContain('lake');
  expect((screen.getByRole('button', { name: '填入全局' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「地点与布景」的抽取' }));
  const button = screen.getByRole('button', { name: '填入全局' });
  fireEvent.click(button); fireEvent.click(button);
  expect(apply).toHaveBeenCalledOnce(); expect((button as HTMLButtonElement).disabled).toBe(true);
  finish(true); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
});

it('实验室实际预览为空时不可写入，编辑按需打开且内嵌不叠加页面边距', () => {
  render(<ContentRollWorkspace active embedded entryTarget={{ mode: 'global' }} allowedPurposes={LAB_PICTURE_PURPOSES} chains={directoryChains}
    notify={vi.fn()} onApplyRoll={vi.fn()} renderApplyPreview={() => null}
    seedRecord={{ seed: 'old', seeds: {}, picks: { 'purpose:place': { kind: 'purpose:place', scope: 'global', filled: true, text: 'lake' } } }} />);
  expect((screen.getByRole('button', { name: '填入全局' }) as HTMLButtonElement).disabled).toBe(true);
  const viewport = document.querySelector('.workspace-scroll-viewport')!;
  expect(viewport.classList.contains('p-4')).toBe(false); expect(viewport.classList.contains('pb-28')).toBe(false);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑地点与布景' }));
  expect(screen.getByRole('textbox', { name: '地点与布景内容' })).toHaveProperty('value', 'lake');
});

it('全部目录包含未归类片段，连续抽取、手写、历史和重开不变成具体目录筛选', () => {
  const tree = createDefaultPromptLibraryTree();
  const entry = { ...chains[0], id: 'loose-place', name: '未归类雨夜', basePrompt: 'rainy street', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: [], _promptLibraryPurposes: ['place'] } } as PromptChain;
  const props = { active: true, directories: tree, chains: [entry], allowedPurposes: LAB_PICTURE_PURPOSES, entryTarget: { mode: 'global' as const }, notify: vi.fn() };
  let view = render(<ContentRollWorkspace {...props} />);
  const assertAll = () => {
    expect(document.querySelector('[title="全部目录"]')).toBeTruthy();
    expect(editorControl('combobox', { name: '选择地点与布景片段' }).querySelectorAll('option')).toHaveLength(2);
  };
  openPurposeGroup('场景与环境'); assertAll();
  fireEvent.click(screen.getByRole('button', { name: '抽一次' })); assertAll();
  fireEvent.change(editorControl('textbox', { name: '地点与布景内容' }), { target: { value: 'manual street' } }); assertAll();
  for (let index = 0; index < 2; index++) { fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' })); assertAll(); }
  fireEvent.click(screen.getByRole('button', { name: '上一组' })); assertAll();
  fireEvent.click(screen.getByRole('button', { name: '下一组' })); assertAll();
  expect(JSON.parse(localStorage.getItem('nai-content-roll')!).history.every((record: { directoryIds?: string[] }) => record.directoryIds === undefined)).toBe(true);
  view.unmount(); view = render(<ContentRollWorkspace {...props} />);
  openPurposeGroup('场景与环境'); assertAll();
  chooseDirectory(tree.nodes[0].name);
  expect(document.querySelector('[title="全部目录"]')).toBeNull();
  expect(editorControl('combobox', { name: '选择地点与布景片段' }).querySelectorAll('option')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  view.unmount(); view = render(<ContentRollWorkspace {...props} />);
  openPurposeGroup('场景与环境');
  expect(document.querySelector('[title="全部目录"]')).toBeNull();
  expect(editorControl('combobox', { name: '选择地点与布景片段' }).querySelectorAll('option')).toHaveLength(1);
  chooseDirectory('全部目录'); assertAll();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' })); assertAll();
  view.unmount(); render(<ContentRollWorkspace {...props} />);
  openPurposeGroup('场景与环境'); assertAll();
});

it.each([['global', LAB_PICTURE_PURPOSES], ['existing', LAB_SUBJECT_PURPOSES]] as const)('实验室%s限制显示、手选、抽取与恢复应用，不带入旧风格历史且保留原记录', async (mode, allowed) => {
  const apply = vi.fn(async (_plan: ContentRollApplyPlan) => true), save = vi.fn(async (_name: string, _picks: Record<string, unknown>) => 'saved');
  const scope = mode === 'global' ? 'global' : 'character';
  const entries = PROMPT_PURPOSES.map(purpose => ({ ...chains[0], id: purpose.id, type: 'preset', name: `候选${purpose.label}`, basePrompt: `fresh_${purpose.id}`,
    params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: [], _promptLibraryPurposes: [purpose.id] } })) as PromptChain[];
  const picks = Object.fromEntries(PROMPT_PURPOSES.map(purpose => [`purpose:${purpose.id}`, { kind: `purpose:${purpose.id}`, scope, filled: true, text: `old_${purpose.id}`, negative: `negative_${purpose.id}` }]));
  const seedRecord = { picks, seed: '完整旧组合', seeds: {} };
  const target = mode === 'global' ? { mode: 'global' as const } : { mode: 'existing' as const, id: 'target' };
  /* 全局画面含互动：至少两名启用角色，互动才默认参与，断言才能覆盖全部 allowed 用途 */
  const params = { ...LAB_DEFAULT_PARAMS, characters: mode === 'global'
    ? [{ id: 'one', prompt: '', x: .5, y: .5 }, { id: 'two', prompt: '', x: .5, y: .5 }]
    : [{ id: 'target', prompt: '', x: .5, y: .5 }] };
  render(<ContentRollWorkspace active entryTarget={target} allowedPurposes={allowed} chains={entries} notify={vi.fn()}
    playgroundParams={params} seedRecord={seedRecord} onApplyRoll={apply} onSaveRoll={save} />);
  document.querySelectorAll<HTMLButtonElement>('[data-prompt-purpose-group] > button').forEach(button => fireEvent.click(button));
  expect(screen.getAllByRole('checkbox')).toHaveLength(allowed.length);
  for (const forbidden of ['画风配方']) {
    expect(screen.queryByRole('textbox', { name: `${forbidden}内容` })).toBeNull();
  }
  const first = allowed[0], label = PROMPT_PURPOSES.find(item => item.id === first)!.label;
  const select = editorControl('combobox', { name: `选择${label}片段` });
  expect(Array.from(select.querySelectorAll('option')).map(option => option.value)).toEqual(['', first]);
  fireEvent.change(select, { target: { value: first } });
  expect(editorControl('textbox', { name: `${label}内容` })).toHaveProperty('value', `fresh_${first}`);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  expect(editorControl('textbox', { name: `${label}内容` })).toHaveProperty('value', `fresh_${first}`);
  openApply();
  confirmApply();
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  const plan = apply.mock.calls[0][0];
  expect(plan.target).toEqual(target);
  const written = mode === 'global' ? Object.keys(plan.globalSections) : plan.roleWrites.map(row => row.kind);
  expect(written.sort()).toEqual(allowed.map(id => `purpose:${id}`).sort());
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(Object.keys(save.mock.calls[0][1]).sort()).toEqual(allowed.map(id => `purpose:${id}`).sort());
  const stored = JSON.parse(localStorage.getItem('nai-content-roll')!);
  expect(stored.history.find((record: { seed: string }) => record.seed === seedRecord.seed).picks['purpose:style'].text).toBe('old_style');
});

it('实验室启用角色不足两人时互动默认不参与，可手动勾回；两人及以上或无数门禁时默认参与', () => {
  const solo = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'solo', prompt: '', x: .5, y: .5 }] };
  const duo = { ...LAB_DEFAULT_PARAMS, characters: [
    { id: 'one', prompt: '', x: .5, y: .5 },
    { id: 'two', prompt: '', x: .5, y: .5 },
    { id: 'off', prompt: '', x: .5, y: .5, enabled: false },
  ] };
  const props = { active: true, embedded: true, entryTarget: { mode: 'global' as const }, allowedPurposes: LAB_PICTURE_PURPOSES, chains: [] as PromptChain[], notify: vi.fn() };
  const interaction = () => screen.getByRole('checkbox', { name: '参与「互动与关系」的抽取' }) as HTMLInputElement;
  const place = () => screen.getByRole('checkbox', { name: '参与「地点与布景」的抽取' }) as HTMLInputElement;
  render(<ContentRollWorkspace {...props} playgroundParams={solo} />);
  expect(interaction().checked).toBe(false);
  expect(place().checked).toBe(true);
  expect(document.querySelector('[data-content-roll-interaction-gate]')).toBeTruthy();
  fireEvent.click(interaction());
  expect(interaction().checked).toBe(true);
  expect(document.querySelector('[data-content-roll-interaction-gate]')).toBeNull();
  cleanup();
  render(<ContentRollWorkspace {...props} playgroundParams={duo} />);
  expect(interaction().checked).toBe(true);
  expect(document.querySelector('[data-content-roll-interaction-gate]')).toBeNull();
  cleanup();
  render(<ContentRollWorkspace {...props} />);
  expect(interaction().checked).toBe(true);
  cleanup();
  render(<ContentRollWorkspace {...props} playgroundParams={{ ...LAB_DEFAULT_PARAMS, characters: [] }} />);
  expect(interaction().checked).toBe(false);
  expect(document.querySelector('[data-content-roll-row="purpose:interaction"]')?.getAttribute('data-content-roll-on')).toBe('false');
});

it('实验室入口不把人数门禁的默认关闭写死进历史，重开多人时互动重新默认参与', () => {
  const entries = [
    { ...chains[0], id: 'place-1', type: 'preset' as const, name: '湖边', basePrompt: 'lakeside',
      params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: [], _promptLibraryPurposes: ['place'] } },
    { ...chains[0], id: 'inter-1', type: 'preset' as const, name: '牵手', basePrompt: 'holding hands',
      params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: [], _promptLibraryPurposes: ['interaction'] } },
  ] as PromptChain[];
  const solo = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'solo', prompt: '', x: .5, y: .5 }] };
  const duo = { ...LAB_DEFAULT_PARAMS, characters: [
    { id: 'one', prompt: '', x: .5, y: .5 }, { id: 'two', prompt: '', x: .5, y: .5 },
  ] };
  const props = { active: true, embedded: true, entryTarget: { mode: 'global' as const }, allowedPurposes: LAB_PICTURE_PURPOSES, chains: entries, directories, notify: vi.fn() };
  const interaction = () => screen.getByRole('checkbox', { name: '参与「互动与关系」的抽取' }) as HTMLInputElement;
  render(<ContentRollWorkspace {...props} playgroundParams={solo} />);
  expect(interaction().checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(document.querySelector('[data-content-roll-row="purpose:place"]')?.getAttribute('data-filled')).toBe('true');
  expect(document.querySelector('[data-content-roll-row="purpose:interaction"]')?.getAttribute('data-filled')).toBe('false');
  cleanup();
  render(<ContentRollWorkspace {...props} playgroundParams={duo} />);
  expect(interaction().checked).toBe(true);
  expect(document.querySelector('[data-content-roll-interaction-gate]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /抽一次|再抽未固定项/ }));
  expect(document.querySelector('[data-content-roll-row="purpose:interaction"]')?.getAttribute('data-filled')).toBe('true');
});

it('受限用途组标题匹配实际内容，自由搭配保留完整组名', () => {
  const props = { active: true, chains: [], directories, notify: vi.fn(), entryTarget: { mode: 'global' as const } };
  const view = render(<ContentRollWorkspace {...props} allowedPurposes={LAB_PICTURE_PURPOSES} />);
  for (const label of ['互动与关系', '镜头、构图与文字', '场景与环境']) expect(screen.getByText(label, { selector: '[data-prompt-purpose-group] > p' })).toBeTruthy();
  for (const label of ['动作与关系', '镜头与光影', '画风与成像']) expect(screen.queryByText(label, { selector: '[data-prompt-purpose-group] > p' })).toBeNull();
  view.rerender(<ContentRollWorkspace {...props} allowedPurposes={LAB_SUBJECT_PURPOSES} />);
  expect(screen.getByText('动作与表情', { selector: '[data-prompt-purpose-group] > p' })).toBeTruthy();
  expect(screen.getByText('主体与外观', { selector: '[data-prompt-purpose-group] > p' })).toBeTruthy();
  view.rerender(<ContentRollWorkspace {...props} />);
  for (const label of ['动作与关系', '镜头、构图与文字', '画风与成像']) expect(screen.getByText(label, { selector: '[data-prompt-purpose-group] > p' })).toBeTruthy();
});

it('同一组件切换受限范围时按当前入口排除异scope历史，不改库页默认自由能力', () => {
  const picks = { 'purpose:clothing': { kind: 'purpose:clothing', scope: 'global' as const, filled: true, text: 'global dress' },
    'purpose:style': { kind: 'purpose:style', scope: 'global' as const, filled: true, text: 'style text' } };
  const props = { active: true, directories, chains: directoryChains, notify: vi.fn(), seedRecord: { picks, seed: '旧全局组合', seeds: {} } };
  const view = render(<ContentRollWorkspace {...props} entryTarget={{ mode: 'existing', id: 'target' }} allowedPurposes={LAB_SUBJECT_PURPOSES} />);
  openPurposeGroup('主体与外观');
  expect(editorControl('textbox', { name: '服饰与配件内容' })).toHaveProperty('value', '');
  view.rerender(<ContentRollWorkspace {...props} entryTarget={{ mode: 'global' }} />);
  openPurposeGroup('画风与成像');
  expect(editorControl('textbox', { name: '服饰与配件内容' })).toHaveProperty('value', 'global dress');
  expect(editorControl('textbox', { name: '画风配方内容' })).toHaveProperty('value', 'style text');
});

it('条目读取状态：搭配候选未就绪不报0条，失败能重试，缓存候选继续可用', () => {
  const retry = vi.fn();
  const page = (items: PromptChain[], chainsLoading = false, chainsError = '') => <ContentRollWorkspace active chains={items} chainsLoading={chainsLoading} chainsError={chainsError} onRetryChains={retry} notify={vi.fn()} />;
  const view = render(page([], true));
  expect(screen.getAllByText('加载中…').length).toBeGreaterThan(0);
  expect(screen.queryAllByTitle('共 0 条')).toHaveLength(0);
  expect(screen.getAllByTitle('共 — 条').every(node => node.textContent === '—')).toBe(true);
  expect(screen.queryAllByText('该库当前 0 条，该栏留空')).toHaveLength(0);
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(page([], false, '读取提示词库失败'));
  expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(page([])); expect(screen.getAllByTitle('共 0 条').every(node => node.textContent === '0')).toBe(true);
  view.rerender(page(chains, true)); expect(screen.getAllByTitle('共 1 条')).toHaveLength(KINDS.length);
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(false);
});

it('编辑与另存组合预填标签，失败保留输入，明确留空会保存空数组', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue('saved');
  const seedRecord = { picks: { scene: { kind: 'scene', filled: true, text: 'rain' } }, seed: '旧组合', seeds: {}, tags: ['夜景', '我的分类'] };
  render(<ContentRollWorkspace active editing chains={chains} notify={vi.fn()} seedRecord={seedRecord} onSaveRoll={save} />);
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  const input = editorControl('textbox', { name: '组合标签' }) as HTMLInputElement;
  expect(input.value).toBe('夜景, 我的分类');
  fireEvent.change(input, { target: { value: ' 新分类，夜景,新分类' } });
  fireEvent.click(screen.getByRole('button', { name: '另存为新组合' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][4]).toBe(true);
  expect(save.mock.calls[0][5]).toEqual(['新分类', '夜景']);
  await waitFor(() => expect(screen.getByRole('button', { name: '保存修改' }).hasAttribute('disabled')).toBe(false));
  expect(input.value).toBe(' 新分类，夜景,新分类');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][5]).toEqual([]);
});

it('组合保存候选包含预建空分类，不混入片段标签', () => {
  render(<ContentRollWorkspace active chains={[{ ...chains[0], tags: ['仅片段标签'] }]} categoryNames={['预建空类']} notify={vi.fn()} onSaveRoll={vi.fn()} />);
  fireEvent.change(editorControl('textbox', { name: '服饰内容' }), { target: { value: 'dress' } });
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  expect(screen.getByRole('button', { name: '#预建空类' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '#仅片段标签' })).toBeNull();
});

it('全局随机搭配提供五类选择，未选栏不进入保存与填入计划，全不选时禁止抽取', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active entryTarget={{ mode: 'global' }} chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS} onApplyRoll={onApplyRoll} />);
  expect(screen.queryByRole('combobox', { name: '选择抽取范围' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: '参与「表情」的抽取' })).toBeNull();
  const checks = screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(checks).toHaveLength(5);
  for (const check of checks) fireEvent.click(check);
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「服饰」的抽取' }));
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(screen.queryByRole('combobox', { name: '选择写入的目标角色' })).toBeNull();
  openApply();
  expect(document.querySelectorAll('[data-content-roll-apply-row]')).toHaveLength(1);
  confirmApply();
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
  expect(screen.queryByRole('checkbox', { name: '参与「场景」的抽取' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  openApply();
  confirmApply();
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0].target).toEqual(entryTarget);
  expect(onApplyRoll.mock.calls[0][0].globalSections).toEqual({});
  openApply();
  view.rerender(<ContentRollWorkspace {...props} entryTarget={entryTarget} playgroundParams={{ ...params, characters: [] }} />);
  expect((applicationButton() as HTMLButtonElement).disabled).toBe(true);
  confirmApply();
  expect(onApplyRoll).toHaveBeenCalledOnce();
  view.rerender(<ContentRollWorkspace {...props} entryTarget={null} />);
  expect((editorControl('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('checkbox', { name: '参与「表情」的抽取' }) as HTMLInputElement).checked).toBe(false);
});

it('首次抽取之前可选全局范围，锁定项不能单栏重抽，填入前显示旧值和新值', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={{ ...LAB_DEFAULT_PARAMS, _promptSections: { scene: 'old_scene' } }} onApplyRoll={onApplyRoll} />);
  fireEvent.change(editorControl('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect(document.querySelector('[data-content-roll-name="appearance"]')).toBeNull();
  const scene = document.querySelector('[data-content-roll-row="scene"]')!;
  fireEvent.click(scene.querySelector('[title="固定这一条"]')!);
  expect((Array.from(scene.querySelectorAll('button')).find(button => button.textContent === '换一个') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('combobox', { name: '选择写入的目标角色' })).toBeNull();
  openApply();
  expect(screen.getByText('old_scene → scene_tag')).toBeTruthy();
  expect(onApplyRoll).not.toHaveBeenCalled();
  confirmApply();
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
});

it('范围与参与开关一致，切范围后可抽取、保存和应用对应内容，历史恢复原范围', async () => {
  const onSaveRoll = vi.fn(async (_name: string, _picks: Record<string, unknown>) => 'saved');
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS}
    onSaveRoll={onSaveRoll} onApplyRoll={onApplyRoll} />);
  const scene = screen.getByRole('checkbox', { name: '参与「场景」的抽取' }) as HTMLInputElement;
  expect(scene.checked).toBe(false); expect(scene.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  fireEvent.change(editorControl('combobox', { name: '选择抽取范围' }), { target: { value: 'global' } });
  expect(scene.checked).toBe(true); expect(scene.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.change(editorControl('textbox', { name: '给这条记录起名' }), { target: { value: '场景搭配' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onSaveRoll).toHaveBeenCalledOnce());
  expect(Object.keys(onSaveRoll.mock.calls[0][1])).toEqual(['scene', 'camera']);
  openApply();
  confirmApply();
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0]).toMatchObject({ roleWrites: [], globalSections: { scene: 'scene_tag', camera: 'camera_tag' } });
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  expect((editorControl('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('character');
  expect(scene.checked).toBe(false);
});

it('仅有全局内容的已存搭配载入后自动采用全局范围，保留负面与约束', async () => {
  const onApplyRoll = vi.fn(async (_plan: ContentRollApplyPlan) => true);
  const picks = { scene: { kind: 'scene', filled: true, text: 'night', negative: 'day', constraints: { notes: '保留夜景' } } };
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} playgroundParams={LAB_DEFAULT_PARAMS}
    seedRecord={{ picks, seed: 'saved', seeds: {} }} onSeedConsumed={vi.fn()} onApplyRoll={onApplyRoll} />);
  expect((editorControl('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('global');
  openApply();
  confirmApply();
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
  fireEvent.change(editorControl('combobox', { name: '选择写入的风格串' }), { target: { value: 'style-1' } });
  fireEvent.click(screen.getByRole('button', { name: '写入风格串…' }));
  fireEvent.click(screen.getByRole('button', { name: '写入这条风格串' }));
  await waitFor(() => expect(onWriteRollToChain).toHaveBeenCalledOnce());
  expect(onWriteRollToChain.mock.calls[0][0]).toMatchObject({
    variableValues: { subject: 'night, beside a red car' },
    params: { characters: [{ sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'black dress' } }],
      _promptSections: { scene: 'night', sectionNegatives: { scene: 'day' } } },
  });
});


it('手写和定向选材无需先抽取，固定手写内容在重抽时保留', async () => {
  const save = vi.fn(async (_name: string, _picks: Record<string, unknown>) => 'saved');
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} onSaveRoll={save} />);
  fireEvent.change(editorControl('textbox', { name: '服饰内容' }), { target: { value: 'my weighted outfit' } });
  const card = document.querySelector('[data-content-roll-row="wardrobe"]')!;
  fireEvent.click(Array.from(card.querySelectorAll('button')).find(button => button.textContent === '固定')!);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((editorControl('textbox', { name: '服饰内容' }) as HTMLTextAreaElement).value).toBe('my weighted outfit');
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.change(editorControl('textbox', { name: '给这条记录起名' }), { target: { value: '手动搭配' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect((save.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({ wardrobe: { kind: 'wardrobe', text: 'my weighted outfit' } });
});

const directories: PromptLibraryTreeState = { revision: 1, nodes: [
  { id: 'people', parentId: null, name: '人物', target: 'character' },
  { id: 'outfits', parentId: 'people', name: '衣装' },
  { id: 'shirts', parentId: 'outfits', name: '上衣' },
  { id: 'motion', parentId: 'people', name: '姿态' },
  { id: 'world', parentId: null, name: '环境', target: 'global' },
] };
const directoryChains = [
  { ...chains[0], id: 'shirt', name: '衬衫', basePrompt: 'white shirt', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: ['shirts'], _promptLibraryPurposes: ['clothing'] } },
  { ...chains[0], id: 'move', name: '站立', basePrompt: 'standing', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: ['motion'], _promptLibraryPurposes: ['pose'] } },
  { ...chains[0], id: 'world-entry', name: '湖边', basePrompt: 'lake', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: ['world'], _promptLibraryPurposes: ['place'] } },
] as PromptChain[];

it('Roll 按固定用途抽取，取消用途后不参与使用和保存', async () => {
  const use = vi.fn(); const save = vi.fn(async (_name: string, _picks: Record<string, unknown>) => 'saved');
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()} onUseCombination={use} onSaveRoll={save} />);
  openPurposeGroup('主体与外观'); openPurposeGroup('动作与关系');
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
  fireEvent.click(screen.getByRole('checkbox', { name: '参与「动作与姿态」的抽取' }));
  fireEvent.click(screen.getByRole('button', { name: '送到实验室' }));
  expect(use.mock.calls[0][0]['purpose:clothing'].text).toBe('white shirt');
  expect(use.mock.calls[0][0]['purpose:pose']).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect((save.mock.calls[0] as unknown[])[1]).not.toHaveProperty('purpose:pose');
});

it('目录任意改名删除后固定手写用途内容不变，重抽仍按 Tag', () => {
  const use = vi.fn(); const props = { active: true, chains: directoryChains, notify: vi.fn(), onUseCombination: use };
  const view = render(<ContentRollWorkspace {...props} directories={directories} />);
  openPurposeGroup('主体与外观'); openPurposeGroup('动作与关系');
  fireEvent.change(editorControl('textbox', { name: '服饰与配件内容' }), { target: { value: '{{manual dress}}' } });
  const card = document.querySelector('[data-content-roll-row="purpose:clothing"]')!;
  fireEvent.click(Array.from(card.querySelectorAll('button')).find(button => button.textContent === '固定')!);
  view.rerender(<ContentRollWorkspace {...props} directories={{ revision: 3, nodes: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('{{manual dress}}');
  expect((editorControl('textbox', { name: '动作与姿态内容' }) as HTMLTextAreaElement).value).toBe('standing');
});

it('全局入口允许全部固定用途，不根据文件夹目标限制内容', () => {
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()} entryTarget={{ mode: 'global' }} />);
  openPurposeGroup('场景与环境'); openPurposeGroup('主体与外观');
  expect(editorControl('textbox', { name: '地点与布景内容' })).toBeTruthy();
  expect(editorControl('textbox', { name: '服饰与配件内容' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
});

it('混合与未标注片段不进入纯用途候选池', () => {
  const entries = [...directoryChains, { ...directoryChains[0], id: 'mixed', basePrompt: 'dress, smiling', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryPurposes: ['clothing', 'expression'] } }, { ...directoryChains[0], id: 'unknown', params: LAB_DEFAULT_PARAMS }] as PromptChain[];
  render(<ContentRollWorkspace active directories={directories} chains={entries} notify={vi.fn()} />);
  openPurposeGroup('主体与外观');
  const select = editorControl('combobox', { name: '选择服饰与配件片段' });
  expect(select.querySelectorAll('option')).toHaveLength(2);
  expect(select.textContent).toContain('衬衫');
});

it('真实片段输入只抽单用途非空正词，排除原因计数忽略普通风格串和角色', () => {
  const pure = directoryChains[0];
  const entries = [pure,
    { ...pure, id: 'unmarked', name: '未标片段', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryDirectoryIds: [] } },
    { ...pure, id: 'mixed', name: '混合片段', basePrompt: '{{dress, smiling}}', params: { ...pure.params, _promptLibraryPurposes: ['clothing', 'expression'] } },
    { ...pure, id: 'negative', name: '负面片段', params: { ...pure.params, _promptLibraryPolarity: 'negative' } },
    { ...pure, id: 'empty', name: '空片段', basePrompt: ' \n ' },
    { ...pure, id: 'original', name: '原文', type: 'preset', params: { ...LAB_DEFAULT_PARAMS, _collectedPrompt: 1, _promptLibraryPurposes: ['clothing'] } },
    { ...pure, id: 'style', name: '普通风格串', type: 'style', params: LAB_DEFAULT_PARAMS },
    { ...pure, id: 'character', name: '普通角色', type: 'character', params: LAB_DEFAULT_PARAMS },
  ] as PromptChain[];
  const before = JSON.stringify(entries);
  const props = { active: true, directories, chains: entries, notify: vi.fn() };
  const view = render(<ContentRollWorkspace {...props} chainsLoading />);
  expect(document.querySelector('[data-content-roll-exclusions]')).toBeNull();
  view.rerender(<ContentRollWorkspace {...props} chainsError="读取失败" />);
  expect(document.querySelector('[data-content-roll-exclusions]')).toBeNull();
  view.rerender(<ContentRollWorkspace {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '5 条未参与随机' }));
  const explanation = document.querySelector('[data-content-roll-exclusions]')!;
  expect(explanation.closest('[role="dialog"]')).toBeTruthy();
  expect(explanation.textContent).toContain('未标注 1 条 · 多用途混合 1 条 · 负面专用 1 条 · 空正文 1 条 · 非片段 1 条');
  expect(screen.queryByRole('button', { name: '7 条未参与随机' })).toBeNull();
  expect(explanation.textContent).toContain('按已保存用途筛选，未自动核验正文。');
  openPurposeGroup('主体与外观');
  const select = editorControl('combobox', { name: '选择服饰与配件片段' });
  expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['手写或选择片段', '衬衫']);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
  expect(JSON.stringify(entries)).toBe(before);
});

it('真实组合恢复同用途全局和角色项目，独立编辑固定和重抽仍保留两个身份', () => {
  const params = { ...LAB_DEFAULT_PARAMS, _promptSections: { 'purpose:clothing': '{{global robe}}' },
    characters: [{ id: 'role', prompt: '', x: .5, y: .5, sections: { 'purpose:clothing': 'character dress' } }] };
  const saved = createCombinationData('两种服饰', workspacePicks(params, 'role', directories)) as PromptChain;
  const picks = combinationPicks(saved);
  const use = vi.fn();
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()} onUseCombination={use}
    seedRecord={{ picks, seed: '两种服饰', seeds: {} }} />);
  openPurposeGroup('主体与外观');
  expect(document.querySelector('[data-content-roll-row="purpose:clothing"]')).toBeNull();
  const global = () => editorControl('textbox', { name: '服饰与配件 · 全局内容' }) as HTMLTextAreaElement;
  const character = () => editorControl('textbox', { name: '服饰与配件 · 角色内容' }) as HTMLTextAreaElement;
  expect(global().value).toBe('{{global robe}}'); expect(character().value).toBe('character dress');
  const characterCard = document.querySelector('[data-content-roll-row="character:purpose:clothing"]')!;
  fireEvent.click(within(characterCard as HTMLElement).getByRole('button', { name: '换一个' }));
  expect(global().value).toBe('{{global robe}}'); expect(character().value).toBe('white shirt');
  fireEvent.change(global(), { target: { value: '{{edited global robe}}' } });
  const card = document.querySelector('[data-content-roll-row="global:purpose:clothing"]')!;
  fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '固定' }));
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect(global().value).toBe('{{edited global robe}}'); expect(character().value).toBe('white shirt');
  fireEvent.click(screen.getByRole('button', { name: '送到实验室' }));
  expect(use.mock.calls[0][0]).toMatchObject({
    'global:purpose:clothing': { kind: 'purpose:clothing', scope: 'global', text: '{{edited global robe}}' },
    'character:purpose:clothing': { kind: 'purpose:clothing', scope: 'character', text: 'white shirt' },
  });
});

it('固定全局入口恢复角色用途历史仍保留全部用途空栏，不改原角色内容', () => {
  const params = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'role', prompt: '', x: .5, y: .5,
    sections: { 'purpose:clothing': '{{role dress}}' } }] };
  const saved = createCombinationData('角色组合', workspacePicks(params, 'role', directories)) as PromptChain;
  const picks = combinationPicks(saved);
  render(<ContentRollWorkspace active entryTarget={{ mode: 'global' }} directories={directories} chains={directoryChains}
    notify={vi.fn()} seedRecord={{ picks, seed: '角色组合', seeds: {} }} />);
  for (const group of PROMPT_PURPOSE_GROUPS) openPurposeGroup(group.label);
  expect(screen.getAllByRole('checkbox', { name: /^参与「/ })).toHaveLength(16);
  expect(document.querySelectorAll('[data-content-roll-row][data-filled="true"]')).toHaveLength(0);
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('textbox', { name: '服饰与配件 · 角色内容' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
  expect(picks['character:purpose:clothing'].text).toBe('{{role dress}}');
});

it('固定角色入口恢复全局用途历史仍保留全部用途空栏，不改原全局内容', () => {
  const source = { ...LAB_DEFAULT_PARAMS, _promptSections: { 'purpose:clothing': '{{global robe}}' } };
  const saved = createCombinationData('全局组合', workspacePicks(source, undefined, directories)) as PromptChain;
  const picks = combinationPicks(saved);
  const target = { ...LAB_DEFAULT_PARAMS, characters: [{ id: 'target', prompt: '', x: .5, y: .5 }] };
  render(<ContentRollWorkspace active entryTarget={{ mode: 'existing', id: 'target' }} playgroundParams={target}
    directories={directories} chains={directoryChains} notify={vi.fn()} seedRecord={{ picks, seed: '全局组合', seeds: {} }} />);
  for (const group of PROMPT_PURPOSE_GROUPS) openPurposeGroup(group.label);
  expect(screen.getAllByRole('checkbox', { name: /^参与「/ })).toHaveLength(16);
  expect(document.querySelectorAll('[data-content-roll-row][data-filled="true"]')).toHaveLength(0);
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('textbox', { name: '服饰与配件 · 全局内容' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((editorControl('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
  expect(picks['global:purpose:clothing'].text).toBe('{{global robe}}');
});

it('双scope同用途应用预览使用独立项目身份，全局不误显所有启用角色', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const source = { ...LAB_DEFAULT_PARAMS, _promptSections: { 'purpose:clothing': '{{global robe}}' },
    characters: [{ id: 'source', prompt: '', x: .5, y: .5, sections: { 'purpose:clothing': 'character dress' } }] };
  const saved = createCombinationData('双范围组合', workspacePicks(source, 'source', directories)) as PromptChain;
  const target = { ...LAB_DEFAULT_PARAMS, _promptSections: { 'purpose:clothing': 'current global outfit' },
    characters: [{ id: 'one', prompt: '', x: .5, y: .5 }, { id: 'two', prompt: '', x: .5, y: .5 }] };
  const apply = vi.fn().mockResolvedValue(true);
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()}
    playgroundParams={target} playgroundRoles={[{ id: 'one', label: '角色一' }, { id: 'two', label: '角色二' }]}
    onApplyRoll={apply} seedRecord={{ picks: combinationPicks(saved), seed: '双范围组合', seeds: {} }} />);
  fireEvent.change(editorControl('combobox', { name: '选择写入的目标角色' }), { target: { value: 'all-enabled' } });
  openApply();
  const global = document.querySelector('[data-content-roll-apply-item="global:purpose:clothing"]')!;
  const character = document.querySelector('[data-content-roll-apply-item="character:purpose:clothing"]')!;
  expect(global.getAttribute('data-content-roll-apply-scope')).toBe('global');
  expect(character.getAttribute('data-content-roll-apply-scope')).toBe('character');
  expect(global.textContent).toContain('current global outfit → {{global robe}}');
  expect(global.textContent).not.toContain('所有启用角色');
  expect(character.textContent).toContain('所有启用角色 → character dress');
  expect(document.querySelectorAll('[data-content-roll-apply-row="purpose:clothing"]')).toHaveLength(2);
  expect(consoleError).not.toHaveBeenCalled();
  confirmApply();
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(apply.mock.calls[0][0]).toMatchObject({ target: { mode: 'all-enabled' },
    globalSections: { 'purpose:clothing': '{{global robe}}' }, roleWrites: [{ kind: 'purpose:clothing', text: 'character dress' }] });
});

it('旧草稿兼容目录键且保留参与状态，刷新不会自动加入后来新增的目录', () => {
  const legacyTree: PromptLibraryTreeState = { revision: 1, nodes: [{ id: 'person-wardrobe', parentId: null, name: '旧服饰', target: 'character' }] };
  // 使用项目默认稳定目录ID，验证草稿只转换身份与归属，不修改原文。
  const saved = { seed: 'old', seeds: {}, picks: { wardrobe: { kind: 'wardrobe', id: 'manual-wardrobe', text: '{{old weighted clothes}}', filled: true } }, checks: { wardrobe: false }, locked: { wardrobe: 'manual-wardrobe' }, scope: 'character', at: 1 };
  localStorage.setItem('nai-content-roll', JSON.stringify({ history: [saved], cursor: 0 }));
  const view = render(<ContentRollWorkspace active directories={legacyTree} chains={[]} notify={vi.fn()} />);
  expect(JSON.parse(localStorage.getItem('nai-content-roll')!).history[0].picks['directory:person-wardrobe'].text).toBe('{{old weighted clothes}}');
  expect((screen.getByRole('checkbox', { name: '参与「旧服饰」的抽取' }) as HTMLInputElement).checked).toBe(false);
  view.unmount();
  render(<ContentRollWorkspace active directories={{ ...legacyTree, nodes: [...legacyTree.nodes, { id: 'new-root', parentId: null, name: '新根', target: 'character' }] }} chains={[]} notify={vi.fn()} />);
  fireEvent.click(screen.getByTitle('选择目录'));
  expect((screen.getByRole('checkbox', { name: '新根' }) as HTMLInputElement).checked).toBe(false);
});

it('组合保存分类使用树路径候选，仍只提交真实分类标签', async () => {
  const save = vi.fn().mockResolvedValue('saved'), categoryTree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }] };
  render(<ContentRollWorkspace active chains={chains} categoryTree={categoryTree} notify={vi.fn()} onSaveRoll={save} />);
  fireEvent.change(editorControl('textbox', { name: '服饰内容' }), { target: { value: 'dress' } }); fireEvent.click(screen.getByRole('button', { name: '保存组合' })); fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(screen.getByRole('button', { name: '#父类 / 子类' })); expect((editorControl('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('子类');
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(save.mock.calls[0][5]).toEqual(['子类']);
});
