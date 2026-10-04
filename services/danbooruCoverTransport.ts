import { api, ApiError } from './api';
import type { DanbooruSearchResult } from './danbooruService';
import { readDanbooruRetryAfter, type DanbooruFailurePayload } from './danbooruErrors.mjs';

export interface CoverQuery { query: string; page: number; limit: number }
export interface CoverReply { index: number; status: number; data: DanbooruSearchResult | ({ error: string } & Partial<DanbooruFailurePayload>) }
type LoadBatch = (queries: CoverQuery[], reply: (item: CoverReply) => void, signal: AbortSignal, background: boolean) => Promise<unknown>;

/** 最多两条浏览器连接、每批五项，为网关十个并发提供任务；批内逐项返回。 */
export const createCoverTransport = (load: LoadBatch) => {
  type Task = { query: CoverQuery; priority: () => number; resolve: (value: DanbooruSearchResult) => void; reject: (error: unknown) => void; done: boolean; signal?: AbortSignal; abort: () => void; batch?: { controller: AbortController; tasks: Task[] } };
  const queue: Task[] = [];
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoffUntil = 0;
  let blockedError: ApiError | undefined;
  let nextBackgroundAt = 0;
  const finish = (task: Task, value?: DanbooruSearchResult, error?: unknown) => {
    if (task.done) return;
    task.done = true;
    task.signal?.removeEventListener('abort', task.abort);
    if (error) task.reject(error); else task.resolve(value!);
  };
  const cooldownError = () => {
    const retryAfter = Math.max(1, Math.ceil((backoffUntil - Date.now()) / 1000));
    const message = blockedError!.message.replace(/；已暂停联网查询，请 \d+ 秒后重试$/, '');
    return Object.assign(new ApiError(`${message}；已暂停联网查询，请 ${retryAfter} 秒后重试`, blockedError!.status, blockedError!.code), { retryAfter });
  };
  const pause = (error: ApiError) => {
    backoffUntil = Math.max(backoffUntil, Date.now() + (readDanbooruRetryAfter(error.retryAfter) || (error.status === 403 ? 300 : 30)) * 1000);
    if (blockedError?.status !== 403 || error.status === 403) blockedError = error;
    // 排队卡片及时显示真实错误，不让它们静默转圈数分钟；已返回的缓存结果仍保留。
    queue.splice(0).forEach(task => finish(task, undefined, cooldownError()));
  };
  const wake = (delay = 50) => {
    if (timer !== undefined || !queue.some(task => !task.done)) return;
    timer = setTimeout(() => { timer = undefined; pump(); }, delay);
  };
  const pump = () => {
    if (active >= 2) return;
    if (backoffUntil > Date.now()) { wake(backoffUntil - Date.now()); return; }
    // 在真正启动时读取位置，滚动进入屏幕的排队卡片会自动提到前面。
    queue.sort((left, right) => left.priority() - right.priority());
    const pending = queue.filter(task => !task.done);
    if (!pending.length) { queue.length = 0; return; }
    const foreground = pending.filter(task => task.priority() < 1000);
    if (!foreground.length && (active > 0 || nextBackgroundAt > Date.now())) {
      wake(active ? 150 : nextBackgroundAt - Date.now());
      return;
    }
    const tasks = (foreground.length ? foreground.slice(0, 5) : pending.slice(0, 1));
    for (const task of tasks) queue.splice(queue.indexOf(task), 1);
    if (!foreground.length) nextBackgroundAt = Date.now() + 1000;
    const batch = { controller: new AbortController(), tasks };
    tasks.forEach(task => { task.batch = batch; });
    active++;
    void Promise.resolve().then(() => load(tasks.map(task => task.query), item => {
      const task = tasks[item.index];
      if (!task || task.done) return;
      if (item.status >= 200 && item.status < 300 && 'items' in item.data) finish(task, item.data);
      else {
        const error = Object.assign(new ApiError('error' in item.data ? item.data.error : 'Danbooru 查询失败', item.status, 'error' in item.data ? item.data.code : undefined), 'error' in item.data && item.data.retryAfter ? { retryAfter: item.data.retryAfter } : {});
        if (item.status === 429 || item.status === 403) pause(error);
        finish(task, undefined, error);
      }
    }, batch.controller.signal, !foreground.length)).catch(error => {
      if (error?.status === 429 || error?.status === 403) pause(error);
      tasks.forEach(task => finish(task, undefined, error));
    }).finally(() => {
      tasks.forEach(task => finish(task, undefined, new Error('Danbooru 封面响应中断')));
      active--;
      wake();
    });
    wake();
  };
  return (query: CoverQuery, signal?: AbortSignal, priority: () => number = () => 0): Promise<DanbooruSearchResult> => {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (backoffUntil > Date.now()) return Promise.reject(cooldownError());
    blockedError = undefined;
    return new Promise((resolve, reject) => {
      const task: Task = { query, signal, priority, resolve, reject, done: false, abort: () => {
        finish(task, undefined, new DOMException('Aborted', 'AbortError'));
        const index = queue.indexOf(task);
        if (index >= 0) queue.splice(index, 1);
        // 一个使用者离开不影响同批其他卡片；全部离开才中止传输。
        if (task.batch?.tasks.every(item => item.done)) task.batch.controller.abort();
      } };
      signal?.addEventListener('abort', task.abort, { once: true });
      queue.push(task);
      wake();
    });
  };
};

export const requestCoverQuery = createCoverTransport((requests, reply, signal, background) =>
  api.postSse('/danbooru/covers', { requests, background }, {}, event => {
    if (event.event === 'result') reply(event.data as CoverReply);
  }, { signal }));
