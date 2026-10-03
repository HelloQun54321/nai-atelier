import { randomUUID } from 'node:crypto';
/** 页面请求由发起标签页认领；重连仅恢复尚在等待的请求，不重放历史操作。 */
export class AgentUiBridge {
  pending = new Map();
  request(sessionId, operation, emit, signal, timeout = 20_000, clientId = '') {
    if (signal?.aborted) return Promise.reject(new Error('页面操作已停止'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(requestId);
        if (error) { try { emit({ type: 'ui_cancel', requestId, clientId }); } catch { /* 流已断开，失效请求不会再出现在恢复列表。 */ } }
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(new Error('页面操作已停止'));
      const timer = setTimeout(() => finish(new Error('当前页面未响应，不能把旧实验室草稿当成实时页面')), timeout);
      const expiresAt = Date.now() + timeout;
      this.pending.set(requestId, { sessionId, clientId, operation, expiresAt, finish, emit, claimId: '' });
      signal?.addEventListener('abort', abort, { once: true });
      try { emit({ type: 'ui_request', requestId, operation, clientId, expiresAt }); } catch (error) { finish(error); }
    });
  }
  list(sessionId, clientId) {
    if (!clientId) return [];
    return [...this.pending].filter(([, item]) => item.sessionId === sessionId && item.clientId === clientId && item.expiresAt > Date.now()).map(([requestId, item]) => ({ requestId, operation: item.operation, clientId, expiresAt: item.expiresAt, claimId: item.claimId }));
  }
  owned(sessionId, payload) {
    const pending = this.pending.get(payload?.requestId);
    if (!pending || pending.sessionId !== sessionId || pending.expiresAt <= Date.now() || pending.clientId && pending.clientId !== payload.clientId) throw Object.assign(new Error('页面请求已过期或不属于当前标签页'), { status: 409 });
    return pending;
  }
  claim(sessionId, payload) {
    const pending = this.owned(sessionId, payload);
    if (pending.claimId) return { execute: false, claimId: pending.claimId };
    pending.claimId = randomUUID();
    return { execute: true, claimId: pending.claimId };
  }
  reply(sessionId, payload) {
    const pending = this.owned(sessionId, payload);
    if (pending.clientId && (!pending.claimId || payload.claimId !== pending.claimId)) throw Object.assign(new Error('页面请求尚未认领或回执令牌无效'), { status: 409 });
    if (payload.error) pending.finish(new Error(String(payload.error).slice(0, 500)));
    else {
      const result = payload.result;
      if (!result || typeof result.title !== 'string' || typeof result.snapshotId !== 'string' || !Array.isArray(result.controls) || JSON.stringify(result).length > 50_000) throw Object.assign(new Error('页面回执格式无效'), { status: 400 });
      pending.finish(null, result);
    }
    return { ok: true };
  }
  cancel(sessionId) { for (const item of this.pending.values()) if (item.sessionId === sessionId) item.finish(new Error('页面操作已停止')); }
}
