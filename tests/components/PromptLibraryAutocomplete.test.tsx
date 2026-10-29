// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TagAutocompleteTextarea } from '../../components/TagAutocompleteTextarea';
import { PromptLibraryContext, PromptLibraryWorkspace } from '../../components/PromptLibraryAccess';
import { createCombinationData, createFragmentData } from '../../services/promptLibraryEntries';
import type { PromptLibraryWorkspaceState } from '../../services/promptLibraryApply';
import { LAB_DEFAULT_PARAMS } from '../../services/labWorkspace';
import type { PromptChain } from '../../types';
import * as tagTranslations from '../../services/tagTranslations';

const mocks = vi.hoisted(() => ({ search: vi.fn(), catalog: vi.fn(), translations: vi.fn() }));
vi.mock('../../services/tagDictionary', () => ({ normalizeTagQuery: (s: string) => s.trim().toLowerCase(), lookupTagCatalogEntries: mocks.catalog, lookupTagTranslations: mocks.translations, preloadTagDictionary: vi.fn(), searchTagDictionary: mocks.search }));
const entries = [1, 2].map(id => ({ ...createFragmentData(`library text ${id}`, 'master outfit', 'wardrobe'), id: String(id) } as PromptChain));
function Harness() {
  const [value, setValue] = useState('');
  return <PromptLibraryContext.Provider value={{ chains: entries, save: vi.fn() }}><TagAutocompleteTextarea aria-label="Prompt" value={value} onValueChange={setValue} showTranslations={false} /></PromptLibraryContext.Provider>;
}
beforeEach(() => {
  mocks.search.mockReset(); mocks.search.mockResolvedValue([{ name: 'masterpiece', chinese: '杰作', category: 0, categoryLabel: '普通', postCount: 1, isNovelAI: false }]);
  mocks.catalog.mockReset().mockResolvedValue(new Map()); mocks.translations.mockReset().mockResolvedValue(new Map());
  vi.spyOn(tagTranslations, 'resolvePromptTranslations').mockImplementation(async tokens => tokens.map(token => ({ ...token, source: 'missing' as const })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const type = (value: string) => { const input = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement; fireEvent.change(input, { target: { value } }); input.setSelectionRange(value.length, value.length); fireEvent.click(input); return input; };

const softGlow = { id: 'soft-glow', ...createFragmentData('soft glow', '柔光片段', 'wardrobe') } as PromptChain;
const negativeDress = { id: 'negative-dress', ...createFragmentData('white dress', '白裙片段', 'wardrobe', 'red dress') } as PromptChain;
const rainyDress = { id: 'rainy-dress', ...createCombinationData('雨夜白裙', {
  wardrobe: { kind: 'wardrobe', scope: 'character', filled: true, text: 'white dress', negative: 'red dress' },
  scene: { kind: 'scene', scope: 'global', filled: true, text: 'rainy night', negative: 'daylight' },
}) } as PromptChain;

function LibraryWorkspaceHarness({ initial = '', chains = [softGlow, negativeDress, rainyDress], field = {}, classified = false, onWorkspaceChange }: {
  initial?: string; chains?: PromptChain[]; field?: { negative?: boolean; roleId?: string }; classified?: boolean;
  onWorkspaceChange?: (state: PromptLibraryWorkspaceState) => void;
}) {
  const [state, setState] = useState<PromptLibraryWorkspaceState>(() => ({ params: { ...LAB_DEFAULT_PARAMS, characters: [] }, base: field.negative ? '' : initial, subject: '', negative: field.negative ? initial : '', classified }));
  const negative = !!field.negative;
  return <PromptLibraryContext.Provider value={{ chains, save: vi.fn() }}>
    <PromptLibraryWorkspace state={state} onChange={next => { onWorkspaceChange?.(next); setState(next); }}>
      <TagAutocompleteTextarea aria-label={negative ? 'Negative' : 'Prompt'} libraryField={field} value={negative ? state.negative : state.base}
        onValueChange={text => setState(previous => ({ ...previous, [negative ? 'negative' : 'base']: text }))} showTranslations />
    </PromptLibraryWorkspace>
  </PromptLibraryContext.Provider>;
}

const chooseLibraryEntry = async (name: string) => {
  const option = await screen.findByRole('option', { name: new RegExp(name) });
  fireEvent.click(option);
};

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

it.each(['prompt', 'translation-edit', 'translation-insert'] as const)('@Tag 片段补全在 %s 中复用同一候选并保留完整草稿', async mode => {
  const initial = mode === 'translation-edit' ? 'before, old' : mode === 'translation-insert' ? 'before' : '';
  render(<LibraryWorkspaceHarness initial={initial} chains={[softGlow]} />);
  let textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
  if (mode === 'prompt') {
    textarea = type('before, @柔光');
  } else {
    if (mode === 'translation-edit') fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('old'));
    else fireEvent.click(screen.getByRole('button', { name: '在末尾插入提示词' }));
    const editor = screen.getByRole('combobox', { name: mode === 'translation-edit' ? '修改提示词' : '添加提示词' });
    fireEvent.change(editor, { target: { value: 'keep, @柔光' } });
  }
  await chooseLibraryEntry('柔光片段');
  if (mode === 'prompt') {
    expect(textarea.value).toBe('before, soft glow');
  } else {
    expect(textarea.value).toBe(initial);
    const editor = screen.getByRole('combobox', { name: mode === 'translation-edit' ? '修改提示词' : '添加提示词' });
    expect((editor as HTMLTextAreaElement).value).toBe('keep, soft glow');
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(textarea.value).toBe('before, keep, soft glow'));
  }
});

it('翻译区负面 Tag 编辑可按 @ 名称找到片段并写入负面正文', async () => {
  render(<LibraryWorkspaceHarness initial="bad anatomy" field={{ negative: true }} chains={[negativeDress]} />);
  const textarea = screen.getByRole('combobox', { name: 'Negative' }) as HTMLTextAreaElement;
  fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('bad anatomy'));
  const editor = screen.getByRole('combobox', { name: '修改提示词' });
  fireEvent.change(editor, { target: { value: '@白裙' } });
  await chooseLibraryEntry('白裙片段');
  expect((editor as HTMLTextAreaElement).value).toBe('red dress');
  fireEvent.keyDown(editor, { key: 'Enter' });
  await waitFor(() => expect(textarea.value).toBe('red dress'));
});

it('翻译区正面编辑遇到带负面词的片段先提交 @ 草稿并打开完整取用窗口', async () => {
  const applied: PromptLibraryWorkspaceState[] = [];
  render(<LibraryWorkspaceHarness initial="before, old" chains={[negativeDress]} onWorkspaceChange={state => applied.push(state)} />);
  const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
  fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('old'));
  const editor = screen.getByRole('combobox', { name: '修改提示词' });
  fireEvent.change(editor, { target: { value: 'keep, @白裙' } });
  await chooseLibraryEntry('白裙片段');
  await screen.findByRole('dialog', { name: '使用提示词' });
  await waitFor(() => expect(textarea.value).toBe('before, keep, @白裙'));
  expect(applied).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(textarea.value).toBe('before, keep, @白裙');
  expect(applied).toHaveLength(0);
});

it('翻译区 @ 片段补全保留原 Tag 的权重包装', async () => {
  render(<LibraryWorkspaceHarness initial="2::{old}::, tail" chains={[softGlow]} />);
  const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
  const zone = within(screen.getByLabelText('提示词中文翻译'));
  fireEvent.doubleClick(zone.getByText('old'));
  const editor = screen.getByRole('combobox', { name: '修改提示词' });
    fireEvent.change(editor, { target: { value: '@柔光' } });
  await chooseLibraryEntry('柔光片段');
  fireEvent.keyDown(editor, { key: 'Enter' });
  await waitFor(() => expect(textarea.value).toBe('2::{soft glow}::, tail'));
});

it('翻译区编辑带 artist 前缀的词仍只查画师 Tag，不混入同名个人片段', async () => {
  render(<LibraryWorkspaceHarness initial="artist:old" chains={entries} />);
  fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('old'));
  fireEvent.change(screen.getByRole('combobox', { name: '修改提示词' }), { target: { value: 'mas' } });
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  expect(screen.getByRole('option').textContent).toContain('masterpiece');
  expect(screen.queryByText('我的提示词')).toBeNull();
});

it.each(['translation-edit', 'translation-insert'] as const)('@组合在翻译区%s中先提交完整草稿，取消不应用，确认后展开全局与角色正负内容', async mode => {
  const applied: PromptLibraryWorkspaceState[] = [];
  const initial = mode === 'translation-edit' ? 'before, old' : 'before';
  render(<LibraryWorkspaceHarness initial={initial} chains={[rainyDress]} onWorkspaceChange={state => applied.push(state)} />);
  const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
  const startChooser = async (first: boolean) => {
    const zone = within(screen.getByLabelText('提示词中文翻译'));
    if (mode === 'translation-edit' || !first) fireEvent.doubleClick(zone.getByText(first ? 'old' : '@雨夜'));
    else fireEvent.click(screen.getByRole('button', { name: '在末尾插入提示词' }));
    const editor = screen.getByRole('combobox', { name: mode === 'translation-insert' && first ? '添加提示词' : '修改提示词' });
    fireEvent.change(editor, { target: { value: 'keep, @雨夜' } });
    await chooseLibraryEntry('雨夜白裙');
    await screen.findByRole('dialog', { name: '使用提示词' });
  };

  await startChooser(true);
  await waitFor(() => expect(textarea.value).toBe('before, keep, @雨夜'));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(textarea.value).toBe('before, keep, @雨夜');
  expect(applied).toHaveLength(0);

  await startChooser(false);
  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  await waitFor(() => expect(applied).toHaveLength(1));
  const result = applied[0];
  expect(result.base).toContain('before, keep');
  expect(result.base).toContain('rainy night');
  expect(result.base).not.toContain('@雨夜');
  expect(result.negative).toContain('daylight');
  expect(result.params.characters).toHaveLength(1);
  expect(result.params.characters![0].prompt).toContain('white dress');
  expect(result.params.characters![0].negativePrompt).toContain('red dress');
});

it('编辑草稿首尾空白时仍按中间 @ 组合查询范围取用，并保留后方正文', async () => {
  const applied: PromptLibraryWorkspaceState[] = [];
  render(<LibraryWorkspaceHarness initial="before, old, beta" chains={[rainyDress]} onWorkspaceChange={state => applied.push(state)} />);
  const textarea = screen.getByRole('combobox', { name: 'Prompt' }) as HTMLTextAreaElement;
  fireEvent.doubleClick(within(screen.getByLabelText('提示词中文翻译')).getByText('old'));
  const editor = screen.getByRole('combobox', { name: '修改提示词' }) as HTMLTextAreaElement;
  await waitFor(() => expect(document.activeElement).toBe(editor));
  const draft = '  keep, @雨夜, tail  ';
  fireEvent.change(editor, { target: { value: draft } });
  editor.setSelectionRange(draft.indexOf(', tail'), draft.indexOf(', tail'));
  fireEvent.click(editor);
  await chooseLibraryEntry('雨夜白裙');
  await screen.findByRole('dialog', { name: '使用提示词' });
  await waitFor(() => expect(textarea.value).toBe('before, keep, @雨夜, tail, beta'));

  fireEvent.click(screen.getByRole('button', { name: '使用' }));
  await waitFor(() => expect(applied).toHaveLength(1));
  expect(applied[0].base).toContain('before');
  expect(applied[0].base).toContain('keep');
  expect(applied[0].base).toContain('rainy night');
  expect(applied[0].base).toContain('tail');
  expect(applied[0].base).toContain('beta');
  expect(applied[0].base).not.toContain('@雨夜');
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
