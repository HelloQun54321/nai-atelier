// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ImagePreviewActions } from '../../components/ImagePreviewActions';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';

afterEach(cleanup);

const wrap = (node: React.ReactNode) => render(<ConfirmDialogProvider>{node}</ConfirmDialogProvider>);

it('只有已入库的历史图才显示官方放大，尺寸不超限才可用', () => {
  const size = { params: { width: 832, height: 1216 } };
  wrap(<ImagePreviewActions filename="a.png" imageUrl="/api/local-history/h1/image" generationData={size} />);
  expect(screen.queryByLabelText('官方放大 2 倍')).toBeNull();
  cleanup();
  wrap(<ImagePreviewActions filename="a.png" imageUrl="/api/local-history/h1/image" generationData={size} historyId="h1" />);
  expect(screen.getByLabelText('官方放大 2 倍')).toBeTruthy();
});

it('超过官方 3,145,728 像素上限时不显示放大入口', () => {
  wrap(<ImagePreviewActions filename="a.png" imageUrl="/api/local-history/h1/image" historyId="h1" generationData={{ params: { width: 2048, height: 1537 } }} />);
  expect(screen.queryByLabelText('官方放大 2 倍')).toBeNull();
});

it('尺寸未知时不阻止入口，交由官方判定', () => {
  wrap(<ImagePreviewActions filename="a.png" imageUrl="/api/local-history/h1/image" historyId="h1" />);
  expect(screen.getByLabelText('官方放大 2 倍')).toBeTruthy();
});
