// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryCard } from '../../components/PromptLibraryCard';
import { ToolbarButton } from '../../components/DesignSystem';
import { createCombinationData, promptLibraryEntryLabel } from '../../services/promptLibraryEntries';
import type { PromptChain } from '../../types';
import { readAgentPage, operateAgentPage } from '../../services/agentWorkspace';

vi.mock('../../components/SmartImage', () => ({ SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement> & { containerClassName?: string; thumbnailVariant?: string }) => {
  const { containerClassName, thumbnailVariant: _variant, ...image } = props;
  return <div className={containerClassName}><img {...image} /></div>;
} }));
vi.mock('../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: 'image-action', ImageShareActions: () => <button data-card-action>收藏</button> }));
const confirm = vi.fn(async () => true);
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirm }));
afterEach(() => { cleanup(); confirm.mockReset(); confirm.mockResolvedValue(true); });
const chain = { id: 'fragment', name: '柔光', type: 'preset', basePrompt: 'soft light', previewImage: '/synthetic/landscape.png', tags: [], params: { _promptLibraryDirectoryIds: ['light'] } } as unknown as PromptChain;

it('只读助手可打开真实资料卡片，但删除按钮不继承卡片browse', async () => {
  const open = vi.fn(), remove = vi.fn();
  render(<main data-agent-view="content-library"><PromptLibraryCard chain={chain} label="光照" onOpen={open} onDelete={remove} notify={vi.fn()} /></main>);
  const page = readAgentPage();
  const card = page.controls.find(control => control.label === '查看柔光')!;
  await act(async () => { await operateAgentPage({ action: 'click', snapshotId: page.snapshotId, controlId: card.id, permissionMode: 'read_only', timeoutMs: 200 }); });
  expect(open).toHaveBeenCalledOnce();
  const current = readAgentPage(), target = current.controls.find(control => control.label === '删除「柔光」')!;
  await expect(operateAgentPage({ action: 'click', snapshotId: current.snapshotId, controlId: target.id, permissionMode: 'read_only' })).rejects.toThrow('只读');
  expect(remove).not.toHaveBeenCalled();
  expect(current.controls.find(control => control.label === '编辑柔光')).toBeUndefined();
});

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

it('片段卡片保留选中与变暗状态，封面不展示使用', () => {
  const open = vi.fn();
  const props = { chain, label: '光照', onOpen: open, notify: vi.fn() };
  const view = render(<PromptLibraryCard {...props} selected />);
  const card = screen.getByRole('button', { name: '查看柔光' });
  expect(card.getAttribute('aria-pressed')).toBe('true');
  expect(card.classList.contains('ring-2')).toBe(true);
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  expect(screen.queryByRole('button', { name: '送到实验室' })).toBeNull();
  expect(open).not.toHaveBeenCalled();
  view.rerender(<PromptLibraryCard {...props} dimmed />);
  expect(card.getAttribute('aria-pressed')).toBe('false');
  expect(card.classList.contains('brightness-[.7]')).toBe(true);
  view.rerender(<PromptLibraryCard {...props} />);
  expect(card.classList.contains('brightness-[.7]')).toBe(false);
});

it('组合卡片封面也不展示送到实验室，点击卡片才打开详情', () => {
  const open = vi.fn();
  const combination = { ...chain, ...createCombinationData('夜景组合', { scene: { kind: 'scene', text: 'night sky', filled: true } }) } as PromptChain;
  render(<PromptLibraryCard chain={combination} label="组合" onOpen={open} notify={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '送到实验室' })).toBeNull();
  expect(screen.queryByRole('button', { name: '使用' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看夜景组合' }));
  expect(open).toHaveBeenCalledOnce();
});

it('当前目录显示真实路径与多归属，未归类和旧类型分别回退', () => {
  const directories = { revision: 1, nodes: [{ id: 'root', name: '光照与色彩', parentId: null }, { id: 'light', name: '光源与明暗', parentId: 'root' }, { id: 'other', name: '其他', parentId: null }] };
  expect(promptLibraryEntryLabel(chain, directories)).toBe('光照与色彩 / 光源与明暗');
  expect(promptLibraryEntryLabel({ ...chain, params: { ...chain.params, _promptLibraryDirectoryIds: ['light', 'other'] } } as PromptChain, directories)).toBe('光照与色彩 / 光源与明暗、其他');
  expect(promptLibraryEntryLabel({ ...chain, params: { ...chain.params, _promptLibraryDirectoryIds: [] } } as PromptChain, directories)).toBe('未归类');
  expect(promptLibraryEntryLabel({ ...chain, type: 'wardrobe' })).toBe('服饰');
});

it('卡片信息栏名称贴在标签上方，不展示目录路径', () => {
  render(<PromptLibraryCard chain={chain} label="光照与色彩 / 光源与明暗" summary="soft light" tagContent={<span>光照</span>} onOpen={vi.fn()} notify={vi.fn()} />);
  const caption = document.querySelector('.gallery-card-caption') as HTMLElement;
  expect(caption.textContent).not.toContain('光照与色彩');
  expect(caption.textContent).not.toContain('光源与明暗');
  const nodes = [...caption.children].map(node => node.tagName.toLowerCase());
  expect(nodes).toEqual(['p', 'h3', 'div']);
  expect(caption.querySelector('h3')?.textContent).toBe('柔光');
  expect(caption.querySelector('.gallery-card-meta')?.textContent).toBe('光照');
});

it('保存按钮具有独立语义，使用操作继续采用主题色', () => {
  render(<><ToolbarButton tone="save">保存</ToolbarButton><ToolbarButton tone="primary">使用</ToolbarButton></>);
  expect(screen.getByRole('button', { name: '保存' }).getAttribute('data-tone')).toBe('save');
  expect(screen.getByRole('button', { name: '保存' }).classList.contains('bg-emerald-700')).toBe(true);
  expect(screen.getByRole('button', { name: '使用' }).getAttribute('data-tone')).toBe('primary');
});

it('有封面时在删除下方提供清除封面，无封面或未接线不显示', async () => {
  const clear = vi.fn(async () => {});
  const notify = vi.fn();
  const view = render(<PromptLibraryCard chain={chain} onOpen={vi.fn()} onDelete={vi.fn()} onClearCover={clear} notify={notify} />);
  const button = screen.getByRole('button', { name: '删除当前封面' });
  expect(button.closest('[data-image-action-left]')?.className).toMatch(/top-14|md:top-11/);
  fireEvent.click(button);
  await act(async () => { await Promise.resolve(); });
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'prompt-library-cover.delete', tone: 'danger' }));
  expect(clear).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith('已清除封面');
  view.rerender(<PromptLibraryCard chain={{ ...chain, previewImage: undefined }} onOpen={vi.fn()} onDelete={vi.fn()} onClearCover={clear} notify={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '删除当前封面' })).toBeNull();
  cleanup();
  render(<PromptLibraryCard chain={chain} onOpen={vi.fn()} onDelete={vi.fn()} notify={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '删除当前封面' })).toBeNull();
});

it('取消清除封面确认时不写回', async () => {
  confirm.mockResolvedValueOnce(false);
  const clear = vi.fn(async () => {});
  render(<PromptLibraryCard chain={chain} onOpen={vi.fn()} onClearCover={clear} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '删除当前封面' }));
  await act(async () => { await Promise.resolve(); });
  expect(clear).not.toHaveBeenCalled();
});
