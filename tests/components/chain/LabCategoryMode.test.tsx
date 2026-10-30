// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabCategoryMode, labCategoryTabOptions } from '../../../components/chain/LabCategoryMode';
import type { CharacterParams, NAIParams, PromptSections } from '../../../types';

const sections = { appearance: '', wardrobe: '', pose: '', scene: 'rainy street', camera: '', extra: '' } as PromptSections;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('分类模式分页', () => {
  it('全局页只有整段画风，不把场景铺在同一页', () => {
    render(<LabCategoryMode tab="style" base="artist:keep" negative="lowres" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: '画风' }) as HTMLTextAreaElement).value).toBe('artist:keep');
    expect(screen.queryByRole('textbox', { name: '地点与布景' })).toBeNull();
    expect(screen.queryByText('整段使用，随机搭配不会改这里。')).toBeNull();
  });

  it('场景固定在角色后面，不需要添加分页', () => {
    expect(labCategoryTabOptions(true).map(item => item[0])).toEqual(['style', 'character', 'scene', 'reference', 'params']);
    expect(labCategoryTabOptions(false).map(item => item[0])).toEqual(['style', 'character', 'scene', 'params']);
    expect(labCategoryTabOptions(true).some(([, label]) => label === '添加')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    render(<LabCategoryMode tab="scene" base="artist:keep" negative="" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '场景（原有）' })).toHaveProperty('value', 'rainy street');
    expect(screen.getByRole('textbox', { name: '地点与布景' })).toHaveProperty('placeholder', '写地点、室内或背景');
    expect(screen.getAllByRole('button', { name: /更多操作/ })).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '画风' })).toBeNull();
    expect(screen.queryByText(/本次结构/)).toBeNull();
    expect(screen.queryByRole('button', { name: '上移' })).toBeNull();
    expect(screen.queryByRole('button', { name: '从分页拿下' })).toBeNull();
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

  it('空状态不重复页头按钮，卡片只保留保存', () => {
    const character = { id: 'c1', prompt: '', x: 0.5, y: 0.5 } as CharacterParams;
    const tools = { chains: [], params: { width: 832, height: 1216, characters: [] } as unknown as NAIParams, setParams: vi.fn(), onSaveCharacter: vi.fn() };
    const props = { tab: 'character' as const, base: '', negative: '', sections, characters: [] as CharacterParams[], tagAssist: false, negativeLocked: false, onBase: vi.fn(), onNegative: vi.fn(), onSections: vi.fn(), onLayout: vi.fn(), onCopy: vi.fn(), onAddCharacter: vi.fn(), onUpdateCharacter: vi.fn(), onRemoveCharacter: vi.fn(), characterTools: tools };
    const empty = render(<LabCategoryMode {...props} />);
    expect(screen.getByText('暂无角色，点击上方添加')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '角色定位' })).toBeNull();
    empty.unmount();
    render(<LabCategoryMode {...props} characters={[character]} />);
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加角色' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '角色定位' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存到角色库' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '角色 1 的更多操作' }));
    expect(screen.getAllByRole('button', { name: '从角色库引用' })).toHaveLength(2);
  });

  it('翻译区按内容显示，与普通模式一致，不要求先点输入框', () => {
    const withText = { ...sections, 'purpose:place': 'rainy street, night' } as PromptSections;
    render(<LabCategoryMode tab="scene" base="" negative="" sections={withText} characters={[]} tagAssist negativeLocked={false} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    const field = document.querySelector('textarea[aria-label=\"地点与布景\"]') as HTMLTextAreaElement;
    expect(field.value).toBe('rainy street, night');
    expect(document.activeElement).not.toBe(field);
    expect(screen.getAllByLabelText('提示词中文翻译').length).toBeGreaterThan(0);
  });
});
