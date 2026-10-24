// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StyleRollSetup } from '../../components/roll/StyleRollSetup';
import { ArtistSampleSettingsDialog } from '../../components/ArtistSampleSettingsDialog';
import { rollFixture } from '../fixtures/styleRoll';
import { createDefaultRollTemplate, type RollPreset } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';

const state = vi.hoisted(() => ({ presets: new Map<string, any>(), templates: {} as Record<string, any>, generate: vi.fn(), preview: vi.fn() }));
vi.mock('../../services/styleRollApi', async original => ({
  ...await original<typeof import('../../services/styleRollApi')>(),
  loadRollPresets: async () => structuredClone([...state.presets.values()]),
  saveRollPreset: async (value: RollPreset) => {
    const old = state.presets.get(value.id);
    if ((old?.revision || 0) !== value.revision) throw new Error('合成版本冲突');
    const saved = structuredClone({ ...value, revision: value.revision + 1 }); state.presets.set(saved.id, saved); return structuredClone(saved);
  },
  deleteRollPreset: async (value: RollPreset) => { state.presets.delete(value.id); },
}));
vi.mock('../../services/artistSampleDrafts', async original => ({
  ...await original<typeof import('../../services/artistSampleDrafts')>(),
  getArtistSampleData: async () => ({ templates: structuredClone(state.templates), samples: [] }),
  saveArtistSampleTemplate: async (pack: string, template: unknown) => { state.templates[pack] = structuredClone(template); },
  prepareArtistSampleImport: state.preview,
}));
vi.mock('../../services/artistSampleGeneration', async original => ({ ...await original<typeof import('../../services/artistSampleGeneration')>(), beginArtistSampleGeneration: state.generate }));
vi.mock('../../services/naiRuntime', async original => ({ ...await original<typeof import('../../services/naiRuntime')>(),
  useNaiRuntime: () => DEFAULT_NAI_RUNTIME, getNaiRuntimeConfig: async () => DEFAULT_NAI_RUNTIME }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: () => null }));
vi.mock('../../components/PromptLibraryAccess', () => ({ PromptLibraryWorkspace: ({ children }: any) => children }));
vi.mock('../../components/TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, libraryField: _libraryField, showTranslations: _showTranslations, ...props }: any) =>
  <textarea role="combobox" {...props} value={value} onChange={event => onValueChange(event.target.value)} /> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('Roll与画师样张通过真实共用编辑器双向选择完整预设，后续预设变更不回写已保存快照', async () => {
  state.presets.clear(); state.templates = {}; state.generate.mockClear(); state.preview.mockClear();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const initial = rollFixture();
  initial.template = { ...createDefaultRollTemplate(DEFAULT_NAI_RUNTIME), characterPrompt: 'shared role', negativePrompt: 'shared negative',
    params: { ...createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, model: 'nai-diffusion-4-5-full', seed: 123, scale: 6,
      characters: [{ id: 'role', prompt: 'full character', negativePrompt: 'bad hands', x: .2, y: .8 }] } };
  const original = structuredClone(initial), rollSave = vi.fn(), rollClose = vi.fn();
  const roll = render(<StyleRollSetup initial={initial} onBlockedChange={async () => {}} enforceFreeStepLimit onSave={rollSave} onClose={rollClose} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  await waitFor(() => expect(screen.queryByText('正在读取生成预设…')).toBeNull());
  fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value: '来自Roll' } });
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await screen.findByRole('option', { name: '来自Roll' });
  const fromRoll = [...state.presets.values()][0] as RollPreset;
  expect(fromRoll.template).toEqual(initial.template);
  fireEvent.click(screen.getByRole('button', { name: '关闭' })); expect(rollClose).toHaveBeenCalledOnce(); roll.unmount();

  const sampleSave = vi.fn();
  const artist = render(<ArtistSampleSettingsDialog pack="v45" generateAfterSave={false} onSaved={sampleSave} onClose={() => {}} />);
  await screen.findByRole('option', { name: '来自Roll' });
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: fromRoll.id } });
  expect(screen.getByRole('combobox', { name: '角色提示词（可选）' })).toHaveProperty('value', 'shared role');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(sampleSave).toHaveBeenCalledWith(initial.template));
  const savedSample = structuredClone(state.templates.v45);
  fireEvent.change(screen.getByRole('combobox', { name: '角色提示词（可选）' }), { target: { value: 'artist edited role' } });
  fireEvent.click(screen.getByRole('button', { name: '更新当前预设' }));
  await waitFor(() => expect(state.presets.get(fromRoll.id).revision).toBe(2));
  expect(state.templates.v45).toEqual(savedSample);
  fireEvent.change(screen.getByRole('textbox', { name: '预设名称' }), { target: { value: '来自画师库' } });
  fireEvent.click(screen.getByRole('button', { name: '另存新预设' }));
  await screen.findByRole('option', { name: '来自画师库' }); artist.unmount();
  const fromArtist = [...state.presets.values()].find(preset => preset.name === '来自画师库') as RollPreset;

  render(<StyleRollSetup initial={initial} onBlockedChange={async () => {}} enforceFreeStepLimit onSave={rollSave} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' })); await screen.findByRole('option', { name: '来自画师库' });
  fireEvent.change(screen.getByRole('combobox', { name: '生成配置预设' }), { target: { value: fromArtist.id } });
  expect(rollSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(rollSave).toHaveBeenCalledOnce());
  expect(rollSave.mock.calls[0][0].template).toEqual(fromArtist.template);
  expect(rollSave.mock.calls[0][0].template.params).toEqual(initial.template.params);
  expect(initial).toEqual(original);
  expect(state.templates.v45).toEqual(savedSample);
  expect(state.generate).not.toHaveBeenCalled(); expect(state.preview).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
