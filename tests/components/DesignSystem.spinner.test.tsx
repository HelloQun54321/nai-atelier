// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { InlineSpinner, PageSpinner } from '../../components/DesignSystem';

afterEach(() => cleanup());

it('PageSpinner 钉在工作区正中，不随正文流式顶栏上跳', () => {
  const { container } = render(
    <div className="app-workspace relative flex min-h-0 flex-1 flex-col">
      <header data-testid="chrome">顶栏</header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageSpinner />
      </div>
    </div>,
  );
  const status = screen.getByRole('status');
  expect(status.hasAttribute('data-page-spinner')).toBe(true);
  expect(status.className).toContain('absolute');
  expect(status.className).toContain('inset-0');
  expect(status.textContent).toContain('加载中…');
  expect(status.parentElement?.classList.contains('app-workspace')).toBe(true);
  expect(container.querySelector('.animate-spin')).toBeTruthy();
});

it('保活视图里的 PageSpinner 留在自己的容器内，后台页面的圈不漏到当前页', () => {
  render(
    <div className="app-workspace relative flex min-h-0 flex-1 flex-col">
      <div data-keep-alive-view="playground" className="hidden"><PageSpinner /></div>
      <div data-keep-alive-view="roll">当前页</div>
    </div>,
  );
  const status = screen.getByRole('status');
  expect(status.closest('[data-keep-alive-view]')?.getAttribute('data-keep-alive-view')).toBe('playground');
  expect(status.closest('.hidden')).toBeTruthy();
  expect(status.parentElement?.classList.contains('app-workspace')).toBe(false);
});

it('弹层内 PageSpinner 可关闭占满模式', () => {
  render(<PageSpinner fill={false} className="py-8" />);
  expect(screen.getByRole('status').hasAttribute('data-page-spinner')).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('加载中…');
});

it('InlineSpinner 用于已有内容时的轻量刷新，默认可读', () => {
  const { container } = render(<InlineSpinner />);
  expect(screen.getByRole('status').textContent).toContain('加载中…');
  expect(container.querySelector('.animate-spin')).toBeTruthy();
  expect(container.querySelector('.sr-only')).toBeTruthy();
});

it('InlineSpinner 可带可见文案', () => {
  render(<InlineSpinner label="刷新中…" />);
  expect(screen.getByRole('status').textContent).toContain('刷新中…');
  expect(screen.getByRole('status').querySelector('.sr-only')).toBeNull();
});
