// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmptyState, WorkspacePageState } from '../../components/DesignSystem';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, width, height: 200, top: 80, bottom: 280, x: left, y: 80, toJSON: () => ({}) });

it('展开目录时按整个正文居中，收起和手机尺寸变化后自动归位且保留原节点', () => {
  let body = rect(80, 1000), host = rect(288, 792);
  const resize: Array<() => void> = [], disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize.push(callback); } observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-workspace-body') ? body : this.hasAttribute('data-workspace-page-state') ? host : rect(0, 200);
  });
  const view = render(<div data-workspace-body><EmptyState title="没有匹配内容" action={<button>重置筛选</button>} /></div>);
  const state = document.querySelector<HTMLElement>('[data-workspace-page-state]')!, action = screen.getByRole('button');
  expect(state.style.getPropertyValue('--workspace-state-offset')).toBe('-104px');
  host = rect(80, 1000);
  act(() => resize.forEach(callback => callback()));
  expect(state.style.getPropertyValue('--workspace-state-offset')).toBe('0px');
  body = rect(0, 390); host = rect(0, 390);
  act(() => resize.forEach(callback => callback()));
  expect(state.style.getPropertyValue('--workspace-state-offset')).toBe('0px');
  expect(screen.getByRole('button')).toBe(action);
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
});

it('窄正文限制偏移，状态及操作不会被目录或滚动边界裁掉', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-workspace-body') ? rect(80, 580) : this.hasAttribute('data-workspace-page-state') ? rect(288, 372) : rect(0, 320);
  });
  render(<div data-workspace-body><WorkspacePageState role="status">没有匹配的画师<button>清除搜索</button></WorkspacePageState></div>);
  expect(screen.getByRole('status').style.getPropertyValue('--workspace-state-offset')).toBe('-26px');
});

it('独立弹窗和没有目录的内容保留本地居中', () => {
  render(<EmptyState title="弹窗空状态" />);
  expect(document.querySelector<HTMLElement>('[data-workspace-page-state]')!.style.getPropertyValue('--workspace-state-offset')).toBe('');
});
