// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryTreeSelect } from '../../components/DirectoryTreeSelect';

afterEach(cleanup);
const nodes = [{ id: 'root', name: '根' }, { id: 'child', parentId: 'root', name: '子项' }, { id: 'leaf', parentId: 'child', name: '末层' }];
it('父级选择显示完整路径，保留根选项并排除传入的自身和后代', () => {
  const onChange = vi.fn();
  render(<DirectoryTreeSelect nodes={nodes} rootLabel="顶层" excludeIds={['child', 'leaf']} aria-label="上级目录" value="" onChange={onChange} />);
  expect(screen.getByRole('option', { name: '顶层' }).getAttribute('value')).toBe('');
  expect(screen.getByRole('option', { name: '根' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: '根 / 子项' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'root' } });
  expect(onChange).toHaveBeenCalledOnce();
});
it('没有根选项时直接列目录，原生属性与禁用状态透传', () => {
  render(<DirectoryTreeSelect nodes={nodes} disabled name="parent" aria-label="上级目录" />);
  expect(screen.getByRole('option', { name: '根 / 子项 / 末层' })).toBeTruthy();
  expect(screen.getAllByRole('option')).toHaveLength(3);
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByRole('combobox').getAttribute('name')).toBe('parent');
});
