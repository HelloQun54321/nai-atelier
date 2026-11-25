import type { GenerationJobDescriptor, GenerationJobOutput, GenerationJobs } from '../worker/generationJobs.mjs';
import { generationJobEventResponse } from '../worker/generationJobs.mjs';
import { getRuntimeNaiModelInfo } from '../services/naiModels';
import { filterEffectiveCharacterReferences } from '../services/preciseReferenceProtocol.mjs';
import type { GenerationPlacement } from '../services/generationTask';
import { json } from '../worker/routes/types';

/** 后台任务请求上限：与电脑网关一致，容纳一次预处理后的底图与蒙版。 */
export const GENERATION_JOB_REQUEST_LIMIT = 60 * 1024 * 1024;

const objectOf = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const failure = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });

/** 网关错误响应：结构化 code 与调度结果一并回给前端，不吞掉真实撤回原因。 */
export const generationJobErrorResponse = (cause: unknown) => {
  if (!objectOf(cause)) return json({ error: '后台任务请求失败' }, 500);
  return json({
    error: typeof cause.message === 'string' && cause.message ? cause.message : '后台任务请求失败',
    code: typeof cause.code === 'string' ? cause.code : undefined,
    ...(typeof cause.outcome === 'string' && cause.outcome ? { outcome: cause.outcome } : {}),
  }, typeof cause.status === 'number' && Number.isFinite(cause.status) ? cause.status : 500);
};

/** 已确认有限任务只传一次描述；此处只做结构性准入，深层规则仍由共享 GenerationJobs 裁决。 */
export const parseGenerationJobBody = (raw: string): GenerationJobDescriptor => {
  if (raw.length > GENERATION_JOB_REQUEST_LIMIT) throw failure('后台任务内容过大', 'invalid_generation_job', 413);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw failure('后台任务配置不是有效 JSON', 'invalid_generation_job'); }
  if (!objectOf(parsed) || !objectOf(parsed.payload) || !objectOf(parsed.history)
    || typeof parsed.approvedCost !== 'number' || !Number.isFinite(parsed.approvedCost) || parsed.approvedCost < 0) {
    throw failure('后台任务配置无效', 'invalid_generation_job');
  }
  const composition = parsed.composition;
  return {
    // 结构存在性已在上方收窄；payload／history 的字段语义由共享 GenerationJobs 与后台任务 validate 收束。
    payload: parsed.payload as unknown as GenerationJobDescriptor['payload'],
    history: parsed.history as unknown as GenerationJobDescriptor['history'],
    ...(objectOf(composition) ? {
      composition: {
        originalImage: String(composition.originalImage ?? ''),
        compositeMask: String(composition.compositeMask ?? ''),
        // 回贴几何由前台一次性预处理；后台 validate 复核选区边界，此处不再重算。
        ...(objectOf(composition.focusedGeometry)
          ? { focusedGeometry: composition.focusedGeometry as unknown as NonNullable<GenerationJobDescriptor['composition']>['focusedGeometry'] }
          : {}),
      },
    } : {}),
    ...(typeof parsed.editMask === 'string' && parsed.editMask ? { editMask: parsed.editMask } : {}),
    randomSeed: parsed.randomSeed === true,
    stream: parsed.stream === true,
    approvedCost: parsed.approvedCost,
    ...(parsed.autoApproveCost === true ? { autoApproveCost: true } : {}),
    ...(parsed.sequence !== undefined ? { sequence: parsed.sequence as GenerationJobDescriptor[] } : {}),
  };
};

// GET 用查询串标识任务；其余动作沿用任务头，避免任务标识进入地址与日志。
export const generationJobToken = (request: Request, url: URL) =>
  String(request.headers.get('x-nai-generation-task') || url.searchParams.get('token') || '');

export const generationJobCount = (request: Request) => {
  const header = request.headers.get('x-nai-generation-count');
  return header === null ? 1 : Number(header);
};

export const generationJobPlacement = (request: Request): GenerationPlacement | undefined => {
  const header = request.headers.get('x-nai-generation-placement');
  if (header === 'end' || header === 'next') return header;
  if (header === null) return undefined;
  throw failure('排队位置无效', 'invalid_generation_queue');
};

/** 费用估算交给同一后端计费函数；本地 Vibe／角色参考尚未展开为请求字段，按数量补齐。 */
export const normalizedBillingPayload = (payload: GenerationJobDescriptor['payload']) => {
  const parameters: Record<string, unknown> = { ...payload?.parameters };
  const vibes = parameters._local_vibes as { enabled?: boolean; slots?: unknown[] } | undefined;
  const references = parameters._local_character_references as { enabled?: boolean; slots?: Array<{ type?: string }> } | undefined;
  if (vibes?.enabled && Array.isArray(vibes.slots)) parameters.reference_image_multiple_cached = vibes.slots;
  if (references?.enabled && Array.isArray(references.slots)) {
    const effective = filterEffectiveCharacterReferences(
      references.slots,
      getRuntimeNaiModelInfo(payload?.model),
      Boolean(parameters.mask) || payload?.action === 'infill',
    );
    if (effective.length) parameters.director_reference_images_cached = effective;
  }
  return { ...payload, parameters };
};

export interface GenerationJobHandlerOptions<Context, Output extends GenerationJobOutput> {
  jobs: Pick<GenerationJobs<Context, Output>, 'has' | 'get' | 'snapshot' | 'subscribe' | 'start' | 'cancel' | 'approve'>;
  keyOf: (authorization: string) => string;
  contextOf: (request: Request) => Context;
  /**
   * 每个后台任务开始／结束各一次；终态后立即放开，不做常驻服务。
   * 标识必须是 Key 指纹与任务标识的组合：同一 token 在不同 Key 下是两份任务，不能共用保活。
   */
  retain: (id: string) => unknown;
  release: (id: string) => unknown;
}

/** 保活标识与任务索引同源：Key 指纹 + 任务标识，跨 Key 的同名 token 互不干扰。 */
export const generationJobRetainId = (key: string, token: string) => `${key}\u0000${token}`;

/**
 * 后台任务唯一的 HTTP 入口：POST 提交、GET 观察、DELETE 取消、PATCH 补充授权。
 * 同一 token 重复投递只观察原任务；关闭页面不能中断已付费图片的保存。
 */
export const createGenerationJobHandler = <Context, Output extends GenerationJobOutput>({
  jobs, keyOf, contextOf, retain, release,
}: GenerationJobHandlerOptions<Context, Output>) => {
  const retained = new Set<string>();
  const releaseJob = (key: string, token: string) => {
    const id = generationJobRetainId(key, token);
    if (!retained.delete(id)) return;
    try { void Promise.resolve(release(id)).catch(() => { /* 保活释放失败由系统回收，不影响任务终态。 */ }); } catch { /* 同上。 */ }
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const token = generationJobToken(request, url);
    try {
      const key = keyOf(request.headers.get('authorization') || '');
      if (!key) return json({ error: '缺少 NovelAI API Key', code: 'missing_key' }, 401);
      if (request.method === 'GET') {
        const job = jobs.get(key, token), version = url.searchParams.get('previewVersion');
        return url.searchParams.get('events') === '1'
          ? generationJobEventResponse(jobs, job, version, request.signal)
          : json(jobs.snapshot(job, version));
      }
      if (request.method === 'DELETE') return json(jobs.cancel(key, token));
      if (request.method === 'PATCH') {
        let parsed: unknown;
        try { parsed = JSON.parse(await request.text() || '{}'); } catch { parsed = undefined; }
        return json(jobs.approve(key, token, objectOf(parsed) && typeof parsed.approvedCost === 'number' ? parsed.approvedCost : Number.NaN));
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      // 重复投递仍读完请求体，避免长连接残留；随后只观察原任务，不重复生图或重复保活。
      const raw = await request.text();
      if (jobs.has(key, token)) return json(jobs.snapshot(jobs.get(key, token)));
      const descriptor = parseGenerationJobBody(raw);
      const count = generationJobCount(request);
      const placement = generationJobPlacement(request);
      const index = generationJobRetainId(key, token);
      if (!retained.has(index)) {
        retained.add(index);
        try { await retain(index); } catch {
          releaseJob(key, token);
          throw failure('系统未允许后台生成，请回到前台后再试', 'generation_background_unavailable', 409);
        }
      }
      const startJob = () => {
        try { return jobs.start(key, token, count, placement, descriptor, contextOf(request)); }
        catch (cause) { releaseJob(key, token); throw cause; }
      };
      const snapshot = startJob();
      // 终态（成功／取消／失败）即释放保活；取消也要等已提交图片保存完成。
      if (jobs.has(key, token)) void Promise.resolve(jobs.get(key, token).running).catch(() => {}).finally(() => releaseJob(key, token));
      else releaseJob(key, token);
      return json(snapshot);
    } catch (cause) { return generationJobErrorResponse(cause); }
  };
};
