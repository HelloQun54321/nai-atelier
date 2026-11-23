import { t } from './i18n';
import { isCloudQueueTaskActive, type CloudQueueStatus } from './cloudQueue';
import type { GenerationJobStage, GenerationJobState } from './generationJob';
import type { GenerationSeriesProgress } from './generationSeries';
import type { GenerationQueueSnapshot } from './generationTask';

export type GenerationStatusIcon = 'image' | 'spin' | 'pause' | 'clock' | 'timer' | 'alert';

export interface GenerationStatusDescriptor {
  icon: GenerationStatusIcon;
  label: string;
}

export interface ResolveGenerationStatusInput {
  occupied: boolean;
  generationState?: GenerationJobState;
  generationStage?: GenerationJobStage;
  generationProgress?: { step: number; total: number } | null;
  series?: Pick<GenerationSeriesProgress, 'current' | 'total' | 'stopping' | 'position'> | null;
  queueState?: Pick<GenerationQueueSnapshot, 'paused' | 'pausing'> | null;
  cloudQueue?: CloudQueueStatus | null;
  paused?: boolean;
  unavailableLabel?: string;
}

/**
 * 仅真实「公共队列」等待时判定为云端排队；
 * 中转／拼车成员网关（proxy: true）无法区分排队与画图，统一按正常生成展示。
 */
export function isRealCloudQueueWaiting(queueStatus?: CloudQueueStatus | null): boolean {
  return Boolean(isCloudQueueTaskActive(queueStatus ?? null) && !queueStatus?.proxy && queueStatus?.phase !== 'generating');
}

/**
 * 实验室生成按钮与 Roll 串卡片共用同一套生成阶段语义，保证跨页面状态文案完全一致。
 */
export function resolveGenerationStatus(input: ResolveGenerationStatusInput): GenerationStatusDescriptor {
  const { occupied, generationState, generationStage, generationProgress, series, queueState, cloudQueue, unavailableLabel } = input;
  const paused = Boolean(input.paused ?? queueState?.paused);
  const saving = generationState === 'saving';
  const cloudQueueWaiting = isRealCloudQueueWaiting(cloudQueue);

  if (unavailableLabel) return { icon: paused ? 'pause' : 'image', label: unavailableLabel };
  if (series?.stopping) return { icon: 'spin', label: t('正在停止…') };
  if (queueState?.pausing) return { icon: 'spin', label: saving ? t('正在保存…') : t('暂停中…') };
  if (paused && occupied) return { icon: 'pause', label: t('已暂停') };
  if (occupied && generationState === 'awaiting_confirmation') return { icon: 'alert', label: t('等待确认费用') };
  if (saving) return { icon: 'spin', label: t('正在保存…') };
  if (occupied && cloudQueueWaiting && cloudQueue?.phase === 'waiting') {
    const pos = cloudQueue.position;
    return { icon: 'spin', label: pos && pos > 0 ? t('云端排队 · 第 {0} 位', [pos]) : t('云端排队中…') };
  }
  if (occupied && generationState === 'preparing') {
    if (generationStage === 'checking_pool') return { icon: 'spin', label: t('轮询密钥额度…') };
    if (generationStage === 'checking_quota') return { icon: 'spin', label: t('核实额度中…') };
    if (generationStage === 'preparing_references') return { icon: 'spin', label: t('处理参考图中…') };
    return { icon: 'spin', label: t('准备中…') };
  }
  if (occupied && generationState === 'waiting') {
    if (series?.position && series.position > 0) return { icon: 'clock', label: t('排队中 · 第 {0} 位', [series.position]) };
    if (series && series.current > 0 && series.current < series.total) return { icon: 'timer', label: t('等待下一张…') };
    return { icon: 'clock', label: t('等待中…') };
  }
  if (occupied) {
    return {
      icon: 'spin',
      label: generationProgress
        ? t('采样 {0} / {1}', [generationProgress.step, generationProgress.total])
        : t('生成中…'),
    };
  }
  return { icon: 'image', label: t('生成') };
}
