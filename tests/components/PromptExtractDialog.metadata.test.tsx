// @vitest-environment jsdom
/**
 * 这里是「真实组件 + 真实 PNG」的回归：不 mock services/pngMetadata.mjs，
 * 用 fast-png 合成一张带 tEXt Comment 的 PNG，覆盖 Codex 复现的场景
 * （全局 classroom, sunset、角色 A red hair、角色 B blue hair）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import { PromptExtractDialog } from '../../components/PromptExtractDialog';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), config: vi.fn(), notify: vi.fn(), close: vi.fn(), save: vi.fn(), attachment: vi.fn() }));

vi.mock('../../services/promptAgent', () => ({
  promptAgentService: { extractCandidates: mocks.extract, getConfig: mocks.config },
  PROMPT_LIBRARY_KIND_LABELS: {
    appearance: '人物形象', wardrobe: '服饰', pose: '姿势',
    expression: '表情状态', scene: '场景', camera: '镜头画面',
  },
}));
vi.mock('../../services/agentAttachments', () => ({ prepareAgentAttachment: mocks.attachment }));
/* 清空草稿的确认框由应用根节点提供；这里只需要一个不弹窗的桩。 */
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
/* 词库分片来自 /tag-data，静态测试环境不需要真实词库。 */
vi.mock('../../services/tagDictionary', () => ({
  normalizeTagQuery: (value: string) => String(value || '').trim().toLowerCase(),
  preloadTagDictionary: () => undefined,
  searchTagDictionary: async () => [],
  lookupTagTranslations: async () => new Map(),
  /* 上游 1.121.1 起输入框会查词典释义；这里同样桩成空表。 */
  lookupTagCatalogEntries: async () => new Map(),
}));

const SIZE = 32;
/** 64 字节都不到的合成 PNG：先在 IEND 前插入真实 tEXt 块，再由组件自己读取。 */
const pngWithComment = (value: Record<string, unknown>) => {
  const plain = Buffer.from(encode({ width: SIZE, height: SIZE, channels: 4, data: new Uint8Array(SIZE * SIZE * 4).fill(255) }));
  const content = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(JSON.stringify(value), 'utf8')]);
  const chunk = Buffer.alloc(content.length + 12);
  chunk.writeUInt32BE(content.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  content.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([plain.subarray(0, plain.length - 12), chunk, plain.subarray(plain.length - 12)]);
};

const metadata = {
  prompt: 'classroom, sunset, red hair, red eyes, blue hair, blue eyes',
  uc: 'bad quality',
  steps: 28,
  Source: 'NovelAI',
  v4_prompt: { caption: {
    base_caption: 'classroom, sunset',
    char_captions: [{ char_caption: 'red hair, red eyes' }, { char_caption: 'blue hair, blue eyes' }],
  } },
  v4_negative_prompt: { caption: {
    base_caption: 'bad quality',
    char_captions: [{ char_caption: 'bad hands' }, { char_caption: '' }],
  } },
};

const imageFile = (bytes: Buffer) => {
  const file = new File([new Uint8Array(bytes)], '合成.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  return file;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ provider: 'synthetic', model: 'synthetic-model', imageInput: true });
  mocks.save.mockResolvedValue(undefined);
  mocks.attachment.mockResolvedValue({ data: 'AAAA', mimeType: 'image/png', name: '合成.png' });
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', writable: true, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true, configurable: true });
});

afterEach(cleanup);

it('真实 PNG 的两名角色都进入分类请求，不与全局合并，角色负面只展示不发送', async () => {
  mocks.extract.mockResolvedValue({
    mode: 'text', provider: 'synthetic', model: 'synthetic-model',
    items: [
      { kind: 'appearance', name: '人物 A · 红发红瞳', prompt: 'red hair, red eyes', original: '' },
      { kind: 'appearance', name: '人物 B · 蓝发蓝瞳', prompt: 'blue hair, blue eyes', original: '' },
      { kind: 'scene', name: '教室夕阳', prompt: 'classroom, sunset', original: '' },
    ],
    unclassified: null,
    excluded: { negative: 'bad quality', parameters: '' },
  });
  render(<PromptExtractDialog open onClose={mocks.close} notify={mocks.notify} onSave={mocks.save} />);
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [imageFile(pngWithComment(metadata))] } });

  // 组件真的从 PNG 里读出了角色分栏，而不是被 mock 喂了一条字符串。
  await waitFor(() => expect(document.querySelectorAll('[data-extract-character]').length).toBe(2));
  expect(screen.getByText(/已读取内嵌提示词 · 2 个角色/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '按文字分类' }));
  await waitFor(() => expect(mocks.extract).toHaveBeenCalledTimes(1));
  const [payload] = mocks.extract.mock.calls[0];
  expect(payload.mode).toBe('text');
  expect(payload.text).toBe('classroom, sunset\nNegative prompt: bad quality');
  expect(payload.characters).toEqual([
    { label: '人物 A', prompt: 'red hair, red eyes', negative: 'bad hands' },
    { label: '人物 B', prompt: 'blue hair, blue eyes', negative: '' },
  ]);
  // 看图提取没有被自动串行调用第二次。
  expect(mocks.attachment).not.toHaveBeenCalled();
});
