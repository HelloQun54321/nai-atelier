// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters, type ChainEditorCharactersProps } from '../../../components/chain/ChainEditorCharacters';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../../services/appearancePreferences';
import type { NAIParams, PromptChain } from '../../../types';
import * as PromptLibraryAccess from '../../../components/PromptLibraryAccess';
import { PromptLibraryContext } from '../../../components/PromptLibraryAccess';

const initial: NAIParams = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [
  { id: 'a', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.223, y: 0.887 },
  { id: 'b', prompt: 'red hair', negativePrompt: 'blue hair', x: 0.7, y: 0.3 },
] };
const mark = vi.fn();
type LibraryProps = Pick<ChainEditorCharactersProps, 'allChains' | 'chainsLoading' | 'chainsError' | 'onRetryChains' | 'showCharacterReference' | 'canSaveCharacter' | 'onSaveCharacter'>;
const Harness = ({ freeform = false, canEdit = true, model, initialParams = initial, onContentRollForRole, library = {}, tagAssistEnabled = false }: { freeform?: boolean; canEdit?: boolean; model?: string; initialParams?: NAIParams; onContentRollForRole?: (index: number) => void; library?: LibraryProps; tagAssistEnabled?: boolean }) => {
  const [params, setParams] = useState(initialParams);
  return <PromptLibraryContext.Provider value={{ chains: library.allChains ?? [], chainsLoading: library.chainsLoading, chainsError: library.chainsError, onRetryChains: library.onRetryChains, save: vi.fn() }}>
    <ChainEditorCharacters params={{ ...params, model }} setParams={setParams} characters={params.characters || []}
      canEdit={canEdit} onContentRollForRole={onContentRollForRole} tagAssistEnabled={tagAssistEnabled} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={mark}
      addCharacter={vi.fn()} removeCharacter={index => setParams(current => ({ ...current, characters: current.characters?.filter((_, i) => i !== index) }))}
      updateCharacter={(index, patch, useCoords) => { setParams(current => ({ ...current, ...(useCoords === undefined ? {} : { useCoords }), characters: current.characters?.map((character, i) => i === index ? { ...character, ...patch } : character) })); mark(); }}
      activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']} mobileEditorTab="character" freeformPosition={freeform} {...library} />
    <output data-testid="draft">{JSON.stringify(params)}</output>
  </PromptLibraryContext.Provider>;
};
const draft = (): NAIParams => JSON.parse(screen.getByTestId('draft').textContent!);
const selectCharacter = (name: string | RegExp) => {
  const button = screen.getAllByRole('button', { name }).find(node => node.hasAttribute('aria-pressed'));
  if (!button) throw new Error(`missing character switch ${String(name)}`);
  fireEvent.click(button);
};
const openLibrary = () => {
  fireEvent.click(screen.getByRole('button', { name: '从库取用' }));
};
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mark.mockClear(); });

describe('共用角色编辑器', () => {
  it('无角色时只留添加主操作，有角色后才出现次要构图组', () => {
    const empty = render(<Harness initialParams={{ ...initial, characters: [] }} />);
    expect(screen.getByRole('button', { name: '添加角色' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '角色构图' })).toBeNull();
    expect(screen.getByText('暂无角色，点击上方添加')).toBeTruthy();
    empty.unmount();
    render(<Harness />);
    expect(screen.getByRole('group', { name: '角色构图' })).toBeTruthy();
  });

  it('只有完整角色正负大块，旧用途与目录原文编译显示但打开不改写数据', () => {
    const role = { ...initial.characters![0], prompt: '1.3::blue hair::',
      sections: { wardrobe: 'blue dress', 'purpose:lighting': 'rim light', 'directory:old': 'tree' },
      sectionNegatives: { wardrobe: 'coat', 'purpose:lighting': 'dark', 'directory:old': 'bare' },
      sectionMeta: { 'directory:old': { directoryPath: ['旧目录', '原位置'], entryName: '旧条目' } } };
    const params = { ...initial, characters: [role, initial.characters![1]] };
    render(<Harness initialParams={params} />);
    expect(screen.getByText('角色专属提示词')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加角色' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '角色构图' }).contains(screen.getByRole('button', { name: '角色定位' }))).toBe(true);
    expect(screen.getByRole('group', { name: '角色构图' }).contains(screen.getByRole('button', { name: '自动构图' }))).toBe(true);
    // 左「角色构图」、右「角色槽位」同款芯片分行语义；添加不进构图组。
    expect(screen.getByRole('group', { name: '角色构图' }).contains(screen.getByRole('button', { name: '添加角色' }))).toBe(false);
    expect(screen.getByRole('group', { name: '角色槽位' }).contains(screen.getByRole('button', { name: '删除角色' }))).toBe(true);
    expect(screen.getByRole('group', { name: '角色槽位' }).contains(screen.getByRole('button', { name: '添加角色' }))).toBe(true);
    expect(screen.getByRole('button', { name: '删除角色' }).compareDocumentPosition(screen.getByRole('button', { name: '添加角色' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('group', { name: '角色切换' })).toBeTruthy();
    for (const name of ['角色定位', '自动构图', '删除角色', '添加角色']) {
      expect(screen.getByRole('button', { name }).className).toContain('h-11');
    }
    const positive = screen.getByPlaceholderText('角色提示词');
    const negative = screen.getByPlaceholderText('选填');
    expect(positive).toHaveProperty('value', 'blue dress, rim light, tree, 1.3::blue hair::');
    expect(negative).toHaveProperty('value', 'coat, dark, bare, red hair');
    expect(positive.compareDocumentPosition(negative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-prompt-purpose-group], [data-character-summary]')).toBeNull();
    expect(document.querySelectorAll('textarea')).toHaveLength(2);
    expect(draft()).toEqual(params); expect(mark).not.toHaveBeenCalled();
    fireEvent.change(positive, { target: { value: 'changed whole role' } });
    expect(draft().characters?.[0]).toMatchObject({ id: 'a', prompt: 'changed whole role', negativePrompt: 'coat, dark, bare, red hair', x: role.x, y: role.y });
    expect(draft().characters?.[0].sections).toBeUndefined();
    expect(draft().characters?.[0].sectionNegatives).toBeUndefined();
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
    selectCharacter(/角色 2/);
    expect(screen.getByPlaceholderText('角色提示词')).toHaveProperty('value', 'red hair');
  });

  it('角色骰子始终使用八个主体用途和稳定ID，排序后整段编辑仍对应原角色', () => {
    const random = vi.spyOn(PromptLibraryAccess, 'PromptLibraryRandomButton').mockImplementation(({ roleId }) => <button type="button" aria-label={`random-${roleId}`} />);
    render(<Harness library={{ showCharacterReference: true }} />);
    const purposes = ['identity', 'appearance', 'clothing', 'pose', 'expression', 'creature', 'object', 'vehicle'];
    // 骰子留在取用弹层里，不再在角色卡上常驻。
    expect(document.querySelector('[aria-label="random-a"]')).toBeNull();
    openLibrary();
    expect(random.mock.calls.some(([props]) => props.roleId === 'a' && JSON.stringify(props.purposes) === JSON.stringify(purposes))).toBe(true);
    expect(document.querySelector('[aria-label="random-a"]')?.closest('[role="dialog"]')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog', { name: '使用提示词' })).getByRole('button', { name: '关闭' }));
    selectCharacter(/角色 2/);
    openLibrary();
    expect(random.mock.calls.some(([props]) => props.roleId === 'b' && JSON.stringify(props.purposes) === JSON.stringify(purposes))).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog', { name: '使用提示词' })).getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '上移角色 2' }));
    selectCharacter(/角色 2/);
    fireEvent.change(screen.getByPlaceholderText('角色提示词'), { target: { value: 'edited role a' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 2' }));
    expect(draft().characters).toEqual([initial.characters![1], { ...initial.characters![0], prompt: 'edited role a', enabled: false }]);
  });

  it('角色卡头部直接提供取用、保存与排序，不再有更多菜单', () => {
    render(<Harness library={{ showCharacterReference: true, canSaveCharacter: true, onSaveCharacter: vi.fn() }} />);
    const tools = document.querySelector('.character-tools') as HTMLElement;
    expect(within(tools).getByRole('button', { name: '从库取用' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: '保存到角色库' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: '上移角色 1' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: '下移角色 1' })).toBeTruthy();
    // 更多菜单已拆掉：保存、排序全部提为常驻按钮。
    expect(screen.queryByRole('button', { name: '角色 1 的更多操作' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '更多' })).toBeNull();
  });

  it('页头横排切换角色，一次只显示当前角色', () => {
    render(<Harness />);
    const first = screen.getAllByRole('button', { name: /角色 1/ }).find(node => node.hasAttribute('aria-pressed'))!;
    const second = screen.getAllByRole('button', { name: /角色 2/ }).find(node => node.hasAttribute('aria-pressed'))!;
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('checkbox', { name: '启用角色 1' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '启用角色 2' })).toBeNull();
    fireEvent.click(second);
    expect(screen.getByRole('checkbox', { name: '启用角色 2' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '启用角色 1' })).toBeNull();
  });
  it('角色卡从库取用打开统一取用弹层，关闭后回到角色编辑器', () => {
    render(<Harness library={{ showCharacterReference: true }} />);
    openLibrary();
    expect(screen.getByRole('dialog', { name: '使用提示词' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '使用提示词' })).toBeNull();
  });

  it('完整角色原文框默认可跟随内容且无高度把手，动态目录正负词合并显示', () => {
    const role = { ...initial.characters![0], sections: { 'directory:dress': 'dress' }, sectionNegatives: { 'directory:dress': 'coat' }, sectionMeta: { 'directory:dress': { directoryName: '服装' } } };
    render(<Harness initialParams={{ ...initial, characters: [role] }} />);
    const fields = Array.from(document.querySelectorAll('textarea'));
    expect(fields).toHaveLength(2);
    expect(screen.getByPlaceholderText('角色提示词')).toHaveProperty('value', 'dress, blue hair');
    expect(screen.getByPlaceholderText('选填')).toHaveProperty('value', 'coat, red hair');
    for (const field of fields) {
      expect(field.classList.contains('resize-none')).toBe(true);
      expect(field.classList.contains('resize-y')).toBe(false);
    }
    expect(screen.queryByRole('button', { name: '调整输入框高度' })).toBeNull();
    expect(mark).not.toHaveBeenCalled();
  });
  it('动态目录正负词整段编辑清栏后不重复编译，其他角色仍保持不变', () => {
    const role = { ...initial.characters![0], sections: { 'directory:dress': '1.2::white dress, ribbon::' }, sectionNegatives: { 'directory:dress': 'coat' },
      sectionMeta: { 'directory:dress': { directoryName: '服装', directoryPath: ['人物', '服装'], entryName: '白裙' } } };
    render(<Harness initialParams={{ ...initial, characters: [role, initial.characters![1]] }} />);
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
    const negative = screen.getAllByPlaceholderText('选填')[0] as HTMLTextAreaElement;
    expect(positive.value).toBe('1.2::white dress, ribbon::, blue hair'); expect(negative.value).toBe('coat, red hair');
    fireEvent.change(positive, { target: { value: '1.2::blue dress, ribbon::' } });
    fireEvent.change(negative, { target: { value: 'red dress' } });
    expect(draft().characters?.[0]).toMatchObject({ prompt: '1.2::blue dress, ribbon::', negativePrompt: 'red dress' });
    expect(draft().characters?.[0].sections).toBeUndefined();
    expect(draft().characters?.[0].sectionNegatives).toBeUndefined();
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
    expect(document.querySelector('[data-character-summary]')).toBeNull();
  });
  it('整段角色完整展示动态分栏，编辑负面后清分类且正文不重复', () => {
    render(<Harness initialParams={{ ...initial, characters: [{ ...initial.characters![0], sections: { 'directory:custom': '1.2::dress, bow::' }, sectionNegatives: { 'directory:custom': 'coat' } }] }} />);
    const positive = screen.getByPlaceholderText('角色提示词') as HTMLTextAreaElement;
    const negative = screen.getByPlaceholderText('选填') as HTMLTextAreaElement;
    expect(positive.value).toBe('1.2::dress, bow::, blue hair'); expect(negative.value).toBe('coat, red hair');
    fireEvent.change(negative, { target: { value: 'red dress' } });
    expect(positive.value).toBe('1.2::dress, bow::, blue hair');
    expect(draft().characters?.[0]).toMatchObject({ prompt: '1.2::dress, bow::, blue hair', negativePrompt: 'red dress' });
    expect(draft().characters?.[0].sections).toBeUndefined(); expect(draft().characters?.[0].sectionNegatives).toBeUndefined();
  });
  it('Medium 合并后的动态角色负面禁用且完整保留原正负词', () => {
    render(<Harness model="nai-diffusion-5-full-medium" initialParams={{ ...initial, characters: [{ ...initial.characters![0], sections: { 'directory:custom': 'dress' }, sectionNegatives: { 'directory:custom': 'coat' }, sectionMeta: { 'directory:custom': { directoryName: '服装快照' } } }] }} />);
    expect((screen.getByPlaceholderText('角色提示词') as HTMLTextAreaElement).disabled).toBe(false);
    const negative = screen.getByPlaceholderText('选填') as HTMLTextAreaElement;
    expect(negative.disabled).toBe(true); expect(negative.value).toBe('coat, red hair');
  });
  it('取用弹层里的随机搭配跟当前角色走，只读时取用入口不可用', () => {
    const random = vi.spyOn(PromptLibraryAccess, 'PromptLibraryRandomButton').mockImplementation(({ roleId, disabled }) => <button type="button" aria-label={`random-${roleId}`} disabled={disabled} />);
    const onContentRollForRole = vi.fn();
    render(<Harness onContentRollForRole={onContentRollForRole} library={{ showCharacterReference: true }} />);
    openLibrary();
    expect(within(screen.getByRole('dialog', { name: '使用提示词' })).getByRole('button', { name: 'random-a' })).toBeTruthy();
    cleanup();
    render(<Harness canEdit={false} library={{ showCharacterReference: true }} />);
    expect((screen.getByRole('button', { name: '从库取用' }) as HTMLButtonElement).disabled).toBe(true);
    expect(random).toHaveBeenCalled();
  });
  it('整段显示完整角色正负词，编辑后分类词不重复参与请求，坐标与其他角色保留', () => {
    render(<Harness initialParams={{ ...initial, characters: [{ ...initial.characters![0], prompt: 'smile', sections: { wardrobe: 'blue dress' }, sectionNegatives: { wardrobe: 'red dress' } }, initial.characters![1]] }} />);
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
    expect(positive.value).toBe('blue dress, smile');
    expect((screen.getAllByPlaceholderText('选填')[0] as HTMLTextAreaElement).value).toBe('red dress, red hair');
    expect(screen.queryByText('分栏内容')).toBeNull();
    fireEvent.change(positive, { target: { value: 'green dress, smile' } });
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'green dress, smile', negativePrompt: 'red dress, red hair', x: 0.223, y: 0.887 });
    expect(draft().characters?.[0].sections).toBeUndefined();
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
  });
  it('定位展开区提供当前角色 X／Y，改数字挪点并只改对应角色', () => {
    render(<Harness freeform />);
    expect(screen.queryByRole('spinbutton', { name: '角色 1 水平位置' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    expect(screen.getByRole('group', { name: '角色 1 坐标' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下移角色 1' })).toBeTruthy();
    const x = screen.getByRole('spinbutton', { name: '角色 1 水平位置' });
    fireEvent.change(x, { target: { value: '0.42' } }); fireEvent.blur(x);
    expect(draft().useCoords).toBe(true);
    expect(draft().characters?.[0]).toEqual({ ...initial.characters![0], x: 0.42 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
  });
  it('角色正词清空在提示词标签行，负词清空在负面标题行，两者分别撤销且保留其他角色', () => {
    render(<Harness />);
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
    const negative = screen.getAllByPlaceholderText('选填')[0] as HTMLTextAreaElement;
    const positiveHeader = screen.getByText('角色提示词').parentElement as HTMLElement;
    const clearPositive = within(positiveHeader).getByRole('button', { name: '清空当前提示词' });
    expect(screen.getByRole('checkbox', { name: '启用角色 1' }).closest('.character-card-header')!.contains(clearPositive)).toBe(false);
    fireEvent.click(clearPositive);
    expect(draft().characters?.[0]).toMatchObject({ id: 'a', prompt: '', negativePrompt: 'red hair', x: 0.223, y: 0.887 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]); expect(document.activeElement).toBe(positive);
    fireEvent.click(within(positiveHeader).getByRole('button', { name: '撤销清空' }));
    const negativeHeader = screen.getAllByText('角色负面提示词')[0].parentElement!;
    fireEvent.click(within(negativeHeader).getByRole('button', { name: '清空当前提示词' }));
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'blue hair', negativePrompt: '' }); expect(document.activeElement).toBe(negative);
    fireEvent.click(within(negativeHeader).getByRole('button', { name: '撤销清空' }));
    expect(draft().characters).toEqual(initial.characters);
  });
  it('Medium 角色负面词灰白禁用，正向词可编辑，切回 High 恢复原负面词', () => {
    const { rerender } = render(<Harness model="nai-diffusion-5-full-medium" />);
    const negativeLocked = screen.getByPlaceholderText('选填') as HTMLTextAreaElement;
    expect(negativeLocked.disabled).toBe(true);
    expect(negativeLocked.closest('.nai-model-locked')).not.toBeNull();
    const positive = screen.getByPlaceholderText('角色提示词') as HTMLTextAreaElement;
    // 当前角色正负词各有一个清空按钮；Medium 下负词跟着锁定，只有正向可点
    const clearButtons = screen.getAllByRole('button', { name: '清空当前提示词' }).map(button => (button as HTMLButtonElement).disabled);
    expect(clearButtons).toEqual([false, true]);
    expect(positive.disabled).toBe(false);
    fireEvent.change(positive, { target: { value: 'green hair' } });
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'green hair', negativePrompt: 'red hair' });
    rerender(<Harness model="nai-diffusion-5-full" />);
    const negative = screen.getByPlaceholderText('选填') as HTMLTextAreaElement;
    expect(negative.disabled).toBe(false);
    expect(negative.value).toBe('red hair');
  });

  it('定位区数字框清空／越界归一化，模型切换不改存量草稿', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('button', { name: '自动构图' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    const x = screen.getByRole('spinbutton', { name: '角色 1 水平位置' });
    expect((x as HTMLInputElement).value).toBe('0.3');
    fireEvent.change(x, { target: { value: '' } });
    expect(draft().characters?.[0].x).toBe(0.223);
    fireEvent.blur(x);
    expect(draft().useCoords).toBe(true);
    expect(draft().characters?.[0].x).toBe(0.5);
    fireEvent.change(x, { target: { value: '9' } }); fireEvent.blur(x);
    expect(draft().characters?.[0].x).toBe(0.9);
    rerender(<Harness freeform />);
    const locate = screen.getByRole('button', { name: '角色定位' });
    if (locate.getAttribute('aria-expanded') !== 'true') fireEvent.click(locate);
    expect((screen.getByRole('spinbutton', { name: '角色 1 垂直位置' }) as HTMLInputElement).value).toBe('0.887');
    expect(draft().characters?.[0].y).toBe(0.887);
  });

  it('上移／下移保持 ID 与所有内容，停用再启用保留文字与坐标', () => {
    render(<Harness />);
    expect((screen.getByRole('button', { name: '上移角色 1' }) as HTMLButtonElement).disabled).toBe(true);
    selectCharacter(/角色 2/);
    fireEvent.click(screen.getByRole('button', { name: '上移角色 2' }));
    expect(draft().characters).toEqual([initial.characters![1], initial.characters![0]]);
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 1' }));
    expect(draft().characters?.[0]).toEqual({ ...initial.characters![1], enabled: false });
    expect(screen.getAllByText('· 已停用').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 1' }));
    fireEvent.click(screen.getByRole('button', { name: '下移角色 1' }));
    expect(draft().characters).toEqual([initial.characters![0], { ...initial.characters![1], enabled: true }]);
    expect(mark).toHaveBeenCalledTimes(4);
  });

  it('角色排序后清空撤销仍跟随稳定角色槽位，不落入其他角色顶栏', () => {
    render(<Harness />);
    const positiveHeader = screen.getByText('角色提示词').parentElement as HTMLElement;
    fireEvent.click(within(positiveHeader).getByRole('button', { name: '清空当前提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '下移角色 1' }));
    // 下移后仍停在同一角色（现为槽位 2），撤销清空应还在该卡提示词标签行。
    const movedHeader = screen.getByText('角色提示词').parentElement as HTMLElement;
    fireEvent.click(within(movedHeader).getByRole('button', { name: '撤销清空' }));
    expect(draft().characters).toEqual([initial.characters![1], initial.characters![0]]);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('角色提示词'));
  });

  it('定位区默认收起，方向键定位自动开启手动坐标，停用角色退出画布', () => {
    render(<Harness />);
    expect(screen.queryByRole('group', { name: '角色定位画布' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(draft()).toMatchObject({ useCoords: true, characters: [{ x: 0.5, y: 0.9 }, {}] });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 1' }));
    expect(screen.queryByRole('button', { name: '定位角色 1' })).toBeNull();
    expect(screen.getByRole('button', { name: '定位角色 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    expect(screen.queryByRole('group', { name: '角色定位画布' })).toBeNull();
  });

  it('只读时不能改开关、顺序、位置或删除', () => {
    render(<Harness canEdit={false} />);
    expect(screen.getAllByRole('button', { name: '清空当前提示词' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole('checkbox', { name: '启用角色 1' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '自动构图' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '删除角色' })).toBeNull();
    expect((screen.getByRole('button', { name: '下移角色 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    expect((screen.getByRole('spinbutton', { name: '角色 1 水平位置' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(draft()).toEqual(initial);
  });
});
