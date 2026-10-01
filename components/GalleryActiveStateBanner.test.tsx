// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GalleryActiveStateBanner } from './GalleryActiveStateBanner';

afterEach(cleanup);

it('顶栏已有抽卡按钮时，状态条保留结果与返回操作', () => {
  const onExit = vi.fn(); const onDrawAgain = vi.fn();
  const { rerender } = render(<GalleryActiveStateBanner count={12} entityName="角色" onDrawAgain={onDrawAgain} onExit={onExit} showDrawAgain={false} />);
  expect(screen.getByText('正在浏览随机抽取的 12 位角色')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '再抽一批' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回完整目录' }));
  expect(onExit).toHaveBeenCalledOnce();
  expect(onDrawAgain).not.toHaveBeenCalled();
  rerender(<GalleryActiveStateBanner count={12} entityName="角色" onDrawAgain={onDrawAgain} onExit={onExit} />);
  fireEvent.click(screen.getByRole('button', { name: '再抽一批' }));
  expect(onDrawAgain).toHaveBeenCalledOnce();
});
