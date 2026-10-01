// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLabImageEditDraft } from '../services/labWorkspace';
import { DEFAULT_LAB_PAGE_LAYOUTS } from '../services/appearancePreferences';
import { createOutpaintCanvas } from '../services/imageEdit';
import { ImageEditPanel, ImageEditRequest } from './ImageEditPanel';
import type { ImageEditCanvasExpansion } from '../types';

vi.mock('../services/lowConsumption', () => ({ useLowConsumption: () => ({ enabled: false }) }));
vi.mock('../services/imageEdit', async importOriginal => ({
  ...await importOriginal<typeof import('../services/imageEdit')>(),
  dataUrlToBlob: async (data: string) => new Blob([data]),
  createOutpaintCanvas: vi.fn(async (_source: Blob, expansion: ImageEditCanvasExpansion) => {
    const width = 832 + expansion.left + expansion.right;
    const height = 1216 + expansion.top + expansion.bottom;
    const image = document.createElement('canvas'), mask = document.createElement('canvas');
    image.width = mask.width = width; image.height = mask.height = height;
    return { image, mask, width, height };
  }),
}));
vi.mock('./ImageEditControls', () => ({ ImageEditControls: (props: React.ComponentProps<typeof import('./ImageEditControls').ImageEditControls>) => <div>
  <canvas ref={props.canvasProps.imageCanvasRef} data-testid="image" />
  <canvas ref={props.canvasProps.maskCanvasRef} />
  <canvas ref={props.canvasProps.overlayCanvasRef} />
  <button onClick={props.onApplyOutpaint}>应用</button>
  <button onClick={() => props.onExpansionChange({ top: 0, bottom: 0, left: 192, right: 192 })}>正方形</button>
  <output data-testid="source">{props.outpaintSourceSize?.width}×{props.outpaintSourceSize?.height}</output>
</div> }));
vi.mock('./ImageEditPreview', () => ({ ImageEditPreview: (props: { canGenerate: boolean; onGenerate: () => void }) =>
  <button disabled={!props.canGenerate} onClick={props.onGenerate}>生成</button> }));

const expansion = { top: 128, bottom: 192, left: 0, right: 0 };
const params = { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };
const onCanvasChange = vi.fn(), onGenerate = vi.fn(async (_request: ImageEditRequest) => undefined);
const readBlobText = (blob: Blob) => new Promise<string>(resolve => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
});
const Harness = ({ restored = false }: { restored?: boolean }) => {
  const [draft, setDraft] = useState(() => createLabImageEditDraft('outpaint', 'night sky, water', '', params,
    { expansion, ...(restored ? { appliedExpansion: expansion } : {}) }));
  return <ImageEditPanel baseImage="original-image" previewImage={null} operation="outpaint" draft={draft} layout={DEFAULT_LAB_PAGE_LAYOUTS.outpaint}
    tagAssistEnabled={false} apiKey="" notify={vi.fn()} generationCostLabel={() => '点数'}
    onPromptChange={vi.fn()} onNegativePromptChange={vi.fn()} onPromptSource={vi.fn()}
    onDraftChange={patch => setDraft(previous => ({ ...previous, ...patch }))}
    onBaseImageChange={vi.fn()} onCanvasChange={onCanvasChange} onGenerate={onGenerate}
    onOpenLightbox={vi.fn()} getDownloadFilename={() => 'fixture.png'} />;
};

beforeEach(() => {
  vi.mocked(createOutpaintCanvas).mockClear(); onCanvasChange.mockClear(); onGenerate.mockClear();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 832, height: 1216, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), putImageData: vi.fn(),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) { return `data:image/png;base64,${this.width}x${this.height}`; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('扩图应用与提交', () => {
  it('重复应用不会叠加，改比例重新从原图生成，未应用时拦截生成', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('source').textContent).toBe('832×1216'));
    expect((screen.getByText('生成') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('应用')); fireEvent.click(screen.getByText('应用'));
    await waitFor(() => expect(onCanvasChange).toHaveBeenCalledTimes(1));
    expect(onCanvasChange.mock.calls[0][0]).toBe('original-image');
    expect(await readBlobText(vi.mocked(createOutpaintCanvas).mock.calls[0][0])).toBe('original-image');
    expect(screen.getByTestId('image')).toHaveProperty('height', 1536);
    fireEvent.click(screen.getByText('应用'));
    expect(createOutpaintCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('生成'));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ canvasWidth: 832, canvasHeight: 1536, expansion });
    fireEvent.click(screen.getByText('正方形'));
    expect((screen.getByText('生成') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('应用'));
    await waitFor(() => expect(screen.getByTestId('image')).toHaveProperty('width', 1216));
    expect(screen.getByTestId('image')).toHaveProperty('height', 1216);
    expect(await readBlobText(vi.mocked(createOutpaintCanvas).mock.calls[1][0])).toBe('original-image');
  });

  it('重新进入时从原图恢复已应用画布，源图尺寸与请求画布分别保留', async () => {
    render(<Harness restored />);
    await waitFor(() => expect(screen.getByTestId('image')).toHaveProperty('height', 1536));
    expect(screen.getByTestId('source').textContent).toBe('832×1216');
    expect(vi.mocked(createOutpaintCanvas).mock.calls[0][1]).toEqual(expansion);
    await waitFor(() => expect((screen.getByText('生成') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('生成'));
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ canvasWidth: 832, canvasHeight: 1536, expansion });
  });
});
