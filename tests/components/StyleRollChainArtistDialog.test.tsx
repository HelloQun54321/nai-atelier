// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { StyleRollChainArtistDialog } from '../../components/roll/StyleRollChainArtistDialog';
import { ImageActivityProvider } from '../../components/SmartImage';
import { createDefaultRollTemplate } from '../../services/styleRoll';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';

const mocks = vi.hoisted(() => ({ load: vi.fn(), extract: vi.fn() }));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.load } }));
vi.mock('../../services/styleRollChainArtists', async original => {
  const actual = await original<typeof import('../../services/styleRollChainArtists')>();
  return { extractRollChainArtistTags: mocks.extract.mockImplementation(actual.extractRollChainArtistTags) };
});
vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }));
const chain = (id: string, prompt: string, type: any = 'style'): PromptChain => ({
  id, type, name: `串 ${id}`, basePrompt: prompt, negativePrompt: 'artist:negative', modules: [], tags: [], description: '',
  params: createDefaultRollTemplate(DEFAULT_NAI_RUNTIME).params, previewImage: `/${id}.png`, userId: 'synthetic', createdAt: 1, updatedAt: 1,
});
const known = new Set(['alpha', 'beta']);
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue([chain('a', '1.3::artist:alpha, artist:beta::'), chain('b', 'artist:beta, artist:gamma'), chain('empty', 'landscape')]); });
afterEach(cleanup);
const setup = (options = {}) => {
  const props = { knownArtists: known, pinned: ['old'], blocked: [] as string[], limit: 8, onConfirm: vi.fn(), onClose: vi.fn(), ...options };
  return { ...render(<StyleRollChainArtistDialog {...props} />), props };
};

it('多串去重仅合并已勾选Tag，一次确认保留原固定项，不传来源配置', async () => {
  const { props } = setup({ pinned: ['old', 'alpha'], blocked: ['gamma'] });
  await screen.findByRole('checkbox', { name: '串 a' });
  expect(document.querySelector('img')!.getAttribute('src')).toBe('/a.png');
  fireEvent.click(screen.getByRole('checkbox', { name: '串 a' })); fireEvent.click(screen.getByRole('checkbox', { name: '串 b' }));
  expect(screen.getAllByRole('checkbox', { name: 'beta' })).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'alpha' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('checkbox', { name: 'gamma' })).toHaveProperty('disabled', true);
  expect(screen.getByText('未识别到画师 Tag')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消全选' })); expect(screen.getByRole('button', { name: '确认提取' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  fireEvent.click(screen.getByRole('button', { name: '确认提取' })); fireEvent.click(screen.getByRole('button', { name: '确认提取' }));
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith(['old', 'alpha', 'beta']);
});

it('超出当前人数上限不丢Tag，减少勾选后确认；64是硬上限', async () => {
  const { props } = setup({ pinned: ['old'], limit: 2 }); await screen.findByRole('checkbox', { name: '串 a' });
  fireEvent.click(screen.getByRole('checkbox', { name: '串 a' })); fireEvent.click(screen.getByRole('button', { name: '确认提取' }));
  expect(screen.getByRole('alert').textContent).toContain('最多可添加 2 位画师'); expect(props.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'beta' })); fireEvent.click(screen.getByRole('button', { name: '确认提取' }));
  expect(props.onConfirm).toHaveBeenCalledWith(['old', 'alpha']);
});

it('人数设置超过64仍不会导入超过64位画师', async () => {
  const { props } = setup({ pinned: Array.from({ length: 63 }, (_, i) => `old ${i}`), limit: 100 });
  await screen.findByRole('checkbox', { name: '串 a' }); fireEvent.click(screen.getByRole('checkbox', { name: '串 a' }));
  fireEvent.click(screen.getByRole('button', { name: '确认提取' }));
  expect(screen.getByRole('alert').textContent).toContain('最多可添加 64 位画师'); expect(props.onConfirm).not.toHaveBeenCalled();
});

it('旧名单全角与转义括号同义识别，不重复固定也不绕过屏蔽', async () => {
  mocks.load.mockResolvedValue([chain('normalized', 'artist:alpha_name, artist:beta_name(style), artist:gamma')]);
  const { props } = setup({ pinned: ['Ａlpha_Name'], blocked: ['beta_name\\(style\\)'] });
  fireEvent.click(await screen.findByRole('checkbox', { name: '串 normalized' }));
  expect(screen.getByRole('checkbox', { name: 'alpha name' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('checkbox', { name: 'beta name (style)' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '确认提取' }));
  expect(props.onConfirm).toHaveBeenCalledWith(['Ａlpha_Name', 'gamma']);
});

it('仅风格及旧无type条目，完整库分页可搜索末项，勾选不重复解析', async () => {
  const legacy = chain('legacy', 'artist:beta'); delete (legacy as Partial<PromptChain>).type;
  mocks.load.mockResolvedValue([...Array.from({ length: 1001 }, (_, i) => chain(String(i), 'artist:alpha')), legacy, chain('character', 'artist:bad', 'character'), chain('preset', 'artist:bad', 'preset')]);
  setup(); await screen.findByRole('checkbox', { name: '串 0' });
  expect(screen.getAllByRole('checkbox')).toHaveLength(60); const parsed = mocks.extract.mock.calls.length;
  fireEvent.click(screen.getByRole('checkbox', { name: '串 0' })); fireEvent.click(screen.getByRole('checkbox', { name: 'alpha' }));
  expect(mocks.extract).toHaveBeenCalledTimes(parsed);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '1000' } }); expect(screen.getByRole('checkbox', { name: '串 1000' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'legacy' } }); expect(screen.getByRole('checkbox', { name: '串 legacy' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'character' } }); expect(screen.queryByRole('checkbox', { name: '串 character' })).toBeNull();
});

it('读取失败不能确认，重试取得最新本地库；关闭后的迟到读取不应用', async () => {
  mocks.load.mockRejectedValueOnce(new Error('合成读取失败')); const view = setup();
  await screen.findByText('合成读取失败'); expect(screen.getByRole('button', { name: '确认提取' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('checkbox', { name: '串 a' });
  expect(mocks.load).toHaveBeenCalledTimes(2); view.unmount();
  let finish!: (value: PromptChain[]) => void; mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = setup(); await screen.findByText('加载中…'); pending.unmount();
  await act(async () => finish([chain('late', 'artist:alpha')])); expect(pending.props.onConfirm).not.toHaveBeenCalled(); expect(screen.queryByText('串 late')).toBeNull();
});

it('真实Portal焦点圈禁与Escape归还只关闭提取层，取消不写固定项', async () => {
  const apply = vi.fn();
  const Fixture = () => { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>打开</button>{open && <StyleRollChainArtistDialog knownArtists={known} pinned={[]} blocked={[]} limit={8} onConfirm={apply} onClose={() => setOpen(false)} />}</>; };
  render(<Fixture />); const trigger = screen.getByRole('button', { name: '打开' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog'); await screen.findByRole('checkbox', { name: '串 a' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  const cancel = within(dialog).getByRole('button', { name: '取消' }); cancel.focus();
  fireEvent.keyDown(window, { key: 'Tab' }); expect(dialog.contains(document.activeElement)).toBe(true);
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(apply).not.toHaveBeenCalled();
});

it('保活页面隐藏时释放窗口键盘且不能应用旧选择', async () => {
  const view = setup(); await screen.findByRole('checkbox', { name: '串 a' }); fireEvent.click(screen.getByRole('checkbox', { name: '串 a' }));
  view.rerender(<ImageActivityProvider active={false}><StyleRollChainArtistDialog {...view.props} /></ImageActivityProvider>);
  fireEvent.keyDown(window, { key: 'Escape' }); expect(view.props.onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(view.props.onConfirm).not.toHaveBeenCalled();
});
