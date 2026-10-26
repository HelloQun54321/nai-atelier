// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CharacterReferenceManager } from '../../components/CharacterReferenceManager';
import type { NAIParams } from '../../types';

const rules = vi.hoisted(() => ({ characterReferenceCost: 7 }));
vi.mock('../../services/naiRuntime', () => ({ useNaiRuntime: () => ({ billing: rules }) }));
vi.mock('../../services/naiModels', () => ({ getRuntimeNaiModelInfo: () => ({ supportsCharacterReferences: true }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock('../../services/characterReferenceService', () => ({ characterReferenceService: {
  list: async (_query: string, archived: boolean) => archived ? [] : [{ id: 'ref', name: '已有角色参考名字', originalImageUrl: '/synthetic.png', defaultStrength: 0.6, defaultFidelity: 0.6 }],
} }));
afterEach(cleanup);
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

it('精准参考保持三种类型及原值，已有资产名称不随通用名称变更', async () => {
  const params: NAIParams = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', assetName: '已有角色参考名字', type: 'character', strength: 1, fidelity: 1 }] } };
  const setParams = vi.fn();
  render(<CharacterReferenceManager params={params} setParams={setParams} markChange={vi.fn()} notify={vi.fn()} />);
  expect(screen.getByText('精准参考')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /精准参考/ }));
  expect(screen.getByRole('dialog', { name: '精准参考' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '精准参考 (Precise Reference)' })).toBeTruthy();
  expect(screen.getByPlaceholderText('搜索精准参考…')).toBeTruthy();
  expect(screen.getByLabelText('上传精准参考图片')).toBeTruthy();
  fireEvent.click(screen.getByText('参数 · 角色 · 强度 1.00'));
  const select = screen.getByRole('combobox');
  expect(Array.from((select as HTMLSelectElement).options).map(option => [option.value, option.textContent])).toEqual([
    ['character', '角色 · 保留人物身份与外观'], ['style', '画风 · 参考图像的风格表现'], ['character_style', '角色与画风 · 同时参考人物和风格'],
  ]);
  for (const type of ['style', 'character_style', 'character']) {
    fireEvent.change(select, { target: { value: type } });
    expect(setParams.mock.lastCall?.[0].characterReferences.slots[0]).toMatchObject({ type, assetId: 'ref', assetName: '已有角色参考名字' });
  }
  fireEvent.click(await screen.findByRole('button', { name: '详情' }));
  expect(screen.getByRole('heading', { name: '已有角色参考名字' })).toBeTruthy();
});
