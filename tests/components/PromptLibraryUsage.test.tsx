// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import dictionary from '../../locales/messages.json';
import { PromptLibraryUsageBadge, PromptLibraryUsageSection } from '../../components/PromptLibraryUsage';

const mocks = vi.hoisted(() => ({ images: vi.fn() }));

vi.mock('../../services/promptLibraryUsage', async original => ({
  ...await original<typeof import('../../services/promptLibraryUsage')>(),
  fetchPromptLibraryUsageImages: mocks.images,
}));

/* 大图查看器本身有独立回归（tests/components/ImageLightbox.test.tsx）；这里只验证接线与传参。 */
vi.mock('../../components/ImageLightbox', () => ({
  ImageLightbox: ({ src, onClose }: { src: string; onClose: () => void }) => (
    <div role="dialog" aria-label="图片预览" data-viewer-src={src}>
      <button type="button" onClick={onClose}>返回图片详情</button>
    </div>
  ),
}));

const row = (id: string) => ({ id, imageUrl: `/api/local-history/${id}/image`, prompt: `prompt ${id}`, createdAt: 1, params: {} });
const page = (ids: string[], count: number, offset = 0) => ({
  items: ids.map(row), count, limit: 12, offset, linkKind: 'appearance', linkChainName: 'chain',
});

beforeEach(() => {
  mocks.images.mockReset();
  // 缩略图与历史条目共用移动端图片显示偏好，jsdom 没有 matchMedia。
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('卡片胶囊按 count 渲染「N 图」，零与负数不渲染，点击不冒泡到卡片', () => {
  const open = vi.fn();
  const view = render(<div onClick={open}><PromptLibraryUsageBadge count={3} /></div>);
  const badge = screen.getByLabelText('3 图');
  expect(badge.textContent).toBe('3 图');
  expect(badge.hasAttribute('data-prompt-library-usage')).toBe(true);
  fireEvent.click(badge);
  expect(open).not.toHaveBeenCalled();
  for (const count of [0, -2, Number.NaN]) {
    view.rerender(<div onClick={open}><PromptLibraryUsageBadge count={count} /></div>);
    expect(view.container.querySelector('[data-prompt-library-usage]')).toBeNull();
  }
});

it('详情区空态显示尚未生成提示，并明确标题与零图', async () => {
  mocks.images.mockResolvedValue(page([], 0));
  render(<PromptLibraryUsageSection chainId="chain-empty" />);
  await screen.findByText('还没有用这条提示词生成过的图');
  expect(screen.getByText('生成记录')).toBeTruthy();
  expect(mocks.images).toHaveBeenCalledWith('chain-empty', { limit: 12, offset: 0 });
  expect(screen.queryAllByLabelText(/查看生成图/)).toHaveLength(0);
});

it('有图时显示总数、2:3 缩略图网格，点缩略图用现成大图查看器打开原图', async () => {
  mocks.images.mockResolvedValue(page(['a', 'b', 'c'], 3));
  const view = render(<PromptLibraryUsageSection chainId="chain-1" />);
  await screen.findByLabelText('查看生成图 1');
  expect(screen.getByText('3 图')).toBeTruthy();
  const thumbs = screen.getAllByLabelText(/查看生成图/);
  expect(thumbs).toHaveLength(3);
  expect(thumbs[0].firstElementChild?.className).toContain('aspect-[2/3]');
  expect(view.container.querySelector('[data-prompt-library-usage-section="chain-1"]')).toBeTruthy();
  fireEvent.click(thumbs[1]);
  expect(screen.getByRole('dialog', { name: '图片预览' }).getAttribute('data-viewer-src')).toBe('/api/local-history/b/image');
  fireEvent.click(screen.getByRole('button', { name: '返回图片详情' }));
  expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();
});

it('总数大于首屏时按同一页大小追加，取满后不再显示「加载更多」', async () => {
  mocks.images.mockResolvedValueOnce(page(['a', 'b', 'c'], 5));
  render(<PromptLibraryUsageSection chainId="chain-2" />);
  await screen.findByLabelText('查看生成图 3');
  expect(screen.getByText('5 图')).toBeTruthy();
  mocks.images.mockResolvedValueOnce(page(['d', 'e'], 5, 3));
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  await screen.findByLabelText('查看生成图 5');
  expect(mocks.images).toHaveBeenLastCalledWith('chain-2', { limit: 12, offset: 3 });
  expect(screen.getAllByLabelText(/查看生成图/)).toHaveLength(5);
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
});

it('读取失败显示可重试错误态，重试后恢复网格', async () => {
  mocks.images.mockRejectedValueOnce(new Error('读取生成图记录失败：服务返回 HTTP 500'));
  mocks.images.mockResolvedValueOnce(page(['a'], 1));
  render(<PromptLibraryUsageSection chainId="chain-3" />);
  await screen.findByText('读取失败，请重试');
  expect(screen.queryAllByLabelText(/查看生成图/)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByLabelText('查看生成图 1');
  expect(screen.getByText('1 图')).toBeTruthy();
  expect(mocks.images).toHaveBeenLastCalledWith('chain-3', { limit: 12, offset: 0 });
});

it('紧凑预览态只取首屏、不提供加载更多', async () => {
  mocks.images.mockResolvedValue(page(['a'], 9));
  render(<PromptLibraryUsageSection chainId="chain-4" preview />);
  await screen.findByLabelText('查看生成图 1');
  expect(mocks.images).toHaveBeenCalledWith('chain-4', { limit: 6, offset: 0 });
  expect(screen.getByText('9 图')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
});

it('生成记录相关文案在四语言字典中齐全且占位符一致', () => {
  const keys = ['生成记录', '{0} 图', '还没有用这条提示词生成过的图', '查看生成图 {0}', '读取失败，请重试', '加载更多'];
  for (const key of keys) {
    const variants = (dictionary as Record<string, string[]>)[key];
    expect(variants, key).toHaveLength(4);
    for (const value of variants) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), key)
        .toEqual([...key.matchAll(/\{\d+\}/g)].map(match => match[0]).sort());
    }
  }
});
