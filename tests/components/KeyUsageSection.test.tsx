// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyUsageSection } from '../../components/KeyUsageSection';
import type { KeyUsageRow } from '../../services/usageEvents';

const mocks = vi.hoisted(() => ({ hash: vi.fn() }));
vi.mock('../../services/anlasBudget', () => ({ getActiveKeyHash: mocks.hash }));

const row = (overrides: Partial<KeyUsageRow> = {}): KeyUsageRow => ({
  keyHash: 'a'.repeat(64), name: '主号', images: 7,
  models: [{ model: 'nai-diffusion-4-5-full', images: 3 }, { model: 'nai-diffusion-5-full-medium', images: 4 }],
  generationAnlas: 8, encodingAnlas: 2, opusImages: 4, unknownBillingImages: 0,
  lifetime: { anlasSpent: 90, opusImages: 20 }, ...overrides,
});
const props = { period: '2026年10月', loading: false, error: '', onRetry: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); mocks.hash.mockResolvedValue('a'.repeat(64)); });
afterEach(cleanup);

it('各 Key 独立显示模型张数和费用，原位展开费用拆分及不受周期限制的旧累计', async () => {
  render(<KeyUsageSection {...props} rows={[row(), row({ keyHash: 'b'.repeat(64), name: '拼车号', images: 12, generationAnlas: 30 })]} />);
  expect(await screen.findByText('使用中')).toBeTruthy();
  expect(screen.getAllByText('使用中')).toHaveLength(1);
  const main = screen.getByLabelText('主号 用量明细');
  const shared = screen.getByLabelText('拼车号 用量明细');
  expect(within(main).getByText('7')).toBeTruthy();
  expect(within(main).getByText('10')).toBeTruthy();
  expect(within(shared).getByText('12')).toBeTruthy();
  expect(within(shared).getByText('32')).toBeTruthy();
  expect(within(main).getByText('V4.5 3 · V5 4')).toBeTruthy();
  expect(main.closest('details')!.open).toBe(false);
  fireEvent.click(main);
  expect(main.closest('details')!.open).toBe(true);
  const detail = within(main.closest('details')!);
  expect(detail.getByText('8 Anlas')).toBeTruthy();
  expect(detail.getByText('2 Anlas')).toBeTruthy();
  expect(detail.getByText(/本地累计（含旧版）：90 Anlas/)).toBeTruthy();
  expect(shared.closest('details')!.open).toBe(false);
});

it('未知计费不显示为零，未保存在保管箱的 Key 仍可区分', async () => {
  render(<KeyUsageSection {...props} rows={[row({ name: null, unknownBillingImages: 2, generationAnlas: 0, encodingAnlas: 0, opusImages: 0 })]} />);
  await screen.findByText('使用中');
  const main = screen.getByLabelText('当前密钥 用量明细');
  expect(within(main).getAllByText('—')).toHaveLength(2);
  expect(screen.getByText(/2 张图片缺少计费快照/)).toBeTruthy();
});

it('统计加载、失败和空记录分别呈现，不用零代替读取失败', () => {
  const view = render(<KeyUsageSection {...props} rows={[]} loading />);
  expect(screen.getByRole('status')).toBeTruthy();
  view.rerender(<KeyUsageSection {...props} rows={[]} error="合成错误" />);
  expect(screen.getByRole('alert').textContent).toContain('合成错误');
  fireEvent.click(screen.getByText('重试')); expect(props.onRetry).toHaveBeenCalledOnce();
  view.rerender(<KeyUsageSection {...props} rows={[]} />);
  expect(screen.getByText('暂无 Key 用量记录')).toBeTruthy();
});

it('切 Key 只更新使用中标记，旧异步指纹不覆盖新标记、不修改实际 Key', async () => {
  let oldHash!: (hash: string) => void;
  mocks.hash.mockImplementationOnce(() => new Promise<string>(resolve => { oldHash = resolve; }));
  render(<KeyUsageSection {...props} rows={[row(), row({ keyHash: 'b'.repeat(64), name: '拼车号' })]} />);
  mocks.hash.mockResolvedValue('b'.repeat(64));
  act(() => { window.dispatchEvent(new Event('nai-api-key-changed')); });
  await waitFor(() => expect(within(screen.getByLabelText('拼车号 用量明细')).getByText('使用中')).toBeTruthy());
  await act(async () => { oldHash('a'.repeat(64)); });
  expect(within(screen.getByLabelText('主号 用量明细')).queryByText('使用中')).toBeNull();
});

it('三个当前 Key 保持主列表，两个无法匹配的旧指纹折叠为历史用量', async () => {
  render(<KeyUsageSection {...props} includeLifetime period="全部年份" rows={[
    row(), row({ keyHash: 'b'.repeat(64), name: '第二把' }), row({ keyHash: 'c'.repeat(64), name: '第三把' }),
    row({ keyHash: 'd'.repeat(64), name: null, images: 0, models: [], lifetime: { anlasSpent: 150, opusImages: 30 } }),
    row({ keyHash: 'e'.repeat(64), name: null, images: 0, models: [], lifetime: { anlasSpent: 200, opusImages: 40 } }),
  ]} />);
  await screen.findByText('使用中');
  const section = screen.getByRole('region', { name: 'Key 使用量' });
  expect(section.querySelectorAll(':scope > details.key-usage__entry')).toHaveLength(3);
  const summary = screen.getByText('未关联的历史用量（2条）');
  const archive = summary.closest('details')!;
  expect(archive.open).toBe(false);
  expect(archive.querySelectorAll('details.key-usage__entry')).toHaveLength(2);
  fireEvent.click(summary);
  expect(archive.open).toBe(true);
  expect(within(screen.getByLabelText('历史用量 · dddddd 用量明细')).getByText('150')).toBeTruthy();
  expect(within(screen.getByLabelText('历史用量 · eeeeee 用量明细')).getByText('200')).toBeTruthy();
});

it('全部年份直接显示旧累计，不重复相加；旧版未记录的张数显示缺失而非零', async () => {
  const legacyOnly = row({ images: 0, models: [], generationAnlas: 0, encodingAnlas: 0, opusImages: 0 });
  const view = render(<KeyUsageSection {...props} includeLifetime period="全部年份" rows={[legacyOnly]} />);
  await screen.findByText('使用中');
  let summary = screen.getByLabelText('主号 用量明细');
  expect(within(summary).getByText('90')).toBeTruthy();
  expect(within(summary).getByText('20')).toBeTruthy();
  expect(within(summary).getAllByText('—')).toHaveLength(3);
  expect(within(summary).queryByText('0')).toBeNull();
  view.rerender(<KeyUsageSection {...props} includeLifetime period="全部年份" rows={[row()]} />);
  summary = screen.getByLabelText('主号 用量明细');
  expect(within(summary).getByText('90')).toBeTruthy();
  expect(within(summary).queryByText('100')).toBeNull();
  view.rerender(<KeyUsageSection {...props} rows={[legacyOnly]} />);
  expect(within(screen.getByLabelText('主号 用量明细')).getAllByText('—')).toHaveLength(5);
  expect(screen.getByText(/本地累计（含旧版）：90 Anlas/)).toBeTruthy();
});
