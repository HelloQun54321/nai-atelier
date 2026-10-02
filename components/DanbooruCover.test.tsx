// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DanbooruCover } from './DanbooruCover';
import { danbooruService, type DanbooruCoverCandidate } from '../services/danbooruService';
import { ImageActivityContext } from './SmartImage';

vi.mock('../services/danbooruService', () => ({ danbooruService: { getCoverSet: vi.fn(), getCoverCandidatePage: vi.fn() } }));
vi.mock('./SmartImage', () => ({ ImageActivityContext: React.createContext(true), SmartImage: ({ src, alt, onError }: { src: string; alt: string; onError: () => void }) => <img src={src} alt={alt} onError={onError} /> }));
const covers = vi.mocked(danbooruService.getCoverSet);
const pages = vi.mocked(danbooruService.getCoverCandidatePage);
const candidate = (id: number): DanbooruCoverCandidate => ({ id, score: 20, previewUrl: `https://cdn.donmai.us/preview/${id}.jpg`, sampleUrl: `https://cdn.donmai.us/sample/${id}.webp`, postUrl: '' });
const set = (candidates = [candidate(1)], hasMore = false, nextPage = 1) => ({ candidates, representative: candidates[0] || null, hasMore, nextPage });
const image = () => screen.getByRole('img') as HTMLImageElement;
const failImage = () => fireEvent.error(image());
it('保存封面直接展示，一次翻图才检索并立即显示代表图', async () => {
  covers.mockResolvedValue({ ...set([candidate(1), candidate(2)]), representative: candidate(2) });
  render(<DanbooruCover tag="saved" kind="character" alt="封面" fixedSrc="/api/assets/synthetic" />);
  expect(image().getAttribute('src')).toBe('/api/assets/synthetic');
  expect(covers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  await waitFor(() => expect(image().src).toBe(candidate(2).sampleUrl));
  expect(covers).toHaveBeenCalledTimes(1);
});
it('离开视图取消查询和预热，回来保留已选图片且不重新查询', async () => {
  covers.mockResolvedValue(set([candidate(1), candidate(2), candidate(3)]));
  const view = (active: boolean) => <ImageActivityContext.Provider value={active}><DanbooruCover tag="retained" kind="artist" alt="封面" /></ImageActivityContext.Provider>;
  const { rerender } = render(view(true));
  await waitFor(() => expect(image().src).toBe(candidate(1).sampleUrl));
  fireEvent.click(screen.getByRole('button', { name: '下一张' })); expect(image().src).toBe(candidate(2).sampleUrl);
  const signal = covers.mock.calls[0][2]?.signal;
  rerender(view(false)); expect(signal?.aborted).toBe(true);
  rerender(view(true)); await act(async () => {});
  expect(image().src).toBe(candidate(2).sampleUrl); expect(covers).toHaveBeenCalledTimes(1);
  const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)));
  expect(bodies.some(body => body.cancel === true)).toBe(true);
  expect(bodies.filter(body => body.sources).every(body => body.sources.length === 1 && body.variant.startsWith('thumb-'))).toBe(true);
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  covers.mockResolvedValue(set()); pages.mockResolvedValue({ candidates: [], hasMore: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('大图失败先换公开预览，再失败自动换下一候选，上一张不返回坏图', async () => {
  covers.mockResolvedValue(set([candidate(1), candidate(2)]));
  const onCandidateChange = vi.fn();
  render(<DanbooruCover tag="synthetic" kind="artist" alt="封面" onCandidateChange={onCandidateChange} />);
  await waitFor(() => expect(image().src).toBe(candidate(1).sampleUrl));
  failImage(); expect(image().src).toBe(candidate(1).previewUrl);
  expect(onCandidateChange).toHaveBeenLastCalledWith(expect.objectContaining({ sampleUrl: candidate(1).previewUrl }));
  failImage(); await waitFor(() => expect(image().src).toBe(candidate(2).sampleUrl));
  expect((screen.getByRole('button', { name: '上一张' }) as HTMLButtonElement).disabled).toBe(true);
});
it('初次展示使用代表图而非评分第一项，回调与前后翻图对应同一作品', async () => {
  covers.mockResolvedValue({ ...set([candidate(1), candidate(2), candidate(3)]), representative: candidate(2) });
  const onCandidateChange = vi.fn();
  render(<DanbooruCover tag="synthetic" kind="character" alt="封面" onCandidateChange={onCandidateChange} />);
  await waitFor(() => expect(image().src).toBe(candidate(2).sampleUrl));
  expect(onCandidateChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, sampleUrl: candidate(2).sampleUrl }));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(image().src).toBe(candidate(3).sampleUrl);
  fireEvent.click(screen.getByRole('button', { name: '上一张' }));
  expect(image().src).toBe(candidate(2).sampleUrl);
  fireEvent.click(screen.getByRole('button', { name: '上一张' }));
  expect(image().src).toBe(candidate(1).sampleUrl);
});
it('代表图加载失败仍保留其他候选，回退和翻页不丢图', async () => {
  covers.mockResolvedValue({ ...set([candidate(2), candidate(1), candidate(3)]), representative: candidate(2) });
  render(<DanbooruCover tag="synthetic" kind="character" alt="封面" />);
  await waitFor(() => expect(image().src).toBe(candidate(2).sampleUrl));
  failImage(); expect(image().src).toBe(candidate(2).previewUrl);
  failImage(); await waitFor(() => expect(image().src).toBe(candidate(1).sampleUrl));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  expect(image().src).toBe(candidate(3).sampleUrl);
});
it('已保存封面优先展示，失效后仅在本次展示回退，不改写原资料', async () => {
  render(<DanbooruCover tag="synthetic" kind="character" alt="封面" fixedSrc="/api/images/synthetic-original" />);
  await screen.findByText('已保存封面');
  expect(image().getAttribute('src')).toBe('/api/images/synthetic-original');
  failImage(); await waitFor(() => expect(image().src).toBe(candidate(1).sampleUrl));
  expect(screen.queryByText('已保存封面')).toBeNull();
  expect(pages).not.toHaveBeenCalled();
});
it('空首屏提供继续查找，从服务记录的页码补读并跳过空页', async () => {
  covers.mockResolvedValue(set([], true, 4));
  pages.mockResolvedValueOnce({ candidates: [], hasMore: true }).mockResolvedValueOnce({ candidates: [candidate(5)], hasMore: false });
  render(<DanbooruCover tag="synthetic" kind="character" alt="封面" />);
  fireEvent.click(await screen.findByRole('button', { name: '继续查找封面' }));
  await waitFor(() => expect(image().src).toBe(candidate(5).sampleUrl));
  expect(pages.mock.calls.map(call => call.slice(0, 3))).toEqual([['synthetic', 'character', 4], ['synthetic', 'character', 5]]);
  expect(pages.mock.calls.every(call => call[3]?.signal instanceof AbortSignal)).toBe(true);
});
it('坏图后的自动补页最多三页，不进入无界请求循环', async () => {
  const broken = { ...candidate(1), previewUrl: candidate(1).sampleUrl };
  covers.mockResolvedValue(set([broken], true));
  pages.mockResolvedValue({ candidates: [], hasMore: true });
  render(<DanbooruCover tag="synthetic" kind="artist" alt="封面" />);
  await waitFor(() => expect(image().src).toBe(broken.sampleUrl));
  failImage();
  await waitFor(() => expect(pages).toHaveBeenCalledTimes(3));
  expect(await screen.findByText('封面图片加载失败')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重试加载封面' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '继续查找封面' })).toBeTruthy();
});

it('连续请求失败显示连接错误，手动重试成功后恢复，不误报无封面', async () => {
  vi.useFakeTimers();
  covers.mockRejectedValue(new Error('network failed'));
  render(<DanbooruCover tag="synthetic" kind="artist" alt="封面" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(covers).toHaveBeenCalledTimes(2);
  expect(screen.getByText('暂时无法读取 Danbooru 封面，请重试')).toBeTruthy();
  expect(screen.queryByText('暂无可用的 Danbooru 封面')).toBeNull();
  covers.mockResolvedValue(set([candidate(7)]));
  fireEvent.click(screen.getByRole('button', { name: '重试加载封面' }));
  await act(async () => {});
  expect(image().src).toBe(candidate(7).sampleUrl);
  expect(screen.queryByText('暂时无法读取 Danbooru 封面，请重试')).toBeNull();
});

it('真实空结果仍显示无封面，429 限流可辨认且不无限重试', async () => {
  vi.useFakeTimers();
  covers.mockRejectedValue(new Error('Danbooru 429'));
  const { rerender } = render(<DanbooruCover tag="busy" kind="character" alt="封面" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('Danbooru 请求过于频繁，请稍后重试')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(covers).toHaveBeenCalledTimes(2);
  covers.mockResolvedValue(set([]));
  rerender(<DanbooruCover tag="empty" kind="character" alt="封面" />);
  await act(async () => {});
  expect(screen.getByText('暂无可用的 Danbooru 封面')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重试加载封面' })).toBeNull();
});
it('更换 Tag 后，旧候选翻页的迟到结果和结束状态不能污染新卡片', async () => {
  covers.mockResolvedValueOnce(set([], true, 4)).mockResolvedValueOnce(set([candidate(9)]));
  let finish!: (result: { candidates: DanbooruCoverCandidate[]; hasMore: boolean }) => void;
  pages.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<DanbooruCover tag="old" kind="artist" alt="封面" />);
  fireEvent.click(await screen.findByRole('button', { name: '继续查找封面' }));
  rerender(<DanbooruCover tag="new" kind="artist" alt="封面" />);
  await waitFor(() => expect(image().src).toBe(candidate(9).sampleUrl));
  await act(async () => finish({ candidates: [candidate(4)], hasMore: true }));
  expect(image().src).toBe(candidate(9).sampleUrl);
});

it('附近卡片进入屏幕后提级且不重启查询，只为可见卡片预热下一张', async () => {
  const observers: Array<(entries: unknown[]) => void> = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: unknown[]) => void) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  covers.mockResolvedValue(set([candidate(1), candidate(2)]));
  render(<DanbooruCover tag="nearby" kind="character" alt="封面" />);
  expect(covers).not.toHaveBeenCalled();
  act(() => observers[0]([{ isIntersecting: true }]));
  await waitFor(() => expect(image().src).toBe(candidate(1).sampleUrl));
  const options = covers.mock.calls[0][2]!;
  expect(options.priority!()).toBeGreaterThanOrEqual(1000);
  const queued = () => vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body))).filter(body => body.sources);
  expect(queued()).toHaveLength(0);
  act(() => observers[1]([{ isIntersecting: true }]));
  expect(options.priority!()).toBe(0); expect(options.signal!.aborted).toBe(false);
  expect(covers).toHaveBeenCalledTimes(1); expect(queued()).toHaveLength(1);
  act(() => observers[1]([{ isIntersecting: false, boundingClientRect: { top: 950, bottom: 1200 }, rootBounds: { top: 0, bottom: 900 } }]));
  expect(options.priority!()).toBe(1050); expect(options.signal!.aborted).toBe(false);
  act(() => observers[0]([{ isIntersecting: false }]));
  expect(options.signal!.aborted).toBe(true);
});
