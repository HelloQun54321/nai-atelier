import { GenerationJobs, generationJobEventResponse } from '../worker/generationJobs.mjs';
import { generationImageBytes, readGenerationResponse, composeGenerationOutput, generationHistoryForm } from './generation-output.mjs';

const REQUEST_LIMIT = 60 * 1024 * 1024;
const error = (message, code, status) => Object.assign(new Error(message), { code, status });

/** 通过同一电脑网关生图、既有 Worker 历史接口保存，不另建存储或绕过准入。 */
export function createDesktopGenerationJobs({ tasks, gatewayUrl, workerPort, estimate, readCleanup, readQueue }) {
  return new GenerationJobs({
    tasks, estimate, readCleanup, readQueue,
    validate: descriptor => {
      if (descriptor.composition) {
        generationImageBytes(descriptor.composition.originalImage);
        generationImageBytes(descriptor.composition.compositeMask);
      }
      if (descriptor.editMask) generationImageBytes(descriptor.editMask);
    },
    generate: async (job, payload, onPreview, onFinal) => {
      const queueTaskId = job.lastQueueTaskId = crypto.randomUUID();
      const response = await fetch(`${gatewayUrl()}/api/generate${job.descriptor.stream ? '-stream' : ''}`, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: job.context.authorization,
          'X-Nai-Generation-Task': job.token, 'X-Nai-Queue-Task-Id': queueTaskId,
          'X-Nai-Generation-Response': 'events',
          cookie: job.context.cookie,
        }, body: JSON.stringify(payload),
      });
      const output = await readGenerationResponse(response, onPreview, output => onFinal({ ...output, queueTaskId }));
      return { ...output, queueTaskId };
    },
    save: async (job, output, metadata) => {
      let image = { bytes: output.bytes, mime: output.mime };
      try {
        const composed = await composeGenerationOutput(output.bytes, job.descriptor.composition);
        image = { bytes: composed.bytes, mime: composed.mime || output.mime };
        const response = await fetch(`http://127.0.0.1:${workerPort}/api/local-history`, {
          method: 'POST', headers: {
            cookie: job.context.cookie, host: job.context.host, Connection: 'close',
            'x-forwarded-for': job.context.ip, 'x-nai-client-ip': job.context.ip,
          }, body: generationHistoryForm(image, metadata, job.descriptor.editMask), signal: AbortSignal.timeout(30_000),
        });
        const saved = await response.json();
        if (!response.ok || !saved?.item?.id || !saved.item.imageUrl) throw error(saved?.error || '电脑历史保存失败', 'history_save_failed', response.status);
        return saved.item;
      } catch (cause) {
        // 保留未落库产物供发起页下载；绝不把保存失败改成再次生图。
        throw Object.assign(error(`图片已生成，但历史保存失败：${cause.message}`, 'history_save_failed', 500), { preview: { image: `data:${image.mime};base64,${image.bytes.toString('base64')}` } });
      }
    },
  });
}

export async function handleGenerationJobRequest(req, res, jobs, { allowed, keyHash, readBody, sendJson, host, ip }) {
  if (!allowed(req)) return sendJson(res, 401, { error: '需要局域网访问密码', code: 'LAN_ACCESS_REQUIRED' });
  const key = keyHash(req);
  if (!key) return sendJson(res, 401, { error: '缺少 NovelAI API Key', code: 'missing_key' });
  const url = new URL(req.url, 'http://localhost');
  const token = String(req.headers['x-nai-generation-task'] || url.searchParams.get('token') || '');
  try {
    if (req.method === 'GET') {
      const job = jobs.get(key, token), version = url.searchParams.get('previewVersion');
      if (url.searchParams.get('events') !== '1') return sendJson(res, 200, jobs.snapshot(job, version));
      const controller = new AbortController(), close = () => controller.abort();
      const response = generationJobEventResponse(jobs, job, version, controller.signal);
      res.on('close', close);
      res.writeHead(200, Object.fromEntries(response.headers));
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || res.destroyed) break;
          res.write(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        res.off('close', close);
        if (!res.destroyed) res.end();
      }
      return;
    }
    if (req.method === 'DELETE') return sendJson(res, 200, jobs.cancel(key, token));
    if (req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req, 4096)).toString('utf8'));
      return sendJson(res, 200, jobs.approve(key, token, body.approvedCost));
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    // 重复投递只能观察原任务；仍读完 body，避免长连接残留请求体。
    const raw = await readBody(req, REQUEST_LIMIT);
    if (jobs.has(key, token)) return sendJson(res, 200, jobs.snapshot(jobs.get(key, token)));
    let descriptor;
    try { descriptor = JSON.parse(raw.toString('utf8')); } catch { throw error('后台任务配置不是有效 JSON', 'invalid_generation_job', 400); }
    const count = Number(req.headers['x-nai-generation-count'] ?? 1);
    const placement = req.headers['x-nai-generation-placement'];
    const context = { authorization: String(req.headers.authorization), cookie: String(req.headers.cookie || ''), host: host(req), ip: ip(req) };
    return sendJson(res, 200, jobs.start(key, token, count, placement, descriptor, context));
  } catch (cause) {
    return sendJson(res, cause.status || 500, { error: cause.message || '后台任务请求失败', code: cause.code, ...(cause.outcome ? { outcome: cause.outcome } : {}) });
  }
}
