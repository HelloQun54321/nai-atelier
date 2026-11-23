// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import * as chunkReload from '../../services/chunkReload';

const Thrower: React.FC<{ error: Error }> = ({ error }) => {
  throw error;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('旧分包加载失败首次自动静默刷新并显示同步提示，不弹出崩溃框', () => {
    vi.spyOn(chunkReload, 'recoverFromDynamicImportError').mockReturnValueOnce(true);
    render(
      <ErrorBoundary>
        <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/StyleRollPage-old.js')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('正在同步新版界面…')).toBeTruthy();
    expect(screen.queryByText('界面遇到了意外错误')).toBeNull();
  });

  it('自动刷新仍在冷却期时展示更友好的版本更新提示', () => {
    vi.spyOn(chunkReload, 'recoverFromDynamicImportError').mockReturnValueOnce(false);
    render(
      <ErrorBoundary>
        <Thrower error={new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/StyleRollPage-old.js')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面版本已更新')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeTruthy();
  });

  it('普通渲染错误仍展示常规意外错误恢复页', () => {
    render(
      <ErrorBoundary>
        <Thrower error={new Error('synthetic crash')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('界面遇到了意外错误')).toBeTruthy();
    expect(screen.getByText('synthetic crash')).toBeTruthy();
  });
});
