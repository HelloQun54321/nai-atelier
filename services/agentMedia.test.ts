import { describe, expect, it } from 'vitest';
import { extractAgentMedia, isAgentImagePath } from './agentMedia';

describe('聊天图片收据', () => {
  it('本地图片只接受会话与不透明 ID，拒绝多余查询参数', () => {
    const path = '/api/prompt-agent/local-image?sessionId=s&id=' + 'a'.repeat(32);
    expect(isAgentImagePath(path)).toBe(true);
    for (const suffix of ['&path=C:/private', '&id=' + 'b'.repeat(32), '#fragment']) expect(isAgentImagePath(path + suffix)).toBe(false);
    expect(isAgentImagePath(path.replace('sessionId=s', 'sessionId=%00'))).toBe(false);
  });
  it('从实时与历史的工具结果提取图片，并去重', () => {
    const image = { kind: 'history', id: 'a', title: '作品', path: '/api/local-history/a/image' };
    const content = [{ type: 'text', text: JSON.stringify({ displayImages: [image, image] }) }];
    expect(extractAgentMedia(content)).toEqual([image]);
    expect(extractAgentMedia({ content })).toEqual([image]);
  });
  it('拒绝外部地址与穿越路径，普通文字不触发图片请求', () => {
    for (const path of ['https://example.com/image', '/api/assets/../secret', '/api/assets/%2e%2e/private', '/api/assets/%5csecret', 'file:///C:/private']) expect(isAgentImagePath(path)).toBe(false);
    expect(extractAgentMedia([{ type: 'text', text: '![图片](https://example.com/image)' }])).toEqual([]);
  });
});
