// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterParams, ImageEditOperation, NAIParams } from '../types';
import { api } from './api';
import { getCurrentCloudQueueStatus, emitCloudQueueStatus } from './cloudQueue';
import { generateImage, generateImageEdit, generateImageStream, generateImageEditStream } from './naiService';
import { prepareImageEdit, PreparedImageEdit } from './imageEdit';

vi.mock('./anlasBudget', () => ({ hashNaiApiKey: vi.fn(async () => 'test-key-hash') }));
vi.mock('./api', () => ({
  api: { postBinary: vi.fn(), postBinaryDetailed: vi.fn(), postSse: vi.fn() },
  isQueueCancelledError: () => false,
}));
vi.mock('./naiRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('./naiRuntime')>();
  return { ...actual, getNaiRuntimeConfig: vi.fn(async () => actual.DEFAULT_NAI_RUNTIME) };
});
vi.mock('jszip', () => ({ default: { loadAsync: vi.fn(async () => ({ files: {
  'image.png': { dir: false, async: async () => new Uint8Array([1, 2, 3]) },
} })) } }));
vi.mock('./imageEdit', async importOriginal => ({
  ...await importOriginal<typeof import('./imageEdit')>(),
  prepareImageEdit: vi.fn(async () => ({ image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', requestWidth: 832, requestHeight: 1216, sourceWidth: 832, sourceHeight: 1216 })),
  composeImageEditResult: vi.fn(async (blob: Blob) => blob),
}));

const params: NAIParams = {
  model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28,
  scale: 5, sampler: 'k_euler_ancestral', qualityToggle: false, ucPreset: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('nai_api_key', 'test-key');
  emitCloudQueueStatus(null);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:test-result');
  });
  vi.mocked(api.postBinary).mockResolvedValue(new Blob(['zip']));
  vi.mocked(api.postBinaryDetailed).mockResolvedValue({ blob: new Blob(['zip']), estimatedCost: 0 });
  vi.mocked(api.postSse).mockImplementation(async (_path, _payload, _headers, onEvent) => {
    onEvent({ event: 'final', data: { image: 'AQID', seed: 123 } });
    return { estimatedCost: 0 };
  });
});

afterEach(() => {
  emitCloudQueueStatus(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const characters = [
  { id: 'c1', prompt: 'girl, blue hair, blue dress', negativePrompt: 'red hair', x: 0.5, y: 0.5 },
  { id: 'c2', prompt: 'boy, black hair, white shirt', negativePrompt: 'blue hair', x: 0.1, y: 0.2 },
];
type CharacterPayload = { parameters: {
  v4_prompt: { caption: { char_captions: { char_caption: string; centers: { x: number; y: number }[] }[] }; use_coords: boolean };
  v4_negative_prompt: { caption: { char_captions: { char_caption: string; centers: { x: number; y: number }[] }[] } };
} };
const lastCharacterPayload = (stream: boolean) => (stream
  ? vi.mocked(api.postSse).mock.calls.at(-1)![1]
  : (vi.mocked(api.postBinaryDetailed).mock.calls.at(-1) || vi.mocked(api.postBinary).mock.calls.at(-1))![1]) as CharacterPayload;

describe('编辑模式完整角色请求与历史坐标', () => {
  it.each([
    ['text-to-image', false], ['text-to-image', true], ['image-to-image', false], ['image-to-image', true],
    ['inpaint', false], ['inpaint', true], ['outpaint', false], ['outpaint', true],
  ] as const)('%s（stream=%s）请求与返回的历史参数记录同一透明权重，旧草稿不变', async (operation, stream) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    const original: NAIParams = { ...params, model: 'nai-diffusion-5-full', transparent: true };
    const prompt = '1girl, 2.1::transparent background::';
    const edit = { operation: operation as ImageEditOperation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 0.8, noise: 0 };
    const result = operation === 'text-to-image'
      ? stream ? await generateImageStream('test-key', prompt, '', original) : await generateImage('test-key', prompt, '', original)
      : stream ? await generateImageEditStream('test-key', prompt, '', original, edit) : await generateImageEdit('test-key', prompt, '', original, edit);
    const payload = lastCharacterPayload(stream) as CharacterPayload & { input: string };
    expect(payload.input).toBe('1girl, 2.1::transparent background::, has alpha');
    expect(result.params.transparentWeight).toBe(2.1);
    expect(original.transparentWeight).toBeUndefined();
  });
  it.each([
    ['text-to-image', false], ['text-to-image', true], ['image-to-image', false], ['image-to-image', true],
    ['inpaint', false], ['inpaint', true], ['outpaint', false], ['outpaint', true],
  ] as const)('%s（stream=%s）按有效角色校验上限，结果不保存空项与停用项，草稿不变', async (operation, stream) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    const original: NAIParams & { characters: CharacterParams[] } = { ...params, characters: [characters[0],
      ...Array.from({ length: 6 }, (_, index) => ({ ...characters[1], id: `paused-${index}`, enabled: false })),
      { ...characters[1], id: 'empty', prompt: '  ' },
    ] };
    const edit = { operation: operation as ImageEditOperation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 1, noise: 0 };
    const generate = (input: NAIParams) => operation === 'text-to-image'
      ? (stream ? generateImageStream : generateImage)('test-key', '', '', input)
      : (stream ? generateImageEditStream : generateImageEdit)('test-key', '', '', input, edit);
    const result = await generate(original);
    expect(lastCharacterPayload(stream).parameters.v4_prompt.caption.char_captions).toEqual([{ char_caption: characters[0].prompt, centers: [{ x: 0.5, y: 0.5 }] }]);
    expect(result.params.characters).toEqual([characters[0]]);
    expect(result.params.useCoords).toBe(false);
    expect(original.characters).toHaveLength(8);
    expect(original.characters[1].enabled).toBe(false);
    await expect(generate({ ...original, characters: original.characters.map(character => ({ ...character, enabled: true })) })).rejects.toThrow('停用或删除多余角色');
  });
  it.each([false, true])('扩图 stream=%s 发给接口的是当前文字；删除全局、角色及关闭预设后确实全空', async stream => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    const cleared = { ...params, qualityToggle: false, qualityPresetId: 'none', ucPreset: 4, ucPresetId: 'none', characters: [] };
    const generate = stream ? generateImageEditStream : generateImageEdit;
    const edit = { operation: 'outpaint' as const, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 1, noise: 0 };
    await generate('test-key', 'new landscape', 'new negative', { ...cleared, characters }, edit);
    const before = (stream ? vi.mocked(api.postSse) : vi.mocked(api.postBinaryDetailed)).mock.calls.at(-1)![1] as { input: string; parameters: Record<string, any> };
    expect(before.input).toBe('new landscape');
    expect(before.parameters.v4_prompt.caption.base_caption).toBe('new landscape');
    expect(before.parameters.v4_prompt.caption.char_captions).toHaveLength(2);
    await generate('test-key', '', '', cleared, edit);
    const after = (stream ? vi.mocked(api.postSse) : vi.mocked(api.postBinaryDetailed)).mock.calls.at(-1)![1] as { input: string; parameters: Record<string, any> };
    expect(after.input).toBe('');
    expect(after.parameters.negative_prompt).toBe('');
    expect(after.parameters.v4_prompt.caption).toEqual({ base_caption: '', char_captions: [] });
    expect(after.parameters.v4_negative_prompt.caption).toEqual({ base_caption: '', char_captions: [] });
  });
  it.each(['nai-diffusion-4-full', 'nai-diffusion-4-5-full', 'nai-diffusion-5-full'])('%s 三种编辑模式普通／流式保留角色正负词及自动构图', async model => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    const original = { ...params, model, characters, useCoords: false };
    const expectedCharacters = model.startsWith('nai-diffusion-5-') ? characters : [characters[0], { ...characters[1], y: 0.3 }];
    const snapshot = structuredClone(original);
    for (const operation of ['image-to-image', 'inpaint', 'outpaint'] as const) for (const stream of [false, true]) {
      const result = await (stream ? generateImageEditStream : generateImageEdit)('test-key', 'base scene', 'global negative', original,
        { operation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 0.7, noise: 0 });
      const payload = lastCharacterPayload(stream).parameters;
      expect(payload.v4_prompt.caption.char_captions).toEqual(expectedCharacters.map(character => ({ char_caption: character.prompt, centers: [{ x: character.x, y: character.y }] })));
      expect(payload.v4_negative_prompt.caption.char_captions).toEqual(expectedCharacters.map(character => ({ char_caption: character.negativePrompt, centers: [{ x: character.x, y: character.y }] })));
      expect(payload.v4_prompt.use_coords).toBe(false);
      expect(result.params.characters).toEqual(expectedCharacters);
    }
    expect(original).toEqual(snapshot);
  });

  it.each([false, true])('Focused（stream=%s）只换算请求坐标，历史保存整图尺寸与角色位置', async stream => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    vi.mocked(prepareImageEdit).mockResolvedValueOnce({
      image: 'data:image/png;base64,AQID', requestWidth: 832, requestHeight: 1216,
      sourceWidth: 1536, sourceHeight: 2048, originalImage: new Blob(),
      focusedGeometry: { crop: { x: 512, y: 512, width: 512, height: 768 }, inner: { x: 544, y: 544, width: 448, height: 704 }, requestWidth: 832, requestHeight: 1216, fullSizeMask: true },
    } as PreparedImageEdit);
    const original = { ...params, width: 1536, height: 2048, characters, useCoords: true };
    const result = await (stream ? generateImageEditStream : generateImageEdit)('test-key', 'base scene', '', original,
      { operation: 'inpaint', image: 'data:image/png;base64,AQID', strength: 1, noise: 0, focused: true });
    const payload = lastCharacterPayload(stream).parameters;
    expect(payload.v4_prompt.use_coords).toBe(true);
    expect(payload.v4_prompt.caption.char_captions[0].centers[0].x).toBeCloseTo(0.5);
    expect(payload.v4_prompt.caption.char_captions[0].centers[0].y).toBe(0.7);
    expect(payload.v4_negative_prompt.caption.char_captions[0].centers).toEqual(payload.v4_prompt.caption.char_captions[0].centers);
    expect(result.params).toMatchObject({ width: 1536, height: 2048, characters });
    expect(result.requestWidth).toBe(832);
    expect(result.requestHeight).toBe(1216);
    expect(original.characters).toEqual(characters);
  });

  it.each([false, true])('扩图（stream=%s）按原图与四边扩展换算定位，重复请求不累加', async stream => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false }))));
    const original = { ...params, characters, useCoords: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.mocked(prepareImageEdit).mockResolvedValueOnce({ image: 'data:image/png;base64,AQID', originalImage: new Blob(),
        requestWidth: 1024, requestHeight: 1408, sourceWidth: 1024, sourceHeight: 1408 });
      const result = await (stream ? generateImageEditStream : generateImageEdit)('test-key', 'base scene', '', original,
        { operation: 'outpaint', image: 'data:image/png;base64,AQID', strength: 1, noise: 0,
          expansion: { top: 0, right: 0, bottom: 192, left: 192 } });
      const payload = lastCharacterPayload(stream).parameters;
      expect(payload.v4_prompt.caption.char_captions[0].centers[0].x).toBe(0.5);
      expect(payload.v4_prompt.caption.char_captions[0].centers[0].y).toBe(0.5);
      expect(result.params.characters?.[0]).toMatchObject(payload.v4_prompt.caption.char_captions[0].centers[0]);
      expect(result.params).toMatchObject({ width: 1024, height: 1408 });
    }
    expect(original.characters).toEqual(characters);
  });
});

describe('成图交付与辅助排队轮询', () => {
  it.each([
    ['text-to-image', false], ['text-to-image', true],
    ['image-to-image', false], ['image-to-image', true],
    ['inpaint', false], ['inpaint', true],
    ['outpaint', false], ['outpaint', true],
  ] as const)('%s（stream=%s）不等待在途轮询，迟到响应也不能覆盖下一张任务', async (operation, stream) => {
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn((url: string | URL | Request) => {
      if (String(url).includes('/low-consumption')) return Promise.resolve(new Response(JSON.stringify({ enabled: false })));
      if (String(url).includes('/preferences')) return Promise.resolve(new Response(JSON.stringify({ enabled: true, serviceUrl: 'https://queue.test' })));
      return new Promise<Response>(resolve => { respond = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);
    const edit = { operation: operation as ImageEditOperation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 0.6, noise: 0.1 };
    const result = operation === 'text-to-image'
      ? await (stream ? generateImageStream : generateImage)('test-key', '1girl', '', params)
      : await (stream ? generateImageEditStream : generateImageEdit)('test-key', '1girl', '', params, edit);
    // 状态 fetch 至今没有返回；旧实现会在 finally 等待，无法交付成图。
    expect(result.image).toBe('blob:test-result');
    expect(result.blob.size).toBe(3);
    const oldTaskId = getCurrentCloudQueueStatus()!.taskId;
    expect(getCurrentCloudQueueStatus()?.phase).toBe('completed');
    emitCloudQueueStatus({ taskId: 'next-task', phase: 'preparing' }, 'test-key');
    respond(new Response(JSON.stringify({ taskId: oldTaskId, phase: 'waiting' })));
    // 等待辅助响应解析结束，确认它没有让旧任务重新出现。
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getCurrentCloudQueueStatus()?.taskId).toBe('next-task');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.postBinary).mock.calls.length + vi.mocked(api.postBinaryDetailed).mock.calls.length + vi.mocked(api.postSse).mock.calls.length).toBe(1);
  });
});

describe('四模式普通／流式请求共用低消耗实际参数', () => {
  it.each([
    ['text-to-image', false], ['text-to-image', true], ['inpaint', false], ['inpaint', true],
  ] as const)('%s（stream=%s）限制步数且不破坏草稿与编辑强度，返回历史实际参数', async (operation, stream) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/low-consumption') ? { enabled: true } : { enabled: false }))));
    for (const [model, steps] of [['nai-diffusion-5-full', 23], ['nai-diffusion-4-5-full', 28]] as const) {
      vi.mocked(api.postBinary).mockClear(); vi.mocked(api.postBinaryDetailed).mockClear(); vi.mocked(api.postSse).mockClear();
      const original: NAIParams = { ...params, model, steps: 40, width: 1536, height: 1536, seed: 123,
        characterReferences: { enabled: true, slots: [{ assetId: 'saved-ref', type: 'character', strength: 0.8, fidelity: 1 }] } };
      const edit = { operation: operation as ImageEditOperation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 0.35, noise: 0.1 };
      const result = operation === 'text-to-image'
        ? await (stream ? generateImageStream : generateImage)('test-key', '1girl', '', original)
        : await (stream ? generateImageEditStream : generateImageEdit)('test-key', '1girl', '', original, edit);
      const sent = (vi.mocked(api.postSse).mock.calls[0] || vi.mocked(api.postBinaryDetailed).mock.calls[0] || vi.mocked(api.postBinary).mock.calls[0])[1] as {
        parameters: { steps: number; width: number; height: number; _local_character_references?: unknown; strength?: number; inpaintImg2ImgStrength?: number };
      };
      expect(sent.parameters.steps).toBe(steps);
      expect(sent.parameters._local_character_references).toBeUndefined();
      expect(result.params.steps).toBe(steps);
      expect(result.params.width).toBe(sent.parameters.width);
      expect(result.params.height).toBe(sent.parameters.height);
      if (operation === 'text-to-image') expect(sent.parameters.width * sent.parameters.height).toBeLessThanOrEqual(1048576);
      else {
        expect([sent.parameters.width, sent.parameters.height]).toEqual([832, 1216]);
        expect(sent.parameters.inpaintImg2ImgStrength).toBe(0.35);
      }
      expect(original.steps).toBe(40);
      expect(original.width).toBe(1536);
      expect(original.characterReferences?.enabled).toBe(true);
    }
  });
  it.each(['image-to-image', 'outpaint'] as const)('%s 开关开启时拒绝普通／流式请求，关闭后不再有原 10／20 点或步数限制', async operation => {
    let enabled = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/low-consumption') ? { enabled } : { enabled: false }))));
    const original = { ...params, steps: 40 };
    const edit = { operation, image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', strength: 1, noise: 0.1 };
    for (const generate of [generateImageEdit, generateImageEditStream]) await expect(generate('test-key', '1girl', '', original, edit)).rejects.toThrow('已关闭图生图和扩图');
    expect(api.postBinaryDetailed).not.toHaveBeenCalled();
    expect(api.postSse).not.toHaveBeenCalled();
    enabled = false;
    for (const generate of [generateImageEdit, generateImageEditStream]) {
      const result = await generate('test-key', '1girl', '', original, edit);
      expect(result.params.steps).toBe(40);
    }
  });
});
