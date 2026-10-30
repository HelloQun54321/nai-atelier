// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabCategoryMode, labCategoryTabOptions } from '../../../components/chain/LabCategoryMode';
import { pinPictureZone } from '../../../services/labSections';
import type { CharacterParams, NAIParams, PromptSections } from '../../../types';

const sections = { appearance: '', wardrobe: '', pose: '', scene: 'rainy street', camera: '', extra: '' } as PromptSections;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('分类模式分页', () => {
  it('全局页只有整段画风，不把场景铺在同一页', () => {
    render(<LabCategoryMode tab="style" adding={false} base="artist:keep" negative="lowres" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onCancelAdd={vi.fn()} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: '画风' }) as HTMLTextAreaElement).value).toBe('artist:keep');
    expect(screen.queryByRole('textbox', { name: '地点与布景' })).toBeNull();
    expect(screen.getByText('整段使用，随机搭配不会改这里。')).toBeTruthy();
  });

  it('场景是单独一页，不显示拼好的提示词', () => {
    const layout = pinPictureZone(undefined, 'scene');
    expect(labCategoryTabOptions(sections, layout, true).map(item => item[0])).toEqual(['style', 'character', 'scene', 'reference', 'params']);
    expect(labCategoryTabOptions(sections, layout, true).some(([, label]) => label === '添加')).toBe(false);
    render(<LabCategoryMode tab="scene" adding={false} base="artist:keep" negative="" sections={sections} layout={layout} characters={[]} tagAssist={false} negativeLocked={false} onCancelAdd={vi.fn()} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '场景（原有）' })).toHaveProperty('value', 'rainy street');
    expect(screen.getByRole('textbox', { name: '地点与布景' })).toHaveProperty('placeholder', '写地点、室内或背景');
    expect(screen.getAllByRole('button', { name: /更多操作/ })).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '画风' })).toBeNull();
    expect(screen.queryByText(/本次结构/)).toBeNull();
    const button = screen.getByRole('button', { name: /更多操作/ });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === button) return { x: 420, y: 180, top: 180, left: 420, right: 500, bottom: 212, width: 80, height: 32, toJSON: () => ({}) };
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    const top = Number(menu.style.top);
    const left = Number(menu.style.left);
    const height = Math.min(240, Number(menu.style.maxHeight) || 240);
    const coversField = top < 212 && top + height > 212 && left < 500 && left + 208 > 420;
    expect(coversField).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    vi.restoreAllMocks();
  });

  it('从角色库引用留在页头和空状态，卡片只保留保存', () => {
    const character = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const tools = { chains: [], params: { width: 832, height: 1216, characters: [] } as unknown as NAIParams, setParams: vi.fn(), onSaveCharacter: vi.fn() };
    const props = { tab: 'character' as const, adding: false, base: '', negative: '', sections, characters: [] as CharacterParams[], tagAssist: false, negativeLocked: false, onCancelAdd: vi.fn(), onBase: vi.fn(), onNegative: vi.fn(), onSections: vi.fn(), onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn(), characterTools: tools };
    const empty = render(<LabCategoryMode {...props} />);
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(2);
    empty.unmount();
    render(<LabCategoryMode {...props} characters={[character]} />);
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '保存到角色库' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '角色 1 的更多操作' }));
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(2);
  });
});
