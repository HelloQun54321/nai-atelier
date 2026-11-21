// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LabTrialNavigation } from '../../components/LabTrialNavigation';
import { createLabTrial } from '../../services/labTrials';
import type { LocalGenItem } from '../../types';
import { listGenerationSeriesSessions } from '../../services/generationSeries';
const confirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => confirm }));
vi.mock('../../services/generationSeries', () => ({ listGenerationSeriesSessions: vi.fn(() => []) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = () => { const trials = [createLabTrial('owner', '水彩'), createLabTrial('owner', '厚涂')]; return { trials, activeId: trials[0].id,
  onSelect: vi.fn(), onAdd: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(), results: {}, notify: vi.fn() }; };
it('新建与复制各自明确，切换不保存风格串，改名只作用于当前分区', () => {
  const p = props(); render(<LabTrialNavigation {...p} />);
  fireEvent.click(screen.getByRole('button', { name: '新建试画分区' })); expect(p.onAdd).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: '复制当前试画分区' })); expect(p.onAdd).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('tab', { name: '厚涂' })); expect(p.onSelect).toHaveBeenCalledWith(p.trials[1].id);
  fireEvent.click(screen.getByRole('button', { name: '重命名试画分区' })); fireEvent.change(screen.getByRole('textbox', { name: '分区名称' }), { target: { value: '新画风' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' })); expect(p.onRename).toHaveBeenCalledWith(p.activeId, '新画风');
});
it('对比两分区真实结果，选择变化后跟随图片，Esc 收起对比', () => {
  const p = props(); const image = (id: string) => ({ id, imageUrl: '/synthetic-'+id+'.png', prompt: id, createdAt: 1, params: {} } as LocalGenItem);
  render(<LabTrialNavigation {...p} results={{ [p.trials[0].id]: image('a'), [p.trials[1].id]: image('b') }} />);
  fireEvent.click(screen.getByRole('button', { name: '对比试画结果' })); const modal = screen.getByRole('dialog', { name: '对比试画结果' });
  expect(within(modal).getByAltText('水彩').getAttribute('src')).toBe('/synthetic-a.png'); expect(within(modal).getByAltText('厚涂').getAttribute('src')).toBe('/synthetic-b.png');
  fireEvent.change(within(modal).getByRole('combobox', { name: '右侧试画分区' }), { target: { value: p.trials[0].id } });
  expect(within(modal).getAllByAltText('水彩')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('dialog', { name: '对比试画结果' })).toBeNull();
});
it('生成中的分区不能删除，空闲后确认才移除，历史保留说明明确', async () => {
  const p = props(); vi.mocked(listGenerationSeriesSessions).mockReturnValue([{ scope: p.activeId, session: {} }] as any);
  render(<LabTrialNavigation {...p} />); fireEvent.click(screen.getByRole('button', { name: '删除试画分区' })); expect(p.onRemove).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  vi.mocked(listGenerationSeriesSessions).mockReturnValue([]); fireEvent.click(screen.getByRole('button', { name: '删除试画分区' }));
  await vi.waitFor(() => expect(p.onRemove).toHaveBeenCalledWith(p.activeId)); expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('生成历史仍会保留') }));
});
