import { expect } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';

/** 打开共用目录选择面板：直达模式展开后已打开；嵌入模式仍点路径按钮。 */
const openTrigger = (label: string) => {
  const existing = screen.queryByRole('dialog', { name: label });
  if (existing) return;
  const trigger = screen.queryByRole('button', { name: label });
  if (trigger && trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
};

/** 消化 MobileBottomSheet 关闭时的 history.back，避免与下一层弹窗抢返回栈。 */
export const flushDirectoryPickerHistory = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** 打开共用目录树的手机主题化路径面板并点选一项；筛选面板改用原生下拉时直接改值。 */
export const pickDirectoryOption = (label: string, value: string) => {
  openTrigger(label);
  const dialog = screen.queryByRole('dialog', { name: label });
  if (dialog) {
    fireEvent.click(within(dialog).getByRole('option', { name: (_, element) => element.getAttribute('data-value') === value }));
    return;
  }
  const select = screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
};

export const pickDirectoryOptionAsync = async (label: string, value: string) => {
  pickDirectoryOption(label, value);
  await flushDirectoryPickerHistory();
};

export const openDirectoryPicker = (label: string) => {
  openTrigger(label);
  return within(screen.getByRole('dialog', { name: label }));
};

export const directoryPickerValue = (label: string) => {
  const trigger = screen.queryByRole('button', { name: label });
  if (trigger) return trigger.getAttribute('data-value');
  const select = screen.queryByRole('combobox', { name: label }) as HTMLSelectElement | null;
  if (select) return select.value;
  return document.querySelector('[data-directory-selected]')?.getAttribute('data-directory-selected') ?? null;
};

export const directoryPickerOptions = (label: string) => Array.from(openDirectoryPicker(label).getAllByRole('option'));

/** 桌面树行的计数（aria-describedby）；手机直达面板则看 option「名称 (计数)」。 */
export const expectDirectoryCount = (name: string | RegExp, count: string) => {
  const row = screen.queryAllByRole('button', { name }).find(button => button.closest('.directory-tree-navigation') && button.getAttribute('aria-describedby'));
  if (row) {
    expect(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent).toBe(count);
    return;
  }
  const label = typeof name === 'string' ? `${name} (${count})` : name;
  expect(screen.getByRole('option', { name: label })).toBeTruthy();
};
