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

vi.mock('../../services/naiModels', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/naiModels')>(),
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
  it('已知 Curated 被配置模型过滤时仍显示真实名称并保留原模型', () => {
    const setParams = vi.fn(), curated = { ...params, model: 'nai-diffusion-5-curated' };
    renderParams({ params: curated, setParams, modelFilter: (id: string) => id === 'nai-diffusion-5-full' });
    expect((screen.getByRole('combobox', { name: '生成模型' }) as HTMLSelectElement).value).toBe('nai-diffusion-5-curated');
    expect(screen.getByRole('option', { name: '当前模型不可用于此配置（V5 Curated）' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /未知模型/ })).toBeNull(); expect(setParams).not.toHaveBeenCalled(); expect(curated.model).toBe('nai-diffusion-5-curated');
  });
  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 的 Medium 锁定灰白控件，切回 High 恢复草稿', mode => {
    let draft!: NAIParams;
    const Harness = () => {
      const [value, setValue] = React.useState<NAIParams>({ ...params, model: 'nai-diffusion-5-full', steps: 35, sampler: 'k_euler', cfgRescale: 0.6, ucPresetId: 'light' });
      draft = value;
      return React.createElement(ChainEditorParams, { params: value, setParams: setValue, canEdit: true, markChange: vi.fn(), enforceFreeStepLimit: false, mode });
    };
    render(React.createElement(Harness));
    fireEvent.change(screen.getByRole('combobox', { name: '生成档位' }), { target: { value: 'medium' } });
    expect(draft.model).toBe('nai-diffusion-5-full-medium');
    const checks = [
      [screen.getByRole('spinbutton', { name: '生成步数' }), '14'],
      [screen.getByRole('combobox', { name: '采样器' }), 'k_euler_ancestral'],
      [screen.getByRole('combobox', { name: '负面预设' }), 'heavy'],
      [screen.getByRole('spinbutton', { name: 'CFG Rescale 数值' }), '0'],
      [screen.getByRole('slider', { name: 'CFG Rescale' }), '0'],
    ] as const;
    for (const [node, value] of checks) {
      expect((node as HTMLInputElement).disabled).toBe(true);
      expect((node as HTMLInputElement).value).toBe(value);
      expect(node.closest('.nai-model-locked')).not.toBeNull();
    }
    expect((screen.getByRole('slider', { name: 'CFG Scale' }) as HTMLInputElement).disabled).toBe(false);
    expect(draft).toMatchObject({ steps: 35, sampler: 'k_euler', cfgRescale: 0.6, ucPresetId: 'light' });
    fireEvent.change(screen.getByRole('combobox', { name: '生成档位' }), { target: { value: 'high' } });
    for (const [node] of checks) expect((node as HTMLInputElement).disabled).toBe(false);
    expect((checks[0][0] as HTMLInputElement).value).toBe('35');
    expect((checks[1][0] as HTMLInputElement).value).toBe('k_euler');
    expect((checks[2][0] as HTMLInputElement).value).toBe('light');
    expect((checks[3][0] as HTMLInputElement).value).toBe('0.6');
    expect(draft.model).toBe('nai-diffusion-5-full');
  });

  it('导入 Medium 显示 V5 Full 与正确档位，只读时禁用档位切换', () => {
    renderParams({ params: { ...params, model: 'nai-diffusion-5-full-medium' }, canEdit: false });
    expect((screen.getByRole('combobox', { name: '生成模型' }) as HTMLSelectElement).value).toBe('nai-diffusion-5-full');
    const effort = screen.getByRole('combobox', { name: '生成档位' }) as HTMLSelectElement;
    expect(effort.value).toBe('medium');
    expect(effort.disabled).toBe(true);
  });

  it('重要提示可点按读取，保留完整预设来源及收费含义，不改写参数', () => {
    const changed = vi.fn();
    const name = '很长的预设名称'.repeat(10);
    renderParams({ params: { ...params, seed: 987654321 }, presetSource: { name, modified: true }, forceEmptySeed: true, enforceFreeStepLimit: false, setParams: changed });
    for (const [label, text] of [['预设来源详情', name], ['步数上限说明', '将消耗 Anlas']] as const) {
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

  it.each([
    { width: 832, height: 1216, message: '832 × 1,216 · 免费像素范围内', color: 'emerald' },
    { width: 1408, height: 2048, message: '1,408 × 2,048 · 超出免费像素范围', color: 'amber' },
  ])('始终在 Scale 标题旁简写 $width × $height 及免费边界状态', ({ width, height, message, color }) => {
    renderParams({ params: { ...params, width, height } });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(message);
    expect(status.classList.contains(`bg-${color}-50`)).toBe(true);
    expect(status.classList.contains(`dark:text-${color}-300`)).toBe(true);
    const title = screen.getByText('尺寸清晰度放大（Scale）');
    const header = title.parentElement;
    expect(status.parentElement).toBe(header);
    expect(title.nextElementSibling).toBe(status);
    expect(header?.classList.contains('grid-cols-[auto_minmax(0,1fr)_auto]')).toBe(true);
    expect(status.className).not.toMatch(/(?:^|\s)(?:\S+:)?(?:row-start-|col-span-)/);
    expect(header?.contains(screen.getByRole('spinbutton', { name: '尺寸清晰度倍率数值' }))).toBe(true);
    expect(status.compareDocumentPosition(screen.getByRole('slider', { name: '尺寸缩放滑块' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.queryByRole('status')).toBeNull();
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

  it.each(['text-to-image', 'image-to-image', 'inpaint', 'outpaint'] as const)('%s 强制置空开关 ON 留空禁用，OFF 恢复种子并可编辑，切换不改写草稿', mode => {
    const changed = vi.fn(), markChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = React.useState<NAIParams>({ ...params, seed: 987654321 });
      const [forceEmptySeed, setForceEmptySeed] = React.useState(true);
      return React.createElement(ChainEditorParams, { params: value, setParams: next => { changed(next); setValue(next); }, canEdit: true,
        markChange, mode, forceEmptySeed, onForceEmptySeedChange: setForceEmptySeed });
    };
    render(React.createElement(Harness));
    const toggle = screen.getByRole('switch', { name: '强制置空' });
    const input = screen.getByRole('spinbutton', { name: '种子' }) as HTMLInputElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toContain('ON');
    expect(input.value).toBe(''); expect(input.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toContain('OFF');
    expect(input.value).toBe('987654321'); expect(input.disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled(); expect(markChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '123' } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ seed: 123 }));
    fireEvent.click(toggle); expect(input.value).toBe('');
    fireEvent.click(toggle); expect(input.value).toBe('123');
    fireEvent.change(input, { target: { value: '' } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ seed: undefined }));
    expect(markChange).toHaveBeenCalledTimes(2);
  });

  it('只读时强制置空开关和种子输入均不可修改', () => {
    const onForceEmptySeedChange = vi.fn();
    renderParams({ canEdit: false, onForceEmptySeedChange });
    const toggle = screen.getByRole('switch', { name: '强制置空' }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect((screen.getByRole('spinbutton', { name: '种子' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(toggle); expect(onForceEmptySeedChange).not.toHaveBeenCalled();
  });

  it('当 params 为空对象或缺少宽高时优雅渲染且不崩溃', () => {
    renderParams({ params: {} as any });
    expect(screen.getByRole('combobox', { name: '图片画幅比例' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: '采样器' })).toBeDefined();
  });
});
