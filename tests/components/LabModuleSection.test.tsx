// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LabModuleSection } from '../../components/LabModuleSection';

afterEach(cleanup);

it('沿用默认展开偏好，手动收起后普通更新保持状态与草稿，偏好变化再同步', async () => {
  const content = (collapsed: boolean, label = '全局提示词') => <LabModuleSection moduleId="prompt" label={label} defaultCollapsed={collapsed}>
    <input aria-label="合成提示词" defaultValue="original" />
  </LabModuleSection>;
  const view = render(content(false));
  const section = view.container.querySelector('details')!;
  const input = screen.getByLabelText('合成提示词') as HTMLInputElement;
  expect(section.open).toBe(true);
  expect(section.style.order).toBe('');
  fireEvent.change(input, { target: { value: '未保存草稿' } });
  fireEvent.click(screen.getByText('全局提示词'));
  await waitFor(() => expect(section.open).toBe(false));
  view.rerender(content(false, '更新标题'));
  expect(section.open).toBe(false);
  expect(input.value).toBe('未保存草稿');
  view.rerender(content(true));
  expect(section.open).toBe(false);
  view.rerender(content(false));
  expect(section.open).toBe(true);
  expect(screen.getByLabelText('合成提示词')).toBe(input);
  expect(input.value).toBe('未保存草稿');
});
