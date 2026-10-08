// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageEditPanel, ImageEditRequest } from '../../components/ImageEditPanel';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../../services/appearancePreferences';
import { createLabImageEditDraft } from '../../services/labWorkspace';
import { DEFAULT_NAI_RUNTIME } from '../../services/naiRuntime';
import type { LabImageEditDraft, NAIParams, PromptAgentDraft } from '../../types';

const state = vi.hoisted(() => ({ freeMaxArea: 1048576, width: 1664, height: 2432 }));
vi.mock('../../services/naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/naiRuntime')>();
  return { ...actual, useNaiRuntime: () => ({ ...actual.DEFAULT_NAI_RUNTIME, freeMaxArea: state.freeMaxArea }) };
});
vi.mock('../../services/imageEdit', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/imageEdit')>(), dataUrlToBlob: async (data: string) => new Blob([data]),
}));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: () => null }));
vi.mock('../../components/VibeManager', () => ({ VibeManager: () => null }));
vi.mock('../../components/CharacterReferenceManager', () => ({ CharacterReferenceManager: () => null }));
vi.mock('../../components/chain/ChainEditorCharacters', () => ({ ChainEditorCharacters: () => null }));
vi.mock('../../components/SmartImage', () => ({ OriginalImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));
vi.mock('../../components/ImageEditPreview', () => ({ ImageEditPreview: (props: { canGenerate: boolean; unavailableLabel?: string; generationCostLabel: string; onGenerate: () => void }) => <>
  <output data-testid="desktop-status">{props.unavailableLabel || '生成'}</output>
  <output data-testid="desktop-cost">{props.generationCostLabel}</output>
  <button disabled={!props.canGenerate} onClick={props.onGenerate}>生成测试图片</button>
</> }));

const params = { model: 'nai-diffusion-5-full', width: 1024, height: 1024, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
  seed: 123, useCoords: true, characters: [{ id: 'c1', prompt: 'girl', negativePrompt: 'bad hands', x: 0.2, y: 0.8 }] };
const onGenerate = vi.fn(async (_request: ImageEditRequest, _options?: { params: NAIParams; onApproved?: () => Promise<void>; agent: true }) => true);
const onCanvasChange = vi.fn();
const onAgentGenerateReady = vi.fn();
const drawImage = vi.fn();
const Harness = ({ patch = {} }: { patch?: Partial<LabImageEditDraft> }) => {
  const [draft, setDraft] = useState(() => createLabImageEditDraft('image-to-image', 'scene', 'negative', params, patch));
  const [bar, setBar] = useState({ costLabel: '', unavailableLabel: '' });
  return <><output data-testid="mobile-cost">{bar.costLabel}</output><output data-testid="mobile-status">{bar.unavailableLabel || '生成'}</output>
    <ImageEditPanel baseImage="original-image" previewImage={null} operation="image-to-image" draft={draft}
      layout={DEFAULT_LAB_PAGE_LAYOUTS['image-to-image']} tagAssistEnabled={false} apiKey="" notify={vi.fn()}
      generationCostLabel={(_operation, _focused, context) => `${context?.width}×${context?.height}`}
      onPromptChange={vi.fn()} onNegativePromptChange={vi.fn()} onPromptSource={vi.fn()}
      onDraftChange={value => setDraft(previous => ({ ...previous, ...value }))}
      onBaseImageChange={vi.fn()} onCanvasChange={onCanvasChange} onGenerate={onGenerate} onAgentGenerateReady={onAgentGenerateReady}
      onGenerateBarChange={value => setBar(previous => previous.costLabel === value.costLabel && previous.unavailableLabel === (value.unavailableLabel || '')
        ? previous : { costLabel: value.costLabel, unavailableLabel: value.unavailableLabel || '' })}
      onOpenLightbox={vi.fn()} getDownloadFilename={() => 'fixture.png'} />
  </>;
};
const choose = (mode: string) => fireEvent.change(screen.getByRole('combobox', { name: '图生图输出尺寸' }), { target: { value: mode } });
const ready = () => waitFor(() => {
  expect(screen.getByTestId('desktop-status').textContent).toBe('生成');
  expect(screen.getByTestId('mobile-status').textContent).toBe('生成');
  expect(screen.getByTestId('mobile-cost').textContent).toBe(screen.getByTestId('desktop-cost').textContent);
});
const expectSize = (size: string) => {
  expect(screen.getByTestId('desktop-cost').textContent).toBe(size);
  expect(screen.getByTestId('mobile-cost').textContent).toBe(size);
};

beforeEach(() => {
  state.freeMaxArea = DEFAULT_NAI_RUNTIME.freeMaxArea; state.width = 1664; state.height = 2432;
  onGenerate.mockClear(); onCanvasChange.mockClear(); onAgentGenerateReady.mockClear(); drawImage.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: state.width, height: state.height, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage, clearRect: vi.fn(), fillRect: vi.fn() }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) { return `data:image/png;base64,${this.width}x${this.height}`; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('图生图输出尺寸与提交副本', () => {
  it('原尺寸默认不变，选择免费范围后两端提示和真实请求缩小，原图及草稿不改', async () => {
    const view = render(<Harness />); await ready();
    expect(screen.getByRole('combobox', { name: '图生图输出尺寸' })).toHaveProperty('value', 'original');
    expectSize('1664×2432');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成测试图片' })));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ image: 'data:image/png;base64,1664x2432', canvasWidth: 1664, canvasHeight: 2432 });
    choose('free'); expectSize('832×1216');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成测试图片' })));
    expect(onGenerate.mock.calls[1][0]).toMatchObject({ image: 'data:image/png;base64,832x1216', canvasWidth: 832, canvasHeight: 1216,
      params: { width: 832, height: 1216, seed: 123, characters: [{ id: 'c1', prompt: 'girl', negativePrompt: 'bad hands' }] }, strength: 0.7, noise: 0, prompt: 'scene', negativePrompt: 'negative' });
    expect(onGenerate.mock.calls[1][0].params?.characters?.[0].x).toBeCloseTo(0.2);
    expect(onGenerate.mock.calls[1][0].params?.characters?.[0].y).toBeCloseTo(0.8);
    expect(view.container.querySelector('canvas')).toHaveProperty('width', 1664);
    expect(view.container.querySelector('canvas')).toHaveProperty('height', 2432);
    expect(onCanvasChange).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    choose('original'); expectSize('1664×2432');
  });

  it('官方免费面积变化即时生效，超接口上限的底图也能通过输出副本生成', async () => {
    state.width = 6000; state.height = 6000;
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('desktop-status').textContent).toBe('请先处理底图尺寸'));
    choose('free'); await ready(); expectSize('1024×1024');
    state.freeMaxArea = 262144; view.rerender(<Harness />); expectSize('512×512');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成测试图片' })));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ image: 'data:image/png;base64,512x512', canvasWidth: 512, canvasHeight: 512 });
    expect(view.container.querySelector('canvas')).toHaveProperty('width', 6000);
    expect(onCanvasChange).not.toHaveBeenCalled();
  });

  it('自定义不同宽高比完整适配并映射角色坐标，草稿坐标与参数保留', async () => {
    const view = render(<Harness />); await ready(); choose('custom'); expectSize('1024×1024');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '生成测试图片' })));
    const request = onGenerate.mock.calls[0][0];
    expect(request.image).toBe('data:image/png;base64,1024x1024');
    expect(request.params?.characters?.[0].x).toBeCloseTo(0.5 + (0.2 - 0.5) * 1664 / 2432);
    expect(request.params?.characters?.[0].y).toBeCloseTo(0.8);
    const placement = drawImage.mock.calls.at(-1)!;
    expect(placement[1]).toBeCloseTo((1024 - 1664 * 1024 / 2432) / 2);
    expect(placement[2]).toBe(0);
    expect(placement[3]).toBeCloseTo(1664 * 1024 / 2432);
    expect(placement[4]).toBe(1024);
    expect(params.characters[0].x).toBe(0.2);
    expect(view.container.querySelector('canvas')).toHaveProperty('width', 1664);
    expect(onCanvasChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: '图生图输出宽度' }), { target: { value: '833' } });
    expect(screen.getByTestId('desktop-status').textContent).toBe('请调整输出尺寸');
    expect(screen.getByTestId('mobile-status').textContent).toBe('请调整输出尺寸');
    expect(screen.getByRole('button', { name: '生成测试图片' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/宽高必须是 64/)).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: '图生图输出宽度' }), { target: { value: '768' } });
    await ready(); expectSize('768×1024');
  });

  it('Agent 覆盖参数仍遵循当前尺寸模式，角色转换与手动生成一致', async () => {
    render(<Harness patch={{ imageToImageSizeMode: 'custom' }} />); await ready();
    const generate = onAgentGenerateReady.mock.calls.at(-1)![0];
    const agentDraft = { basePrompt: 'agent scene', subjectPrompt: '', modules: [], negativePrompt: 'agent negative', params } as PromptAgentDraft;
    await act(async () => { expect(await generate(agentDraft)).toBe(true); });
    const [request, options] = onGenerate.mock.calls[0];
    expect(request).toMatchObject({ image: 'data:image/png;base64,1024x1024', prompt: 'agent scene', negativePrompt: 'agent negative' });
    expect(options?.params).toEqual(request.params);
    expect(options?.params.characters?.[0].x).toBeCloseTo(0.5 + (0.2 - 0.5) * 1664 / 2432);
  });
});
