// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageEditOperation, NAIParams } from '../types';
import { api } from './api';
import { getCurrentCloudQueueStatus, emitCloudQueueStatus } from './cloudQueue';
import { generateImage, generateImageEdit, generateImageStream, generateImageEditStream } from './naiService';

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
  prepareImageEdit: vi.fn(async () => ({ image: 'data:image/png;base64,AQID', mask: 'data:image/png;base64,AQID', requestWidth: 832, requestHeight: 1216 })),
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

describe('成图交付与辅助排队轮询', () => {
  it.each([
    ['text-to-image', false], ['text-to-image', true],
    ['image-to-image', false], ['image-to-image', true],
    ['inpaint', false], ['inpaint', true],
    ['outpaint', false], ['outpaint', true],
  ] as const)('%s（stream=%s）不等待在途轮询，迟到响应也不能覆盖下一张任务', async (operation, stream) => {
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn((url: string | URL | Request) => {
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.postBinary).mock.calls.length + vi.mocked(api.postBinaryDetailed).mock.calls.length + vi.mocked(api.postSse).mock.calls.length).toBe(1);
  });
});
