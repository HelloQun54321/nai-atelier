// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';
import type { NAIParams } from '../../types';

const rules = vi.hoisted(() => ({ characterReferenceCost: 7, listOverride: undefined as ((archived: boolean) => Promise<unknown[]>) | undefined }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: rules }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsCharacterReferences: true }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: {
  list: async (_query: string, archived: boolean) => rules.listOverride ? rules.listOverride(archived) : archived ? [] : [{ id: 'ref', name: '已有角色参考名字', originalImageUrl: '/synthetic.png', defaultStrength: 0.6, defaultFidelity: 0.6, createdAt: 0 }],
} }));
afterEach(() => { cleanup(); rules.listOverride = undefined; window.history.replaceState({}, ""); });
it('参考图所有费用提示跟随动态单价', () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', type: 'character' as const, strength: 1, fidelity: 1 }] } };
  const props = { params, setParams: vi.fn(), markChange: vi.fn(), notify: vi.fn() };
  const view = render(<CharacterReferenceManager {...props} />);
  expect(screen.getByText('本次生成额外消耗 1 × 7 = 7 Anlas')).toBeTruthy();
  rules.characterReferenceCost = 9;
  view.rerender(<CharacterReferenceManager {...props} />);
  expect(screen.getByText('本次生成额外消耗 1 × 9 = 9 Anlas')).toBeTruthy();
});

it('精准参考保持官方五种描述类型及原值，已有资产名称不随通用名称变更', async () => {
  const params: NAIParams = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', assetName: '已有角色参考名字', type: 'character', strength: 1, fidelity: 1 }] } };
  const setParams = vi.fn();
  render(<CharacterReferenceManager params={params} setParams={setParams} markChange={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByRole('button', { name: '管理精准参考' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByRole('dialog', { name: '精准参考' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '精准参考' })).toBeTruthy();
  expect(screen.getByPlaceholderText('搜索精准参考…')).toBeTruthy();
  expect(screen.getByLabelText('上传精准参考图片')).toBeTruthy();
  const select = screen.getByRole('combobox');
  expect(Array.from((select as HTMLSelectElement).options).map(option => [option.value, option.textContent])).toEqual([
    ['character', '角色 · 保留人物身份与外观'], ['style', '画风 · 参考图像的风格表现'], ['costume', '服装 · 服装与配饰'],
    ['character_style', '角色与画风 · 同时参考人物和风格'], ['delta', '变化 · 变化量'],
  ]);
  for (const type of ['style', 'costume', 'character_style', 'delta', 'character']) {
    fireEvent.change(select, { target: { value: type } });
    expect(setParams.mock.lastCall?.[0].characterReferences.slots[0]).toMatchObject({ type, assetId: 'ref', assetName: '已有角色参考名字' });
  }
  fireEvent.click(await screen.findByRole('button', { name: '详情' }));
  expect(screen.getByRole('heading', { name: '已有角色参考名字' })).toBeTruthy();
});

it('首次读取等待和失败不显示空库，重试成功空结果才显示空态', async () => {
  const pending = Promise.withResolvers<unknown[]>();
  rules.listOverride = () => pending.promise;
  render(<CharacterReferenceManager params={{} as NAIParams} setParams={vi.fn()} markChange={vi.fn()} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByText('加载中…')).toBeTruthy();
  expect(screen.queryByText('还没有精准参考图')).toBeNull();
  await act(async () => pending.reject(new Error('synthetic')));
  expect(screen.getByRole('alert').textContent).toContain('资料库加载失败');
  expect(screen.queryByText('还没有精准参考图')).toBeNull();
  rules.listOverride = async () => [];
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('还没有精准参考图')).toBeTruthy();
});

it('缓存资料刷新失败时保留已有卡片', async () => {
  render(<CharacterReferenceManager params={{} as NAIParams} setParams={vi.fn()} markChange={vi.fn()} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  await screen.findByRole('button', { name: /已有角色参考名字/ });
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  const pending = Promise.withResolvers<unknown[]>();
  rules.listOverride = () => pending.promise;
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByRole('button', { name: /已有角色参考名字/ })).toBeTruthy();
  await act(async () => pending.reject(new Error('synthetic')));
  expect(screen.getByRole('button', { name: /已有角色参考名字/ })).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
});

const referenceParams = (slots: Array<Record<string, unknown>> = [{ assetId: 'ref', assetName: '已有角色参考名字', type: 'character', strength: 1, fidelity: 1 }], extra: Partial<NAIParams> = {}): NAIParams => ({
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
  characterReferences: { enabled: slots.length > 0, slots: slots as never }, ...extra,
});

it('当前参考按官方上限 16 计数，不再写死为四个槽位', async () => {
  render(<CharacterReferenceManager params={referenceParams()} setParams={vi.fn()} markChange={vi.fn()} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByText('1/16')).toBeTruthy();
});

it('参考槽直接显示类型与三个数值参数，信息提取量可按槽调整', async () => {
  const setParams = vi.fn();
  render(<CharacterReferenceManager params={referenceParams()} setParams={setParams} markChange={vi.fn()} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByText('信息提取量')).toBeTruthy();
  const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
  expect(sliders).toHaveLength(3);
  // 未单独设置过的槽按官方默认提取量 1 显示，且限定在 0..1。
  expect({ value: sliders[2].value, min: sliders[2].min, max: sliders[2].max }).toEqual({ value: '1', min: '0', max: '1' });
  fireEvent.change(sliders[2], { target: { value: '0.4' } });
  expect(setParams.mock.lastCall?.[0].characterReferences.slots[0]).toMatchObject({ informationExtracted: 0.4, type: 'character' });
});

it('新增参考会关掉正在生效的氛围参考，并当场说明', async () => {
  const setParams = vi.fn(); const notify = vi.fn();
  render(<CharacterReferenceManager params={referenceParams([], {
    vibes: { enabled: true, normalizeStrengths: true, slots: [{ vibeId: 'v', encodingId: 'e', informationExtracted: 1, strength: 0.6 }] },
  })} setParams={setParams} markChange={vi.fn()} notify={notify} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  fireEvent.click(await screen.findByRole('button', { name: /已有角色参考名字/ }));
  expect(setParams.mock.lastCall?.[0].vibes.enabled).toBe(false);
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('已关闭氛围参考'));
});

it('详情页可以直接把这张参考加入本次使用', async () => {
  render(<CharacterReferenceManager params={referenceParams([])} setParams={vi.fn()} markChange={vi.fn()} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  fireEvent.click(await screen.findByRole('button', { name: '详情' }));
  expect(screen.getByRole('button', { name: '加入本次使用' })).toBeTruthy();
});
