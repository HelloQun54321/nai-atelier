// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../types';

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(), getAllChains: vi.fn(), getAllArtists: vi.fn(), getAllInspirations: vi.fn(),
  createChain: vi.fn(), createChainWithData: vi.fn(),
}));
vi.mock('../services/dbService', () => ({ db: mocks }));
vi.mock('../services/collectorAppearance', () => ({ useCollectorAppearance: () => {} }));
vi.mock('./ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock('./Layout', () => ({ Layout: ({ children, onNavigate, currentView, toast }: any) => <>
  <div data-testid="view">{currentView}</div>
  {['aitag', 'inspiration', 'list'].map(view => <button key={view} onClick={() => onNavigate(view)}>{view}</button>)}
  {toast && <div role="status" data-type={toast.type}>{toast.message}</div>}{children}
</> }));
vi.mock('./ChainList', () => ({ ChainList: ({ chains }: { chains: PromptChain[] }) => <div data-testid="list">{chains.map(chain => chain.id).join(',')}</div> }));
vi.mock('./ChainEditor', () => ({ ChainEditor: ({ chain, onBack }: any) => <div data-testid="editor">{chain.id}|{chain.basePrompt}|{chain.previewImage}<button onClick={onBack}>返回资料库</button></div> }));
// 这里验证 App 的共享保存回调；AITag 实际按钮的元数据与连点行为在图库组件测试中覆盖。
const source: PromptChain = {
  id: 'aitag-synthetic', type: 'style', userId: 'owner', name: '合成作品 P1', description: '', tags: [],
  basePrompt: 'synthetic prompt', negativePrompt: 'synthetic negative', modules: [], variableValues: { subject: '' },
  params: { width: 832, height: 1216, steps: 23, scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 4, characters: [] },
  previewImage: '/api/assets/aitag/source.png', createdAt: 1, updatedAt: 1,
};
const saved = { ...source, id: 'server-saved', previewImage: '/api/assets/covers/server-saved.png' };
const ExternalGallery = ({ onCreateArtistChain, notify }: any) => <button onClick={async () => {
  try { await onCreateArtistChain(source); notify('已保存到风格串'); }
  catch (error: any) { notify(error.message, 'error'); }
}}>保存合成作品</button>;
vi.mock('./AitagGallery', () => ({ AitagGallery: (props: any) => <ExternalGallery {...props} /> }));
vi.mock('./InspirationGallery', () => ({ InspirationGallery: (props: any) => <ExternalGallery {...props} /> }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  mocks.getMe.mockResolvedValue({ id: 'owner', username: '合成用户', role: 'admin' });
  mocks.getAllChains.mockResolvedValue([]); mocks.getAllArtists.mockResolvedValue([]); mocks.getAllInspirations.mockResolvedValue([]);
  mocks.createChain.mockResolvedValue(saved.id); mocks.createChainWithData.mockResolvedValue(saved);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const setup = async (entry = 'aitag') => {
  const { default: App } = await import('../App');
  render(<App />);
  await screen.findByTestId('list');
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: entry }));
  await screen.findByRole('button', { name: '保存合成作品' });
};

it.each(['aitag', 'inspiration'])('%s 保存后直接打开服务端条目，无须等待整库刷新', async entry => {
  await setup(entry);
  // 若重新读整库会永远等待，证明跳转没有依赖这个请求。
  mocks.getAllChains.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  const editor = await screen.findByTestId('editor');
  expect(editor.textContent).toContain('server-saved|synthetic prompt|/api/assets/covers/server-saved.png');
  expect(screen.getByTestId('view').textContent).toBe('edit');
  expect(mocks.getAllChains).toHaveBeenCalledTimes(1);
  expect(mocks.createChainWithData).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('已保存到风格串');
  fireEvent.click(screen.getByRole('button', { name: '返回资料库' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
});

it('写入失败保持来源页，只显示失败，不伪报已保存', async () => {
  await setup(); mocks.createChainWithData.mockRejectedValueOnce(new Error('模拟创建失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('模拟创建失败'));
  expect(screen.getByRole('status').getAttribute('data-type')).toBe('error');
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
});

it('旧的整库刷新迟到不会移除刚保存的条目或破坏已打开的工作台', async () => {
  await setup(); let resolve!: (value: PromptChain[]) => void;
  mocks.getAllChains.mockImplementation(() => new Promise<PromptChain[]>(done => { resolve = done; }));
  act(() => window.dispatchEvent(new CustomEvent('nai-project-data-changed')));
  await waitFor(() => expect(mocks.getAllChains).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  await screen.findByTestId('editor');
  await act(async () => resolve([{ ...source, id: 'existing-from-slow-list' }]));
  expect(screen.getByTestId('editor').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
  expect(screen.getByTestId('list').textContent).toContain('existing-from-slow-list');
});

it('保存中已主动离开时保留新页面，仍把成功条目加入资料库', async () => {
  await setup(); let resolve!: (value: PromptChain) => void;
  mocks.createChainWithData.mockImplementation(() => new Promise<PromptChain>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  await act(async () => resolve(saved));
  expect(screen.getByTestId('view').textContent).toBe('list');
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(screen.getByTestId('list').textContent).toContain(saved.id);
});

it('保存中离开再返回来源页，旧保存完成也不打断新的浏览会话', async () => {
  await setup(); let resolve!: (value: PromptChain) => void;
  mocks.createChainWithData.mockImplementation(() => new Promise<PromptChain>(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '保存合成作品' }));
  fireEvent.click(screen.getByRole('button', { name: 'list' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('list'));
  fireEvent.click(screen.getByRole('button', { name: 'aitag' }));
  await waitFor(() => expect(screen.getByTestId('view').textContent).toBe('aitag'));
  await act(async () => resolve(saved));
  expect(screen.getByTestId('view').textContent).toBe('aitag');
  expect(screen.queryByTestId('editor')).toBeNull();
});
