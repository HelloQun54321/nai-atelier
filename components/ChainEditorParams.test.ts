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
    expect(screen.getByRole('switch', { name: '正面质量预设' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('combobox', { name: '正面质量预设类型' })).toBeNull();
    expect(screen.getByRole('combobox', { name: '负面预设' }).querySelectorAll('option')).toHaveLength(3);
  });

  it('V4.5 用开关控制唯一质量预设，不显示单选项下拉框', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    const toggle = screen.getByRole('switch', { name: '正面质量预设' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('combobox', { name: '正面质量预设类型' })).toBeNull();
    fireEvent.click(toggle);
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'none' }));
  });

  it('V5 开启质量标签后可以选择 standard 或 light', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full' }, setParams });
    const preset = screen.getByRole('combobox', { name: '正面质量预设类型' });
    expect(preset.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(preset, { target: { value: 'light' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'light' }));
  });

  it('关闭质量标签后仍可通过开关重新启用', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, qualityPresetId: 'none' }, setParams });
    const toggle = screen.getByRole('switch', { name: '正面质量预设' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'standard' }));
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
