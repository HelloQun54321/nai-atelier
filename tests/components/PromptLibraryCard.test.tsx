// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryCard } from '../../components/PromptLibraryCard';
import { ToolbarButton } from '../../components/DesignSystem';
import { createCombinationData, promptLibraryEntryLabel } from '../../services/promptLibraryEntries';
import type { PromptChain } from '../../types';

vi.mock('../../components/SmartImage', () => ({ SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement> & { containerClassName?: string; thumbnailVariant?: string }) => {
  const { containerClassName, thumbnailVariant: _variant, ...image } = props;
  return <div className={containerClassName}><img {...image} /></div>;
} }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'image-action', ImageShareActions: () => <button data-card-action>收藏</button> }));
afterEach(cleanup);
const chain = { id: 'fragment', name: '柔光', type: 'preset', basePrompt: 'soft light', previewImage: '/synthetic/landscape.png', tags: [], params: { _promptLibraryDirectoryIds: ['light'] } } as unknown as PromptChain;

it('按封面真实比例显示，换图不会沿用旧图片比例', () => {
  const props = { chain, label: '光照', onOpen: vi.fn(), notify: vi.fn() };
  const view = render(<PromptLibraryCard {...props} />);
  const img = screen.getByRole('img');
  Object.defineProperties(img, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 600 } });
  fireEvent.load(img);
  const frame = img.closest<HTMLElement>('.mobile-gallery-frame')!;
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('2');
  view.rerender(<PromptLibraryCard {...props} chain={{ ...chain, previewImage: '/synthetic/portrait.png' }} />);
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe(String(2 / 3));
  Object.defineProperties(img, { naturalWidth: { configurable: true, value: 600 }, naturalHeight: { configurable: true, value: 1200 } });
  fireEvent.load(img);
  expect(frame.style.getPropertyValue('--mobile-image-ratio')).toBe('0.5');
});

it('片段卡片保留选中与变暗状态，即使传入回调也不展示使用', () => {
  const open = vi.fn(), use = vi.fn();
  const props = { chain, label: '光照', onOpen: open, onUse: use, notify: vi.fn() };
  const view = render(<PromptLibraryCard {...props} selected />);
  const card = screen.getByRole('button', { name: '查看柔光' });
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(card.classList.contains('ring-2')).toBe(true);
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '送到实验室' })).toBeNull();
  expect(use).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  view.rerender(<PromptLibraryCard {...props} dimmed />);
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(card.classList.contains('brightness-[.7]')).toBe(true);
  view.rerender(<PromptLibraryCard {...props} />);
  expect(card.classList.contains('brightness-[.7]')).toBe(false);
});

it('组合卡片明确送到实验室，操作不冒泡打开详情', () => {
  const open = vi.fn(), use = vi.fn();
  const combination = { ...chain, ...createCombinationData('夜景组合', { scene: { kind: 'scene', text: 'night sky', filled: true } }) } as PromptChain;
  render(<PromptLibraryCard chain={combination} label="组合" onOpen={open} onUse={use} notify={vi.fn()} />);
  const send = screen.getByRole('button', { name: '送到实验室' });
  expect(send.getAttribute('data-tone')).toBe('primary');
  fireEvent.click(send);
  expect(use).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});

it('当前目录显示真实路径与多归属，未归类和旧类型分别回退', () => {
  const directories = { revision: 1, nodes: [{ id: 'root', name: '光照与色彩', parentId: null }, { id: 'light', name: '光源与明暗', parentId: 'root' }, { id: 'other', name: '其他', parentId: null }] };
  expect(promptLibraryEntryLabel(chain, directories)).toBe('光照与色彩 / 光源与明暗');
  expect(promptLibraryEntryLabel({ ...chain, params: { ...chain.params, _promptLibraryDirectoryIds: ['light', 'other'] } } as PromptChain, directories)).toBe('光照与色彩 / 光源与明暗、其他');
  expect(promptLibraryEntryLabel({ ...chain, params: { ...chain.params, _promptLibraryDirectoryIds: [] } } as PromptChain, directories)).toBe('未归类');
  expect(promptLibraryEntryLabel({ ...chain, type: 'wardrobe' })).toBe('服饰');
});

it('保存按钮具有独立语义，使用操作继续采用主题色', () => {
  render(<><ToolbarButton tone="save">保存</ToolbarButton><ToolbarButton tone="primary">使用</ToolbarButton></>);
  expect(screen.getByRole('button', { name: '保存' }).getAttribute('data-tone')).toBe('save');
  expect(screen.getByRole('button', { name: '保存' }).classList.contains('bg-emerald-700')).toBe(true);
  expect(screen.getByRole('button', { name: '使用' }).getAttribute('data-tone')).toBe('primary');
});

it('管理中无法编辑的快照保留禁用入口，不触发载入', () => {
  const edit = vi.fn();
  render(<PromptLibraryCard chain={chain} label="组合" onOpen={vi.fn()} onEdit={edit} editDisabled notify={vi.fn()} />);
  const button = screen.getByRole('button', { name: '编辑柔光' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button); expect(edit).not.toHaveBeenCalled();
});
