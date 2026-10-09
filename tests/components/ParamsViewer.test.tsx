// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ParamsViewer } from '../../components/ParamsViewer';
import { copyTagText } from '../../services/externalImageTags';

vi.mock('../../services/externalImageTags', () => ({ copyTagText: vi.fn(async () => undefined) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('历史参考参数不把当前估算价格冒充当时的实际扣费', () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characterReferences: { enabled: true, slots: [{ assetId: 'ref', type: 'character' as const, strength: 1, fidelity: 1 }] } };
  render(<ParamsViewer params={params} />);
  expect(screen.getByText('角色参考 (1)')).toBeTruthy();
  expect(screen.queryByText(/Anlas/)).toBeNull();
});
it('手机可点按完整采样器和种子，内容在浮层中换行，原参数不变化', () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'custom_very_long_sampler_name', seed: 987654321, qualityToggle: true, ucPreset: 4 };
  const snapshot = JSON.stringify(params); render(<ParamsViewer params={params} />);
  fireEvent.click(screen.getByRole('button', { name: '查看采样器完整值' }));
  expect(within(screen.getByRole('dialog', { name: '查看采样器完整值' })).getByText('custom very long sampler name')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭说明' }));
  fireEvent.click(screen.getByRole('button', { name: '查看随机种子完整值' }));
  expect(within(screen.getByRole('dialog', { name: '查看随机种子完整值' })).getByText('987654321')).toBeTruthy();
  expect(JSON.stringify(params)).toBe(snapshot);
});

it('收藏详情可分别展示角色、参数及参考信息，历史默认仍完整展示且不改原数据', () => {
  const params = {
    width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
    characters: [{ id: 'char', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.3, y: 0.7 }],
    characterReferences: { enabled: true, slots: [{ assetId: 'ref', type: 'character' as const, strength: 1, fidelity: 1 }] },
    vibes: { enabled: true, normalizeStrengths: false, slots: [{ vibeId: 'vibe', encodingId: 'encoding', informationExtracted: 1, strength: 1 }] },
  };
  const original = JSON.stringify(params), view = render(<ParamsViewer params={params} />);
  const labels = ['生成参数', '多角色定义 (1)', '角色参考 (1)', 'Vibe Transfer (1)'];
  labels.forEach(label => expect(screen.getByText(label)).toBeTruthy());
  const sections = ['params', 'characters', 'characterReference', 'vibe'] as const;
  sections.forEach((section, index) => {
    view.rerender(<ParamsViewer params={params} section={section} />);
    labels.forEach((label, labelIndex) => expect(Boolean(screen.queryByText(label))).toBe(labelIndex === index));
  });
  expect(JSON.stringify(params)).toBe(original);
});

it('收藏角色 Tag 默认折叠，角色正负提示词分别复制，历史入口仍默认展开', async () => {
  const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [{ id: 'char', prompt: 'blue hair', negativePrompt: 'red hair', x: 0.5, y: 0.5 }] };
  const view = render(<ParamsViewer params={params} section="characters" />);
  const group = view.container.querySelector('details')!;
  expect(group.open).toBe(false);
  group.open = true;
  fireEvent.click(screen.getByRole('button', { name: '复制角色 1提示词' }));
  await waitFor(() => expect(copyTagText).toHaveBeenLastCalledWith('blue hair'));
  fireEvent.click(screen.getByRole('button', { name: '复制角色 1负面提示词' }));
  await waitFor(() => expect(copyTagText).toHaveBeenLastCalledWith('red hair'));
  view.rerender(<ParamsViewer params={params} />);
  expect(view.container.querySelector('details')!.open).toBe(true);
});
