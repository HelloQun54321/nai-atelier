// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StyleRollPartyDialog } from '../../components/roll/StyleRollPartyDialog';

const mocks = vi.hoisted(() => ({ catalogTags: [] as string[], search: vi.fn() }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), searchArtistDictionary: mocks.search }));
vi.mock('../../services/artistSamples', () => ({
  getArtistSampleStatus: async () => ({ available: true, canManage: false, packs: [{ id: 'v45', phase: 'ready' }] }),
  getArtistSampleCatalog: async () => ({ pack: 'v45', revision: 'synthetic', tags: mocks.catalogTags }),
  buildArtistSampleImageUrl: (pack: string, tag: string, index: number, revision: string) => `/api/artist-samples/image?pack=${pack}&tag=${encodeURIComponent(tag)}&index=${index}&revision=${revision}`,
  normalizeArtistSampleTag: (tag: string) => tag.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
}));
vi.mock('../../services/artistSampleDrafts', () => ({ getArtistSampleData: async () => ({ templates: {}, samples: [] }) }));

const library = Array.from({ length: 40 }, (_, index) => `artist_${index}`);
beforeEach(() => { mocks.catalogTags = []; mocks.search.mockResolvedValue([]); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (overrides: Partial<React.ComponentProps<typeof StyleRollPartyDialog>> = {}) => {
  const onSave = vi.fn(), onBlock = vi.fn(async (_tags: string[]) => {}), onClose = vi.fn();
  render(<StyleRollPartyDialog library={library} count={4} initial={[]} blocked={[]} onSave={onSave} onBlock={onBlock} onClose={onClose} {...overrides} />);
  return { onSave, onBlock, onClose };
};
const loaded = () => waitFor(() => expect(screen.queryByText('正在读取画师样张…')).toBeNull());

it('随机选择按设定人数抽出一组，可踢出、再加一位并用手动输入覆盖', async () => {
  const { onSave } = open();
  await loaded();
  expect(screen.getByText('已固定 0 位 · 之后每轮只随机权重')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '随机选择' }));
  expect(screen.getAllByRole('button', { name: /^移除 artist_/ })).toHaveLength(4);
  fireEvent.click(screen.getAllByRole('button', { name: /^移除 artist_/ })[0]);
  expect(screen.getAllByRole('button', { name: /^移除 artist_/ })).toHaveLength(3);
  fireEvent.click(screen.getAllByRole('button', { name: '再加一位' })[0]);
  expect(screen.getAllByRole('button', { name: /^移除 artist_/ })).toHaveLength(4);
  fireEvent.change(screen.getByRole('textbox', { name: '手动输入' }), { target: { value: '1.2::artist:alpha ::, beta' } });
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
  expect(screen.getByText('alpha')).toBeTruthy(); expect(screen.getByText('beta')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  expect(onSave).toHaveBeenCalledWith(['alpha', 'beta']);
});

it('屏蔽当前集合会写入全局名单并清空本次选择', async () => {
  const onBlock = vi.fn(async (_tags: string[]) => {});
  open({ blocked: ['old_artist'], onBlock });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: '随机选择' }));
  fireEvent.click(screen.getByRole('button', { name: '屏蔽这些' }));
  await waitFor(() => expect(onBlock).toHaveBeenCalledOnce());
  expect(onBlock.mock.calls[0][0]).toContain('old_artist');
  expect(onBlock.mock.calls[0][0]).toHaveLength(5);
  await waitFor(() => expect(screen.getByText('已屏蔽 5 位')).toBeTruthy());
  expect(screen.getByText('已固定 0 位 · 之后每轮只随机权重')).toBeTruthy();
});

it('已屏蔽画师不会再被抽到，也可以从管理列表取消屏蔽', async () => {
  const onBlock = vi.fn(async (_tags: string[]) => {});
  open({ blocked: library.slice(0, 36), onBlock });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: '随机选择' }));
  expect(screen.getAllByRole('button', { name: /^移除 artist_/ })).toHaveLength(4);
  for (const index of [36, 37, 38, 39]) expect(screen.getByText(`artist_${index}`)).toBeTruthy();
  fireEvent.click(screen.getByText('管理屏蔽'));
  fireEvent.click(screen.getAllByRole('button', { name: /^取消屏蔽 / })[0]);
  await waitFor(() => expect(onBlock).toHaveBeenCalledOnce());
  expect(onBlock.mock.calls[0][0]).toHaveLength(35);
});

it('只抽有样张时，随机选择限定在有样张的画师内', async () => {
  mocks.catalogTags = ['artist_1', 'artist_2'];
  open({ sampledOnly: true });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: '随机选择' }));
  const labels = screen.getAllByRole('button', { name: /^移除 / }).map(button => button.getAttribute('aria-label'));
  expect(labels.sort()).toEqual(['移除 artist_1', '移除 artist_2']);
});

it('可以逐位替换已固定的画师，其他位置保持不变', async () => {
  mocks.search.mockResolvedValue([{ name: 'replacement artist', chinese: '', postCount: 1 }]);
  const { onSave } = open();
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: '随机选择' }));
  const remove = screen.getAllByRole('button', { name: /^移除 artist_/ })[0];
  const removed = remove.getAttribute('aria-label')!.replace('移除 ', '');
  const card = remove.parentElement!;
  fireEvent.click(within(card).getByRole('button', { name: /^替换 / }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索替换画师' }), { target: { value: 'replacement' } });
  fireEvent.click(await screen.findByRole('button', { name: 'replacement artist' }));
  expect(screen.queryByText(removed)).toBeNull();
  expect(screen.getByText('replacement artist')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  const saved = onSave.mock.calls[0][0] as string[];
  expect(saved).toContain('replacement artist');
  expect(saved).not.toContain(removed);
  expect(saved).toHaveLength(4);
});
