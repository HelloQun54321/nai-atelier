
const terminal = state => ['succeeded', 'cancelled', 'failed'].includes(state);
const failure = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const index = (key, token) => `${key}:${token}`;

/** 配置与凭据仅在运行设备进程内存中托管；重启不恢复，不允许自动付费重试。 */
export class GenerationJobs {
  constructor({ tasks, generate, save, estimate, validate, readCleanup, readQueue, now = Date.now, sleep = wait, terminalMs = 300_000, terminalLimit = 256 }) {
    this.tasks = tasks;
    this.generate = generate;
    this.save = save;
    this.estimate = estimate;
    this.validate = validate;
    this.readCleanup = readCleanup;
    this.readQueue = readQueue;
    this.now = now;
    this.sleep = sleep;
    this.terminalMs = terminalMs;
    this.terminalLimit = terminalLimit;
    this.jobs = new Map();
    this.closed = false;
  }
  prune() {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (!terminal(job.state)) continue;
      // 未被前端收取的终态回执不能因页面冻结超过五分钟而丢失；图片预览另行限时释放。
      if (job.preview && this.now() - job.finishedAt > this.terminalMs) { job.preview = undefined; job.previewVersion++; }
      if (job.observedAt !== undefined && this.now() - job.observedAt > this.terminalMs) this.jobs.delete(id);
      else count++;
    }
    if (count > this.terminalLimit) for (const [id, job] of this.jobs) {
      if (terminal(job.state)) { this.jobs.delete(id); if (--count <= this.terminalLimit) break; }
    }
  }
  get(key, token) {
    this.prune();
    const job = this.jobs.get(index(key, token));
    if (!job) throw failure('生成任务不存在或已结束，请查看历史', 'generation_job_not_found', 404);
    return job;
  }
  has(key, token) { this.prune(); return this.jobs.has(index(key, token)); }
  subscribe(job, listener) {
    job.listeners ||= new Set();
    job.listeners.add(listener);
    return () => { job.listeners.delete(listener); };
  }
  notify(job) {
    if (!job.listeners?.size) return;
    const snapshot = this.snapshot(job, undefined, false);
    for (const listener of job.listeners) {
      try { listener(snapshot); } catch { job.listeners.delete(listener); }
    }
  }
  snapshot(job, previewVersion, observed = true) {
    if (observed && terminal(job.state) && job.observedAt === undefined) {
      job.observedAt = this.now();
      setTimeout(() => this.prune(), this.terminalMs + 1).unref?.();
    }
    let position, paused = false;
    if (!terminal(job.state)) {
      try {
        const status = this.tasks.status(job.key, job.token);
        position = status.position; paused = status.paused;
      } catch { /* 终态由执行循环收束，不用一次观察覆盖真实执行回执。 */ }
    }
    const state = !terminal(job.state) && !['generating', 'saving', 'awaiting_confirmation'].includes(job.state)
      ? paused ? 'paused' : position > 0 ? 'waiting' : job.state
      : job.state;
    const queue = this.readQueue?.(job);
    return {
      token: job.token, state, completedCount: job.historyIds.length, requestedCount: job.count,
      // 只传展示与取消所需信息，后台控制器、Key 指纹等内部字段留在运行设备。
      cloudQueue: queue ? {
        taskId: queue.taskId, phase: queue.phase, position: queue.position, queueSize: queue.queueSize,
        greeting: queue.greeting, cancelable: queue.cancelable, proxy: queue.proxy,
        error: queue.error, cleanupError: queue.cleanupError,
      } : null,
      historyIds: [...job.historyIds], ...(position === undefined ? {} : { position }),
      ...(job.lastSavedItem ? { lastSavedItem: job.lastSavedItem } : {}),
      previewVersion: job.previewVersion,
      ...(job.preview && String(previewVersion) !== String(job.previewVersion) ? { preview: job.preview } : {}),
      ...(job.error ? { error: job.error, code: job.code } : {}),
      ...(job.cost === undefined ? {} : { cost: job.cost }),
      ...(job.accountingFailed ? { accountingFailed: true } : {}),
      ...(job.accountingError ? { accountingError: job.accountingError } : {}),
      ...(job.cleanupError ? { cleanupError: job.cleanupError } : {}),
    };
  }
  start(key, token, count, placement, descriptor, context) {
    this.prune();
    if (this.closed) throw failure('工坊正在关闭，请稍后再试', 'generation_backend_stopping', 503);
    if (!key) throw failure('缺少 NovelAI API Key', 'missing_key', 401);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(token || '')) throw failure('生成任务标识无效', 'invalid_generation_task');
    const prior = this.jobs.get(index(key, token));
    if (prior) return this.snapshot(prior);
    if (!Number.isSafeInteger(count) || count < 1) throw failure('生成张数无效', 'invalid_generation_count');
    const sequence = descriptor?.sequence;
    if (sequence !== undefined && (!Array.isArray(sequence) || sequence.length !== count || !sequence.length || sequence.length > 24)) throw failure('后台任务配方数量无效', 'invalid_generation_job');
    for (const entry of [descriptor, ...(sequence || [])]) {
      const payload = entry?.payload, history = entry?.history;
      if (!payload || !['generate', 'img2img', 'infill'].includes(payload.action) || typeof payload.model !== 'string' || !payload.parameters || payload.parameters.n_samples !== 1 || !history || typeof history.prompt !== 'string' || !history.params || !Number.isFinite(entry.approvedCost) || entry.approvedCost < 0 || (entry !== descriptor && entry.sequence !== undefined)) throw failure('后台任务配置无效', 'invalid_generation_job');
      this.validate(entry);
    }
    if (placement) this.tasks.enqueue(key, token, placement, count); else this.tasks.reserve(key, token, count);
    this.tasks.manage(key, token);
    const job = { key, token, count, placement, descriptor, sequence, context, state: 'waiting', historyIds: [], previewVersion: 0, approvedCost: descriptor.approvedCost, cancelled: false };
    this.jobs.set(index(key, token), job);
    job.running = this.run(job);
    return this.snapshot(job);
  }
  cancel(key, token) {
    const job = this.get(key, token);
    if (terminal(job.state)) return this.snapshot(job);
    job.cancelled = true;
    return this.snapshot(job);
  }
  approve(key, token, approvedCost) {
    const job = this.get(key, token);
    if (job.state !== 'awaiting_confirmation' || !Number.isFinite(approvedCost) || approvedCost < job.cost) throw failure('请重新确认当前剩余任务的费用', 'generation_confirmation_required', 409);
    job.approvedCost = approvedCost;
    job.state = 'waiting';
    return this.snapshot(job);
  }
  async run(job) {
    try {
      while (job.historyIds.length < job.count) {
        if (job.cancelled) break;
        if (job.sequence) job.descriptor = job.sequence[job.historyIds.length];
        if (job.state === 'awaiting_confirmation') { await this.sleep(250); continue; }
        const status = this.tasks.status(job.key, job.token), current = this.tasks.current(job.key);
        if (status.paused || status.position > 0 || status.waitMs > 0 || current?.inFlight) {
          job.state = status.paused ? 'paused' : 'waiting';
          await this.sleep(status.waitMs > 0 ? Math.min(status.waitMs, 250) : 250);
          continue;
        }
        this.tasks.renew(job.key, job.token, undefined, true);
        job.state = 'preparing';
        const cost = await this.estimate(job, Boolean(job.placement) || job.count > 1 || job.historyIds.length > 0 || job.needsRefresh);
        job.needsRefresh = false;
        if (job.cancelled) break;
        if (!Number.isFinite(cost) || cost < 0) throw failure('无法核实当前额度，已停止后续生成', 'quota_refresh_failed', 503);
        if (cost > job.approvedCost && job.descriptor.autoApproveCost !== true) {
          job.cost = cost;
          job.state = 'awaiting_confirmation';
          // 保留当前执行位等待本任务授权，不改写用户/其他客户端的全局暂停状态。
          continue;
        }
        // 准备期间也可能被另一入口暂停；不提交任何未经准入的生图请求。
        const ready = this.tasks.status(job.key, job.token);
        if (ready.paused || ready.position > 0 || ready.waitMs > 0) {
          job.state = ready.paused ? 'paused' : 'waiting';
          job.needsRefresh = true;
          await this.sleep(250);
          continue;
        }
        const payload = { ...job.descriptor.payload, parameters: { ...job.descriptor.payload.parameters } };
        if (job.descriptor.randomSeed) {
          const seed = crypto.getRandomValues(new Uint32Array(1))[0];
          payload.parameters.seed = seed;
          if (payload.action !== 'generate') payload.parameters.extra_noise_seed = seed - 1;
        }
        job.preview = undefined;
        job.previewVersion++;
        job.state = 'generating';
        let output, saving;
        const startSaving = finalOutput => {
          if (saving) return;
          output = finalOutput;
          job.state = 'saving';
          this.notify(job);
          const seed = finalOutput.seed ?? payload.parameters.seed;
          const history = {
            ...job.descriptor.history, id: crypto.randomUUID(), createdAt: this.now(), isFavorite: false,
            params: { ...job.descriptor.history.params, ...(seed === undefined ? {} : { seed }) },
            ...(job.descriptor.history.edit ? { edit: { ...job.descriptor.history.edit, estimatedCost: finalOutput.estimatedCost ?? cost, settlementStatus: 'estimated' } } : {}),
          };
          // 立即接住保存失败，仍等待生成链路收齐记账及公共队列回执。
          saving = Promise.resolve().then(() => this.save(job, finalOutput, history)).then(item => {
            if (!item?.id || !item.imageUrl) throw failure('图片已生成，但历史保存回执无效，已停止后续生成', 'history_save_failed', 500);
            return { item };
          }).catch(error => ({ error }));
        };
        try {
          output = await this.generate(job, payload, preview => { job.preview = preview; job.previewVersion++; this.notify(job); }, startSaving);
        } catch (error) {
          // 完整成图后必须等保存落定，收尾异常不能触发再次生成。
          if (saving) {
            job.cleanupError ||= error.message || '图片已收齐，但生成连接收尾失败';
            job.accountingFailed = true;
            job.accountingError ||= '图片已收齐，但未收到完整本地记账回执';
          }
          else {
            // 只有后端明确在上游提交前拒绝的调度回执可以等待，不重试失败的真实生图。
            if (error.status === 409 && ['generation_paused', 'generation_waiting', 'generation_interval'].includes(error.code)) { job.needsRefresh = true; await this.sleep(250); continue; }
            throw error;
          }
        }
        job.accountingFailed ||= output.accountingFailed;
        job.accountingError ||= output.accountingError;
        job.cleanupError ||= output.cleanupError;
        // ZIP 与未使用 final 回调的适配器沿用返回后保存。
        startSaving(output);
        const { item, error: saveError } = await saving;
        job.lastQueueTaskId = output.queueTaskId;
        while (this.tasks.current(job.key)?.token === job.token && this.tasks.current(job.key).inFlight) await this.sleep(50);
        job.cleanupError ||= this.readCleanup(job);
        if (saveError) throw saveError;
        job.historyIds.push(item.id);
        job.lastSavedItem = item;
        job.preview = undefined;
        job.previewVersion++;
        this.notify(job);
        this.tasks.renew(job.key, job.token, job.historyIds.length);
        job.state = 'waiting';
      }
      job.state = job.cancelled ? 'cancelled' : 'succeeded';
      if (job.cancelled) { job.error = '已取消后续生成，已提交的图片仍已保存'; job.code = 'generation_cancelled'; }
    } catch (error) {
      const saving = job.state === 'saving';
      job.state = !saving && (error.code === 'generation_cancelled' || job.cancelled) ? 'cancelled' : 'failed';
      job.error = error.message || '后台生成失败';
      job.code = job.state === 'cancelled' ? 'generation_cancelled' : saving ? 'history_save_failed' : error.code || 'generation_failed';
      if (error.preview) { job.preview = error.preview; job.previewVersion++; }
    } finally {
      // 公共清理可能晚于图片交付；不要因任务结束抢先放开它仍持有的单并发锁。
      if (job.cancelled) this.tasks.cancel(job.key, job.token); else this.tasks.release(job.key, job.token);
      job.finishedAt = this.now();
      job.descriptor = undefined;
      job.sequence = undefined;
      job.context = undefined;
      if (job.state !== 'failed') { job.preview = undefined; job.previewVersion++; }
      this.notify(job);
      setTimeout(() => this.prune(), this.terminalMs + 1).unref?.();
    }
  }
  close() {
    this.closed = true;
    for (const job of this.jobs.values()) if (!terminal(job.state)) job.cancelled = true;
  }
}

/** 观察连接只推送任务回执；断开不会取消生成、回贴或保存。电脑与独立手机共用。 */
export function generationJobEventResponse(jobs, job, previewVersion, signal) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false, timer, version = previewVersion;
      const close = () => {
        if (closed) return;
        stop();
        controller.close();
      };
      stop = () => {
        closed = true;
        clearInterval(timer);
        unsubscribe();
        signal?.removeEventListener('abort', close);
      };
      const send = snapshot => {
        if (closed) return;
        const next = { ...snapshot };
        if (String(version) === String(next.previewVersion)) delete next.preview;
        version = next.previewVersion;
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(next)}\n\n`));
        if (terminal(next.state)) close();
      };
      const unsubscribe = jobs.subscribe(job, send);
      signal?.addEventListener('abort', close, { once: true });
      if (signal?.aborted) { close(); return; }
      // 推送入缓冲不等于页面已收取终态，冻结的手机回来后仍能通过 GET 补查。
      send(jobs.snapshot(job, version, false));
      // 排队、暂停及费用状态沿用一秒观察；每个预览回调立即推送，不等待定时器。
      if (!closed) timer = setInterval(() => send(jobs.snapshot(job, version, false)), 1_000);
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
