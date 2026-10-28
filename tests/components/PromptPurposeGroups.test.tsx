// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs } from '../../components/chain/ChainEditorPromptInputs';
import { ChainEditorCharacters } from '../../components/chain/ChainEditorCharacters';
import { PromptPurposePicker } from '../../components/PromptPurposePicker';
import { PromptLibraryContext, PromptLibraryWorkspace } from '../../components/PromptLibraryAccess';
import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES } from '../../services/promptPurposes.mjs';
import { createCombinationData } from '../../services/promptLibraryEntries';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import type { PromptChain } from '../../types';
import { openPurposeGroup } from '../support/promptPurposeGroups';

vi.mock('../../components/chain/CharacterTaggerReference', () => ({ CharacterTaggerReference: () => null }));
afterEach(cleanup);

const entries = [
  { id: 'dress', name: '白裙预设', type: 'preset', basePrompt: '1.2::white dress::', negativePrompt: 'coat', params: { _promptLibraryDirectoryIds: ['anything'], _promptLibraryPurposes: ['clothing'] } },
  { id: 'mixed', name: '混合片段', type: 'preset', basePrompt: 'dress, smiling', params: { _promptLibraryDirectoryIds: ['anything'], _promptLibraryPurposes: ['clothing', 'expression'] } },
  { id: 'light', name: '灯光预设', type: 'preset', basePrompt: 'backlight', params: { _promptLibraryDirectoryIds: ['anything'], _promptLibraryPurposes: ['lighting'] } },
  { id: 'combo', ...createCombinationData('服饰组合预设', {
    'purpose:clothing': { kind: 'purpose:clothing', scope: 'global', filled: true, text: '1.2::white dress::', negative: 'coat' },
    'purpose:lighting': { kind: 'purpose:lighting', scope: 'global', filled: true, text: 'backlight' },
  }) },
] as PromptChain[];

function Harness({ target }: { target: 'global' | 'role' }) {
  const [state, setState] = useState<PromptLibraryWorkspaceState>({
    base: '', subject: '', negative: 'global negative', classified: true,
    params: { ...LAB_DEFAULT_PARAMS, seed: 42, characters: [
      { id: 'a', prompt: 'person a', negativePrompt: 'role negative', x: 0.3, y: 0.5 },
      { id: 'b', prompt: 'person b', x: 0.7, y: 0.5 },
    ] },
  });
  return <PromptLibraryContext.Provider value={{ chains: entries, directories: { revision: 1, nodes: [] }, save: vi.fn() }}>
    <PromptLibraryWorkspace state={state} onChange={setState}>
      {target === 'global' ? <ChainEditorPromptInputs promptClassificationEnabled prompt={state.base} setPrompt={base => setState(previous => ({ ...previous, base }))}
        sections={state.params._promptSections} supplementPrompt={state.subject}
        setSections={sections => setState(previous => ({ ...previous, params: { ...previous.params, _promptSections: sections } }))}
        setSupplementPrompt={subject => setState(previous => ({ ...previous, subject }))}
        presetSources={{}} tagAssistEnabled={false} canEdit copyPromptToClipboard={vi.fn()} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
        activeLabLayout={{ collapsed: {} }} mobileEditorTab="global" />
        : <ChainEditorCharacters promptClassificationEnabled params={state.params} characters={state.params.characters!.slice(0, 1)} canEdit tagAssistEnabled={false}
          setParams={params => setState(previous => ({ ...previous, params }))} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={vi.fn()}
          updateCharacter={(index, patch) => setState(previous => ({ ...previous, params: { ...previous.params, characters: previous.params.characters!.map((role, i) => i === index ? { ...role, ...patch } : role) } }))}
          addCharacter={vi.fn()} removeCharacter={vi.fn()} activeLabLayout={{ collapsed: {} }} mobileEditorTab="character" />}
      <output data-testid="draft">{JSON.stringify(state)}</output>
    </PromptLibraryWorkspace>
  </PromptLibraryContext.Provider>;
}
const draft = (): PromptLibraryWorkspaceState => JSON.parse(screen.getByTestId('draft').textContent!);

it.each([['global', 'fragment'], ['role', 'fragment'], ['global', 'combination'], ['role', 'combination']] as const)('%s 从空白小区取用 %s，只写当前用途和目标，折叠保留编辑与撤销', async (target, source) => {
  render(<Harness target={target} />);
  const before = structuredClone(draft());
  for (const group of PROMPT_PURPOSE_GROUPS) expect(screen.getByRole('button', { name: group.label }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('combobox', { name: '服饰与配件' })).toBeNull();
  openPurposeGroup('主体与外观');
  const field = within(screen.getByRole('group', { name: '服饰与配件' }));
  const input = field.getByRole('combobox', { name: '服饰与配件' }) as HTMLTextAreaElement;
  expect(input.value).toBe('');
  expect(field.queryByRole('combobox', { name: '添加提示词' })).toBeNull();
  const use = field.getByRole('button', { name: '使用提示词' });
  expect(field.getByText('服饰与配件').parentElement!.contains(use)).toBe(true);
  fireEvent.click(use);
  const dialog = await screen.findByRole('dialog', { name: '使用提示词' });
  expect(within(dialog).queryByRole('button', { name: /混合片段|灯光预设/ })).toBeNull();
  expect(within(dialog).queryByRole('combobox', { name: '取用目标' })).toBeNull();
  if (source === 'combination') fireEvent.click(within(dialog).getByRole('tab', { name: '组合' }));
  fireEvent.click(within(dialog).getByRole('button', { name: source === 'combination' ? /服饰组合预设/ : /白裙预设/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '使用' }));
  await waitFor(() => expect(input.value).toBe('1.2::white dress::'));
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  const after = draft();
  expect(after.params.seed).toBe(42);
  expect(after.negative).toBe(before.negative);
  expect(after.params.characters![1]).toEqual(before.params.characters![1]);
  if (target === 'global') {
    expect(after.params._promptSections).toMatchObject({ 'purpose:clothing': '1.2::white dress::', sectionNegatives: { 'purpose:clothing': 'coat' } });
    expect(after.params.characters).toEqual(before.params.characters);
  } else {
    expect(after.params.characters![0]).toMatchObject({ prompt: 'person a', negativePrompt: 'role negative', sections: { 'purpose:clothing': '1.2::white dress::' }, sectionNegatives: { 'purpose:clothing': 'coat' } });
    expect(after.subject).toBe(before.subject);
    expect(after.params._promptSections).toEqual(before.params._promptSections);
  }
  fireEvent.change(input, { target: { value: 'handwritten dress' } });
  fireEvent.click(field.getAllByRole('button', { name: '清空当前提示词' })[0]);
  fireEvent.click(screen.getByRole('button', { name: '主体与外观' }));
  openPurposeGroup('主体与外观');
  expect(field.getByRole('combobox', { name: '服饰与配件' })).toBe(input);
  fireEvent.click(field.getByRole('button', { name: '撤销清空' }));
  expect(input.value).toBe('handwritten dress');
});

it('用途选择的五组顺序一致，收起保留选择，所有 22 个用途都可进入', () => {
  const change = vi.fn();
  render(<PromptPurposePicker value={['clothing']} onChange={change} />);
  expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(PROMPT_PURPOSE_GROUPS.map(group => group.label));
  for (const group of PROMPT_PURPOSE_GROUPS) {
    openPurposeGroup(group.label);
    const section = screen.getByRole('button', { name: group.label }).closest('section')!;
    for (const id of group.purposes) expect(within(section).getByRole('button', { name: PROMPT_PURPOSES.find(item => item.id === id)!.label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: '动作与姿态' }));
  expect(change).toHaveBeenLastCalledWith(['clothing', 'pose']);
  fireEvent.click(screen.getByRole('button', { name: '主体与外观' }));
  openPurposeGroup('主体与外观');
  expect(screen.getByRole('button', { name: '服饰与配件' }).getAttribute('aria-pressed')).toBe('true');
});
