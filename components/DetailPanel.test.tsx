// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DetailSidePanel } from './DetailPanel';
import { readAgentPage } from '../services/agentWorkspace';

afterEach(cleanup);

it('原帖链接位于固定标题栏关闭钮左侧，正文滚动不带走入口，窄屏保留返回', () => {
  const onClose = vi.fn(), onBack = vi.fn();
  render(<DetailSidePanel open title="很长的作品标题" sourceUrl="https://example.invalid/posts/123" onClose={onClose} onBack={onBack}><p>图片正文</p></DetailSidePanel>);
  const link = screen.getByRole('link', { name: '查看原帖' });
  const close = screen.getByRole('button', { name: '关闭' });
  const header = link.closest('header')!;
  expect(header.contains(close)).toBe(true);
  expect(link.nextElementSibling).toBe(close);
  expect(link.getAttribute('href')).toBe('https://example.invalid/posts/123');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noreferrer');
  expect(link.classList.contains('h-10')).toBe(true);
  expect(link.classList.contains('w-10')).toBe(true);
  expect(link.getAttribute('style')).toBeNull();
  expect(header.classList.contains('flex-none')).toBe(true);
  expect(header.contains(screen.getByText('图片正文'))).toBe(false);
  expect(screen.getByText('图片正文').parentElement?.classList.contains('overflow-y-auto')).toBe(true);
  expect(screen.getByText('很长的作品标题').parentElement?.parentElement?.classList.contains('flex-1')).toBe(true);
  expect(close.className).toContain('hidden lg:inline-flex');
  const back = screen.getByRole('button', { name: '返回' });
  expect(back.className).toContain('lg:hidden');
  fireEvent.click(back); expect(onBack).toHaveBeenCalledTimes(1);
  fireEvent.click(close); expect(onClose).toHaveBeenCalledTimes(1);
});

it('未传来源的其他详情仍保留原正文和关闭行为，不出现空来源按钮', () => {
  render(<DetailSidePanel open title="其他图库" onClose={vi.fn()}><p>已有详情</p></DetailSidePanel>);
  expect(screen.queryByRole('link', { name: '查看原帖' })).toBeNull();
  expect(screen.getByText('已有详情')).toBeTruthy();
  expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
});

it.each(['aitag', 'pixiv', 'danbooru'])('%s 的详情优先于长列表，换作品更新身份、关闭恢复列表', view => {
  const draw = (open: boolean, title: string, id: number) => <main data-agent-view={view}><p>{'列表作品摘要 '.repeat(400)}</p><button>筛选</button><DetailSidePanel open={open} title={title} subInfo={`#${id} · 合成来源`} onClose={vi.fn()}><p>当前详情的完整提示词</p><button>查看当前图片</button></DetailSidePanel></main>;
  const result = render(draw(false, '作品甲', 101));
  const list = readAgentPage(); expect(list.foreground).toBe(''); expect(list.text).not.toContain('当前详情');
  result.rerender(draw(true, '作品甲', 101));
  const detail = readAgentPage(); expect(detail).toMatchObject({ view, foreground: 'detail' }); expect(detail.title).toContain('作品详情：作品甲');
  expect(detail.text).toContain('#101'); expect(detail.text).toContain('当前详情的完整提示词'); expect(detail.text).not.toContain('列表作品摘要'); expect(detail.controls.some(item => item.label === '筛选')).toBe(false);
  result.rerender(draw(true, '作品乙', 202));
  const switched = readAgentPage(); expect(switched.snapshotId).not.toBe(detail.snapshotId); expect(switched.title).toContain('作品乙'); expect(switched.text).toContain('#202');
  result.rerender(draw(false, '作品乙', 202)); expect(readAgentPage().foreground).toBe(''); expect(readAgentPage().text).toContain('列表作品摘要');
});
