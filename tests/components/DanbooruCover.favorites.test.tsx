// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Inspiration, User } from '../../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), getCoverSet: vi.fn() }));
vi.mock('../../services/api', async original => ({ ...await original<typeof import('../../services/api')>(), api: { get: mocks.get, post: mocks.post, put: mocks.put } }));
vi.mock('../../services/localHistory', () => ({ localHistory: { getPage: vi.fn(async () => ({ items: [], count: 0 })), setFavorite: vi.fn(), setFavorites: vi.fn() } }));
vi.mock('../../services/aitagService', async original => ({ ...await original<typeof import('../../services/aitagService')>(), aitagService: { setFavorite: vi.fn() } }));
vi.mock('../../services/pixivService', () => ({ importPixivImageAsFile: vi.fn() }));
vi.mock('../../services/danbooruCoverImport', () => ({ importDanbooruCoverAsDataUrl: vi.fn() }));
vi.mock('../../services/codexService', () => ({ readCodexImageFile: vi.fn(), readCodexImageMetadata: vi.fn() }));
vi.mock('../../services/danbooruService', () => ({ danbooruService: { getCoverSet: mocks.getCoverSet, getCoverCandidatePage: vi.fn(), getCoverFallback: vi.fn() } }));
vi.mock('../../components/SmartImage', () => ({
  ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt, onError, onLoad }: { src: string; alt: string; onError?: () => void; onLoad?: React.ReactEventHandler<HTMLImageElement> }) => <img src={src} alt={alt} onError={onError} onLoad={onLoad} />,
}));

import { DanbooruCover } from '../../components/DanbooruCover';
import type { DanbooruCoverCandidate } from '../../services/danbooruService';

const owner: User = { id: 'synthetic-owner', username: 'synthetic', role: 'admin', createdAt: 1 };
const base = 'ulrich von hutten (azur lane)';
const variant = 'ulrich von hutten (mayhem maid) (azur lane)';
const candidate = (id: number): DanbooruCoverCandidate => ({ id, score: 1, width: 800, height: 1000, previewUrl: `https://cdn.donmai.us/preview/${id}.jpg`, sampleUrl: `https://cdn.donmai.us/sample/${id}.webp`, postUrl: '' });
let stored: Inspiration[];

beforeEach(() => {
  vi.clearAllMocks();
  stored = [{ id: 'saved-base', userId: owner.id, username: owner.username, title: 'Ulrich von Hutten', prompt: base, imageUrl: '/saved/base.png', sourceType: 'character', sourceId: base, tags: [], createdAt: 1, updatedAt: 1 }];
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/auth/me') return owner;
    if (path === '/inspirations') return stored.map(item => ({ ...item }));
    if (path === '/aitag/favorites') return [];
    throw new Error(`Unexpected GET ${path}`);
  });
  mocks.put.mockImplementation(async (path: string, updates: Partial<Inspiration>) => {
    const id = decodeURIComponent(path.split('/').pop() || '');
    stored = stored.map(item => item.id === id ? { ...item, ...updates } : item);
    return { item: stored.find(item => item.id === id) };
  });
  mocks.post.mockImplementation(async (_path: string, item: Inspiration) => ({ item }));
  mocks.getCoverSet.mockResolvedValue({ candidates: [candidate(1), candidate(2)], representative: candidate(1), hasMore: false, nextPage: 1 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('部分已收藏的角色换封面和翻页仍亮心，点击后只取消已有成员且不补齐缺失成员', async () => {
  const favoriteVariants = [{ tag: base, title: '原版' }, { tag: variant, title: '变体' }];
  const view = render(<DanbooruCover tag={base} kind="character" alt="Ulrich von Hutten" fixedSrc="/cover/first.png" favoriteVariants={favoriteVariants} />);
  const activeHeart = () => screen.getByRole('button', { name: '取消所有变体收藏' });

  await waitFor(() => expect(activeHeart().getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: '下一张' }));
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe(candidate(1).sampleUrl));
  expect(activeHeart().getAttribute('aria-pressed')).toBe('true');

  view.rerender(<DanbooruCover tag={base} kind="character" alt="Ulrich von Hutten" fixedSrc="/cover/changed.png" favoriteVariants={favoriteVariants} />);
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('/cover/changed.png'));
  expect(activeHeart().getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '取消所有变体收藏' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '收藏所有变体' }).getAttribute('aria-pressed')).toBe('false'));
  expect(stored.filter(item => !item.archived).map(item => item.sourceId)).toEqual([]);
  expect(mocks.put).toHaveBeenCalledWith('/inspirations/saved-base', { archived: true });
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.getCoverSet.mock.calls.some(([tag]) => tag === variant)).toBe(false);
});
