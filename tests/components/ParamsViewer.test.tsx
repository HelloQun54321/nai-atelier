// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ParamsViewer } from '../../components/ParamsViewer';

afterEach(cleanup);
it('手机可点按完整采样器和种子，内容在浮层中换行，原参数不变化', () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'custom_very_long_sampler_name', seed: 987654321, qualityToggle: true, ucPreset: 4 };
  const snapshot = JSON.stringify(params); render(<ParamsViewer params={params} />);
  fireEvent.click(screen.getByRole('button', { name: '查看采样器完整值' }));
  expect(within(screen.getByRole('dialog', { name: '查看采样器完整值' })).getByText('custom very long sampler name')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭说明' }));
  fireEvent.click(screen.getByRole('button', { name: '查看随机种子完整值' }));
  expect(within(screen.getByRole('dialog', { name: '查看随机种子完整值' })).getByText('987654321')).toBeTruthy();
  expect(JSON.stringify(params)).toBe(snapshot);
});
