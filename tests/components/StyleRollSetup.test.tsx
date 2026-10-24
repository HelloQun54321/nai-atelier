// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rollFixture, candidateFixture } from '../fixtures/styleRoll';
import { StyleRollSetup } from '../../components/roll/StyleRollSetup';
import { createDefaultRollTemplate, DEFAULT_ROLL_CHARACTER_PROMPT, DEFAULT_ROLL_PROMPT, type RollExperiment, type RollPreset } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import { loadRollPresets, saveRollPreset, deleteRollPreset } from '../../services/styleRollApi';
const collection: any[] = [];
vi.mock('../../services/artistSampleUrls', () => ({ loadArtistSampleUrls: async () => new Map() }));
vi.mock('../../services/collectionFavorites', () => ({ collectionSnapshot: () => collection, subscribeCollection: () => () => {}, ensureCollection: async () => {}, toggleArtistPreference: vi.fn() }));
const mocks = vi.hoisted(() => ({ search: vi.fn(), confirm: vi.fn() }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => mocks.confirm }));
vi.mock('../../services/styleRollApi', () => ({ loadRollPresets: vi.fn(), saveRollPreset: vi.fn(), deleteRollPreset: vi.fn() }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(), useNaiRuntime: () => DEFAULT_NAI_RUNTIME }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), searchArtistDictionary: mocks.search }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: () => null }));

it('切换抽取与生成分区保留预设选择及未保存名称，不重复读取预设', async () => {
  const initial = rollFixture();
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onBlockedChange={async () => {}} onSave={async () => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: 'recommended' } });
  fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value: '未保存的名称' } });
  fireEvent.click(screen.getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('value', 'recommended');
  expect(screen.getByRole('textbox', { name: '预设名称' })).toHaveProperty('value', '未保存的名称');
  expect(loadRollPresets).toHaveBeenCalledOnce();
});
beforeEach(() => { vi.resetAllMocks(); mocks.search.mockResolvedValue([]); mocks.confirm.mockResolvedValue(true);
  vi.mocked(loadRollPresets).mockResolvedValue([]); vi.mocked(saveRollPreset).mockImplementation(async value => ({ ...value, revision: value.revision + 1 }));
  vi.mocked(deleteRollPreset).mockResolvedValue();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('不提供已有风格串导入；可套用推荐词后自定义并完整保存配置', async () => {
  const initial = rollFixture(); initial.revision = 0; initial.artists = [];
  initial.template.params.seed = 42;
  initial.template.params.characters = [{ id: 'r', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }];
  const originalParams = structuredClone(initial.template.params);
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect(screen.queryByRole('combobox', { name: '载入生成配置' })).toBeNull();
  await waitFor(() => expect((screen.getByRole('combobox', { name: '生成配置预设' }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: 'recommended' } });
  const prompt = screen.getByRole('combobox', { name: '公共提示词' });
  expect((prompt as HTMLTextAreaElement).value).toBe(DEFAULT_ROLL_PROMPT);
  expect((prompt as HTMLTextAreaElement).value).not.toContain('1girl');
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', DEFAULT_ROLL_CHARACTER_PROMPT);
  fireEvent.change(prompt, { target: { value: 'custom style, {style}, 1girl' } });
  fireEvent.change(screen.getByRole('combobox', { name: '角色提示词（可选）' }), { target: { value: 'miku, twintails' } });
  fireEvent.change(screen.getByRole('textbox', { name: '负面提示词' }), { target: { value: 'custom negative' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0];
  expect(value.template.prompt).toBe('custom style, {style}, 1girl');
  expect(value.template.negativePrompt).toBe('custom negative');
  expect(value.template.characterPrompt).toBe('miku, twintails');
  expect(value.template.params).toEqual(createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params);
  expect(initial.template.params).toEqual(originalParams);
});
it('已有候选冻结生成配置，画师锁定及排除仍可保存且不改旧候选', async () => {
  const initial = rollFixture(); initial.candidates = [candidateFixture('a')]; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByText('手动添加固定 Tag'));
  fireEvent.change(screen.getByRole('textbox', { name: '固定画师 Tag（可选）' }), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '添加到固定画师 Tag（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  fireEvent.change(screen.getByLabelText('最低权重'), { target: { value: '0.2' } });
  fireEvent.change(screen.getByLabelText('最高权重'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect((screen.getByRole('combobox', { name: '公共提示词' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0]; expect(value.pinnedArtists).toEqual(['alpha']); expect(value.artists).toEqual(initial.artists);
  expect(value.candidates).toEqual(initial.candidates); expect(value.template).toEqual(initial.template);
  expect(value.rules).toMatchObject({ minWeight: 0.2, maxWeight: 2.5 });
});
it('保存失败保留输入和窗口，空白 Seed 或无效规则不投递', async () => {
  const save = vi.fn(async () => { throw new Error('合成保存失败'); }), close = vi.fn();
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={rollFixture()} enforceFreeStepLimit onSave={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText('记录名称'), { target: { value: 'new name' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await screen.findByText('合成保存失败');
  expect(close).not.toHaveBeenCalled(); expect(screen.getByLabelText('记录名称')).toHaveProperty('value', 'new name');
  fireEvent.change(screen.getByLabelText('最少画师人数'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('请检查画师数量和权重范围'); expect(save).toHaveBeenCalledOnce();
});
it('新建配置使用总人数和可选固定 Tag，不再提供模式或权重锁', async () => {
  const initial = rollFixture(); initial.artists = [];
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /全随机|固定权重|选择固定画师/ })).toBeNull();
  fireEvent.change(screen.getByRole('spinbutton', { name: '最多画师人数' }), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: /管理画师与偏好/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Roll 画师' })).getByRole('button', { name: '抽取设置' }));
  fireEvent.click(screen.getByText('手动添加固定 Tag'));
  fireEvent.change(screen.getByRole('textbox', { name: '固定画师 Tag（可选）' }), { target: { value: 'alpha, beta' } });
  fireEvent.click(screen.getByRole('button', { name: '添加到固定画师 Tag（可选）' }));
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  fireEvent.change(screen.getByLabelText('最低权重'), { target: { value: '1.3' } });
  fireEvent.change(screen.getByLabelText('最高权重'), { target: { value: '1.3' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].pinnedArtists).toEqual(['alpha', 'beta']);
  expect(save.mock.calls[0][0].drawPlan).toBeUndefined();
  expect(save.mock.calls[0][0].rules).toEqual({ minArtists: 4, maxArtists: 5, minWeight: 1.3, maxWeight: 1.3 });
});

it('打开仍有历史默认模板的记录时自动换成质量词模板并提示', async () => {
  const initial = rollFixture(); initial.artists = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  const save = vi.fn(async (_value: RollExperiment) => {});
  const originalParams = structuredClone(initial.template.params);
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect(screen.getByText('已把旧的默认提示词换成质量词模板，保存后生效。')).toBeTruthy();
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', DEFAULT_ROLL_PROMPT);
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', DEFAULT_ROLL_CHARACTER_PROMPT);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template.prompt).toBe(DEFAULT_ROLL_PROMPT);
  expect(save.mock.calls[0][0].template.characterPrompt).toBe(DEFAULT_ROLL_CHARACTER_PROMPT);
  expect(save.mock.calls[0][0].template.params).toEqual(originalParams);
  expect(initial.template.params).toEqual(originalParams);
});

it('角色提示词独立于公共提示词保存', async () => {
  const initial = rollFixture(); initial.artists = []; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  fireEvent.change(screen.getByRole('combobox', { name: '角色提示词（可选）' }), { target: { value: 'miku, twintails' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template.characterPrompt).toBe('miku, twintails');
  expect(save.mock.calls[0][0].template.prompt).not.toContain('miku');
});

it.each([
  ['用户已有角色文本', 'custom role', []],
  ['显式清空角色文本', '', []],
  ['结构化角色', undefined, [{ id: 'existing', prompt: 'structured role', negativePrompt: 'bad role', x: 0.5, y: 0.5 }]],
] as const)('旧默认模板升级时不覆盖%s', async (_label, characterPrompt, characters) => {
  const initial = rollFixture(); initial.artists = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  if (characterPrompt !== undefined) initial.template.characterPrompt = characterPrompt;
  initial.template.params.characters = [...characters];
  const originalTemplate = structuredClone(initial.template);
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect(screen.queryByText('已把旧的默认提示词换成质量词模板，保存后生效。')).toBeNull();
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', originalTemplate.prompt);
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', characterPrompt ?? '');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].template).toEqual(originalTemplate);
  expect(initial.template).toEqual(originalTemplate);
});

it('套用推荐配置后可另存角色词已自定义的完整预设', async () => {
  await presetSetup();
  choosePreset('recommended');
  expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', DEFAULT_ROLL_PROMPT);
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', DEFAULT_ROLL_CHARACTER_PROMPT);
  fireEvent.change(screen.getByRole('combobox', { name: '角色提示词（可选）' }), { target: { value: 'custom role, blue hair' } });
  namePreset('role copy');
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await waitFor(() => expect(saveRollPreset).toHaveBeenCalledOnce());
  expect(vi.mocked(saveRollPreset).mock.calls[0][0].template).toMatchObject({ prompt: DEFAULT_ROLL_PROMPT, characterPrompt: 'custom role, blue hair' });
});

it('默认只需设置抽取数量，无需建画师池或从旧画师表导入', async () => {
  const initial = rollFixture(); initial.artists = []; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup library={rollFixture().artists.map(artist => ({ name: artist.tag, chinese: '', postCount: 1 }))} onBlockedChange={async () => {}} initial={initial} libraryCount={1205} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.getByText('从画师库自动抽取 · 1205 位画师')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '从已保存画师添加' })).toBeNull();
  fireEvent.change(screen.getByLabelText('最少画师人数'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].artists).toEqual([]); expect(save.mock.calls[0][0].rules).toMatchObject({ minArtists: 4, maxArtists: 4 });
});

const presetFixture = (id: string, seed: number): RollPreset => ({ id, name: id, revision: 2, createdAt: 1, updatedAt: 2,
  template: { ...structuredClone(rollFixture().template), prompt: `${id}, {style}`, negativePrompt: `negative ${id}`, characterPrompt: `character ${id}`,
    params: { ...rollFixture().template.params, seed, scale: seed / 10, characters: [{ id: 'character', prompt: id, negativePrompt: 'bad', x: 0.2, y: 0.8 }] } } });
const presetSetup = async (initial = rollFixture()) => {
  const save = vi.fn(async (_value: RollExperiment) => {}), close = vi.fn();
  render(<StyleRollSetup initial={initial} enforceFreeStepLimit onBlockedChange={async () => {}} onSave={save} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  await waitFor(() => expect(loadRollPresets).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('正在读取 Roll 预设…')).toBeNull());
  return { save, close };
};
const choosePreset = (id: string) => fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: id } });
const namePreset = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value } });

it('旧默认模板切换自定义预设后不再显示推荐升级提示', async () => {
  const initial = rollFixture(); initial.candidates = [];
  initial.template.prompt = '{style}, 1girl, solo, upper body, simple background, looking at viewer';
  initial.template.negativePrompt = '';
  vi.mocked(loadRollPresets).mockResolvedValue([presetFixture('custom', 42)]);
  await presetSetup(initial);
  expect(screen.getByText('已把旧的默认提示词换成质量词模板，保存后生效。')).toBeTruthy();
  choosePreset('custom');
  expect(screen.queryByText('已把旧的默认提示词换成质量词模板，保存后生效。')).toBeNull();
});

it('两套预设完整套用正负词、角色和参数，另存快照不改源或记录，保存后可再切换', async () => {
  const presets = [presetFixture('first', 42), presetFixture('second', 88)], original = structuredClone(presets);
  vi.mocked(loadRollPresets).mockResolvedValue(presets);
  const initial = rollFixture(), originalInitial = structuredClone(initial);
  const { save } = await presetSetup(initial);
  for (const preset of presets) {
    choosePreset(preset.id);
    expect(screen.getByRole('combobox', { name: '公共提示词' })).toHaveProperty('value', preset.template.prompt);
    expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', preset.template.characterPrompt);
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
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('textbox', { name: '负面提示词' })).toHaveProperty('disabled', true);
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

it('冻结记录不可套用预设但可另存完整配置，在途预设保存不触发记录保存或退出', async () => {
  const initial = rollFixture(); initial.candidates = [candidateFixture('frozen')];
  const { save, close } = await presetSetup(initial);
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', true);
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
  expect(screen.getByRole('combobox', { name: '生成配置预设' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '保存配置' })).toHaveProperty('disabled', false);
});
