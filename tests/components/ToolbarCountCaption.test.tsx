// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createPortal } from 'react-dom';
import { WorkspaceChrome, WorkspaceToolbar } from '../../components/DesignSystem';
import { ToolbarCountCaption } from '../../components/ToolbarCountCaption';
import { setTopbarCollapsed } from '../../services/workspaceTopbar';

afterEach(() => { cleanup(); setTopbarCollapsed(false); });

it('数量仅叠放在原顶栏末端，附加行保留且随原把手收起', () => {
  const { container } = render(<div><WorkspaceChrome><WorkspaceToolbar><button>搜索</button><ToolbarCountCaption>共 120 条 · 已加载 20 条</ToolbarCountCaption></WorkspaceToolbar><p>已有筛选条件</p></WorkspaceChrome></div>);
  const caption = screen.getByText('共 120 条 · 已加载 20 条');
  const header = container.querySelector('header');
  expect(caption.closest('header')).toBeNull();
  expect(caption.className).toContain('absolute');
  expect(caption.className).toContain('pointer-events-none');
  expect(caption.parentElement?.lastElementChild).toBe(caption);
  expect(header?.textContent).toBe('搜索');
  fireEvent.click(screen.getByRole('button', { name: '收起顶栏' }));
  expect(caption.parentElement?.className).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: '展开顶栏' }));
  expect(caption.parentElement?.className).toBe('contents');
  expect(container.querySelector('header')).toBe(header);
});

it('投射到工具栏的内容按实际DOM定位，普通弹窗使用原header', () => {
  const target = document.createElement('div');
  const { unmount } = render(<header data-toolbar-caption-host="true" className="relative"><div ref={node => { if (node && !target.parentElement) node.append(target); }} />{createPortal(<ToolbarCountCaption>匹配 0 条</ToolbarCountCaption>, target)}</header>);
  const caption = screen.getByText('匹配 0 条');
  expect(caption.parentElement?.tagName).toBe('HEADER');
  expect(target.querySelector('[data-toolbar-count-caption]')).toBeNull();
  unmount();
  expect(document.querySelector('[data-toolbar-count-caption]')).toBeNull();
});
