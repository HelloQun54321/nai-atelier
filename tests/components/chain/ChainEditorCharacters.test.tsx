// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters } from '../../../components/chain/ChainEditorCharacters';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../../services/appearancePreferences';
import type { NAIParams } from '../../../types';

vi.mock('../../../components/chain/CharacterTaggerReference', () => ({ CharacterTaggerReference: () => null }));

const initial: NAIParams = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [
  { id: 'a', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.223, y: 0.887 },
  { id: 'b', prompt: 'red hair', negativePrompt: 'blue hair', x: 0.7, y: 0.3 },
] };
const mark = vi.fn();
const Harness = ({ freeform = false, canEdit = true, model }: { freeform?: boolean; canEdit?: boolean; model?: string }) => {
  const [params, setParams] = useState(initial);
  return <><ChainEditorCharacters params={{ ...params, model }} setParams={setParams} characters={params.characters || []}
    canEdit={canEdit} tagAssistEnabled={false} characterPresetSources={{}} markPresetSectionModified={vi.fn()} markChange={mark}
    addCharacter={vi.fn()} removeCharacter={index => setParams(current => ({ ...current, characters: current.characters?.filter((_, i) => i !== index) }))}
    updateCharacter={(index, patch, useCoords) => { setParams(current => ({ ...current, ...(useCoords === undefined ? {} : { useCoords }), characters: current.characters?.map((character, i) => i === index ? { ...character, ...patch } : character) })); mark(); }}
    activeLabLayout={DEFAULT_LAB_PAGE_LAYOUTS['text-to-image']} mobileEditorTab="character" freeformPosition={freeform} />
    <output data-testid="draft">{JSON.stringify(params)}</output></>;
};
const draft = (): NAIParams => JSON.parse(screen.getByTestId('draft').textContent!);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mark.mockClear(); });

describe('共用角色编辑器', () => {
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
    expect((screen.getByRole('spinbutton', { name: '角色 1 水平位置' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI 自动构图' }));
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
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(draft()).toEqual(initial);
  });
});
