// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexBootstrap } from '../../services/codexService';
const mocks = vi.hoisted(() => ({ library: vi.fn(), status: vi.fn(), data: vi.fn(), lookup: vi.fn(), copy: vi.fn(), auxiliary: vi.fn() }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleLibrary: mocks.library, getArtistSampleStatus: mocks.status, getArtistSampleLookup: mocks.lookup }));
vi.mock('../../services/artistSampleDrafts', () => ({ getArtistSampleData: mocks.data }));
vi.mock('../../services/codexService', async original => ({ ...await original<typeof import('../../services/codexService')>(), loadCodexAuxiliary: mocks.auxiliary }));
vi.mock('../../services/externalImageTags', async original => ({ ...await original<typeof import('../../services/externalImageTags')>(), copyTagText: mocks.copy }));
vi.mock('../../components/ImageLightbox', () => ({ ViewableImage: (props: any) => <img {...props} /> }));
import { PromptArtistSamples } from '../../components/PromptArtistSamples';
const boot = { release: 'synthetic', books: [], media: {} } as unknown as CodexBootstrap;
const lookup = (pack = 'v5', tag = 'alpha') => ({ pack, tag, model: pack === 'v5' ? 'nai-diffusion-5-full' : undefined, revision: 'a'.repeat(24), imageCount: 1, sourceUrl: '' });
const view = (prompt = '0.54::artist:alpha::') => <PromptArtistSamples prompt={prompt} params={{ model: 'nai-diffusion-5-full' }} boot={boot} />;
const expand = () => { const details = screen.getByText('画师样张').closest('details')!; details.open = true; fireEvent(details, new Event('toggle')); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.library.mockResolvedValue([{ name: 'alpha' }, { name: 'beta' }]);
  mocks.data.mockResolvedValue({ samples: [], templates: {} }); mocks.auxiliary.mockResolvedValue({ versions: {} });
  mocks.status.mockResolvedValue({ packs: [{ id: 'v5', model: 'nai-diffusion-5-full', phase: 'ready' }, { id: 'v45', phase: 'ready' }] });
  mocks.lookup.mockImplementation(async (pack: string, tag: string) => lookup(pack, tag)); mocks.copy.mockResolvedValue(undefined);
});
afterEach(cleanup);
it('收起不读样张，展开显示名字、真实倍率与本地 V5 Full 样张，可复制', async () => {
  render(view()); expect(mocks.library).not.toHaveBeenCalled(); expand();
  expect(await screen.findByRole('img', { name: 'artist:alpha' })).toBeTruthy();
  expect(screen.getByText('V5 Full · ×0.54')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '复制画师 Tag：alpha' }));
  await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('artist:alpha'));
});
it('切换图片或版本后拒绝迟到的旧样张', async () => {
  let finish!: (value: ReturnType<typeof lookup>) => void;
  mocks.lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(view()); expand(); await waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce());
  rerender(view('artist:beta'));
  expect(await screen.findByRole('img', { name: 'artist:beta' })).toBeTruthy();
  await act(async () => finish(lookup())); expect(screen.queryByRole('img', { name: 'artist:alpha' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'V4.5' }));
  await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toContain('pack=v45'));
});
it('读取失败可重试，不伪装为无画师；缺少画师的普通词明确空态', async () => {
  mocks.lookup.mockRejectedValueOnce(new Error('offline'));
  const { rerender } = render(view()); expand();
  fireEvent.click(await screen.findByRole('button', { name: '样张读取失败 · 重试' }));
  expect(await screen.findByRole('img', { name: 'artist:alpha' })).toBeTruthy();
  rerender(view('solo, blue eyes')); expect(await screen.findByText('未找到画师 Tag')).toBeTruthy();
});

it('法典索引很慢也不阻塞已就绪本地样张；图片解码失败可以重试', async () => {
  mocks.auxiliary.mockImplementationOnce(() => new Promise(() => {}));
  render(view()); expand();
  const image = await screen.findByRole('img', { name: 'artist:alpha' });
  fireEvent.error(image);
  fireEvent.click(await screen.findByRole('button', { name: '样张读取失败 · 重试' }));
  expect(await screen.findByRole('img', { name: 'artist:alpha' })).toBeTruthy();
});

it('样张分页尊重用户移除标记，不混入 Curated 版本', async () => {
  mocks.data.mockResolvedValue({ samples: [], templates: {}, removedSamples: [{ source: 'pack', pack: 'v5', tag: 'alpha', revision: 'a'.repeat(24), index: 0, imageCount: 3 }] });
  mocks.lookup.mockResolvedValue({ ...lookup(), imageCount: 3 });
  render(view()); expand();
  expect((await screen.findByRole('img')).getAttribute('src')).toContain('index=1');
  fireEvent.click(screen.getByRole('button', { name: '下一张样张' }));
  expect(screen.getByRole('img').getAttribute('src')).toContain('index=2');
});

it('原图无画师时可看法典配方快照且明确标注，有实际画师时优先实际内容', async () => {
  const { rerender } = render(<PromptArtistSamples prompt="<artist></artist>, blue eyes" sourcePrompt="0.7::artist:alpha::" boot={boot} />);
  expand(); expect(await screen.findByRole('img', { name: 'artist:alpha' })).toBeTruthy();
  expect(screen.getByText('画师来自法典条目配方')).toBeTruthy();
  rerender(<PromptArtistSamples prompt="artist:beta" sourcePrompt="artist:alpha" boot={boot} />);
  expect(await screen.findByRole('img', { name: 'artist:beta' })).toBeTruthy();
  expect(screen.queryByText('画师来自法典条目配方')).toBeNull(); expect(screen.queryByRole('img', { name: 'artist:alpha' })).toBeNull();
});
