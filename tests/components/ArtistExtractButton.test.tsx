// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistExtractButton } from '../../components/ArtistExtractButton';
import { ImagePreviewActions } from '../../components/ImagePreviewActions';
import type { ArtistPreferenceBatchResult } from '../../services/collectionFavorites';

const mocks = vi.hoisted(() => ({ favorite: vi.fn() }));
vi.mock('../../services/artistFavoriteExtraction', () => ({ favoriteArtistsFrom: mocks.favorite }));

const result = (value: Partial<ArtistPreferenceBatchResult>): ArtistPreferenceBatchResult => ({ tags: [], added: [], existing: [], failed: [], ...value });

beforeEach(() => { localStorage.clear(); mocks.favorite.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cases: [ArtistPreferenceBatchResult, string, 'success' | 'error'][] = [
  [result({}), '没有在这串里认出画师', 'error'],
  [result({ tags: ['a', 'b'], existing: ['a', 'b'] }), '这串的 2 位画师都已在收藏里', 'success'],
  [result({ tags: ['a', 'b'], added: ['a', 'b'] }), '已收藏 2 位画师：a, b', 'success'],
  [result({ tags: ['a', 'b', 'c'], added: ['a', 'b'], existing: ['c'] }), '已收藏 2 位画师：a, b（1 位原本已收藏）', 'success'],
  [result({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], added: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), '已收藏 7 位画师：a, b, c, d, e +2', 'success'],
  [result({ tags: ['a', 'b'], added: ['a'], failed: ['b'], error: '写入失败' }), '已收藏 1 位画师，1 位失败：写入失败', 'error'],
  [result({ tags: ['a'], failed: ['a'], error: '写入失败' }), '1 位画师收藏失败：写入失败', 'error'],
];

it.each(cases)('点按后如实说明本次结果：%#', async (value, message, type) => {
  mocks.favorite.mockResolvedValue(value);
  const notify = vi.fn(), parentClick = vi.fn(), parentPointer = vi.fn();
  render(<div onClick={parentClick} onPointerDown={parentPointer}><ArtistExtractButton source={{ kind: 'tags', tags: ['a'] }} notify={notify} label="收藏候选 3 的画师" /></div>);
  const button = screen.getByRole('button', { name: '收藏候选 3 的画师' });
  expect(button.title).toBe('收藏这串的画师');
  expect(button.classList.contains('hover-reveal-md')).toBe(true);
  fireEvent.pointerDown(button);
  await act(async () => { fireEvent.click(button); });
  expect(mocks.favorite).toHaveBeenCalledWith({ kind: 'tags', tags: ['a'] });
  expect(notify).toHaveBeenCalledWith(message, type);
  expect(parentClick).not.toHaveBeenCalled();
  expect(parentPointer).not.toHaveBeenCalled();
});

it('处理中禁用并忽略连点，异常原样提示后恢复可用', async () => {
  let finish!: (value: ArtistPreferenceBatchResult) => void;
  mocks.favorite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('访客无法修改收藏'));
  const notify = vi.fn();
  render(<ArtistExtractButton source={{ kind: 'tags', tags: ['a'] }} notify={notify} />);
  const button = screen.getByRole('button', { name: '收藏这串的画师' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toHaveProperty('disabled', true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(mocks.favorite).toHaveBeenCalledOnce();
  await act(async () => { finish(result({ tags: ['a'], existing: ['a'] })); });
  expect(button).toHaveProperty('disabled', false);
  await act(async () => { fireEvent.click(button); });
  expect(notify).toHaveBeenLastCalledWith('访客无法修改收藏', 'error');
});

it('实验室预览按成图记录提取，显示封面时使用调用方给的风格串，没有来源不显示', async () => {
  mocks.favorite.mockResolvedValue(result({}));
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };
  const { rerender } = render(<ImagePreviewActions imageUrl="/result.png" filename="NAI.png" generationData={{ prompt: 'artist:alpha', negativePrompt: 'bad', params }} />);
  const right = screen.getByRole('button', { name: '收藏' }).parentElement!.parentElement!;
  expect([...right.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['收藏', '下载图片', '复制图片', '收藏这串的画师']);
  expect(screen.getByRole('button', { name: '收藏这串的画师' }).classList.contains('hover-reveal-lg')).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '收藏这串的画师' })); });
  expect(mocks.favorite).toHaveBeenLastCalledWith({ kind: 'prompt', prompt: 'artist:alpha', params });
  const chain = { id: 'style', name: '合成风格串' } as never;
  rerender(<ImagePreviewActions imageUrl="/cover.png" filename="NAI.png" artistSource={{ kind: 'chain', chain }} onBack={() => undefined} />);
  expect(screen.getByRole('button', { name: '收藏这串的画师' }).classList.contains('hover-reveal-md')).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '收藏这串的画师' })); });
  expect(mocks.favorite).toHaveBeenLastCalledWith({ kind: 'chain', chain });
  rerender(<ImagePreviewActions imageUrl="/cover.png" filename="NAI.png" />);
  expect(screen.queryByRole('button', { name: '收藏这串的画师' })).toBeNull();
});
