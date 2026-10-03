import { randomUUID } from 'node:crypto';
/** 浏览器回执绑定会话与随机请求；仅由发起任务的流连接执行，不读取电脑其他应用。 */
export class AgentUiBridge {
  pending = new Map();
  request(sessionId, operation, emit, signal, timeout = 12_000) {
    if (signal?.aborted) return Promise.reject(new Error('页面操作已停止'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(requestId);
        if (error) reject(error); else resolve(result);
      };
      const abort = () => finish(new Error('页面操作已停止'));
      const timer = setTimeout(() => finish(new Error('当前页面未响应，不能把旧实验室草稿当成实时页面')), timeout);
      this.pending.set(requestId, { sessionId, finish });
      signal?.addEventListener('abort', abort, { once: true });
      try { emit({ type: 'ui_request', requestId, operation }); } catch (error) { finish(error); }
    });
  }
  reply(sessionId, payload) {
    const pending = this.pending.get(payload?.requestId);
    if (!pending || pending.sessionId !== sessionId) throw Object.assign(new Error('页面回执已过期或不属于这个会话'), { status: 409 });
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
