// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TagAutocompleteTextarea } from '../../components/TagAutocompleteTextarea';
import { PromptLibraryContext, PromptLibraryWorkspace } from '../../components/PromptLibraryAccess';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import type { PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptChain } from '../../types';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../services/tagDictionary', () => ({ normalizeTagQuery: (s: string) => s.trim().toLowerCase(), preloadTagDictionary: vi.fn(), searchTagDictionary: mocks.search }));
const entries = [1, 2].map(id => ({ ...createFragmentData(`library text ${id}`, 'master outfit', 'wardrobe'), id: String(id) } as PromptChain));
function Harness() {
  const [value, setValue] = useState('');
  return <PromptLibraryContext.Provider value={{ chains: entries, save: vi.fn() }}><TagAutocompleteTextarea aria-label="Prompt" value={value} onValueChange={setValue} showTranslations={false} /></PromptLibraryContext.Provider>;
}
beforeEach(() => { mocks.search.mockReset(); mocks.search.mockResolvedValue([{ name: 'masterpiece', chinese: '杰作', category: 0, categoryLabel: '普通', postCount: 1, isNovelAI: false }]); });
afterEach(cleanup);
const type = (value: string) => { const input = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement; fireEvent.change(input, { target: { value } }); input.setSelectionRange(value.length, value.length); fireEvent.click(input); return input; };

it('个人提示词在上、Tag 在下，共用一个浮层，保留同名记录及未选中 Enter/Tab', async () => {
  render(<Harness />); const input = type('mas');
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
  expect(screen.getAllByRole('listbox')).toHaveLength(1);
  const options = screen.getAllByRole('option');
  expect(options[0].textContent).toContain('library text 1'); expect(options[1].textContent).toContain('library text 2'); expect(options[2].textContent).toContain('masterpiece');
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
  fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true); expect(input.value).toBe('mas');
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input.value).toBe('library text 1');
});
it('@只查个人库，中文输入法确认不调用候选', async () => {
  render(<Harness />); const input = type('@mas'); await screen.findAllByRole('option');
  expect(mocks.search).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(input.value).toBe('@mas'); expect(screen.queryByRole('listbox')).toBeNull();
});
it('NAI 的 @_@ 与 artist: 保留 Tag 补全，不被个人库快捷写法抢走', async () => {
  render(<Harness />);
  type('@_@'); await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('@_@'));
  type('artist:mas'); await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  expect(screen.getByRole('option').textContent).toContain('masterpiece');
  expect(screen.queryByText('我的提示词')).toBeNull();
});
it('跨组方向键仍能选择 Tag，展开只替换当前名称而保留前后文字', async () => {
  render(<Harness />); const input = type('keep, mas, after'); input.setSelectionRange(9, 9); fireEvent.click(input);
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
  for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' }); expect(input.value).toBe('keep, masterpiece, after');
});

it('输入组合名称先预览，取消保留名称，确认后按角色和全局分别展开正负词', async () => {
  const combo = { id: 'combo', ...createCombinationData('雨夜白裙', { wardrobe: { kind: 'wardrobe', filled: true, text: 'white dress', negative: 'red dress' }, scene: { kind: 'scene', filled: true, text: 'rainy night', negative: 'daylight' } }) } as PromptChain;
  const changed = vi.fn();
  function CombinationHarness() {
    const [state, setState] = useState<PromptLibraryWorkspaceState>({ params: LAB_DEFAULT_PARAMS, base: '', subject: '', negative: '', classified: true });
    return <PromptLibraryContext.Provider value={{ chains: [combo], save: vi.fn() }}><PromptLibraryWorkspace state={state} onChange={next => { changed(next); setState(next); }}><TagAutocompleteTextarea aria-label="Prompt" value={state.base} onValueChange={base => setState(previous => ({ ...previous, base }))} showTranslations={false} /></PromptLibraryWorkspace></PromptLibraryContext.Provider>;
  }
  render(<CombinationHarness />);
  const choose = async () => {
    const input = type('keep, @雨夜');
    await screen.findByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('dialog', { name: '使用提示词' });
    return input;
  };
  const input = await choose();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(input.value).toBe('keep, @雨夜');
  await choose(); fireEvent.click(screen.getByRole('button', { name: '使用' }));
  expect(changed).toHaveBeenCalledOnce();
  expect(changed.mock.calls[0][0]).toMatchObject({ base: 'keep, ', subject: 'rainy night', params: { _promptSections: { scene: 'rainy night', sectionNegatives: { scene: 'daylight' } }, characters: [{ sections: { wardrobe: 'white dress' }, sectionNegatives: { wardrobe: 'red dress' } }] } });
  expect(input.value).toBe('keep, ');
});
