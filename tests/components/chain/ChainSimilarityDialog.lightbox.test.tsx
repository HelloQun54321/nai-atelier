// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChainSimilarityDialog } from '../../../components/chain/ChainSimilarityDialog';
import { ConfirmDialogProvider } from '../../../components/ConfirmDialog';
import { setLanguage } from '../../../services/i18n';
import type { PromptChain } from '../../../types';

vi.mock('../../../services/artistSamples', () => ({ getArtistSampleDictionary: async () => [] }));
vi.mock('../../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));
vi.mock('../../../components/ImageShareActions', () => ({ IMAGE_CARD_ACTION_CLASS: '', ImageShareOverlay: () => null }));
const chains = ['a', 'b', 'c'].map(id => ({ id, name: id, userId: 'synthetic', type: 'style', tags: [],
  description: '', basePrompt: 'artist:synthetic_artist', negativePrompt: '', modules: [],
  previewImage: '/synthetic/' + id + '.png', createdAt: 1, updatedAt: 1,
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' } })) as PromptChain[];
let narrow = true;
beforeEach(() => {
  narrow = true; localStorage.clear(); setLanguage('zh-CN'); window.history.replaceState({ synthetic: true }, '');
  vi.stubGlobal('matchMedia', () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止访问真实资料'); }));
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = async () => {
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open && <ChainSimilarityDialog chains={chains} filteredChains={chains} onDelete={async () => false}
      onOpenChain={() => {}} onClose={() => { close(); setOpen(false); }} />;
  }
  render(<ConfirmDialogProvider><Harness /></ConfirmDialogProvider>);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  return close;
};
const back = async () => { await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 25)); }); };

it.each(['Escape', '返回按钮', '浏览器返回'])('窄屏打开父层后放宽窗口，%s 只关闭最上层原图，重复打开仍保留父层', async action => {
  const close = await mount();
  const parent = screen.getByRole('dialog', { name: '查找相似' });
  const marker = window.history.state.__naiMobileLayer;
  expect(marker).toContain('chain-similarity-');
  narrow = false;
  for (let round = 0; round < 2; round++) {
    fireEvent.click(screen.getByRole('button', { name: '放大查看：a' }));
    await screen.findByRole('dialog', { name: '图片预览' });
    if (action === 'Escape') fireEvent.keyDown(screen.getByRole('button', { name: '返回图片详情' }), { key: 'Escape', cancelable: true });
    else if (action === '返回按钮') fireEvent.click(screen.getByRole('button', { name: '返回图片详情' }));
    else await back();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull());
    expect(parent.isConnected).toBe(true); expect(close).not.toHaveBeenCalled();
    expect(window.history.state.__naiMobileLayer).toBe(marker);
  }
});
