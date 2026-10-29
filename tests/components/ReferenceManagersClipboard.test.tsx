// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VibeManager } from '../../components/VibeManager';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';
import { ReferenceSelectionPreview } from '../../components/ReferenceSelectionPreview';
import type { NAIParams, VibeAsset, CharacterReferenceAsset } from '../../types';

const fixtures = vi.hoisted(() => ({ createVibe: vi.fn(), createReference: vi.fn(), encode: vi.fn(), confirm: vi.fn(), refresh: vi.fn(), listVibe: vi.fn(), listReference: vi.fn() }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: { vibeEncodingCost: 2, freeVibeCount: 4, extraVibeCost: 2, characterReferenceCost: 5 } }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsVibes: true, supportsCharacterReferences: true }) }));
vi.mock('../../services/anlasBudget', () => ({ useAnlasBudget: () => ({ remaining: 100 }) }));
vi.mock('../../services/naiUsage', () => ({ useNovelaiUsage: () => ({ refreshIfStale: fixtures.refresh }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => fixtures.confirm }));
vi.mock('../../services/vibeService', () => ({ vibeService: { list: fixtures.listVibe, listGroups: async () => [], create: fixtures.createVibe, encode: fixtures.encode } }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: { list: fixtures.listReference, create: fixtures.createReference } }));

const params: NAIParams = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', vibes: { enabled: false, normalizeStrengths: true, slots: [] }, characterReferences: { enabled: false, slots: [] } };
const copiedImage = () => new File(['synthetic image'], 'clipboard.png', { type: 'image/png' });
const copiedClipboardItem = (): ClipboardItem => ({ types: ['image/png'], presentationStyle: 'unspecified', getType: async () => copiedImage() });
const vibe = { id: 'copied-vibe', name: '用户原名 Vibe', hasOriginal: true, defaultStrength: 0.6, encodings: [] } as unknown as VibeAsset;
const reference = { id: 'copied-ref', name: '用户原名 Reference', originalImageUrl: '/synthetic.png', defaultStrength: 0.6, defaultFidelity: 0.6 } as CharacterReferenceAsset;
const read = vi.fn();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const dispatchPaste = (target: Element, file: File | null = copiedImage()) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: file ? [file] : [], items: [] } });
  fireEvent(target, event);
  return event;
};
const coverWindow = () => {
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.style.zIndex = '2000';
  document.body.appendChild(modal);
  return modal;
};

beforeEach(() => {
  fixtures.createVibe.mockReset().mockResolvedValue({ item: vibe, duplicate: false });
  fixtures.createReference.mockReset().mockResolvedValue({ item: reference, duplicate: false });
  fixtures.encode.mockReset(); fixtures.confirm.mockReset().mockResolvedValue(false); fixtures.refresh.mockReset().mockResolvedValue({});
  fixtures.listVibe.mockReset().mockResolvedValue([]); fixtures.listReference.mockReset().mockResolvedValue([]);
  read.mockReset().mockResolvedValue([copiedClipboardItem()]);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read } });
});
afterEach(() => {
  cleanup(); window.history.replaceState({}, '');
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe.each(['vibe', 'reference'] as const)('%s 管理器粘贴图片', kind => {
  const title = kind === 'vibe' ? '氛围参考' : '精准参考';
  const create = () => kind === 'vibe' ? fixtures.createVibe : fixtures.createReference;
  const mount = async (initial = params) => {
    const setParams = vi.fn(), notify = vi.fn(), parentPaste = vi.fn();
    const Component = kind === 'vibe' ? VibeManager : CharacterReferenceManager;
    const props = { params: initial, setParams, notify, markChange: vi.fn(), apiKey: 'synthetic' };
    const content = (next: NAIParams) => <div onPaste={parentPaste}><Component {...props} params={next} /></div>;
    const view = render(content(initial));
    fireEvent.click(screen.getByRole('button', { name: kind === 'vibe' ? '管理氛围参考' : /精准参考/ }));
    const dialog = await screen.findByRole('dialog', { name: title });
    return { ...view, setParams, notify, parentPaste, dialog, rerenderParams: (next: NAIParams) => view.rerender(content(next)) };
  };

  it('按钮读取图片并沿用原导入流程，重复点击和粘贴不重复导入', async () => {
    const pending = Promise.withResolvers<ClipboardItem[]>(); read.mockReturnValue(pending.promise);
    const { dialog, setParams } = await mount();
    const button = screen.getByRole('button', { name: '粘贴图片' });
    fireEvent.click(button); fireEvent.click(button); dispatchPaste(dialog);
    expect(read).toHaveBeenCalledOnce(); expect(create()).not.toHaveBeenCalled();
    await act(async () => pending.resolve([copiedClipboardItem()]));
    await waitFor(() => expect(create()).toHaveBeenCalledOnce());
    expect(create()).toHaveBeenCalledWith(expect.objectContaining({ name: 'clipboard.png', type: 'image/png' }), 'clipboard');
    if (kind === 'vibe') {
      expect(await screen.findByRole('heading', { name: '用户原名 Vibe' })).toBeTruthy();
      await waitFor(() => expect(fixtures.confirm).toHaveBeenCalledWith(expect.objectContaining({ rememberKey: 'vibe.encode' })));
      expect(fixtures.encode).not.toHaveBeenCalled();
    } else await waitFor(() => expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ characterReferences: expect.objectContaining({ slots: [expect.objectContaining({ assetId: reference.id })] }) })));
  });

  it('窗口内图片 paste 不读取剪贴板 API，也不冒泡到后台画布', async () => {
    const { dialog, parentPaste } = await mount();
    const file = copiedImage(), event = dispatchPaste(dialog, file);
    expect(event.defaultPrevented).toBe(true); expect(parentPaste).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await waitFor(() => expect(create()).toHaveBeenCalledWith(file, 'clipboard'));
  });

  it('文字输入、纯文本粘贴与其它最上层窗口不被劫持', async () => {
    const { dialog } = await mount();
    const search = screen.getByPlaceholderText(kind === 'vibe' ? '搜索我的氛围参考…' : '搜索精准参考…');
    expect(dispatchPaste(search).defaultPrevented).toBe(false);
    expect(dispatchPaste(dialog, null).defaultPrevented).toBe(false);
    const modal = coverWindow();
    expect(dispatchPaste(dialog).defaultPrevented).toBe(false);
    modal.remove();
    expect(create()).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    dispatchPaste(document.body);
    expect(create()).not.toHaveBeenCalled();
  });

  it.each(['closed', 'covered', 'selection'] as const)('读取剪贴板期间 %s 后，不导入或覆盖选择', async action => {
    const pending = Promise.withResolvers<ClipboardItem[]>(); read.mockReturnValue(pending.promise);
    const { rerenderParams, setParams, notify } = await mount();
    fireEvent.click(screen.getByRole('button', { name: '粘贴图片' }));
    let modal: HTMLElement | undefined;
    if (action === 'closed') fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    else if (action === 'covered') modal = coverWindow();
    else rerenderParams({ ...params, scale: 8 });
    await act(async () => pending.resolve([copiedClipboardItem()]));
    modal?.remove();
    expect(create()).not.toHaveBeenCalled(); expect(setParams).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
  });

  it.each(['closed', 'covered'] as const)('保存图片期间 %s 后，迟到结果不选用或弹出编码确认', async action => {
    const pending = Promise.withResolvers<unknown>(); create().mockReturnValue(pending.promise);
    const { dialog, setParams, notify } = await mount();
    dispatchPaste(dialog);
    expect(create()).toHaveBeenCalledOnce();
    let modal: HTMLElement | undefined;
    if (action === 'closed') fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    else modal = coverWindow();
    await act(async () => pending.resolve({ item: kind === 'vibe' ? vibe : reference, duplicate: false }));
    modal?.remove();
    expect(setParams).not.toHaveBeenCalled(); expect(fixtures.confirm).not.toHaveBeenCalled(); expect(fixtures.encode).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
  });

  it.each(['permission', 'unsupported'] as const)('剪贴板 %s 失败给出快捷键提示，按钮恢复可用', async failure => {
    const { notify } = await mount();
    if (failure === 'permission') read.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fireEvent.click(screen.getByRole('button', { name: '粘贴图片' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('在参考窗口按 Ctrl+V'), 'error'));
    expect(screen.getByRole('button', { name: '粘贴图片' })).toHaveProperty('disabled', false);
    expect(create()).not.toHaveBeenCalled(); expect(fixtures.encode).not.toHaveBeenCalled();
  });
});

it('精准参考粘贴复用重复资产并禁用氛围参考，不叠加同一参考', async () => {
  fixtures.createReference.mockResolvedValue({ item: reference, duplicate: true });
  const setParams = vi.fn();
  const initial = { ...params, vibes: { enabled: true, normalizeStrengths: true, slots: [] } };
  const props = { params: initial, setParams, notify: vi.fn(), markChange: vi.fn() };
  const view = render(<CharacterReferenceManager {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  dispatchPaste(screen.getByRole('dialog', { name: '精准参考' }));
  await waitFor(() => expect(setParams).toHaveBeenCalledOnce());
  const selected = setParams.mock.lastCall![0];
  expect(selected.vibes.enabled).toBe(false); expect(selected.characterReferences.slots).toHaveLength(1);
  view.rerender(<CharacterReferenceManager {...props} params={selected} />);
  dispatchPaste(screen.getByRole('dialog', { name: '精准参考' }));
  await waitFor(() => expect(fixtures.createReference).toHaveBeenCalledTimes(2));
  expect(setParams).toHaveBeenCalledOnce();
});

describe.each(['vibe', 'reference'] as const)('%s 已选参考摘要', kind => {
  const Component = kind === 'vibe' ? VibeManager : CharacterReferenceManager;
  const selected = (enabled = true): NAIParams => ({ ...params,
    ...(kind === 'vibe' ? { vibes: { enabled, normalizeStrengths: true, slots: [{ vibeId: 'asset /一', vibeName: '原始资产名称', encodingId: 'encoding', informationExtracted: 1, strength: 0.6 }] } }
      : { characterReferences: { enabled, slots: [{ assetId: 'asset /一', assetName: '原始资产名称', type: 'style', strength: 0.6, fidelity: 0.6 }] } }),
  });

  it('首屏直接显示选中缩略图，不等待名单、不增加摘要读取，停用也保留图片', async () => {
    fixtures.listVibe.mockReturnValue(new Promise(() => {}));
    const props = { setParams: vi.fn(), notify: vi.fn(), markChange: vi.fn(), apiKey: 'synthetic' };
    const view = render(<Component {...props} params={selected()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const image = screen.getByRole('img', { name: '原始资产名称' });
    const expectedUrl = `/api/${kind === 'vibe' ? 'vibes' : 'character-references'}/${encodeURIComponent('asset /一')}/thumbnail`;
    expect(image.getAttribute('src')).toBe(expectedUrl);
    expect(screen.getByText('已启用')).toBeTruthy();
    // 氛围参考保留原有模型编码匹配读取；摘要自身不发起额外名单请求。
    expect(fixtures.listVibe).toHaveBeenCalledTimes(kind === 'vibe' ? 2 : 0);
    expect(fixtures.listReference).not.toHaveBeenCalled();
    view.rerender(<Component {...props} params={selected(false)} />);
    expect(screen.getByText('已停用')).toBeTruthy();
    expect(screen.getByRole('img', { name: '原始资产名称' }).getAttribute('src')).toBe(expectedUrl);
    expect(fixtures.listVibe).toHaveBeenCalledTimes(kind === 'vibe' ? 2 : 0);
    expect(props.setParams).not.toHaveBeenCalled(); expect(fixtures.encode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看参考：原始资产名称' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('无已选参考时保持简短空态和明确的管理入口', () => {
    render(<Component params={params} setParams={vi.fn()} notify={vi.fn()} markChange={vi.fn()} apiKey="synthetic" />);
    expect(screen.getByText('未选择参考图')).toBeTruthy();
    expect(screen.getByRole('button', { name: kind === 'vibe' ? '管理氛围参考' : '管理精准参考' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('heading')).toBeNull();
    expect(fixtures.listVibe).not.toHaveBeenCalled(); expect(fixtures.listReference).not.toHaveBeenCalled();
  });
});

it('精准参考摘要直接区分角色、画风、角色与画风三种含义', () => {
  const types = ['character', 'style', 'character_style'] as const;
  render(<CharacterReferenceManager params={{ ...params, characterReferences: { enabled: true, slots: types.map((type, i) => ({ assetId: String(i), assetName: `参考 ${i}`, type, strength: 0.6, fidelity: 0.6 })) } }} setParams={vi.fn()} notify={vi.fn()} markChange={vi.fn()} />);
  expect(screen.getAllByRole('img')).toHaveLength(3);
  for (const label of ['角色', '画风', '角色与画风']) expect(screen.getByText(label)).toBeTruthy();
  expect(fixtures.listReference).not.toHaveBeenCalled();
});

it('预览缺失或图片失败都显示暂无预览，换图后可显示新地址', () => {
  const props = { enabled: true, manageLabel: '管理氛围参考', onManage: vi.fn() };
  const view = render(<ReferenceSelectionPreview {...props} items={[{ id: 'encoded', name: '纯编码' }, { id: 'failed', name: '网络失败图片', imageUrl: '/synthetic-a.png' }]} />);
  expect(screen.getAllByText('暂无预览')).toHaveLength(1);
  fireEvent.error(screen.getByRole('img', { name: '网络失败图片' }));
  expect(screen.getAllByText('暂无预览')).toHaveLength(2);
  expect(screen.queryByText('仅编码')).toBeNull();
  view.rerender(<ReferenceSelectionPreview {...props} items={[{ id: 'failed', name: '新图片', imageUrl: '/synthetic-b.png' }]} />);
  expect(screen.getByRole('img', { name: '新图片' }).getAttribute('src')).toBe('/synthetic-b.png');
  expect(screen.queryByText('暂无预览')).toBeNull();
});
