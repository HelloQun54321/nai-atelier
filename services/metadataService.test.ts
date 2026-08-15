import { describe, it, expect } from 'vitest';
import { extractRawMetadataFromJsonText } from './metadataService';

describe('extractRawMetadataFromJsonText', () => {
  it('Comment 为对象时序列化返回', () => {
    const comment = { prompt: 'a girl', steps: 28 };
    const out = extractRawMetadataFromJsonText(JSON.stringify({ Comment: comment, other: 1 }));
    expect(JSON.parse(out)).toEqual(comment);
  });

  it('comment 为字符串时直接返回', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ comment: 'raw meta text' }))).toBe('raw meta text');
  });

  it('空字符串 comment 不算有效值，继续走后续分支', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ comment: '  ', prompt: 'p' }))).toContain('"prompt"');
  });

  it('本身是生成参数 JSON 时整体返回', () => {
    const out = extractRawMetadataFromJsonText(JSON.stringify({ prompt: 'x', steps: 23, uc: 'y' }));
    expect(JSON.parse(out)).toEqual({ prompt: 'x', steps: 23, uc: 'y' });
  });

  it('Description 字段兜底', () => {
    expect(extractRawMetadataFromJsonText(JSON.stringify({ Description: 'legacy text' }))).toBe('legacy text');
  });

  it('非 JSON 纯文本原样返回（交给纯文本元数据解析）', () => {
    const plain = 'masterpiece, 1girl, best quality Negative prompt: lowres Steps: 28';
    expect(extractRawMetadataFromJsonText(plain)).toBe(plain);
  });

  it('对象但无任何已知字段时原样返回', () => {
    const raw = JSON.stringify({ foo: 'bar' });
    expect(extractRawMetadataFromJsonText(raw)).toBe(raw);
  });
});
