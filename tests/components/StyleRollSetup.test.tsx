// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rollFixture, candidateFixture } from '../fixtures/styleRoll';
import { ImageActivityProvider } from '../../components/SmartImage';
import { StyleRollSetup } from '../../components/roll/StyleRollSetup';
import { createDefaultRollTemplate, DEFAULT_ROLL_PROMPT, type RollExperiment, type RollPreset } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { loadRollPresets, saveRollPreset, deleteRollPreset } from '../../services/styleRollApi';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), params: null as any }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/styleRollApi', () => ({ loadRollPresets: vi.fn(), saveRollPreset: vi.fn(), deleteRollPreset: vi.fn() }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => DEFAULT_NAI_RUNTIME }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: (props: any) => { mocks.params = props; return null; } }));

/** Roll 的角色栏与实验室普通模式共用多角色编辑器：正文用 placeholder 定位，数据落在 template.characters。 */
const roleFields = (placeholder = '角色提示词') => screen.queryAllByPlaceholderText(placeholder) as HTMLTextAreaElement[];
const addRole = (prompt: string) => {
  fireEvent.click(screen.getByRole('button', { name: '添加角色' }));
  const fields = roleFields();
  fireEvent.change(fields[fields.length - 1], { target: { value: prompt } });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.confirm.mockResolvedValue(true);
  vi.mocked(loadRollPresets).mockResolvedValue([]);
  vi.mocked(saveRollPreset).mockImplementation(async value => ({ ...value, revision: value.revision + 1 }));
  vi.mocked(deleteRollPreset).mockResolvedValue();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('直接呈现提示词与生成设置，不重复提供抽取设置标签或记录名输入框', async () => {
  const initial = rollFixture();
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={async () => {}} onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: '提示词与生成设置' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '抽取设置' })).toBeNull();
  expect(screen.queryByRole('button', { name: '生成配置' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: '记录名称' })).toBeNull();
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  expect(loadRollPresets).toHaveBeenCalledOnce();
});

it('Roll 生成配置沿用全局强制清空种子开关，可原位切换', async () => {
  const onForceEmptySeedChange = vi.fn();
  render(<StyleRollSetup initial={rollFixture()} forceEmptySeed onForceEmptySeedChange={onForceEmptySeedChange} enforceFreeStepLimit onSave={async () => {}} onClose={() => {}} />);
  expect(mocks.params.forceEmptySeed).toBe(true);
  mocks.params.onForceEmptySeedChange(false);
  expect(onForceEmptySeedChange).toHaveBeenCalledWith(false);
});

it('不提供已有风格串导入；可套用推荐词后自定义并完整保存配置', async () => {
  const initial = rollFixture(); initial.revision = 0; initial.artists = [];
  initial.template.params.seed = 42;
  initial.template.params.characters = [{ id: 'r', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }];
  const originalParams = structuredClone(initial.template.params);
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.queryByRole('combobox', { name: '载入生成配置' })).toBeNull();
  await waitFor(() => expect((screen.getByRole('combobox', { name: '生成配置预设' }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: 'recommended' } });
  const prompt = screen.getByRole('combobox', { name: '公共提示词' });
  expect((prompt as HTMLTextAreaElement).value).toBe(DEFAULT_ROLL_PROMPT);
  expect((prompt as HTMLTextAreaElement).value).not.toContain('1girl');
  fireEvent.change(prompt, { target: { value: 'custom style, {style}, 1girl' } });
  addRole('miku, twintails');
  fireEvent.change(screen.getByRole('combobox', { name: '负面提示词' }), { target: { value: 'custom negative' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0];
  expect(value.template.prompt).toBe('custom style, {style}, 1girl');
  expect(value.template.negativePrompt).toBe('custom negative');
  expect(value.template.characters).toEqual([expect.objectContaining({ prompt: 'miku, twintails' })]);
  expect(value.template.params).toEqual(createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params);
  expect(initial.template.params).toEqual(originalParams);
});

it('已有候选仍可修改生成配置且不改旧候选与抽取规则', async () => {
  const initial = rollFixture(); initial.candidates = [candidateFixture('a')]; initial.pinnedArtists = ['alpha'];
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect((screen.getByRole('combobox', { name: '公共提示词' }) as HTMLTextAreaElement).disabled).toBe(false);
  expect(screen.getByRole('button', { name: '添加角色' })).toHaveProperty('disabled', false);
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'updated, {style}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0];
  expect(value.pinnedArtists).toEqual(['alpha']);
  expect(value.artists).toEqual(initial.artists);
  expect(value.candidates).toEqual(initial.candidates);
  expect(value.rules).toEqual(initial.rules);
  expect(value.template.prompt).toBe('updated, {style}');
});

it('保存失败保留输入和窗口，缺少画风占位时不投递', async () => {
  const save = vi.fn(async () => { throw new Error('合成保存失败'); }), close = vi.fn();
  render(<StyleRollSetup initial={rollFixture()} enforceFreeStepLimit onSave={save} onClose={close} />);
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'keep draft, {style}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await screen.findByText('合成保存失败');
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', 'keep draft, {style}');
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'missing placeholder' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByRole('alert');
  expect(save).toHaveBeenCalledOnce();
});

it('打开并保存历史默认记录时保留原模板，不自动套用新版推荐', async () => {
  const initial = rollFixture(); initial.artists = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  const save = vi.fn(async (_value: RollExperiment) => {});
  const originalTemplate = structuredClone(initial.template);
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', originalTemplate.prompt);
  expect(roleFields()).toHaveLength(0);
  expect(screen.getByRole('button', { name: '添加角色' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '负面提示词' })).toHaveProperty('value', '');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template).toEqual(originalTemplate);
  expect(initial.template).toEqual(originalTemplate);
});

it('角色提示词独立于公共提示词保存', async () => {
  const initial = rollFixture(); initial.artists = []; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  addRole('miku, twintails');
  expect(roleFields()[0]).toHaveProperty('value', 'miku, twintails');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template.characters?.[0].prompt).toBe('miku, twintails');
  expect(save.mock.calls[0][0].template.characterPrompt).toBeUndefined();
  expect(save.mock.calls[0][0].template.prompt).not.toContain('miku');
});

type RoleFixture = { id: string; prompt: string; negativePrompt: string; x: number; y: number };
const legacyTemplateCases: [string, string | undefined, RoleFixture[], RoleFixture[]][] = [
  ['用户已有角色文本', 'custom role', [], []],
  ['显式清空角色文本', '', [], []],
  ['结构化参数角色', undefined, [{ id: 'existing', prompt: 'structured role', negativePrompt: 'bad role', x: 0.5, y: 0.5 }], []],
  ['新编辑器角色', undefined, [], [{ id: 'existing', prompt: 'structured role', negativePrompt: 'bad role', x: 0.5, y: 0.5 }]],
];
it.each(legacyTemplateCases)('打开旧默认模板不覆盖%s', async (_label, characterPrompt, paramCharacters, templateCharacters) => {
  const initial = rollFixture(); initial.artists = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  if (characterPrompt !== undefined) initial.template.characterPrompt = characterPrompt;
  initial.template.params.characters = [...paramCharacters];
  if (templateCharacters.length) initial.template.characters = [...templateCharacters];
  const originalTemplate = structuredClone(initial.template);
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', originalTemplate.prompt);
  if (templateCharacters.length) {
    expect(roleFields()[0]).toHaveProperty('value', 'structured role');
    expect(roleFields('选填')[0]).toHaveProperty('value', 'bad role');
  } else if (characterPrompt) {
    expect(roleFields()[0]).toHaveProperty('value', characterPrompt);
  } else {
    expect(roleFields()).toHaveLength(0);
    if (paramCharacters.length) expect(screen.queryByText(/保留 1 个角色的完整提示词与位置/)).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const saved = save.mock.calls[0][0].template;
  if (characterPrompt) {
    expect(saved.characters?.[0]?.prompt).toBe(characterPrompt);
    expect(saved.characterPrompt).toBeUndefined();
  } else {
    expect(saved).toEqual(originalTemplate);
  }
  expect(initial.template).toEqual(originalTemplate);
});

/** 预设里的角色与实验室同构：template.characters 存正负词与位置，params.characters 保留参数快照。 */
const presetRole = (id: string) => ({ id: 'character', prompt: id, negativePrompt: 'bad', x: 0.2, y: 0.8 });
const presetFixture = (id: string, seed: number): RollPreset => ({
  id, name: id, revision: 2, createdAt: 1, updatedAt: 2,
  template: {
    ...structuredClone(rollFixture().template), prompt: `${id}, {style}`, negativePrompt: `negative ${id}`, characterPrompt: `character ${id}`,
    characters: [presetRole(id)],
    params: { ...rollFixture().template.params, seed, scale: seed / 10, characters: [presetRole(id)] },
  },
});
const presetSetup = async (initial = rollFixture()) => {
  const save = vi.fn(async (_value: RollExperiment) => {}), close = vi.fn();
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onSave={save} onClose={close} />);
  await waitFor(() => expect(loadRollPresets).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  return { save, close };
};
const choosePreset = (id: string) => fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: id } });
const namePreset = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value } });

it('套用推荐配置后可另存角色词已自定义的完整预设', async () => {
  await presetSetup();
  choosePreset('recommended');
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', DEFAULT_ROLL_PROMPT);
  addRole('custom role, blue hair');
  namePreset('role copy');
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await waitFor(() => expect(saveRollPreset).toHaveBeenCalledOnce());
  expect(vi.mocked(saveRollPreset).mock.calls[0][0].template).toMatchObject({ prompt: DEFAULT_ROLL_PROMPT, characters: [expect.objectContaining({ prompt: 'custom role, blue hair' })] });
});

it('旧默认记录只有主动选推荐才更新草稿，切换自定义预设仍原样取用', async () => {
  const initial = rollFixture(); initial.candidates = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  const preset = presetFixture('custom', 42), originalPreset = structuredClone(preset), originalTemplate = structuredClone(initial.template);
  vi.mocked(loadRollPresets).mockResolvedValue([preset]);
  const { save } = await presetSetup(initial);
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', originalTemplate.prompt);
  expect(roleFields()).toHaveLength(0);
  choosePreset('recommended');
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', DEFAULT_ROLL_PROMPT);
  choosePreset('custom');
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', preset.template.prompt);
  expect(roleFields()[0]).toHaveProperty('value', preset.template.characters![0].prompt);
  expect(initial.template).toEqual(originalTemplate); expect(preset).toEqual(originalPreset);
  expect(save).not.toHaveBeenCalled(); expect(saveRollPreset).not.toHaveBeenCalled(); expect(deleteRollPreset).not.toHaveBeenCalled();
});

it('两套预设完整套用正负词、角色和参数，另存快照不改源或记录，保存后可再切换', async () => {
  const presets = [presetFixture('first', 42), presetFixture('second', 88)], original = structuredClone(presets);
  vi.mocked(loadRollPresets).mockResolvedValue(presets);
  const initial = rollFixture(), originalInitial = structuredClone(initial);
  const { save } = await presetSetup(initial);
  for (const preset of presets) {
    choosePreset(preset.id);
    expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', preset.template.prompt);
    expect(roleFields()[0]).toHaveProperty('value', preset.template.characters![0].prompt);
    expect(roleFields('选填')[0]).toHaveProperty('value', preset.template.characters![0].negativePrompt);
    namePreset(preset.name + ' copy');
    fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
    await waitFor(() => expect(saveRollPreset).toHaveBeenLastCalledWith(expect.objectContaining({ name: preset.name + ' copy', template: preset.template, revision: 0 })));
    await waitFor(() => expect((screen.getByRole('button', { name: '另存新预设' }) as HTMLButtonElement).disabled).toBe(false));
    const submitted = vi.mocked(saveRollPreset).mock.calls.at(-1)![0];
    expect(submitted.template).not.toBe(preset.template); expect(submitted.template.params).not.toBe(preset.template.params);
  }
  expect(save).not.toHaveBeenCalled(); expect(initial).toEqual(originalInitial); expect(presets).toEqual(original);
  choosePreset('first');
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'manually edited, {style}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template).toEqual({ ...presets[0].template, prompt: 'manually edited, {style}' });
  expect(presets).toEqual(original);
});

it('预设读取失败明确重试且不覆盖已手写配置，写入失败保留输入和选择可重试', async () => {
  vi.mocked(loadRollPresets).mockRejectedValueOnce(new Error('合成读取失败'));
  const { save } = await presetSetup();
  expect(screen.getByRole('alert').textContent).toContain('合成读取失败');
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', false);
  choosePreset('recommended');
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).prompt);
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'handwritten, {style}' } });
  vi.mocked(loadRollPresets).mockResolvedValue([presetFixture('first', 42)]);
  fireEvent.click(screen.getByRole('button', { name: '重新读取预设' }));
  await screen.findByRole('option', { name: 'first' });
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', 'handwritten, {style}');
  namePreset('my preset');
  vi.mocked(saveRollPreset).mockRejectedValueOnce(new Error('合成写入失败'));
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await screen.findByText('合成写入失败');
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('value', 'my preset');
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('value', 'recommended');
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await screen.findByRole('option', { name: 'my preset' });
  expect(save).not.toHaveBeenCalled();
});

it('预设保存在途统一锁定可编辑模板，失败后恢复且不覆盖原记录保存忙态', async () => {
  const { save, close } = await presetSetup();
  namePreset('deferred'); let reject!: (reason: Error) => void;
  vi.mocked(saveRollPreset).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('combobox', { name: '负面提示词' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '保存配置' })).toHaveProperty('disabled', true);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  await act(async () => reject(new Error('合成延迟失败')));
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('disabled', false);
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('value', 'deferred');
});

it('更新和删除先确认，失败保留原选项与输入，成功删除不改当前模板', async () => {
  const preset = presetFixture('first', 42); vi.mocked(loadRollPresets).mockResolvedValue([preset]);
  const { save } = await presetSetup(); choosePreset('first'); namePreset('renamed');
  mocks.confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '更新当前预设' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalled()); expect(saveRollPreset).not.toHaveBeenCalled();
  vi.mocked(saveRollPreset).mockRejectedValueOnce(new Error('合成更新失败'));
  fireEvent.click(screen.getByRole('button', { name: '更新当前预设' }));
  await screen.findByText('合成更新失败'); expect(screen.getByRole('option', { name: 'first' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('value', 'renamed');
  fireEvent.click(screen.getByRole('button', { name: '更新当前预设' }));
  await screen.findByRole('option', { name: 'renamed' });
  expect(saveRollPreset).toHaveBeenLastCalledWith(expect.objectContaining({ id: preset.id, revision: preset.revision, template: preset.template }));
  mocks.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getByRole('button', { name: '删除当前预设' }));
  await act(async () => {}); expect(deleteRollPreset).not.toHaveBeenCalled();
  vi.mocked(deleteRollPreset).mockRejectedValueOnce(new Error('合成删除失败'));
  fireEvent.click(screen.getByRole('button', { name: '删除当前预设' })); await screen.findByText('合成删除失败');
  expect(screen.getByRole('option', { name: 'renamed' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '删除当前预设' }));
  await waitFor(() => expect(screen.queryByRole('option', { name: 'renamed' })).toBeNull());
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', preset.template.prompt);
  expect(save).not.toHaveBeenCalled();
});

it('已有候选仍可套用预设并另存完整配置，在途预设保存不触发记录保存或退出', async () => {
  const initial = rollFixture(); initial.candidates = [candidateFixture('frozen')];
  const { save, close } = await presetSetup(initial);
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', false);
  expect(screen.getByRole('button', { name: '更新当前预设' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '删除当前预设' })).toHaveProperty('disabled', true);
  namePreset('frozen copy'); let finish!: (value: RollPreset) => void;
  vi.mocked(saveRollPreset).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  expect(screen.getByRole('button', { name: '保存配置' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); fireEvent.keyDown(window, { key: 'Escape' });
  expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  const snapshot = vi.mocked(saveRollPreset).mock.calls[0][0]; expect(snapshot.template).toEqual(initial.template);
  await act(async () => finish({ ...snapshot, revision: 1 }));
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', false);
  expect(screen.getByRole('button', { name: '保存配置' })).toHaveProperty('disabled', false);
});

it('配置隐藏释放弹窗层，返回保留草稿', () => {
  const props = { initial: rollFixture(), enforceFreeStepLimit: true, onSave: vi.fn(async () => {}), onClose: vi.fn() };
  const view = render(<ImageActivityProvider active><StyleRollSetup {...props} /></ImageActivityProvider>);
  fireEvent.change(screen.getByRole('combobox', { name: '公共提示词' }), { target: { value: 'draft kept, {style}' } });
  view.rerender(<ImageActivityProvider active={false}><StyleRollSetup {...props} /></ImageActivityProvider>);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<ImageActivityProvider active><StyleRollSetup {...props} /></ImageActivityProvider>);
  expect(screen.getByRole('dialog', { name: '提示词与生成设置' })).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', 'draft kept, {style}');
});
