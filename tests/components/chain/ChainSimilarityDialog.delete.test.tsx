// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../../types';
import { ChainSimilarityDialog } from '../../../components/chain/ChainSimilarityDialog';
import { ConfirmDialogProvider, useConfirmDialog } from '../../../components/ConfirmDialog';
import { isTopmostModal } from '../../../components/useModalA11y';
import { rememberDailyConfirmation } from '../../../services/dailyConfirmation';
import { setLanguage, t } from '../../../services/i18n';

vi.mock('../../../services/artistSamples', () => ({ getArtistSampleDictionary: async () => [] }));
vi.mock('../../../components/SmartImage', () => ({ ImageActivityContext: React.createContext(true),
  SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
const chains: PromptChain[] = ['a', 'b', 'c'].map(id => ({ id, name: id, userId: 'synthetic', type: 'style',
  description: '', tags: [], basePrompt: 'artist:synthetic_artist', negativePrompt: '', modules: [],
  previewImage: '/synthetic/' + id + '.png', createdAt: 1, updatedAt: 1,
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler' } }));

// 复用 ChainList.handleDelete 的确认选项与成功回执语义，写入边界仅由合成 spy 承担。
function Harness({ remove, close }: { remove: (id: string) => Promise<void>; close: () => void }) {
  const confirm = useConfirmDialog();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  const onDelete = async (chain: PromptChain) => {
    if (!await confirm({ rememberKey: 'chain.delete', title: t('删除“{0}”？', [chain.name]),
      message: t('该风格串将被永久删除，此操作无法撤销。'), confirmLabel: t('确认删除'), tone: 'danger' })) return false;
    try { await remove(chain.id); return true; }
    catch { setError('删除失败，请稍后重试'); return false; }
  };
  return <>{error && <p role="alert">{error}</p>}{open && <ChainSimilarityDialog chains={chains} filteredChains={chains}
    onClose={() => { close(); setOpen(false); }} onOpenChain={() => {}} onDelete={onDelete} />}</>;
}
const mount = async (remove = vi.fn(async (_id: string) => {})) => {
  const close = vi.fn();
  render(<ConfirmDialogProvider><Harness remove={remove} close={close} /></ConfirmDialogProvider>);
  await screen.findByText('已扫描 3 条 · 1 组相似 · 涉及 3 条 · 线索不足 0 条');
  return { remove, close };
};
const begin = () => fireEvent.click(screen.getByRole('button', { name: '删除：b' }));
const confirm = () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }));

beforeEach(() => {
  localStorage.clear(); setLanguage('zh-CN'); window.history.replaceState(null, '');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止访问真实数据'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('真实确认层高于相似弹层，Esc 和取消仅取消确认且不隐式记住偏好', async () => {
  const { remove, close } = await mount();
  begin();
  const parent = screen.getByRole('dialog', { name: '查找相似' });
  expect(isTopmostModal(screen.getByRole('alertdialog'))).toBe(true);
  expect(isTopmostModal(parent)).toBe(false);
  expect((screen.getByRole('checkbox', { name: '今日内不再显示' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(parent.isConnected).toBe(true); expect(close).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  await waitFor(() => expect((screen.getByRole('button', { name: '删除：b' }) as HTMLButtonElement).disabled).toBe(false));
  begin(); fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(remove).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai_daily_confirmations')).toBeNull();
});

it.each([false, true])('确认后 deferred 删除锁定关闭、遮罩、Esc、重复提交及手机返回（手机=%s）', async mobile => {
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener() {}, removeEventListener() {} }));
  let finish!: () => void;
  const remove = vi.fn((_id: string) => new Promise<void>(resolve => { finish = resolve; }));
  const { close } = await mount(remove);
  begin(); confirm();
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('b'));
  const parent = screen.getByRole('dialog', { name: '查找相似' });
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.pointerDown(parent.parentElement!);
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '删除：b' }));
  fireEvent.click(screen.getByRole('button', { name: '删除：a' }));
  if (mobile) {
    await waitFor(() => expect(window.history.state?.__naiMobileLayer).toContain('chain-similarity-'));
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
    await waitFor(() => expect(window.history.state?.__naiMobileLayer).toContain('chain-similarity-'));
  }
  expect(parent.isConnected).toBe(true); expect(close).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
  expect(screen.queryByRole('region', { name: 'b' })).toBeNull();
  expect(screen.getByRole('region', { name: 'a' })).toBeTruthy(); expect(screen.getByRole('region', { name: 'c' })).toBeTruthy();
  expect(localStorage.getItem('nai_daily_confirmations')).toBeNull();
});

it('删除失败保留作品；仅合成的既有当日授权跳过后续确认', async () => {
  const remove = vi.fn(async (_id: string): Promise<void> => { throw new Error('合成失败'); });
  const { close } = await mount(remove);
  begin(); confirm();
  await screen.findByText('删除失败，请稍后重试');
  expect(screen.getByRole('region', { name: 'b' })).toBeTruthy(); expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem('nai_daily_confirmations')).toBeNull();
  rememberDailyConfirmation('chain.delete', 'confirm');
  remove.mockResolvedValueOnce(undefined);
  begin();
  await screen.findByText('已扫描 2 条 · 1 组相似 · 涉及 2 条 · 线索不足 0 条');
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('region', { name: 'b' })).toBeNull();
});
