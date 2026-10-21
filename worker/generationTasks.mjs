const failure = (message, code, status = 409, outcome) => Object.assign(new Error(message), { code, status, ...(outcome ? { outcome } : {}) });
const expiredFailure = () => failure('生成任务已过期或归属已变化，已停止后续生成', 'generation_task_expired');
const cancelledFailure = () => failure('生成任务已被取消', 'generation_cancelled', 409, 'cancelled');
export const DEFAULT_GENERATION_INTERVAL_SECONDS = 2;
export const MAX_GENERATION_INTERVAL_SECONDS = 3600;
export const validateGenerationInterval = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_GENERATION_INTERVAL_SECONDS || Math.round(seconds * 10) / 10 !== seconds) throw failure('生成间隔须为 0～3600 秒，最多一位小数', 'invalid_generation_interval', 400);
  return seconds;
};

/** 由同一工坊后端持有；只记录 Key 指纹，空闲租约过期，在途请求始终占用。 */
export class GenerationTasks {
  constructor({ now = Date.now, idleMs = 90_000, intervalSeconds = DEFAULT_GENERATION_INTERVAL_SECONDS, cancelTtlMs = 120_000 } = {}) {
    this.now = now;
    this.idleMs = idleMs;
    this.cancelTtlMs = cancelTtlMs;
    this.intervalSeconds = validateGenerationInterval(intervalSeconds);
    this.tasks = new Map();
    this.waiting = new Map();
    this.queues = new Map();
    // 明确取消的 token 墓碑：短时保留，让 status/owned 返回结构化 cancelled 而不是过期。
    this.tombstones = new Map();
  }
  isCancelled(key, token) {
    const expiresAt = this.tombstones.get(key + '\n' + token);
    return expiresAt !== undefined && expiresAt > this.now();
  }
  rememberCancelled(key, token) { this.tombstones.set(key + '\n' + token, this.now() + this.cancelTtlMs); }
  prune() {
    for (const [key, queue] of this.waiting) {
      // 后台托管任务不依赖浏览器心跳，期间始终保留。
      const live = queue.filter(task => task.managed || task.expiresAt > this.now());
      if (live.length) this.waiting.set(key, live); else this.waiting.delete(key);
    }
    for (const [key, task] of this.tasks) if (!task.inFlight && !task.managed && task.expiresAt <= this.now()) this.tasks.delete(key);
    for (const [id, expiresAt] of this.tombstones) if (expiresAt <= this.now()) this.tombstones.delete(id);
    for (const key of this.waiting.keys()) this.promote(key);
  }
  promote(key) {
    if (this.tasks.has(key)) return;
    const queue = this.waiting.get(key);
    if (!queue?.length) return;
    const task = queue.shift();
    delete task.preempt;
    this.tasks.set(key, task);
    if (!queue.length) this.waiting.delete(key);
  }
  // 只在当前图片已保存后交接；原任务剩余张数留在插队任务之后、普通队尾之前。
  yield(key) {
    const task = this.tasks.get(key), queue = this.waiting.get(key);
    // 只有空闲（保存已确认且公共 cleanup 已收尾）的执行位才能被插队抢占；准备/生成/保存/在途清理期间都独占。
    if (!task || task.inFlight || task.phase !== 'idle' || task.releasing || task.completed === 0 || task.completed >= task.count || queue?.[0]?.preempt !== task.token) return;
    const next = queue.shift();
    let index = 0;
    while (queue[index]?.preempt === task.token) index++;
    queue.splice(index, 0, task);
    delete next.preempt;
    this.tasks.set(key, next);
  }
  get size() { this.prune(); return this.tasks.size; }
  current(key) { this.prune(); return this.tasks.get(key); }
  setInterval(key, seconds) {
    const state = this.queues.get(key) || { completed: 0, paused: false };
    state.intervalSeconds = validateGenerationInterval(seconds);
    this.queues.set(key, state);
    return this.snapshot(key);
  }
  waitMs(key) {
    const state = this.queues.get(key);
    return state?.lastFinishedAt === undefined ? 0 : Math.max(0, state.lastFinishedAt + Math.round((state.intervalSeconds ?? this.intervalSeconds) * 1000) - this.now());
  }
  snapshot(key) {
    this.prune();
    const state = this.queues.get(key) || { completed: 0, paused: false };
    const tasks = [...(this.tasks.has(key) ? [this.tasks.get(key)] : []), ...(this.waiting.get(key) || [])];
    // 只有真正生成或保存中的图片才让前端保持“暂停中”，准备阶段不算，避免恢复按钮被禁用而卡死。
    return { intervalSeconds: state.intervalSeconds ?? this.intervalSeconds, busy: tasks.length > 0 || state.paused, completed: state.completed, total: state.completed + tasks.reduce((sum, task) => sum + task.count - task.completed, 0), paused: state.paused, pausing: state.paused && tasks.some(task => task.phase === 'generating' || task.phase === 'saving'), waiting: (this.waiting.get(key) || []).map((task, index) => ({ token: task.token, total: task.count, completed: task.completed, position: index + 1 })) };
  }
  pause(key, paused) {
    const state = this.queues.get(key) || { completed: 0, paused: false };
    state.paused = paused;
    this.queues.set(key, state);
    return this.snapshot(key);
  }
  reserve(key, token, count = 1, queued = false) {
    if (!key) throw failure('缺少 NovelAI API Key', 'missing_key', 401);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(token || '')) throw failure('生成任务标识无效', 'invalid_generation_task', 400);
    if (this.isCancelled(key, token)) throw cancelledFailure();
    if (!Number.isSafeInteger(count) || count < 1) throw failure('生成张数无效', 'invalid_generation_count', 400);
    const current = this.current(key);
    if (!queued && !current && this.queues.get(key)?.paused) throw failure('生成队列已暂停，请主动加入队列', 'generation_paused');
    if (current && current.token !== token) throw failure('此 Key 正在生成，请等待当前任务完成', 'generation_busy');
    if (current?.releasing) throw failure('生成任务已结束，请重新发起', 'generation_task_expired');
    if (!current && !this.waiting.has(key) && !this.queues.get(key)?.paused) this.queues.set(key, { ...this.queues.get(key), completed: 0, paused: false });
    const task = current || { token, inFlight: false, releasing: false, cancelled: false, managed: false, phase: 'idle', count, completed: 0 };
    if (!Number.isSafeInteger(this.snapshot(key).total + (current ? 0 : count))) throw failure('生成总张数过大', 'invalid_generation_count', 400);
    task.expiresAt = this.now() + this.idleMs;
    this.tasks.set(key, task);
    return task;
  }
  enqueue(key, token, placement, count = 1) {
    if (!['end', 'next'].includes(placement)) throw failure('排队位置无效', 'invalid_generation_queue', 400);
    if (!key) throw failure('缺少 NovelAI API Key', 'missing_key', 401);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(token || '')) throw failure('生成任务标识无效', 'invalid_generation_task', 400);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(this.snapshot(key).total + count)) throw failure('生成张数无效', 'invalid_generation_count', 400);
    this.prune();
    if (this.isCancelled(key, token)) throw cancelledFailure();
    if (this.tasks.get(key)?.token === token || this.waiting.get(key)?.some(task => task.token === token)) return this.status(key, token);
    if (!this.tasks.has(key)) { this.reserve(key, token, count, true); return this.status(key, token); }
    const queue = this.waiting.get(key) || [];
    if (queue.length >= 50) throw failure('待生成任务已满，请先完成或取消部分任务', 'generation_queue_full');
    const task = { token, inFlight: false, releasing: false, cancelled: false, managed: false, phase: 'idle', count, completed: 0, expiresAt: this.now() + this.idleMs, ...(placement === 'next' ? { preempt: this.tasks.get(key).token } : {}) };
    if (placement === 'next') queue.unshift(task); else queue.push(task);
    this.waiting.set(key, queue);
    this.yield(key);
    return this.status(key, token);
  }
  status(key, token) {
    this.prune();
    if (this.isCancelled(key, token)) throw cancelledFailure();
    if (this.tasks.get(key)?.token === token) return { position: 0, paused: Boolean(this.queues.get(key)?.paused), waitMs: this.waitMs(key) };
    const index = this.waiting.get(key)?.findIndex(task => task.token === token) ?? -1;
    if (index < 0) throw expiredFailure();
    return { position: index + 1, paused: Boolean(this.queues.get(key)?.paused) };
  }
  owned(key, token) {
    const task = this.current(key);
    if (this.isCancelled(key, token)) throw cancelledFailure();
    if (!task || task.token !== token || task.releasing) throw expiredFailure();
    return task;
  }
  // 后台 runner 领取后标记托管：没有浏览器心跳也不被 prune 清理，直到显式释放或取消。
  manage(key, token) {
    this.prune();
    const task = this.tasks.get(key)?.token === token ? this.tasks.get(key) : this.waiting.get(key)?.find(candidate => candidate.token === token);
    if (!task) throw expiredFailure();
    task.managed = true;
    task.expiresAt = this.now() + this.idleMs;
    return task;
  }
  /** 当前队列的租约令牌只供服务端路由取消在途任务，不进入普通状态快照。 */
  currentToken(key) {
    this.prune();
    return this.tasks.get(key)?.token || '';
  }
  /** 按 Key 取消当前与全部等待项；用于同一工坊跨标签页的明确取消。 */
  cancelAll(key) {
    this.prune();
    const tokens = [this.currentToken(key), ...(this.waiting.get(key) || []).map(task => task.token)].filter(Boolean);
    for (const token of tokens) {
      try { this.cancel(key, token); } catch { /* 已被其他入口取消的项不重复建立终态。 */ }
    }
    return { cancelled: tokens.length, ...this.snapshot(key) };
  }
  // 明确取消某个 token；未知 token 报过期且不建立墓碑，不影响其他任务。在途与待保存图片不提前放行。
  cancel(key, token) {
    this.prune();
    const paused = Boolean(this.queues.get(key)?.paused);
    if (this.isCancelled(key, token)) return { cancelled: true, position: 0, paused };
    const task = this.tasks.get(key);
    if (task?.token === token) {
      this.rememberCancelled(key, token);
      task.cancelled = true;
      if (!task.inFlight && task.phase !== 'saving') { this.tasks.delete(key); this.promote(key); }
      return { cancelled: true, position: 0, paused };
    }
    const queue = this.waiting.get(key);
    const index = queue?.findIndex(candidate => candidate.token === token) ?? -1;
    if (index >= 0) {
      queue.splice(index, 1);
      if (queue.length) this.waiting.set(key, queue); else this.waiting.delete(key);
      this.rememberCancelled(key, token);
      return { cancelled: true, position: 0, paused };
    }
    throw expiredFailure();
  }
  renew(key, token, completed, prepare = false) {
    const status = this.status(key, token);
    const task = status.position === 0 ? this.owned(key, token) : this.waiting.get(key)[status.position - 1];
    if (completed !== undefined) {
      if (status.position !== 0 || !Number.isSafeInteger(completed) || completed < task.completed || completed > task.count) throw failure('生成进度无效', 'invalid_generation_progress', 400);
      const state = this.queues.get(key) || { completed: 0, paused: false };
      if (completed > task.completed) state.lastFinishedAt = this.now();
      state.completed += completed - task.completed;
      task.completed = completed; task.phase = 'idle';
      this.queues.set(key, state);
    }
    task.expiresAt = this.now() + this.idleMs;
    if (completed !== undefined) this.yield(key);
    // 额度检查与请求前处理已属于这张图片，普通心跳不能抢占准备中的执行位。
    else if (prepare && status.position === 0 && !status.paused && !this.waitMs(key)) task.phase = 'preparing';
    return this.status(key, token);
  }
  release(key, token) {
    const task = this.current(key);
    if (!task || task.token !== token) {
      const queue = this.waiting.get(key)?.filter(task => task.token !== token);
      if (queue?.length) this.waiting.set(key, queue); else this.waiting.delete(key);
      return;
    }
    if (task.inFlight) task.releasing = true;
    else { this.tasks.delete(key); this.promote(key); }
  }
  enter(key, token) {
    if (this.queues.get(key)?.paused) throw failure('生成队列已暂停', 'generation_paused');
    const standalone = !token;
    if (token && this.status(key, token).position > 0) throw failure('此任务仍在排队，不能提前生成', 'generation_waiting');
    const task = standalone ? this.reserve(key, crypto.randomUUID()) : this.owned(key, token);
    if (task.inFlight) throw failure('此 Key 正在生成，请等待当前任务完成', 'generation_busy');
    if (this.waitMs(key)) {
      if (standalone) this.release(key, task.token);
      throw failure('请等待生成间隔结束后再生成', 'generation_interval');
    }
    task.inFlight = true;
    task.phase = 'generating';
    const confirmedAtEntry = task.completed;
    return () => {
      if (this.tasks.get(key) !== task) return;
      task.inFlight = false;
      const state = this.queues.get(key);
      task.expiresAt = this.now() + this.idleMs;
      // 保存确认（renew completed）已经为下一张起算间隔时，收尾不能再覆盖该时刻。
      const saveConfirmed = task.completed > confirmedAtEntry;
      if (!saveConfirmed) state.lastFinishedAt = this.now();
      if (standalone || task.releasing || task.cancelled) { this.tasks.delete(key); this.promote(key); return; }
      // 收图后仍等保存确认才交接；但若保存回执已经先到（后台 runner 先 renew），不能退回 saving 造成虚假暂停。
      if (!saveConfirmed) task.phase = 'saving';
      this.yield(key);
    };
  }
}
