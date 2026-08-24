// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorParams } from './ChainEditorParams';

vi.mock('../services/naiRuntime', () => ({
  useNaiRuntime: () => ({}),
  getNaiRuntimeModelCapability: () => ({
    qualityPresets: [{ id: 'standard', name: '标准' }],
    ucPresets: [{ id: 'none', name: '关闭' }],
  }),
}));

vi.mock('../services/naiModels', () => ({
  getSelectableNaiModels: () => [{ id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' }],
  getRuntimeNaiModelInfo: () => ({
    label: 'V4.5 Full',
    maxCharacters: 6,
    supportsTransparentBackground: false,
    supportsVibes: true,
    supportsCharacterReferences: true,
    supportsCharacterReferenceInpainting: true,
  }),
}));

const params = {
  width: 1216,
  height: 832,
  steps: 28,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  model: 'nai-diffusion-4-5-full',
  qualityPresetId: 'standard',
  ucPresetId: 'none',
};

const renderParams = (props: Record<string, unknown> = {}) => render(React.createElement(ChainEditorParams, {
  params,
  setParams: vi.fn(),
  canEdit: true,
  markChange: vi.fn(),
  ...props,
}));

afterEach(() => cleanup());

describe('ChainEditorParams', () => {
  it('文生图保留可调图片尺寸', () => {
    renderParams();
    expect(screen.getByText('图片尺寸')).toBeTruthy();
    expect(screen.getByRole('option', { name: '横屏 (1216x832)' })).toBeTruthy();
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 不显示不可调节的图片尺寸', mode => {
    renderParams({ hideResolution: true, mode });
    expect(screen.queryByText('图片尺寸')).toBeNull();
    expect(screen.queryByText(/当前画布|等待底图/)).toBeNull();
  });
});
