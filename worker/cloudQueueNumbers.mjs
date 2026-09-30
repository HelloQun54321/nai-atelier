// 队列数量只接受非负整数；0 是有效值，缺失或非法值保持未知。
export const normalizeCloudQueueCount = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};
