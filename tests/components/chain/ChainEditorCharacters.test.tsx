// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters, type ChainEditorCharactersProps } from '../../../components/chain/ChainEditorCharacters';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../../services/appearancePreferences';
import type { NAIParams, PromptChain } from '../../../types';
import * as PromptLibraryAccess from '../../../components/PromptLibraryAccess';

vi.mock('../../../components/chain/CharacterTaggerReference', () => ({ CharacterTaggerReference: () => null }));

const initial: NAIParams = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [
  { id: 'a', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.223, y: 0.887 },
  { id: 'b', prompt: 'red hair', negativePrompt: 'blue hair', x: 0.7, y: 0.3 },
] };
const mark = vi.fn();
type LibraryProps = Pick<ChainEditorCharactersProps, 'allChains' | 'chainsLoading' | 'chainsError' | 'onRetryChains' | 'showCharacterReference'>;
const Harness = ({ freeform = false, canEdit = true, model, initialParams = initial, onContentRollForRole, library = {}, tagAssistEnabled = false }: { freeform?: boolean; canEdit?: boolean; model?: string; initialParams?: NAIParams; onContentRollForRole?: (index: number) => void; library?: LibraryProps; tagAssistEnabled?: boolean }) => {
  const [params, setParams] = useState(initialParams);
  return <><ChainEditorCharacters params={{ ...params, model }} setParams={setParams} characters={params.characters || []}
    canEdit={canEdit} onContentRollForRole={onContentRollForRole} tagAssistEnabled={tagAssistEnabled} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={mark}
    addCharacter={vi.fn()} removeCharacter={index => setParams(current => ({ ...current, characters: current.characters?.filter((_, i) => i !== index) }))}
    updateCharacter={(index, patch, useCoords) => { setParams(current => ({ ...current, ...(useCoords === undefined ? {} : { useCoords }), characters: current.characters?.map((character, i) => i === index ? { ...character, ...patch } : character) })); mark(); }}
    activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']} mobileEditorTab="character" freeformPosition={freeform} {...library} />
    <output data-testid="draft">{JSON.stringify(params)}</output></>;
};
const draft = (): NAIParams => JSON.parse(screen.getByTestId('draft').textContent!);
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mark.mockClear(); });

describe('共用角色编辑器', () => {
  it('只有完整角色正负大块，旧用途与目录原文编译显示但打开不改写数据', () => {
    const role = { ...initial.characters![0], prompt: '1.3::blue hair::',
      sections: { wardrobe: 'blue dress', 'purpose:lighting': 'rim light', 'directory:old': 'tree' },
      sectionNegatives: { wardrobe: 'coat', 'purpose:lighting': 'dark', 'directory:old': 'bare' },
      sectionMeta: { 'directory:old': { directoryPath: ['旧目录', '原位置'], entryName: '旧条目' } } };
    const params = { ...initial, characters: [role, initial.characters![1]] };
    render(<Harness initialParams={params} />);
    expect(screen.getByText('角色专属提示词')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ 添加角色' })).toBeTruthy();
    const positive = screen.getAllByPlaceholderText('角色提示词')[0];
    const negative = screen.getAllByPlaceholderText('选填')[0];
    expect(positive).toHaveProperty('value', 'blue dress, rim light, tree, 1.3::blue hair::');
    expect(negative).toHaveProperty('value', 'coat, dark, bare, red hair');
    expect(positive.compareDocumentPosition(negative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[data-prompt-purpose-group], [data-character-summary]')).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    expect(draft()).toEqual(params); expect(mark).not.toHaveBeenCalled();
    fireEvent.change(positive, { target: { value: 'changed whole role' } });
    expect(draft().characters?.[0]).toMatchObject({ id: 'a', prompt: 'changed whole role', negativePrompt: 'coat, dark, bare, red hair', x: role.x, y: role.y });
    expect(draft().characters?.[0].sections).toBeUndefined();
    expect(draft().characters?.[0].sectionNegatives).toBeUndefined();
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
  });

  it('角色骰子始终使用八个主体用途和稳定ID，排序后整段编辑仍对应原角色', () => {
    const random = vi.spyOn(PromptLibraryAccess, 'PromptLibraryRandomButton').mockImplementation(({ roleId }) => <button type="button" aria-label={`random-${roleId}`} />);
    render(<Harness />);
    const purposes = ['identity', 'appearance', 'clothing', 'pose', 'expression', 'creature', 'object', 'vehicle'];
    for (const id of ['a', 'b']) {
      expect(random.mock.calls.some(([props]) => props.roleId === id && props.variant === 'icon' && JSON.stringify(props.purposes) === JSON.stringify(purposes))).toBe(true);
      expect(screen.getByRole('button', { name: `random-${id}` }).closest('.character-tools')).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: '上移角色 2' }));
    fireEvent.change(screen.getAllByPlaceholderText('角色提示词')[1], { target: { value: 'edited role a' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 2' }));
    expect(draft().characters).toEqual([initial.characters![1], { ...initial.characters![0], prompt: 'edited role a', enabled: false }]);
    expect(screen.getByRole('button', { name: 'random-a' }).closest('.lab-character')).toBe(screen.getByRole('checkbox', { name: '启用角色 2' }).closest('.lab-character'));
  });
  it('角色库首读等待与失败不冒充空库，重试成功为空后才显示空态', async () => {
    let resolve!: (chains: PromptChain[]) => void;
    let reject!: (error: Error) => void;
    const load = vi.fn(() => new Promise<PromptChain[]>((yes, no) => { resolve = yes; reject = no; }));
    const LoadingHarness = () => {
      const [library, setLibrary] = useState<LibraryProps>({ allChains: [], chainsLoading: true });
      const fetchChains = () => {
        setLibrary(current => ({ ...current, chainsLoading: true, chainsError: undefined }));
        void load().then(allChains => setLibrary({ allChains, chainsLoading: false }), error => setLibrary(current => ({ ...current, chainsLoading: false, chainsError: error.message })));
      };
      useEffect(fetchChains, []);
      return <Harness library={{ ...library, showCharacterReference: true, onRetryChains: fetchChains }} />;
    };
    render(<LoadingHarness />);
    fireEvent.click(screen.getAllByRole('button', { name: '从角色库引用' })[0]);
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe('加载中…');
    expect(screen.queryByText('角色库中暂无自定义角色')).toBeNull();
    await act(async () => reject(new Error('角色库读取失败')));
    expect(screen.getByRole('alert').textContent).toContain('角色库读取失败');
    expect(screen.queryByText('角色库中暂无自定义角色')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByRole('status')).toBeTruthy();
    await act(async () => resolve([]));
    expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
    expect(screen.getByText('角色库中暂无自定义角色')).toBeTruthy();
    expect(mark).not.toHaveBeenCalled();
  });

  it('后台刷新与失败保留已有角色并仍可引用，不清空当前角色坐标', () => {
    const allChains: PromptChain[] = [{ id: 'stored', userId: 'synthetic', name: '已有角色', type: 'character', description: '', tags: [], basePrompt: 'green hair', negativePrompt: 'hat', modules: [], params: initial, createdAt: 1, updatedAt: 1 }];
    const library = { allChains, chainsLoading: true, showCharacterReference: true };
    const view = render(<Harness library={library} />);
    fireEvent.click(screen.getAllByRole('button', { name: '从角色库引用' })[0]);
    const cachedButton = screen.getByRole('button', { name: /已有角色/ });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toBeTruthy();
    view.rerender(<Harness library={{ ...library, chainsLoading: false, chainsError: '刷新失败' }} />);
    expect(screen.getByRole('button', { name: /已有角色/ })).toBe(cachedButton);
    expect(screen.getByRole('alert').textContent).toContain('刷新失败');
    expect(screen.queryByText('角色库中暂无自定义角色')).toBeNull();
    fireEvent.click(cachedButton);
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'green hair', negativePrompt: 'hat', x: 0.223, y: 0.887 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('角色库引用弹窗支持名称、提示词与标签搜索，选中后写入当前角色且重新打开清空查询', () => {
    const allChains: PromptChain[] = [
      { id: 'moon', userId: 'synthetic', name: '月光骑士', type: 'character', description: '银甲角色', tags: ['骑士', '月光'], basePrompt: 'silver armor, moonlight', negativePrompt: 'blurry', modules: [], params: { ...initial, characters: [{ ...initial.characters![0], prompt: 'silver armor', negativePrompt: 'blurry' }] }, createdAt: 1, updatedAt: 1 },
      { id: 'forest', userId: 'synthetic', name: '森林精灵', type: 'character', description: '绿叶角色', tags: ['精灵', '森林'], basePrompt: 'green cloak, forest', negativePrompt: 'low quality', modules: [], params: { ...initial, characters: [{ ...initial.characters![0], prompt: 'green cloak', negativePrompt: 'low quality' }] }, createdAt: 2, updatedAt: 2 },
    ];
    render(<Harness library={{ allChains, showCharacterReference: true }} />);
    fireEvent.click(screen.getAllByRole('button', { name: '从角色库引用' })[0]);
    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByRole('searchbox', { name: '搜索角色库角色' }) as HTMLInputElement;
    const roleButtons = () => within(dialog).getAllByRole('button').filter(button => button.textContent !== '关闭');

    expect(search).toBeTruthy();
    expect(roleButtons()).toHaveLength(2);
    fireEvent.change(search, { target: { value: '森林精灵' } });
    expect(within(dialog).getByRole('button', { name: /森林精灵/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /月光骑士/ })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(roleButtons()).toHaveLength(2);

    const beforeSearch = draft();
    fireEvent.change(search, { target: { value: 'moonlight' } });
    expect(within(dialog).getByRole('button', { name: /月光骑士/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /森林精灵/ })).toBeNull();
    expect(draft()).toEqual(beforeSearch);
    fireEvent.change(search, { target: { value: 'green cloak' } });
    expect(within(dialog).getByRole('button', { name: /森林精灵/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /月光骑士/ })).toBeNull();
    fireEvent.change(search, { target: { value: 'does-not-exist' } });
    expect(within(dialog).getByText('没有匹配的角色')).toBeTruthy();
    expect(within(dialog).queryByText('角色库中暂无自定义角色')).toBeNull();

    fireEvent.change(search, { target: { value: '森林' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /森林精灵/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'green cloak, forest', negativePrompt: 'low quality', x: 0.223, y: 0.887 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);

    fireEvent.click(screen.getAllByRole('button', { name: '从角色库引用' })[0]);
    expect((within(screen.getByRole('dialog')).getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  it('完整角色原文框均可拉伸，动态目录正负词合并显示', () => {
    const role = { ...initial.characters![0], sections: { 'directory:dress': 'dress' }, sectionNegatives: { 'directory:dress': 'coat' }, sectionMeta: { 'directory:dress': { directoryName: '服装' } } };
    render(<Harness initialParams={{ ...initial, characters: [role] }} />);
    const fields = Array.from(document.querySelectorAll('textarea'));
    expect(fields).toHaveLength(2);
    expect(screen.getByPlaceholderText('角色提示词')).toHaveProperty('value', 'dress, blue hair');
    expect(screen.getByPlaceholderText('选填')).toHaveProperty('value', 'coat, red hair');
    for (const field of fields) {
      expect(field.classList.contains('resize-y')).toBe(true);
      expect(field.classList.contains('resize-none')).toBe(false);
    }
    expect(screen.getAllByRole('button', { name: '调整输入框高度' })).toHaveLength(fields.length);
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
  it.each([[false, 0], [true, 2]] as const)('可编辑=%s 时显示对应角色工具组的随机搭配入口，数量=%s', (canEdit, count) => {
    const onContentRollForRole = vi.fn();
    render(<Harness canEdit={canEdit} onContentRollForRole={onContentRollForRole} />);
    const buttons = screen.queryAllByRole('button', { name: '随机搭配' });
    expect(buttons).toHaveLength(count);
    if (count) {
      for (const button of buttons) {
        expect(button.closest('.character-tools')).toBeTruthy();
        expect(button.textContent).toBe('');
      }
      fireEvent.click(buttons[1]); expect(onContentRollForRole).toHaveBeenCalledWith(1);
    }
    expect(draft()).toEqual(initial);
    expect(mark).not.toHaveBeenCalled();
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
  it.each([1280, 390])('%spx 下坐标图标与原有角色动作同排，展开后仍只修改对应角色并可关闭', async width => {
    vi.stubGlobal('innerWidth', width);
    render(<Harness freeform />);
    expect(screen.queryByRole('spinbutton', { name: '角色 1 水平位置' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI 自动构图' }));
    const trigger = screen.getAllByRole('button', { name: '坐标' })[0];
    const prompt = screen.getAllByPlaceholderText('角色提示词')[0];
    const tools = trigger.closest('.character-tools')!;
    expect(trigger.textContent).toBe('');
    expect(tools.contains(screen.getByRole('button', { name: '下移角色 1' }))).toBe(true);
    expect(tools.contains(prompt)).toBe(false);
    expect(tools.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '角色 1 坐标' })).toBeTruthy();
    const x = screen.getByRole('spinbutton', { name: '角色 1 水平位置' });
    fireEvent.change(x, { target: { value: '0.42' } }); fireEvent.blur(x);
    expect(draft().characters?.[0]).toEqual({ ...initial.characters![0], x: 0.42 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]);
    if (width < 768) fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    else fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
  it('角色正词清空在卡片顶栏，负词清空在负面标题行，两者分别撤销且保留其他角色', () => {
    render(<Harness />);
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
    const negative = screen.getAllByPlaceholderText('选填')[0] as HTMLTextAreaElement;
    const header = screen.getByRole('checkbox', { name: '启用角色 1' }).closest('label')!.parentElement!;
    const clearPositive = within(header).getByRole('button', { name: '清空当前提示词' });
    expect(header.contains(screen.getByRole('button', { name: '下移角色 1' }))).toBe(true);
    expect(positive.parentElement!.contains(clearPositive)).toBe(false);
    fireEvent.click(clearPositive);
    expect(draft().characters?.[0]).toMatchObject({ id: 'a', prompt: '', negativePrompt: 'red hair', x: 0.223, y: 0.887 });
    expect(draft().characters?.[1]).toEqual(initial.characters![1]); expect(document.activeElement).toBe(positive);
    fireEvent.click(within(header).getByRole('button', { name: '撤销清空' }));
    const negativeHeader = screen.getAllByText('角色负面提示词')[0].parentElement!;
    fireEvent.click(within(negativeHeader).getByRole('button', { name: '清空当前提示词' }));
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'blue hair', negativePrompt: '' }); expect(document.activeElement).toBe(negative);
    fireEvent.click(within(negativeHeader).getByRole('button', { name: '撤销清空' }));
    expect(draft().characters).toEqual(initial.characters);
  });
  it('Medium 角色负面词灰白禁用，正向词可编辑，切回 High 恢复原负面词', () => {
    const { rerender } = render(<Harness model="nai-diffusion-5-full-medium" />);
    for (const node of screen.getAllByPlaceholderText('选填')) {
      expect((node as HTMLTextAreaElement).disabled).toBe(true);
      expect(node.closest('.nai-model-locked')).not.toBeNull();
    }
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
    // 每个角色正负词各有一个清空按钮；Medium 下负词那一半跟着锁定，只有正向可点
    const clearButtons = screen.getAllByRole('button', { name: '清空当前提示词' }).map(button => (button as HTMLButtonElement).disabled);
    expect(clearButtons).toEqual([false, true, false, true]);
    expect(positive.disabled).toBe(false);
    fireEvent.change(positive, { target: { value: 'green hair' } });
    expect(draft().characters?.[0]).toMatchObject({ prompt: 'green hair', negativePrompt: 'red hair' });
    rerender(<Harness model="nai-diffusion-5-full" />);
    const negative = screen.getAllByPlaceholderText('选填')[0] as HTMLTextAreaElement;
    expect(negative.disabled).toBe(false);
    expect(negative.value).toBe('red hair');
  });

  it('旧资料默认自动构图，坐标真正禁用；开启手动后清空／越界归一化，模型切换不改存量草稿', () => {
    const { rerender } = render(<Harness />);
    expect((screen.getByRole('checkbox', { name: 'AI 自动构图' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: '坐标' })[0]);
    expect((screen.getByRole('spinbutton', { name: '角色 1 水平位置' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI 自动构图' }));
    fireEvent.click(screen.getAllByRole('button', { name: '坐标' })[0]);
    const x = screen.getByRole('spinbutton', { name: '角色 1 水平位置' });
    expect((x as HTMLInputElement).value).toBe('0.3');
    fireEvent.change(x, { target: { value: '' } });
    expect(draft().characters?.[0].x).toBe(0.223);
    fireEvent.blur(x);
    expect(draft().characters?.[0].x).toBe(0.5);
    fireEvent.change(x, { target: { value: '9' } }); fireEvent.blur(x);
    expect(draft().characters?.[0].x).toBe(0.9);
    rerender(<Harness freeform />);
    expect((screen.getByRole('spinbutton', { name: '角色 1 垂直位置' }) as HTMLInputElement).value).toBe('0.887');
    expect(draft().characters?.[0].y).toBe(0.887);
  });

  it('上移／下移保持 ID 与所有内容，停用再启用保留文字与坐标', () => {
    render(<Harness />);
    expect((screen.getByRole('button', { name: '上移角色 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '上移角色 2' }));
    expect(draft().characters).toEqual([initial.characters![1], initial.characters![0]]);
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 1' }));
    expect(draft().characters?.[0]).toEqual({ ...initial.characters![1], enabled: false });
    expect(screen.getByText('· 已停用')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用角色 1' }));
    fireEvent.click(screen.getByRole('button', { name: '下移角色 1' }));
    expect(draft().characters).toEqual([initial.characters![0], { ...initial.characters![1], enabled: true }]);
    expect(mark).toHaveBeenCalledTimes(4);
  });

  it('角色排序后清空撤销仍跟随稳定角色槽位，不落入其他角色顶栏', () => {
    render(<Harness />);
    const firstHeader = screen.getByRole('checkbox', { name: '启用角色 1' }).closest('label')!.parentElement!;
    fireEvent.click(within(firstHeader).getByRole('button', { name: '清空当前提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '下移角色 1' }));
    const movedHeader = screen.getByRole('checkbox', { name: '启用角色 2' }).closest('label')!.parentElement!;
    fireEvent.click(within(movedHeader).getByRole('button', { name: '撤销清空' }));
    expect(draft().characters).toEqual([initial.characters![1], initial.characters![0]]);
    expect(document.activeElement).toBe(screen.getAllByPlaceholderText('角色提示词')[1]);
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
    for (const name of ['启用角色 1', 'AI 自动构图']) expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下移角色 1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole('button', { name: '移除角色提示词' })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: '坐标' })[0]);
    expect((screen.getByRole('spinbutton', { name: '角色 1 水平位置' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(draft()).toEqual(initial);
  });
});
