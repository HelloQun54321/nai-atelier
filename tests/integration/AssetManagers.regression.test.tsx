// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CharacterReferenceAsset, NAIParams, VibeAsset } from '../../types';
import { VibeManager } from '../../components/VibeManager';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';

const fixtures = vi.hoisted(() => ({ vibeList: vi.fn(), refList: vi.fn(), encode: vi.fn(), create: vi.fn(), rename: vi.fn(), archive: vi.fn() }));

vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: { vibeEncodingCost: 2, characterReferenceCost: 5 } }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true, supportsCharacterReferences: true }) }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 10 }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: async () => null }) }));
vi.mock('../../components/SmartImage', async importOriginal => ({
  ...await importOriginal<typeof import('../../components/SmartImage')>(),
  SmartImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
  OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));
vi.mock('../../services/vibeService', () => ({ vibeService: { list: fixtures.vibeList, listGroups: async () => [], encode: fixtures.encode, rename: fixtures.rename, archive: fixtures.archive } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { list: fixtures.refList, create: fixtures.create, rename: fixtures.rename, archive: fixtures.archive } }));
const params: NAIParams = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };
const vibe: VibeAsset = { id: 'v', name: '测试 Vibe', sourceHash: 'synthetic', defaultStrength: 0, hasOriginal: true, thumbnailUrl: '/synthetic.webp', archived: false, createdAt: 0, updatedAt: 0, encodings: [{ id: 'e', model: 'nai-diffusion-4-5-full', modelKey: 'v4-5full', encodingHash: 'synthetic', informationExtracted: 1, createdAt: 0 }] };
const reference: CharacterReferenceAsset = { id: 'r', name: '测试参考', sourceHash: 'synthetic', defaultStrength: 0, defaultFidelity: 0, originalImageUrl: '/synthetic.webp', thumbnailUrl: '/synthetic.webp', archived: false, createdAt: 0, updatedAt: 0 };
const changed = vi.fn();
const notify = vi.fn();
const Harness = ({ kind, initial = params }: { kind: 'vibe' | 'reference'; initial?: NAIParams }) => {
  const [value, setValue] = useState(initial);
  const actions = { params: value, setParams: (next: NAIParams) => { setValue(next); changed(next); }, markChange: vi.fn(), notify };
  return <div className="agent-stage safe-mode dark"><ConfirmDialogProvider><main className="isolate">{kind === 'vibe' ? <VibeManager {...actions} apiKey="synthetic" /> : <CharacterReferenceManager {...actions} />}</main></ConfirmDialogProvider></div>;
};
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '');
  fixtures.vibeList.mockImplementation(async (_query: string, archived: boolean) => archived ? [] : [vibe]);
  fixtures.refList.mockImplementation(async (_query: string, archived: boolean) => archived ? [] : [reference]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = async (kind: 'vibe' | 'reference') => {
  fireEvent.click(screen.getByRole('button', { name: kind === 'vibe' ? '管理' : /角色参考/ }));
  await screen.findByRole('button', { name: kind === 'vibe' ? /测试 Vibe/ : /测试参考/ });
};

it.each(['vibe', 'reference'] as const)('%s 添加保留合法零值，关闭只结束窗口', async kind => {
  render(<Harness kind={kind} />); await open(kind);
  fireEvent.click(screen.getByRole('button', { name: kind === 'vibe' ? /测试 Vibe/ : /测试参考/ }));
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining(kind === 'vibe' ? { vibes: expect.objectContaining({ slots: [expect.objectContaining({ strength: 0 })] }) } : { characterReferences: expect.objectContaining({ slots: [expect.objectContaining({ strength: 0, fidelity: 0 })] }) }));
  const calls = changed.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(changed).toHaveBeenCalledTimes(calls);
});

it('搜索或切换归档不把已选编码误报为缺失，也不重载资料', async () => {
  render(<Harness kind="vibe" />); await open('vibe');
  fireEvent.click(screen.getByRole('button', { name: /测试 Vibe/ }));
  fireEvent.click(screen.getByText('参数 · 强度 0.00'));
  fireEvent.change(screen.getByPlaceholderText('搜索我的 Vibe…'), { target: { value: '无匹配' } });
  expect(screen.queryByRole('button', { name: /测试 Vibe/ })).toBeNull();
  expect(screen.getByRole('option', { name: '提取量 1.00' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('tablist', { name: '资料库范围' })).getByRole('tab', { name: '已归档' }));
  expect(screen.getByRole('option', { name: '提取量 1.00' })).toBeTruthy();
  expect(screen.queryByText('编码缺失或资产已归档')).toBeNull(); expect(fixtures.vibeList).toHaveBeenCalledTimes(2);
});

it.each(['vibe', 'reference'] as const)('%s 详情返回保留列表节点、滚动位置和搜索；X 退出整个窗口', async kind => {
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  render(<Harness kind={kind} />); await open(kind);
  const search = screen.getByPlaceholderText(kind === 'vibe' ? '搜索我的 Vibe…' : '搜索角色参考…');
  fireEvent.change(search, { target: { value: '测试' } });
  const list = document.querySelector<HTMLElement>('.workspace-manager-list')!; list.scrollTop = 128;
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  expect(document.querySelector('.workspace-manager-list')).toBe(list);
  expect(list.closest('[hidden]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回' })); expect(back).toHaveBeenCalledOnce();
  window.history.replaceState({ [kind === 'vibe' ? 'naiVibeManager' : 'naiCharacterReferenceManager']: 'list' }, '');
  fireEvent.popState(window);
  expect(list.closest('[hidden]')).toBeNull(); expect(list.scrollTop).toBe(128); expect((search as HTMLInputElement).value).toBe('测试');
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(go).toHaveBeenCalledWith(-2);
});

it.each(['vibe', 'reference'] as const)('%s 资料默认值明确保存，失焦不写入本次参数', async kind => {
  const asset = kind === 'vibe' ? vibe : reference;
  fixtures.rename.mockResolvedValue({ item: { ...asset, name: '新名称' } });
  render(<Harness kind={kind} />); await open(kind);
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '新名称' } });
  fireEvent.blur(screen.getByRole('textbox', { name: '名称' })); expect(fixtures.rename).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存资料' }));
  await screen.findByText('资料默认值已保存'); expect(fixtures.rename).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
});

it('确认框打开时 Tab 与 Esc 只作用于确认框，父资料详情保持打开', async () => {
  render(<Harness kind="reference" />); await open('reference');
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.click(screen.getByRole('button', { name: '归档' }));
  const confirm = screen.getByRole('alertdialog');
  const buttons = within(confirm).getAllByRole('button'); buttons.at(-1)!.focus();
  fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.getByRole('dialog', { name: '测试参考' })).toBeTruthy(); expect(fixtures.archive).not.toHaveBeenCalled();
});

it('上传期间改变选择不会被旧快照覆盖；关闭后完成也不会自动选入', async () => {
  let resolve!: (value: { item: CharacterReferenceAsset }) => void;
  fixtures.create.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<Harness kind="reference" />); await open('reference');
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['x'], 'synthetic.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: /测试参考/ }));
  resolve({ item: { ...reference, id: 'late' } });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('角色参考图已保存'));
  expect(changed).toHaveBeenCalledTimes(1);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['y'], 'late.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: '完成' })); resolve({ item: { ...reference, id: 'closed' } });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(changed).toHaveBeenCalledTimes(1);
});

it('关闭后重新打开丢弃前一轮列表的迟到响应', async () => {
  let resolve!: (value: CharacterReferenceAsset[]) => void;
  fixtures.refList.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  vi.spyOn(window.history, 'go').mockImplementation(() => {});
  render(<Harness kind="reference" />);
  fireEvent.click(screen.getByRole('button', { name: /角色参考/ })); fireEvent.click(screen.getByRole('button', { name: '完成' }));
  await open('reference'); resolve([{ ...reference, name: '过期结果' }]);
  await waitFor(() => expect(screen.getByRole('button', { name: /测试参考/ })).toBeTruthy()); expect(screen.queryByText('过期结果')).toBeNull();
});

it('编码完成不会覆盖等待期间移除的选择，永久编码仍保存并可再次取用', async () => {
  let resolve!: (value: { item: VibeAsset }) => void;
  fixtures.vibeList.mockImplementation(async (_query: string, archived: boolean) => archived ? [] : [{ ...vibe, encodings: [] }]);
  fixtures.encode.mockImplementation(() => new Promise(done => { resolve = done; }));
  const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'previous', vibeName: '原选择', encodingId: 'previous-e', informationExtracted: 1, strength: 0.4 }] } };
  render(<Harness kind="vibe" initial={initial} />); await open('vibe');
  fireEvent.click(screen.getByRole('button', { name: /测试 Vibe/ }));
  fireEvent.click(await screen.findByRole('button', { name: '支付 2 Anlas 并生成' }));
  await waitFor(() => expect(fixtures.encode).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  resolve({ item: vibe });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('编码已保存，当前选择已变化，请重新选择该 Vibe'));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ vibes: expect.objectContaining({ slots: [] }) }));
  fireEvent.click(screen.getByRole('button', { name: /测试 Vibe/ }));
  expect(changed).toHaveBeenCalledTimes(2); expect(fixtures.encode).toHaveBeenCalledOnce();
});
