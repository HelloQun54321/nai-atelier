import type { LocalGenItem } from '../types';
import { composeImageEditResult } from '../services/imageEdit';
import { GenerationJobs } from '../worker/generationJobs.mjs';
import type { GenerationJobDescriptor, GenerationJobOutput } from '../worker/generationJobs.mjs';
import type { GenerationTasks } from '../worker/generationTasks.mjs';
import type { CloudQueueCoordinator } from 'mobile:gateway';
import {
  cacheNovelAiSubscription, estimateNovelAiGenerationCost,
  keyHashFromAuthorization, sanitizeNovelAiSubscription, isSubscriptionUnsupported,
} from 'mobile:gateway';
import { generationHistoryForm, generationImageBytes, readGenerationResponse } from 'mobile:generation-output';
import { bytesToBase64, native } from './native';
import { createGenerationJobHandler, normalizedBillingPayload } from './generationJobModel';

interface MobileGenerationContext { authorization: string }

/** 手机成图：回贴后统一交付 PNG；ZIP／流式的真实字节与预估费用原样保留。 */
interface MobileGenerationOutput extends GenerationJobOutput { bytes: Uint8Array; mime: string }

interface NaiSubscriptionSnapshot { tier?: number; active?: boolean; usage?: { isNegative?: boolean } }

// 订阅快照按 Key 原样保存在运行进程内；普通生成复用前台已刷新的快照，不额外联网。
const subscriptions = new Map<string, NaiSubscriptionSnapshot>();

/** 前台额度刷新与后台额度核实共用同一快照，结算与估算不会各用一套数值。 */
export const rememberNaiSubscription = (authorization: string, subscription: NaiSubscriptionSnapshot | null) => {
  if (subscription) subscriptions.set(authorization, subscription);
  else subscriptions.delete(authorization);
  cacheNovelAiSubscription(authorization, subscription);
};

const historyError = (message: string, code: string, status: number, preview?: unknown) =>
  Object.assign(new Error(message), { code, status, ...(preview ? { preview } : {}) });

/** 图片原料按既有校验转成真实 Blob；回贴只消费原图、蒙版与聚焦几何。 */
const compositionBlob = (value: string) => {
  const image = generationImageBytes(value);
  return new Blob([image.bytes as BlobPart], { type: image.mime });
};

const composeMobileEditResult = async (output: MobileGenerationOutput, composition: NonNullable<GenerationJobDescriptor['composition']>) => {
  const composed = await composeImageEditResult(
    new Blob([output.bytes as BlobPart], { type: output.mime || 'image/png' }),
    {
      originalImage: compositionBlob(composition.originalImage),
      compositeMask: compositionBlob(composition.compositeMask),
      ...(composition.focusedGeometry ? { focusedGeometry: composition.focusedGeometry } : {}),
    },
  );
  return new Uint8Array(await composed.arrayBuffer());
};

export function createMobileGenerationJobs({ tasks, queue, readGatewayUrl }: {
  tasks: GenerationTasks; queue: CloudQueueCoordinator; readGatewayUrl: (authorization: string) => Promise<string>;
}) {
  const jobs = new GenerationJobs<MobileGenerationContext, MobileGenerationOutput>({
    tasks,
    readQueue: job => job.lastQueueTaskId ? queue.get(job.key, job.lastQueueTaskId) : null,
    readCleanup: job => (job.lastQueueTaskId ? queue.get(job.key, job.lastQueueTaskId)?.cleanupError : undefined),
    validate: descriptor => {
      if (descriptor.composition) {
        generationImageBytes(descriptor.composition.originalImage);
        generationImageBytes(descriptor.composition.compositeMask);
        const crop = descriptor.composition.focusedGeometry?.crop;
        if (crop && ![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)) {
          throw historyError('后台任务回贴选区无效', 'invalid_generation_job', 400);
        }
      }
      if (descriptor.editMask) generationImageBytes(descriptor.editMask);
    },
    // 生图复用同一手机网关处理器：公共队列、计费与单并发准入只有一份实现。
    generate: async (job, payload, onPreview) => {
      const queueTaskId = job.lastQueueTaskId = crypto.randomUUID();
      const response = await fetch(`/api/generate${job.descriptor.stream ? '-stream' : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: job.context.authorization,
          'X-Nai-Generation-Task': job.token,
          'X-Nai-Queue-Task-Id': queueTaskId,
        },
        body: JSON.stringify(payload),
      });
      const output = await readGenerationResponse(response, onPreview);
      return { ...output, queueTaskId };
    },
    // 保存复用既有 history multipart 接口；缩略图与索引由该接口维护，不另建手机存储结构。
    save: async (job, output, metadata) => {
      let image = { bytes: output.bytes, mime: output.mime };
      try {
        if (job.descriptor.composition) image = { bytes: await composeMobileEditResult(output, job.descriptor.composition), mime: 'image/png' };
        const response = await fetch('/api/local-history', {
          method: 'POST', body: generationHistoryForm(image, metadata, job.descriptor.editMask),
          signal: AbortSignal.timeout(30_000),
        });
        // 回执结构由既有 history 路由维护，与前端保存使用同一份 LocalGenItem 语义。
        const saved = await response.json() as { error?: string; item?: LocalGenItem };
        if (!response.ok || !saved?.item?.id || !saved.item.imageUrl) throw new Error(saved?.error || '手机历史保存失败');
        return saved.item;
      } catch (cause) {
        // 保留未落库产物供发起页下载；绝不把保存失败改成再次生图。
        throw historyError(
          `图片已生成，但历史保存失败：${cause instanceof Error ? cause.message : String(cause)}`,
          'history_save_failed', 500,
          { image: `data:${image.mime};base64,${bytesToBase64(image.bytes)}` },
        );
      }
    },
    estimate: async (job, fresh) => {
      const authorization = job.context.authorization;
      let subscriptionUnsupported = false;
      if (fresh) {
        try {
          const gatewayUrl = await readGatewayUrl(authorization);
          const response = await fetch('/api/novelai-subscription', { headers: { Authorization: authorization }, signal: AbortSignal.timeout(30_000) });
          if (isSubscriptionUnsupported(gatewayUrl, response.status)) {
            subscriptionUnsupported = true;
            rememberNaiSubscription(authorization, null);
          } else if (!response.ok) throw new Error('账号额度刷新失败');
          else rememberNaiSubscription(authorization, sanitizeNovelAiSubscription(await response.json(), gatewayUrl));
        } catch {
          throw historyError('无法核实当前额度，已停止后续生成', 'quota_refresh_failed', 503);
        }
      }
      const subscription = subscriptions.get(authorization);
      // 普通单张没有近期快照时沿用用户已确认的费用，不附加联网门禁。
      if (!subscription && !fresh) return job.approvedCost;
      if (!subscription && !subscriptionUnsupported) throw historyError('无法核实当前额度，已停止后续生成', 'quota_refresh_failed', 503);
      return estimateNovelAiGenerationCost(
        normalizedBillingPayload(job.descriptor.payload),
        subscription?.usage?.isNegative === true,
        subscription?.active === true && Number(subscription.tier) >= 3,
      );
    },
  });
  return {
    jobs,
    close: () => jobs.close(),
    handle: createGenerationJobHandler({
      jobs,
      keyOf: keyHashFromAuthorization,
      contextOf: request => ({ authorization: request.headers.get('authorization') || '' }),
      // 每个后台任务单独保活：等待、请求间隔、图片处理与保存都算在该任务全程内；标识含 Key 指纹，跨 Key 不共用。
      retain: id => native.backgroundJob({ action: 'retain', id }),
      release: id => native.backgroundJob({ action: 'release', id }),
    }),
  };
}
