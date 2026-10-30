// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabCategoryMode, labCategoryTabOptions } from '../../../components/chain/LabCategoryMode';
import { pinPictureZone } from '../../../services/labSections';
import type { PromptSections } from '../../../types';

const sections = { appearance: '', wardrobe: '', pose: '', scene: 'rainy street', camera: '', extra: '' } as PromptSections;

afterEach(() => cleanup());

describe('分类模式分页', () => {
  it('全局页只有整段画风，不把场景铺在同一页', () => {
    render(<LabCategoryMode tab="style" adding={false} base="artist:keep" negative="lowres" sections={sections} characters={[]} tagAssist={false} negativeLocked={false} onCancelAdd={vi.fn()} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect((screen.getByRole('textbox', { name: '画风' }) as HTMLTextAreaElement).value).toBe('artist:keep');
    expect(screen.queryByRole('textbox', { name: '地点与布景' })).toBeNull();
    expect(screen.getByText('整段使用，随机搭配不会改这里。')).toBeTruthy();
  });

  it('场景是单独一页，结构摘要默认收起', () => {
    const layout = pinPictureZone(undefined, 'scene');
    expect(labCategoryTabOptions(sections, layout, true).map(item => item[0])).toEqual(['style', 'character', 'scene', 'reference', 'params', 'add']);
    render(<LabCategoryMode tab="scene" adding={false} base="artist:keep" negative="" sections={sections} layout={layout} characters={[]} tagAssist={false} negativeLocked={false} onCancelAdd={vi.fn()} onBase={vi.fn()} onNegative={vi.fn()} onSections={vi.fn()} onLayout={vi.fn()} onCopy={vi.fn()} onAddCharacter={vi.fn()} onUpdateCharacter={vi.fn()} onRemoveCharacter={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '场景（原有）' })).toHaveProperty('value', 'rainy street');
    expect(screen.queryByRole('textbox', { name: '画风' })).toBeNull();
    const summary = screen.getByText(/本次结构/).closest('details');
    expect(summary?.open).toBe(false);
    fireEvent.click(screen.getByText(/本次结构/));
    expect(summary?.open).toBe(true);
    expect(screen.getByText(/artist:keep, rainy street/)).toBeTruthy();
  });
});
