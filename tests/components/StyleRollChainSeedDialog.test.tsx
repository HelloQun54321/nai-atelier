// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptChain } from '../../types';
import { StyleRollChainSeedDialog } from '../../components/roll/StyleRollChainSeedDialog';

vi.mock('../../components/SmartImage', async original => ({ ...await original<typeof import('../../components/SmartImage')>(), SmartImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }));
vi.mock('../../services/artistSamples', async original => ({ ...await original<typeof import('../../services/artistSamples')>(), getArtistSampleDictionary: async () => [] }));

const chain = (overrides: Partial<PromptChain> = {}): PromptChain => ({
  id: 'chain-1', userId: 'u', type: 'style', name: '合成画风', description: '测试描述', tags: [], modules: [], createdAt: 1, updatedAt: 1,
  basePrompt: 'masterpiece, 1.2::artist:alpha ::, 1girl, artist:beta, solo', negativePrompt: 'lowres',
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42, qualityToggle: false, ucPreset: 4 },
  previewImage: '/preview.png',
  variableValues: { subject: '' },
  ...overrides,
});

beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('选择风格串后预览画师并默认保留原权重新建', async () => {
  const createOptions = vi.fn(async () => {}), onClose = vi.fn();
  render(<StyleRollChainSeedDialog chains={[chain()]} createOptions={createOptions} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /合成画风/ }));
  expect(await screen.findByText('画师 2 位 · 首次保留原权重')).toBeTruthy();
  expect(screen.getByText('2 位画师')).toBeTruthy();
  expect(screen.getAllByRole('img', { name: '合成画风' }).length).toBeGreaterThan(0);
  expect(screen.getByText('masterpiece, {style}, 1girl, solo')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '新建 Roll 记录' }));
  await waitFor(() => expect(createOptions).toHaveBeenCalledWith(expect.objectContaining({ id: 'chain-1' }), { preserveWeights: true }));
  expect(onClose).toHaveBeenCalled();
});

it('没有画师 Tag 的风格串明确报错并禁用新建', async () => {
  const createOptions = vi.fn(async () => {});
  render(<StyleRollChainSeedDialog chains={[chain({ id: 'no-artist', name: '无画师串', basePrompt: '1girl, solo' })]} createOptions={createOptions} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /无画师串/ }));
  expect(await screen.findByText('该风格串没有可识别的画师 Tag；请使用 artist: 或 Artists: 前缀（大小写不限），或确认画师名已收录在词库')).toBeTruthy();
  expect(screen.getByRole('button', { name: '新建 Roll 记录' })).toHaveProperty('disabled', true);
});

it('可以关闭保留权重，新建时交给调用方立即重 roll', async () => {
  const createOptions = vi.fn(async () => {});
  render(<StyleRollChainSeedDialog chains={[chain()]} createOptions={createOptions} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /合成画风/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /保留风格串里的画师权重/ }));
  fireEvent.click(screen.getByRole('button', { name: '新建 Roll 记录' }));
  await waitFor(() => expect(createOptions).toHaveBeenCalledWith(expect.anything(), { preserveWeights: false }));
});

it('没有记录模型的旧风格串仍可新建，使用默认模型', async () => {
  const source = chain();
  delete (source.params as { model?: string }).model;
  const createOptions = vi.fn(async () => {});
  render(<StyleRollChainSeedDialog chains={[source]} createOptions={createOptions} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /合成画风/ }));
  expect(await screen.findByText('未记录模型，将使用默认模型')).toBeTruthy();
  expect(screen.getByRole('button', { name: '新建 Roll 记录' })).toHaveProperty('disabled', false);
});
