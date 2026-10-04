/** 使用当前代码中的公开默认值构造快照，不读取用户最近一次联网同步结果。 */
export const createNaiRuntimeSnapshot = runtime => ({
  syncedAt: 1,
  runtime: structuredClone(runtime),
  health: { ok: true, extracted: [], missed: [] },
});
