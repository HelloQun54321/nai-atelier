/** 格式化出口生图耗时（仅包含发往上游出口至收齐最终图片响应的时间）。 */
export const formatGenerationDuration = (durationMs?: number | null): string => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return '';
  const totalSeconds = Math.max(0.1, durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
};

/** 从历史条目读取记录的上游生图耗时（兼容顶层便捷字段与 params 持久字段）。 */
export const readGenerationDurationMs = (
  item?: {
    generationDurationMs?: number;
    params?: { _local_generation_duration_ms?: number } | null;
  } | null,
): number | undefined => {
  const direct = item?.generationDurationMs;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  const fromParams = item?.params?._local_generation_duration_ms;
  if (typeof fromParams === 'number' && Number.isFinite(fromParams) && fromParams > 0) return fromParams;
  return undefined;
};
