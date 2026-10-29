import { openPurposeGroup } from '../support/promptPurposeGroups';
// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentRollWorkspace } from '../../components/ContentRollWorkspace';
import { KINDS } from '../../services/contentRoll';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import { combinationPicks, createCombinationData, workspacePicks } from '../../services/promptLibraryEntries';
import { PROMPT_PURPOSE_GROUPS } from '../../services/promptPurposes.mjs';
import type { ContentRollApplyPlan } from '../../services/contentRollApply';
import type { PromptChain } from '../../types';
import type { PromptLibraryTreeState } from '../../services/promptLibraryDirectories';

const chains: PromptChain[] = KINDS.map(kind => ({ id: kind, type: kind as PromptChain['type'], name: kind, userId: 'owner', description: '', basePrompt: `${kind}_tag`, negativePrompt: '',
  params: LAB_DEFAULT_PARAMS, modules: [], tags: [], variableValues: {}, createdAt: 1, updatedAt: 1 }));
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it('条目读取状态：搭配候选未就绪不报0条，失败能重试，缓存候选继续可用', () => {
  const retry = vi.fn();
  const page = (items: PromptChain[], chainsLoading = false, chainsError = '') => <ContentRollWorkspace active chains={items} chainsLoading={chainsLoading} chainsError={chainsError} onRetryChains={retry} notify={vi.fn()} />;
  const view = render(page([], true));
  expect(screen.getByText('加载中…')).toBeTruthy();
  expect(screen.queryAllByText('共 0 条')).toHaveLength(0);
  expect(screen.queryAllByText('该库当前 0 条，该栏留空')).toHaveLength(0);
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(page([], false, '读取提示词库失败'));
  expect(screen.getByRole('alert').textContent).toContain('读取提示词库失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); expect(retry).toHaveBeenCalledOnce();
  view.rerender(page([])); expect(screen.getAllByText('共 0 条').length).toBeGreaterThan(0);
  view.rerender(page(chains, true)); expect(screen.queryByText('加载中…')).toBeNull();
  expect((screen.getByRole('button', { name: '抽一次' }) as HTMLButtonElement).disabled).toBe(false);
});

it('编辑与另存组合预填标签，失败保留输入，明确留空会保存空数组', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue('saved');
  const seedRecord = { picks: { scene: { kind: 'scene', filled: true, text: 'rain' } }, seed: '旧组合', seeds: {}, tags: ['夜景', '我的分类'] };
  render(<ContentRollWorkspace active editing chains={chains} notify={vi.fn()} seedRecord={seedRecord} onSaveRoll={save} />);
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  const input = screen.getByRole('textbox', { name: '组合标签' }) as HTMLInputElement;
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
  fireEvent.change(screen.getByRole('textbox', { name: '服饰内容' }), { target: { value: 'dress' } });
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
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
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
  expect(screen.queryByRole('checkbox', { name: '参与「场景」的抽取' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  fireEvent.click(screen.getByRole('button', { name: '上一组' }));
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  await waitFor(() => expect(onApplyRoll).toHaveBeenCalledOnce());
  expect(onApplyRoll.mock.calls[0][0].target).toEqual(entryTarget);
  expect(onApplyRoll.mock.calls[0][0].globalSections).toEqual({});
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  view.rerender(<ContentRollWorkspace {...props} entryTarget={entryTarget} playgroundParams={{ ...params, characters: [] }} />);
  expect((screen.getByRole('button', { name: '确认填入' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
  expect(onApplyRoll).toHaveBeenCalledOnce();
  view.rerender(<ContentRollWorkspace {...props} entryTarget={null} />);
  expect((screen.getByRole('combobox', { name: '选择抽取范围' }) as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('checkbox', { name: '参与「表情」的抽取' }) as HTMLInputElement).checked).toBe(false);
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
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
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
  const scene = screen.getByRole('checkbox', { name: '参与「场景」的抽取' }) as HTMLInputElement;
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
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
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
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
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


it('手写和定向选材无需先抽取，固定手写内容在重抽时保留', async () => {
  const save = vi.fn(async () => 'saved');
  render(<ContentRollWorkspace active chains={chains} notify={vi.fn()} onSaveRoll={save} />);
  fireEvent.change(screen.getByRole('textbox', { name: '服饰内容' }), { target: { value: 'my weighted outfit' } });
  const card = document.querySelector('[data-content-roll-row="wardrobe"]')!;
  fireEvent.click(Array.from(card.querySelectorAll('button')).find(button => button.textContent === '固定')!);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((screen.getByRole('textbox', { name: '服饰内容' }) as HTMLTextAreaElement).value).toBe('my weighted outfit');
  fireEvent.click(screen.getByRole('button', { name: '保存组合' }));
  fireEvent.change(screen.getByRole('textbox', { name: '给这条记录起名' }), { target: { value: '手动搭配' } });
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
  const use = vi.fn(); const save = vi.fn(async () => 'saved');
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()} onUseCombination={use} onSaveRoll={save} />);
  openPurposeGroup('主体与外观'); openPurposeGroup('动作与关系');
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
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
  fireEvent.change(screen.getByRole('textbox', { name: '服饰与配件内容' }), { target: { value: '{{manual dress}}' } });
  const card = document.querySelector('[data-content-roll-row="purpose:clothing"]')!;
  fireEvent.click(Array.from(card.querySelectorAll('button')).find(button => button.textContent === '固定')!);
  view.rerender(<ContentRollWorkspace {...props} directories={{ revision: 3, nodes: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('{{manual dress}}');
  expect((screen.getByRole('textbox', { name: '动作与姿态内容' }) as HTMLTextAreaElement).value).toBe('standing');
});

it('全局入口允许全部固定用途，不根据文件夹目标限制内容', () => {
  render(<ContentRollWorkspace active directories={directories} chains={directoryChains} notify={vi.fn()} entryTarget={{ mode: 'global' }} />);
  openPurposeGroup('场景与环境'); openPurposeGroup('主体与外观');
  expect(screen.getByRole('textbox', { name: '地点与布景内容' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '服饰与配件内容' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
});

it('混合与未标注片段不进入纯用途候选池', () => {
  const entries = [...directoryChains, { ...directoryChains[0], id: 'mixed', basePrompt: 'dress, smiling', params: { ...LAB_DEFAULT_PARAMS, _promptLibraryPurposes: ['clothing', 'expression'] } }, { ...directoryChains[0], id: 'unknown', params: LAB_DEFAULT_PARAMS }] as PromptChain[];
  render(<ContentRollWorkspace active directories={directories} chains={entries} notify={vi.fn()} />);
  openPurposeGroup('主体与外观');
  const select = screen.getByRole('combobox', { name: '选择服饰与配件片段' });
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
  fireEvent.click(screen.getByText('未入单用途池 5 条'));
  const explanation = document.querySelector('[data-content-roll-exclusions]')!;
  expect(explanation.hasAttribute('open')).toBe(true);
  expect(explanation.textContent).toContain('未标注 1 条 · 多用途混合 1 条 · 负面专用 1 条 · 空正文 1 条 · 非片段 1 条');
  expect(screen.queryByText('未入单用途池 7 条')).toBeNull();
  expect(explanation.textContent).toContain('按已保存用途筛选，未自动核验正文。');
  openPurposeGroup('主体与外观');
  const select = screen.getByRole('combobox', { name: '选择服饰与配件片段' });
  expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['手写或选择片段', '衬衫']);
  fireEvent.click(screen.getByRole('button', { name: '抽一次' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
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
  const global = screen.getByRole('textbox', { name: '服饰与配件 · 全局内容' }) as HTMLTextAreaElement;
  const character = screen.getByRole('textbox', { name: '服饰与配件 · 角色内容' }) as HTMLTextAreaElement;
  expect(global.value).toBe('{{global robe}}'); expect(character.value).toBe('character dress');
  const characterCard = document.querySelector('[data-content-roll-row="character:purpose:clothing"]')!;
  fireEvent.click(within(characterCard as HTMLElement).getByRole('button', { name: '换一个' }));
  expect(global.value).toBe('{{global robe}}'); expect(character.value).toBe('white shirt');
  fireEvent.change(global, { target: { value: '{{edited global robe}}' } });
  const card = document.querySelector('[data-content-roll-row="global:purpose:clothing"]')!;
  fireEvent.click(within(card as HTMLElement).getByRole('button', { name: '固定' }));
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect(global.value).toBe('{{edited global robe}}'); expect(character.value).toBe('white shirt');
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
  expect(document.querySelectorAll('[data-content-roll-row]')).toHaveLength(22);
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('textbox', { name: '服饰与配件 · 角色内容' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
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
  expect(document.querySelectorAll('[data-content-roll-row]')).toHaveLength(22);
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('textbox', { name: '服饰与配件 · 全局内容' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再抽未固定项' }));
  expect((screen.getByRole('textbox', { name: '服饰与配件内容' }) as HTMLTextAreaElement).value).toBe('white shirt');
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
  fireEvent.change(screen.getByRole('combobox', { name: '选择写入的目标角色' }), { target: { value: 'all-enabled' } });
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  const global = document.querySelector('[data-content-roll-apply-item="global:purpose:clothing"]')!;
  const character = document.querySelector('[data-content-roll-apply-item="character:purpose:clothing"]')!;
  expect(global.getAttribute('data-content-roll-apply-scope')).toBe('global');
  expect(character.getAttribute('data-content-roll-apply-scope')).toBe('character');
  expect(global.textContent).toContain('current global outfit → {{global robe}}');
  expect(global.textContent).not.toContain('所有启用角色');
  expect(character.textContent).toContain('所有启用角色 → character dress');
  expect(document.querySelectorAll('[data-content-roll-apply-row="purpose:clothing"]')).toHaveLength(2);
  expect(consoleError).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认填入' }));
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
  expect((screen.getByRole('textbox', { name: '旧服饰内容' }) as HTMLTextAreaElement).value).toBe('{{old weighted clothes}}');
  expect((screen.getByRole('checkbox', { name: '参与「旧服饰」的抽取' }) as HTMLInputElement).checked).toBe(false);
  view.unmount();
  render(<ContentRollWorkspace active directories={{ ...legacyTree, nodes: [...legacyTree.nodes, { id: 'new-root', parentId: null, name: '新根', target: 'character' }] }} chains={[]} notify={vi.fn()} />);
  expect((screen.getByRole('checkbox', { name: '新根' }) as HTMLInputElement).checked).toBe(false);
});

it('组合保存分类使用树路径候选，仍只提交真实分类标签', async () => {
  const save = vi.fn().mockResolvedValue('saved'), categoryTree = { revision: 1, nodes: [{ id: '父类', name: '父类', parentId: null }, { id: '子类', name: '子类', parentId: '父类' }] };
  render(<ContentRollWorkspace active chains={chains} categoryTree={categoryTree} notify={vi.fn()} onSaveRoll={save} />);
  fireEvent.change(screen.getByRole('textbox', { name: '服饰内容' }), { target: { value: 'dress' } }); fireEvent.click(screen.getByRole('button', { name: '保存组合' })); fireEvent.click(screen.getByRole('button', { name: '选择已有标签' }));
  fireEvent.click(screen.getByRole('button', { name: '#父类 / 子类' })); expect((screen.getByRole('textbox', { name: '组合标签' }) as HTMLInputElement).value).toBe('子类');
  fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(save).toHaveBeenCalledOnce()); expect(save.mock.calls[0][5]).toEqual(['子类']);
});
