import { expect, it } from 'vitest';
import { agentConnectionEndpoint, normalizeAgentConnectionUrl } from '../../services/agentConnection.mjs';

it('根地址与完整端点归一化后始终使用同一请求路径，不重复版本号', () => {
  for (const [api, endpoint, base, models] of [
    ['openai-completions', 'https://example.com/proxy/v1/chat/completions', 'https://example.com/proxy/v1', 'https://example.com/proxy/v1/models'],
    ['openai-responses', 'https://example.com/proxy/v1/responses/', 'https://example.com/proxy/v1', 'https://example.com/proxy/v1/models'],
    ['anthropic-messages', 'https://example.com/proxy/v1/messages', 'https://example.com/proxy', 'https://example.com/proxy/v1/models'],
  ]) {
    expect(normalizeAgentConnectionUrl(endpoint, api)).toBe(base);
    expect(agentConnectionEndpoint(endpoint, api)).toBe(endpoint.replace(/\/$/, ''));
    expect(agentConnectionEndpoint(endpoint, api, true)).toBe(models);
  }
  expect(agentConnectionEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
});
it('拒绝凭据、查询参数与非 HTTP 地址，避免把敏感内容拼进 URL', () => {
  for (const url of ['file:///a', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) expect(() => normalizeAgentConnectionUrl(url)).toThrow();
});
