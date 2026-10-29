// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryImagePicker } from '../../components/HistoryImagePicker';

const mocks = vi.hoisted(() => ({ getPage: vi.fn(), subscribe: vi.fn(() => vi.fn()), fetch: vi.fn() }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: mocks.getPage, subscribe: mocks.subscribe } }));
vi.mock('../../components/SmartImage', () => ({ SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: { children: React.ReactNode }) => children }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const response = (id: string) => ({ ok: true, json: async () => ({ items: [{ id, imageUrl: `/${id}.png`, createdAt: 1, prompt: id }], count: 1 }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('首次读取期间和失败后不显示无图，重试成功空结果才显示空态', async () => {
  const pending = deferred<never>();
  mocks.getPage.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ items: [], count: 0 });
  render(<HistoryImagePicker open onClose={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByText('正在读取历史图片…')).toBeTruthy();
  expect(screen.getByText('全部 — 张')).toBeTruthy();
  expect(screen.queryByText('历史页面中还没有生成图片')).toBeNull();
  await act(async () => pending.reject(new Error('合成首读失败')));
  expect(screen.getByText('历史图片读取失败，请重试。')).toBeTruthy();
  expect(screen.queryByText('历史页面中还没有生成图片')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  expect(await screen.findByText('历史页面中还没有生成图片')).toBeTruthy();
  expect(screen.getByText('全部 0 张')).toBeTruthy();
  expect(mocks.getPage).toHaveBeenCalledTimes(2);
  expect(mocks.getPage).toHaveBeenLastCalledWith(0, expect.any(Number), undefined, true);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('同作用域重开刷新期间和失败后保留缓存，切换作用域立即隐藏旧卡片并只允许选择新结果', async () => {
  mocks.fetch.mockResolvedValueOnce(response('scope-a-image'));
  const props = { open: true, scopeChainId: 'scope-a', onClose: vi.fn(), onSelect: vi.fn() };
  const view = render(<HistoryImagePicker {...props} />);
  expect((await screen.findByRole('img', { name: '历史生成图片' })).getAttribute('src')).toBe('/scope-a-image.png');
  view.rerender(<HistoryImagePicker {...props} open={false} />);
  const refresh = deferred<never>();
  mocks.fetch.mockReturnValueOnce(refresh.promise);
  view.rerender(<HistoryImagePicker {...props} />);
  expect(screen.getByText('正在读取历史图片…')).toBeTruthy();
  expect(screen.getByText('这条目的生成图 — 张')).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('src')).toBe('/scope-a-image.png');
  await act(async () => refresh.reject(new Error('合成刷新失败')));
  expect(screen.getByRole('alert').textContent).toContain('历史图片读取失败，请重试。');
  expect(screen.getByRole('img').getAttribute('src')).toBe('/scope-a-image.png');
  expect(screen.queryByText('这条提示词还没有生成过的图')).toBeNull();
  const nextScope = deferred<ReturnType<typeof response>>();
  mocks.fetch.mockReturnValueOnce(nextScope.promise);
  view.rerender(<HistoryImagePicker {...props} scopeChainId="scope-b" />);
  expect(screen.getByText('正在读取历史图片…')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: /^选择历史生成图片/ })).toBeNull();
  await act(async () => nextScope.resolve(response('scope-b-image')));
  expect(screen.getByRole('img').getAttribute('src')).toBe('/scope-b-image.png');
  fireEvent.click(screen.getByRole('button', { name: /^选择历史生成图片/ }));
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'scope-b-image', imageUrl: '/scope-b-image.png' }), false);
  expect(mocks.fetch).toHaveBeenLastCalledWith(expect.stringContaining('chainId=scope-b&'));
  expect(mocks.getPage).not.toHaveBeenCalled();
});
