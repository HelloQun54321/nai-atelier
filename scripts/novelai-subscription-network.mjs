import { setTimeout as sleep } from 'node:timers/promises';

const SUBSCRIPTION_URL = 'https://image.novelai.net/user/subscription';
const FALLBACK_SUBSCRIPTION_URL = 'https://text.novelai.net/user/subscription';
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

// Only this read-only endpoint is retried. Generation/encoding POSTs are never replayed.
export async function fetchNovelAiSubscription(
  authorization,
  signal = AbortSignal.timeout(30_000),
  requestRemote = fetch,
  gatewayUrl = '',
  { retryDelaysMs = [750, 1500], attemptTimeoutMs = 8000 } = {},
) {
  let url = gatewayUrl ? `${gatewayUrl}/user/subscription` : SUBSCRIPTION_URL;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]);
    let response;
    try {
      response = await requestRemote(url, {
        method: 'GET', headers: { Authorization: authorization }, signal: attemptSignal,
        ...(gatewayUrl ? { redirect: 'error' } : {}),
      });
      if (response.ok) {
        // Receive the complete small body before returning, so mid-body disconnects
        // are covered by the same bounded retry and timeout as the handshake.
        const body = await response.text();
        JSON.parse(body);
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const canFallback = !gatewayUrl && url === SUBSCRIPTION_URL && response.status === 400;
      if (attempt >= retryDelaysMs.length || (!canFallback && !RETRYABLE_STATUS.has(response.status))) return response;
      if (canFallback) url = FALLBACK_SUBSCRIPTION_URL;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (attempt >= retryDelaysMs.length || !['TypeError', 'TimeoutError', 'SyntaxError'].includes(error.name)) throw error;
      if (!gatewayUrl && error.name !== 'SyntaxError') url = FALLBACK_SUBSCRIPTION_URL;
    }
    await sleep(retryDelaysMs[attempt], undefined, { signal });
  }
}
