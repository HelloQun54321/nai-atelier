// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorCharacters } from '../../../components/chain/ChainEditorCharacters';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../../services/appearancePreferences';
import type { NAIParams } from '../../../types';

vi.mock('../../../components/TagAutocompleteTextarea', () => ({ TagAutocompleteTextarea: ({ value, onValueChange, tagAssistEnabled: _assist, ...props }: { value: string; onValueChange: (value: string) => void; tagAssistEnabled: boolean }) =>
  <textarea {...props} value={value} onChange={event => onValueChange(event.target.value)} /> }));
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
  it('Medium 角色负面词灰白禁用，正向词可编辑，切回 High 恢复原负面词', () => {
    const { rerender } = render(<Harness model="nai-diffusion-5-full-medium" />);
    for (const node of screen.getAllByPlaceholderText('选填')) {
      expect((node as HTMLTextAreaElement).disabled).toBe(true);
      expect(node.closest('.nai-model-locked')).not.toBeNull();
    }
    const positive = screen.getAllByPlaceholderText('角色提示词')[0] as HTMLTextAreaElement;
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
    for (const name of ['启用角色 1', 'AI 自动构图']) expect((screen.getByRole('checkbox', { name }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下移角色 1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole('button', { name: '移除角色提示词' })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '角色定位' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '定位角色 1' }), { key: 'ArrowRight' });
    expect(draft()).toEqual(initial);
  });
});
