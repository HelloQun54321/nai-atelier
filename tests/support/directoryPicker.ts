import { expect } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

const openTrigger = (label: string) => {
  const trigger = screen.getByRole('button', { name: label });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return trigger;
};

/** 消化 MobileBottomSheet 关闭时的 history.back，避免与下一层弹窗抢返回栈。 */
export const flushDirectoryPickerHistory = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** 打开共用目录树的手机主题化路径面板并点选一项。 */
export const pickDirectoryOption = (label: string, value: string) => {
  openTrigger(label);
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('option', { name: (_, element) => element.getAttribute('data-value') === value }));
};

export const pickDirectoryOptionAsync = async (label: string, value: string) => {
  pickDirectoryOption(label, value);
  await flushDirectoryPickerHistory();
};

export const openDirectoryPicker = (label: string) => {
  openTrigger(label);
  return within(screen.getByRole('dialog', { name: label }));
};

export const directoryPickerValue = (label: string) => screen.getByRole('button', { name: label }).getAttribute('data-value');

export const directoryPickerOptions = (label: string) => Array.from(openDirectoryPicker(label).getAllByRole('option'));

/** 桌面树行的计数（aria-describedby），替代旧原生 option「名称 (计数)」断言。 */
export const expectDirectoryCount = (name: string | RegExp, count: string) => {
  const row = screen.getAllByRole('button', { name }).find(button => button.closest('.directory-tree-navigation') && button.getAttribute('aria-describedby'));
  expect(row).toBeTruthy();
  expect(document.getElementById(row!.getAttribute('aria-describedby')!)?.textContent).toBe(count);
};
