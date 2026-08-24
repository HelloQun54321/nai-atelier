// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorParams } from './ChainEditorParams';

vi.mock('../services/naiRuntime', () => ({
  useNaiRuntime: () => ({}),
  getNaiRuntimeModelCapability: (_runtime: unknown, model: string) => ({
    qualityPresets: model.startsWith('nai-diffusion-5-')
      ? [{ id: 'standard', name: 'standard' }, { id: 'light', name: 'light' }]
      : [{ id: 'standard', name: 'standard' }],
    ucPresets: [{ id: 'heavy', name: 'heavy' }, { id: 'light', name: 'light' }, { id: 'none', name: 'none' }],
  }),
}));

vi.mock('../services/naiModels', () => ({
  DEFAULT_NAI_MODEL: 'nai-diffusion-4-5-full',
  getSelectableNaiModels: () => [
    { id: 'nai-diffusion-5-full', label: 'V5 Full' },
    { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  ],
  getRuntimeNaiModelInfo: (model: string) => ({
    label: model === 'nai-diffusion-5-full' ? 'V5 Full' : 'V4.5 Full',
    maxCharacters: 6,
    supportsTransparentBackground: model === 'nai-diffusion-5-full',
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
  it('未保存模型的旧数据按界面默认 V4.5 读取完整预设', () => {
    renderParams({ params: { ...params, model: undefined } });
    expect(screen.getByRole('combobox', { name: '正面质量预设' }).querySelectorAll('option')).toHaveLength(2);
    expect(Array.from(screen.getByRole('combobox', { name: '负面预设' }).querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'heavy', 'light']);
  });

  it('V4.5 质量预设显示 standard 和 none', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    const preset = screen.getByRole('combobox', { name: '正面质量预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'standard']);
    fireEvent.change(preset, { target: { value: 'none' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'none' }));
  });

  it('V5 质量预设显示 standard、light 和 none', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full' }, setParams });
    const preset = screen.getByRole('combobox', { name: '正面质量预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'standard', 'light']);
    fireEvent.change(preset, { target: { value: 'light' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'light' }));
  });

  it('旧版关闭状态在下拉框中保持 none', () => {
    renderParams({ params: { ...params, qualityPresetId: undefined, qualityToggle: false } });
    expect((screen.getByRole('combobox', { name: '正面质量预设' }) as HTMLSelectElement).value).toBe('none');
  });

  it('负面预设将 none 固定在首项并能切换其他模型预设', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    const preset = screen.getByRole('combobox', { name: '负面预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'heavy', 'light']);
    fireEvent.change(preset, { target: { value: 'heavy' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ ucPresetId: 'heavy' }));
  });

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
