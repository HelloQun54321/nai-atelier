// Isolate paid generation requests from pooled sockets used by background lookups.
// A failed POST is never replayed; closing a dispatcher drains its active response.
export function createNovelAiRemoteFetch({ requestRemote, ProxyAgent, proxyUrl, sharedAgent }) {
  return async (url, options = {}) => {
    const target = new URL(url);
    const generation = target.hostname === 'image.novelai.net'
      && target.pathname.startsWith('/ai/') && options.method === 'POST';
    if (!generation || !proxyUrl) {
      return requestRemote(url, { ...options, ...(sharedAgent ? { dispatcher: sharedAgent } : {}) });
    }
    const agent = new ProxyAgent({ uri: proxyUrl, connections: 1 });
    try {
      const response = await requestRemote(url, { ...options, dispatcher: agent });
      // undici close() waits for the in-flight response body, including SSE.
      void agent.close().catch(() => {});
      return response;
    } catch (error) {
      await agent.destroy().catch(() => {});
      throw error;
    }
  };
}
