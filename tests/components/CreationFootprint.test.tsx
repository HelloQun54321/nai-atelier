// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreationFootprint } from '../../components/CreationFootprint';
import type { UsageStats } from '../../services/usageStats';

const mocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  getEvents: vi.fn(),
  getAssets: vi.fn(),
  getSessions: vi.fn(),
  ensureCollection: vi.fn(),
  collection: [] as { sourceType: string; sourceId: string; archived?: boolean }[],
}));

vi.mock('../../services/usageStats', async original => ({ ...await original<typeof import('../../services/usageStats')>(), getUsageStats: mocks.getStats, getUsageAssets: mocks.getAssets }));
vi.mock('../../services/collectionFavorites', () => ({
  ensureCollection: mocks.ensureCollection,
  collectionSnapshot: () => mocks.collection,
  subscribeCollection: () => () => {},
  collectionRevision: () => 0,
}));
vi.mock('../../services/anlasBudget', () => ({ getActiveKeyHash: async () => '' }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ info: null }) }));
vi.mock('../../services/promptAgent', () => ({ promptAgentService: { listSessions: mocks.getSessions } }));
vi.mock('../../services/usageEvents', () => ({ getUsageEventStats: mocks.getEvents }));

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
const todayKey = dayKey(today);
const yesterdayKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
const weekStart = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};
const previousMonth = (() => {
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
})();
const now = Date.now();

const stats = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  totals: { images: 120, activeDays: 12, favoriteImages: 8, firstAt: now - 30 * 86400000, lastAt: now, currentStreak: 3 },
  daily: [{ date: todayKey, images: 4 }, { date: yesterdayKey, images: 2 }],
  chains: [{ id: 'chain-a', name: '厚涂冷色', images: 80, lastAt: now }],
  artists: [{ name: 'alpha_artist', images: 60, lastAt: now }],
  characters: [{ id: 'character-a', name: '角色甲', images: 20, lastAt: now }],
  tags: [{ name: '1girl', images: 100 }, { name: 'solo', images: 90 }],
  characterUsage: { images: 30, slots: 45 },
  vibeUsage: { images: 12, slots: 18 },
  referenceUsage: { images: 8, slots: 10 },
  models: [{ model: 'nai-diffusion-4-5-full', images: 100 }],
  sizes: [{ width: 832, height: 1216, images: 90 }],
  steps: [{ steps: 28, images: 70 }],
  operations: [{ operation: 'text-to-image', images: 100 }, { operation: 'inpaint', images: 20 }],
  uniqueChains: 2,
  uniqueArtists: 5,
  uniqueCharacters: 3,
  artistScan: { scanned: 120, truncated: false },
  generatedAt: now,
  ...overrides,
});

const setup = (overrides: Partial<UsageStats> = {}) => {
  const onOpenHistory = vi.fn(), onOpenCollection = vi.fn(), onOpenLab = vi.fn(), onOpenRoll = vi.fn();
  mocks.getStats.mockResolvedValue(stats(overrides));
  const view = render(<CreationFootprint active chains={[]} onOpenHistory={onOpenHistory} onOpenCollection={onOpenCollection} onOpenLab={onOpenLab} onOpenRoll={onOpenRoll} />);
  return { ...view, onOpenHistory, onOpenCollection, onOpenLab, onOpenRoll };
};

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); mocks.collection = [];
  mocks.getEvents.mockResolvedValue({ totals: [], daily: [], keys: [], generatedAt: 0 });
  mocks.getAssets.mockResolvedValue({ roll: [], vibes: [], vibeGroups: [] });
  mocks.getSessions.mockResolvedValue([]);
  mocks.ensureCollection.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('显示概览、热力图、风格串与画师排行，并落到真实历史筛选', async () => {
  const { onOpenHistory } = setup();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(screen.getByText('120')).toBeTruthy();
  expect(screen.getByRole('grid', { name: '创作活动热力图' })).toBeTruthy();
  expect(screen.getAllByRole('gridcell').length).toBeGreaterThanOrEqual(365);
  expect(screen.getByText('风格串使用排行')).toBeTruthy();
  expect(screen.getByText('画师使用排行')).toBeTruthy();
  expect(screen.getByText('角色使用排行')).toBeTruthy();
  expect(screen.getByText('创作资产')).toBeTruthy();
  expect(screen.getByText('创作助手')).toBeTruthy();
  expect(screen.getByText('Key 使用量')).toBeTruthy();
  expect(screen.getByText('生成结果')).toBeTruthy();
  expect(screen.getByText(/1girl/)).toBeTruthy();

  fireEvent.click(screen.getAllByRole('button', { name: /厚涂冷色/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ search: '厚涂冷色', sort: 'newest' });
  fireEvent.click(screen.getAllByRole('button', { name: /alpha_artist/ }).at(-1)!);
  expect(onOpenHistory).toHaveBeenLastCalledWith({ search: 'artist:alpha_artist', sort: 'newest' });

  const cell = screen.getByRole('gridcell', { name: `${todayKey} · 4 张` });
  fireEvent.click(cell);
  expect(onOpenHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest' }));
  expect(onOpenHistory.mock.calls.at(-1)![0].from).toBeLessThanOrEqual(now);
});

it('周视图使用下拉选择，只列到本周', async () => {
  localStorage.setItem('nai_footprint_granularity_v2', 'week');
  setup();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(screen.getAllByRole('gridcell')).toHaveLength(7);
  const select = screen.getByLabelText('选择周') as HTMLSelectElement;
  const currentWeek = weekStart(now);
  expect(Number(select.value)).toBe(currentWeek);
  const options = [...select.options].map(option => Number(option.value));
  expect(Math.max(...options)).toBe(currentWeek);
  const previousWeek = currentWeek - 7 * 86400000;
  fireEvent.change(select, { target: { value: String(previousWeek) } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('7', expect.any(AbortSignal), expect.any(String), undefined, expect.objectContaining({ start: previousWeek, end: previousWeek + 7 * 86400000 - 1 })));
  fireEvent.click(screen.getByRole('button', { name: '月' }));
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('month', expect.any(AbortSignal), expect.any(String), undefined, undefined));
  expect(localStorage.getItem('nai_footprint_granularity_v2')).toBe('month');
});

it('可以按月下拉切换，统计与热力图切换到该月', async () => {
  setup();
  await screen.findByText('作品总数');
  fireEvent.click(screen.getByRole('button', { name: '月' }));
  const select = screen.getByLabelText('选择月份') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: previousMonth } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('month', expect.any(AbortSignal), previousMonth, undefined, undefined));
  expect(localStorage.getItem('nai_footprint_month')).toBe(previousMonth);
  expect(screen.getAllByRole('gridcell')).toHaveLength(new Date(today.getFullYear(), today.getMonth(), 0).getDate());
});

it('年模式下拉选择年份，全部年份回到全历史', async () => {
  setup();
  await screen.findByText('作品总数');
  fireEvent.click(screen.getByRole('button', { name: '年' }));
  const select = await screen.findByLabelText('选择年份') as HTMLSelectElement;
  const year = String(new Date().getFullYear());
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), year, undefined));
  expect(select.value).toBe(year);
  fireEvent.change(select, { target: { value: '' } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), undefined, undefined));
  fireEvent.change(select, { target: { value: year } });
  await waitFor(() => expect(mocks.getStats).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), year, undefined));
  expect(localStorage.getItem('nai_footprint_year')).toBe(year);
});

it('总数与收藏来自本地统计与收藏快照，不把收藏当成生成量', async () => {
  mocks.collection = [
    { sourceType: 'chain', sourceId: 'chain-a' },
    { sourceType: 'artist', sourceId: 'alpha_artist' },
    { sourceType: 'history', sourceId: 'one' },
    { sourceType: 'history', sourceId: 'two', archived: true },
  ];
  setup();
  await screen.findByText('作品总数');
  expect(screen.getByText('收藏的风格串')).toBeTruthy();
  expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  expect(screen.getByText('120')).toBeTruthy();
});

it('没有记录时给出空态与去实验室入口', async () => {
  const { onOpenLab } = setup({ totals: { images: 0, activeDays: 0, favoriteImages: 0, firstAt: null, lastAt: null, currentStreak: 0 }, daily: [], chains: [], artists: [], characters: [], tags: [], characterUsage: { images: 0, slots: 0 }, vibeUsage: { images: 0, slots: 0 }, referenceUsage: { images: 0, slots: 0 }, models: [], sizes: [], steps: [], operations: [], uniqueChains: 0, uniqueArtists: 0, uniqueCharacters: 0, artistScan: { scanned: 0, truncated: false } });
  expect(await screen.findByText('还没有创作记录')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去实验室创作' }));
  expect(onOpenLab).toHaveBeenCalledOnce();
});

it('统计读取失败时显示错误并可重试', async () => {
  mocks.getStats.mockRejectedValueOnce(new Error('合成统计失败')).mockResolvedValueOnce(stats());
  render(<CreationFootprint active chains={[]} onOpenHistory={() => {}} onOpenCollection={() => {}} onOpenLab={() => {}} onOpenRoll={() => {}} />);
  expect(await screen.findByText('合成统计失败')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('作品总数')).toBeTruthy();
});

it('Key 用量跟随周期且忽略迟到结果', async () => {
  let oldEvents!: (value: unknown) => void;
  mocks.getEvents.mockImplementationOnce(() => new Promise(resolve => { oldEvents = resolve; }));
  setup();
  expect(mocks.getStats).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '月' }));
  const select = screen.getByLabelText('选择月份');
  fireEvent.change(select, { target: { value: previousMonth } });
  await waitFor(() => expect(mocks.getEvents).toHaveBeenLastCalledWith('month', expect.any(AbortSignal), previousMonth, undefined, undefined));
  await act(async () => { oldEvents({ totals: [], daily: [], keys: [{ keyHash: 'a'.repeat(64), name: '过期别名' }], generatedAt: 0 }); });
  await waitFor(() => expect(screen.queryByText('过期别名')).toBeNull());
  expect(mocks.getStats.mock.calls.every(call => call[0] === 'month')).toBe(true);
});

it('先读取并显示 Key 用量，再发起历史和资产统计，不等待重查询完成', async () => {
  let resolveEvents!: (value: unknown) => void;
  let resolveStats!: (value: UsageStats) => void;
  mocks.getEvents.mockImplementationOnce(() => new Promise(resolve => { resolveEvents = resolve; }));
  mocks.getStats.mockImplementationOnce(() => new Promise(resolve => { resolveStats = resolve; }));
  setup();
  for (const mock of [mocks.getStats, mocks.getAssets, mocks.getSessions, mocks.ensureCollection]) expect(mock).not.toHaveBeenCalled();
  await act(async () => { resolveEvents({ totals: [], daily: [], keys: [{
    keyHash: 'a'.repeat(64), name: '优先显示的 Key', images: 7,
    models: [{ model: 'nai-diffusion-5-full', images: 7 }], generationAnlas: 0, encodingAnlas: 0, opusImages: 7, unknownBillingImages: 0, lifetime: null,
  }], generatedAt: now }); });
  expect(await screen.findByText('优先显示的 Key')).toBeTruthy();
  expect(screen.queryByText('作品总数')).toBeNull();
  for (const mock of [mocks.getStats, mocks.getAssets, mocks.getSessions, mocks.ensureCollection]) expect(mock).toHaveBeenCalledOnce();
  await act(async () => { resolveStats(stats()); });
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(mocks.getAssets).toHaveBeenCalledOnce();
});

it('Key 用量读取失败仍继续加载其他统计', async () => {
  mocks.getEvents.mockRejectedValueOnce(new Error('合成用量错误'));
  setup();
  expect(await screen.findByText('用量读取失败，请重试')).toBeTruthy();
  expect(await screen.findByText('作品总数')).toBeTruthy();
  expect(mocks.getAssets).toHaveBeenCalledOnce();
});

it('离开页面后，迟到的 Key 请求不会继续发起重查询', async () => {
  let resolveEvents!: (value: unknown) => void;
  mocks.getEvents.mockImplementationOnce(() => new Promise(resolve => { resolveEvents = resolve; }));
  const view = setup();
  view.rerender(<CreationFootprint active={false} chains={[]} onOpenHistory={() => {}} onOpenCollection={() => {}} onOpenLab={() => {}} onOpenRoll={() => {}} />);
  await act(async () => { resolveEvents({ totals: [], daily: [], keys: [], generatedAt: 0 }); });
  expect(mocks.getEvents.mock.calls[0][1].aborted).toBe(true);
  for (const mock of [mocks.getStats, mocks.getAssets, mocks.getSessions, mocks.ensureCollection]) expect(mock).not.toHaveBeenCalled();
});

it('摘要沿用资产周期口径，切换周期不重读资产，刷新重读且离页取消请求', async () => {
  const old = new Date(today.getFullYear() - 1, 0, 1).getTime();
  mocks.getAssets.mockResolvedValue({ roll: [
    { id: 'roll', name: '当前资产排行', updatedAt: now, candidates: [{ createdAt: now, savedChainId: 'saved' }, { createdAt: old, archived: true }], rounds: [{ createdAt: now }] },
    { id: 'archived', name: '归档资产排行', updatedAt: now, archived: true, candidates: [{ createdAt: now }], rounds: [] },
  ], vibes: [{ createdAt: now, encodings: [{ model: 'nai-diffusion-4-5-full', createdAt: now }] }, { createdAt: old, encodings: [] }], vibeGroups: [{ createdAt: now }, { createdAt: old }] });
  const view = setup();
  expect(await screen.findByText('当前资产排行')).toBeTruthy();
  expect(screen.queryByText('归档资产排行')).toBeNull();
  expect(screen.getByText('1 候选 · 1 保存')).toBeTruthy();
  const select = screen.getByLabelText('选择年份');
  fireEvent.change(select, { target: { value: '' } });
  expect(await screen.findByText('2 候选 · 1 保存')).toBeTruthy();
  expect(mocks.getAssets).toHaveBeenCalledOnce();
  await waitFor(() => expect((screen.getByRole('button', { name: '刷新统计' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  await waitFor(() => expect(mocks.getAssets).toHaveBeenCalledTimes(2));
  const signal = mocks.getAssets.mock.calls[1][0] as AbortSignal;
  view.rerender(<CreationFootprint active={false} chains={[]} onOpenHistory={() => {}} onOpenCollection={() => {}} onOpenLab={() => {}} onOpenRoll={() => {}} />);
  expect(signal.aborted).toBe(true);
});

it('失败的资产分组显示未知，成功读取的空分组仍显示零', async () => {
  mocks.getAssets.mockResolvedValue({ vibes: [], vibeGroups: [] });
  setup();
  await screen.findByText('创作资产');
  await waitFor(() => expect(mocks.getAssets).toHaveBeenCalledOnce());
  expect(screen.getByText('Roll 候选').parentElement!.textContent).toBe('Roll 候选—');
  expect(screen.getByText('Vibe 分组').parentElement!.textContent).toBe('Vibe 分组0');
});

it('资产摘要先到先显示，不等待收藏加载或助手会话扫描', async () => {
  let resolveCollection!: () => void, resolveSessions!: (value: unknown[]) => void;
  mocks.ensureCollection.mockImplementationOnce(() => new Promise<void>(resolve => { resolveCollection = resolve; }));
  mocks.getSessions.mockImplementationOnce(() => new Promise(resolve => { resolveSessions = resolve; }));
  mocks.getAssets.mockResolvedValue({ roll: [{ id: 'roll', name: '立即显示的资产', updatedAt: now, candidates: [], rounds: [] }], vibes: [], vibeGroups: [] });
  setup();
  expect(await screen.findByText('立即显示的资产')).toBeTruthy();
  expect(screen.getByText('正在读取…')).toBeTruthy();
  await act(async () => { resolveCollection(); resolveSessions([]); });
  await waitFor(() => expect(screen.queryByText('正在读取…')).toBeNull());
});

it('没有保留历史图片时也能看到独立用量，并导出带周期的模型与费用而不含指纹', async () => {
  const firstYear = new Date().getFullYear() - 2;
  mocks.getEvents.mockResolvedValue({ totals: [], daily: [], keyUsageFirstAt: new Date(firstYear, 0, 1).getTime(), keys: [{
    keyHash: 'a'.repeat(64), name: '主号', images: 3, models: [{ model: 'nai-diffusion-5-full', images: 3 }],
    generationAnlas: 4, encodingAnlas: 2, opusImages: 2, unknownBillingImages: 0, lifetime: null,
  }, { keyHash: 'b'.repeat(64), name: null, images: 1, models: [{ model: 'nai-diffusion-4-full', images: 1 }],
    generationAnlas: 0, encodingAnlas: 0, opusImages: 0, unknownBillingImages: 0, lifetime: null },
  { keyHash: 'c'.repeat(64), name: null, images: 0, models: [], generationAnlas: 0, encodingAnlas: 0, opusImages: 0,
    unknownBillingImages: 0, lifetime: { anlasSpent: 150, opusImages: 20 } }], generatedAt: 0 });
  setup({ totals: { images: 0, activeDays: 0, favoriteImages: 0, firstAt: null, lastAt: null, currentStreak: 0 } });
  expect(await screen.findByText('主号')).toBeTruthy();
  expect(screen.getByText('还没有创作记录')).toBeTruthy();
  let saved!: Blob;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { saved = blob; return 'blob:synthetic'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    fireEvent.click(screen.getByRole('button', { name: '导出 CSV' }));
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(saved); });
    expect(text).toContain('"key_model","主号 · nai-diffusion-5-full","3","","' + new Date().getFullYear() + '"');
    expect(text).toContain('"key_encoding_anlas_estimate","主号","2"');
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain('bbbbbb');
    expect(text).toContain('历史用量 2');
    expect(text).toContain('"key_cumulative_anlas_estimate","历史用量 3","150","","累计（含旧版）"');
    expect(text).not.toContain('"key_images","历史用量 3","0"');
    const select = screen.getByLabelText('选择年份') as HTMLSelectElement;
    expect([...select.options].map(option => option.value)).toContain(String(firstYear));
    fireEvent.change(select, { target: { value: String(firstYear) } });
    await waitFor(() => expect(mocks.getEvents).toHaveBeenLastCalledWith('all', expect.any(AbortSignal), expect.any(String), String(firstYear), undefined));
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    const month = screen.getByLabelText('选择月份') as HTMLSelectElement;
    expect([...month.options].map(option => option.value)).toContain(`${firstYear}-01`);
  } finally { click.mockRestore(); }
});

it('用量失败在独立统计区重试，不把失败显示为零', async () => {
  mocks.getEvents.mockRejectedValueOnce(new Error('synthetic usage failure'));
  setup();
  expect(await screen.findByText('用量读取失败，请重试')).toBeTruthy();
  expect(screen.getByText('作品总数')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('暂无 Key 用量记录');
});
