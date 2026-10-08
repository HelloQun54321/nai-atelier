// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { operateAgentPage, readAgentPage } from '../../services/agentWorkspace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorParams } from '../../components/ChainEditorParams';
import type { NAIParams } from '../../types';

vi.mock('../../services/naiRuntime', () => ({
  useNaiRuntime: () => ({ freeMaxArea: 1048576, freeMaxSteps: 28 }),
  getNaiRuntimeModelCapability: (_runtime: unknown, model: string) => ({
    qualityPresets: model.startsWith('nai-diffusion-5-')
      ? [{ id: 'standard', name: 'standard' }, { id: 'light', name: 'light' }]
      : [{ id: 'standard', name: 'standard' }],
    ucPresets: [{ id: 'heavy', name: 'heavy' }, { id: 'light', name: 'light' }, { id: 'none', name: 'none' }],
  }),
}));

vi.mock('../../services/naiModels', () => ({
  DEFAULT_NAI_MODEL: 'nai-diffusion-4-5-full',
  getDefaultStepsForModel: (model: string) => (model?.startsWith('nai-diffusion-5-') ? 23 : 28),
  getModelFollowDefaultSteps: (model: string, steps: number | undefined) => {
    if (steps === undefined || steps === 23 || steps === 28) return model?.startsWith('nai-diffusion-5-') ? 23 : 28;
    return steps;
  },
  getSelectableNaiModels: () => [
    { id: 'nai-diffusion-5-full', label: 'V5 Full' },
    { id: 'nai-diffusion-5-curated', label: 'V5 Curated' },
    { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  ],
  getRuntimeNaiModelInfo: (model: string) => ({
    label: model === 'nai-diffusion-5-full' ? 'V5 Full' : 'V4.5 Full',
    maxCharacters: 6,
    supportsTransparentBackground: model.startsWith('nai-diffusion-5-'),
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

afterEach(() => { cleanup(); });

describe('ChainEditorParams', () => {
  it('重要提示可点按读取，保留完整预设来源、原种子及收费含义，不改写参数', () => {
    const changed = vi.fn();
    const name = '很长的预设名称'.repeat(10);
    renderParams({ params: { ...params, seed: 987654321 }, presetSource: { name, modified: true }, forceEmptySeed: true, enforceFreeStepLimit: false, setParams: changed });
    for (const [label, text] of [['预设来源详情', name], ['强制随机说明', '987654321'], ['步数上限说明', '将消耗 Anlas']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('dialog', { name: label }).textContent).toContain(text);
      fireEvent.click(screen.getByRole('button', { name: '关闭说明' }));
    }
    expect(changed).not.toHaveBeenCalled(); expect((screen.getByPlaceholderText('已强制置空 (随机)') as HTMLInputElement).value).toBe('');
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('Agent 在 %s 填透明权重，数值失焦后真实参数与滑条同时生效', async mode => {
    let actual: NAIParams;
    const Harness = () => {
      const [value, setValue] = React.useState<NAIParams>({ ...params, model: 'nai-diffusion-5-full', transparent: true, transparentWeight: 1 }); actual = value;
      return React.createElement('main', { 'data-agent-view': 'playground' }, React.createElement(ChainEditorParams, { params: value, setParams: setValue, canEdit: true, markChange: vi.fn(), mode }));
    };
    render(React.createElement(Harness)); const page = readAgentPage({ query: '透明权重数值' }); let operation!: ReturnType<typeof operateAgentPage>;
    act(() => { operation = operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: '1.5' }); }); await operation;
    expect(actual!.transparentWeight).toBe(1.5); expect((screen.getByRole('slider', { name: '透明权重' }) as HTMLInputElement).value).toBe('1.5');
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 的 V5 权重滑条与数值输入修改同一参数，开关保留权重', mode => {
    const changed = vi.fn();
    const Harness = () => {
      const [value, setValue] = React.useState<NAIParams>({ ...params, model: 'nai-diffusion-5-full', transparent: true, transparentWeight: 1 });
      return React.createElement(ChainEditorParams, { params: value, setParams: setValue, canEdit: true, markChange: changed, mode });
    };
    render(React.createElement(Harness));
    const slider = () => screen.getByRole('slider', { name: '透明权重' }) as HTMLInputElement;
    expect([slider().min, slider().max, slider().step, slider().value]).toEqual(['0.1', '3', '0.1', '1']);
    fireEvent.change(slider(), { target: { value: '2.1' } });
    expect((screen.getByRole('spinbutton', { name: '透明权重数值' }) as HTMLInputElement).value).toBe('2.1');
    fireEvent.change(screen.getByRole('spinbutton', { name: '透明权重数值' }), { target: { value: '8' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: '透明权重数值' }));
    expect(slider().value).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: '透明背景' }));
    expect(screen.queryByRole('slider', { name: '透明权重' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '透明背景' }));
    expect(slider().value).toBe('3');
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('精确输入保留临时 0 与空值，离开输入框再校验，可正常输入小于 1 的权重', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full', transparent: true, transparentWeight: 2.1 }, setParams });
    const input = screen.getByRole('spinbutton', { name: '透明权重数值' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0');
    expect(setParams).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);
    expect(setParams).toHaveBeenLastCalledWith(expect.objectContaining({ transparentWeight: 0.5 }));
    setParams.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('2.1');
    expect(setParams).not.toHaveBeenCalled();
  });

  it.each(['nai-diffusion-5-full', 'nai-diffusion-5-curated'])('%s 恢复旧提示词权重，只读禁用输入，旧模型隐藏透明控件', model => {
    const setParams = vi.fn();
    const { rerender } = renderParams({ params: { ...params, model, transparent: true }, prompt: '1girl, 2.1::transparent background::', canEdit: false, setParams });
    const slider = screen.getByRole('slider', { name: '透明权重' }) as HTMLInputElement;
    expect(slider.value).toBe('2.1');
    expect(slider.disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: '透明权重数值' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(slider, { target: { value: '1.4' } });
    expect(setParams).not.toHaveBeenCalled();
    rerender(React.createElement(ChainEditorParams, { params: { ...params, transparent: true, transparentWeight: 2.1 }, setParams, canEdit: true, markChange: vi.fn() }));
    expect(screen.queryByRole('button', { name: '透明背景' })).toBeNull();
    expect(screen.queryByRole('slider', { name: '透明权重' })).toBeNull();
  });

  it('修改画幅和模型保留透明权重，旧模型仅关闭透明开关', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full', transparent: true, transparentWeight: 2.1 }, setParams });
    fireEvent.change(screen.getByRole('combobox', { name: '图片画幅比例' }), { target: { value: '16:9' } });
    expect(setParams).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1344, height: 768, transparent: true, transparentWeight: 2.1 }));
    fireEvent.change(screen.getByRole('combobox', { name: '生成模型' }), { target: { value: 'nai-diffusion-4-5-full' } });
    expect(setParams).toHaveBeenLastCalledWith(expect.objectContaining({ transparent: false, transparentWeight: 2.1 }));
  });
  it('角色上限只计启用且有正向词的角色，切换旧模型可停用多余项', () => {
    const characters = Array.from({ length: 7 }, (_, index) => ({ id: String(index), prompt: 'girl', x: 0.5, y: 0.5 }));
    const { rerender } = renderParams({ params: { ...params, characters } });
    expect(screen.getByText(/当前启用了 7 个/)).toBeTruthy();
    rerender(React.createElement(ChainEditorParams, { params: { ...params, characters: characters.map((character, index) => index === 6 ? { ...character, enabled: false } : character) }, setParams: vi.fn(), canEdit: true, markChange: vi.fn() }));
    expect(screen.queryByText(/当前启用了/)).toBeNull();
    rerender(React.createElement(ChainEditorParams, { params: { ...params, characters: characters.map((character, index) => index === 6 ? { ...character, prompt: '  ' } : character) }, setParams: vi.fn(), canEdit: true, markChange: vi.fn() }));
    expect(screen.queryByText(/当前启用了/)).toBeNull();
  });

  it('未保存模型的旧数据按界面默认 V4.5 读取完整预设', () => {
    renderParams({ params: { ...params, model: undefined } });
    expect(screen.getByRole('combobox', { name: '质量预设' }).querySelectorAll('option')).toHaveLength(2);
    expect(Array.from(screen.getByRole('combobox', { name: '负面预设' }).querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'heavy', 'light']);
  });

  it('V4.5 质量预设显示 standard 和 none', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    const preset = screen.getByRole('combobox', { name: '质量预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'standard']);
    fireEvent.change(preset, { target: { value: 'none' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'none' }));
  });

  it('V5 质量预设显示 standard、light 和 none', () => {
    const setParams = vi.fn();
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full' }, setParams });
    const preset = screen.getByRole('combobox', { name: '质量预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'standard', 'light']);
    fireEvent.change(preset, { target: { value: 'light' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ qualityPresetId: 'light' }));
  });

  it('旧版关闭状态在下拉框中保持 none', () => {
    renderParams({ params: { ...params, qualityPresetId: undefined, qualityToggle: false } });
    expect((screen.getByRole('combobox', { name: '质量预设' }) as HTMLSelectElement).value).toBe('none');
  });

  it('负面预设将 none 固定在首项并能切换其他模型预设', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    const preset = screen.getByRole('combobox', { name: '负面预设' });
    expect(Array.from(preset.querySelectorAll('option')).map(option => option.value)).toEqual(['none', 'heavy', 'light']);
    fireEvent.change(preset, { target: { value: 'heavy' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ ucPresetId: 'heavy' }));
  });

  it('Variety+ 归入引导控制并使用可切换的开关', () => {
    const setParams = vi.fn();
    const markChange = vi.fn();
    renderParams({ setParams, markChange });

    expect(screen.getByText('引导控制')).toBeTruthy();
    const varietySwitch = screen.getByRole('switch', { name: 'Variety+（多样性）' });
    expect(varietySwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(varietySwitch);

    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ variety: true }));
    expect(markChange).toHaveBeenCalledOnce();
  });

  it('Variety+ 与各滑块控件统一使用主题强调色', () => {
    renderParams({ params: { ...params, variety: true } });

    const varietySwitch = screen.getByRole('switch', { name: 'Variety+（多样性）' });
    expect(varietySwitch.className).toContain('hover:border-indigo-300');
    expect(varietySwitch.querySelector('.bg-indigo-500')).toBeTruthy();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(3); // Resolution Scale, CFG Scale, CFG Rescale
    expect(sliders.every(slider => slider.className.includes('accent-indigo-600'))).toBe(true);
  });

  it('文生图保留可调图片画幅比例与常见比例预设', () => {
    const setParams = vi.fn();
    renderParams({ setParams });
    expect(screen.getByText('图片画幅比例')).toBeTruthy();
    expect(screen.getByRole('option', { name: /3:2 经典横屏/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /9:16 手机壁纸/ })).toBeTruthy();

    const select = screen.getByRole('combobox', { name: '图片画幅比例' });
    fireEvent.change(select, { target: { value: '16:9' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ width: 1344, height: 768 }));
  });

  it('清晰显示当前像素是否在 Opus 免费范围内', () => {
    renderParams({ params: { ...params, width: 832, height: 1216 } });
    expect(screen.getByRole('status').textContent).toContain('1,011,712 像素');
    expect(screen.getByRole('status').textContent).toContain('在 Opus 免费像素范围内');
  });

  it('CFG Scale 和 CFG Rescale 支持直接输入精确数值', () => {
    const setParams = vi.fn();
    renderParams({ setParams });

    const cfgScaleInput = screen.getByRole('spinbutton', { name: 'CFG Scale 数值' });
    fireEvent.change(cfgScaleInput, { target: { value: '4.75' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ scale: 4.75 }));

    const cfgRescaleInput = screen.getByRole('spinbutton', { name: 'CFG Rescale 数值' });
    fireEvent.change(cfgRescaleInput, { target: { value: '0.38' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ cfgRescale: 0.38 }));
  });

  it('尺寸比例清晰度（Scale）滑块可将画幅尺寸等比高清放大并封顶在官方上限', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, width: 832, height: 1216 } });
    const scaleSlider = screen.getByRole('slider', { name: '尺寸缩放滑块' });
    expect(Number(scaleSlider.getAttribute('min'))).toBe(1);
    expect(Number(scaleSlider.getAttribute('max'))).toBe(1.69);
    fireEvent.change(scaleSlider, { target: { value: '1.5' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 1856 }));
  });

  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('%s 不显示不可调节的图片尺寸', mode => {
    renderParams({ hideResolution: true, mode });
    expect(screen.queryByText('图片画幅比例')).toBeNull();
    expect(screen.queryByText(/当前画布|等待底图/)).toBeNull();
  });

  it('切换到 V5 系列模型时自动将默认步数调整为 23', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, model: 'nai-diffusion-4-5-full', steps: 28 } });
    const modelSelect = screen.getByRole('combobox', { name: '生成模型' });
    fireEvent.change(modelSelect, { target: { value: 'nai-diffusion-5-full' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nai-diffusion-5-full',
      steps: 23,
    }));
  });

  it('切换模型时保留用户自定义的非默认步数', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, model: 'nai-diffusion-4-5-full', steps: 16 } });
    const modelSelect = screen.getByRole('combobox', { name: '生成模型' });
    fireEvent.change(modelSelect, { target: { value: 'nai-diffusion-5-full' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nai-diffusion-5-full',
      steps: 16,
    }));
  });
  it('已处于 V5 模型时重新选择 V5（含过期 28 步会话）也会纠正为 23', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, model: 'nai-diffusion-5-full', steps: 28 } });
    const modelSelect = screen.getByRole('combobox', { name: '生成模型' });
    fireEvent.change(modelSelect, { target: { value: 'nai-diffusion-5-curated' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nai-diffusion-5-curated',
      steps: 23,
    }));
  });

  it('从 V5 切回 V4.5 时把默认 23 步恢复为 28 步', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, model: 'nai-diffusion-5-full', steps: 23 } });
    const modelSelect = screen.getByRole('combobox', { name: '生成模型' });
    fireEvent.change(modelSelect, { target: { value: 'nai-diffusion-4-5-full' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nai-diffusion-4-5-full',
      steps: 28,
    }));
  });

  it('从 V5 切回 V4.5 时保留自定义非默认步数', () => {
    const setParams = vi.fn();
    renderParams({ setParams, params: { ...params, model: 'nai-diffusion-5-full', steps: 16 } });
    const modelSelect = screen.getByRole('combobox', { name: '生成模型' });
    fireEvent.change(modelSelect, { target: { value: 'nai-diffusion-4-5-full' } });
    expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nai-diffusion-4-5-full',
      steps: 16,
    }));
  });

  it('开启 forceEmptySeed 时随机种子输入框显示为空，关闭时显示原种子数值', () => {
    const { rerender } = renderParams({ params: { ...params, seed: 987654321 }, forceEmptySeed: true });
    const seedInput = screen.getByPlaceholderText('已强制置空 (随机)') as HTMLInputElement;
    expect(seedInput.value).toBe('');

    rerender(React.createElement(ChainEditorParams, {
      params: { ...params, seed: 987654321 },
      setParams: vi.fn(),
      canEdit: true,
      markChange: vi.fn(),
      forceEmptySeed: false,
    }));
    const restoredInput = screen.getByPlaceholderText('随机') as HTMLInputElement;
    expect(restoredInput.value).toBe('987654321');
  });

  it('当 params 为空对象或缺少宽高时优雅渲染且不崩溃', () => {
    renderParams({ params: {} as any });
    expect(screen.getByRole('combobox', { name: '图片画幅比例' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: '采样器' })).toBeDefined();
  });
});
