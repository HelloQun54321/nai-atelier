/** 明确区分用户取消、提交前拦截与执行失败；旧布尔回执不能推断用户取消。 */
export const normalizeAgentGenerationResult = value => {
  const source = value && typeof value === 'object' ? value : {};
  const success = value === true || source.success === true;
  const outcome = success ? 'succeeded' : ['cancelled', 'blocked', 'failed'].includes(source.outcome) ? source.outcome : 'failed';
  const code = typeof source.code === 'string' && /^[a-z_]{1,60}$/.test(source.code) ? source.code : !success ? 'generation_failed' : '';
  const error = !success ? String(source.error || (outcome === 'cancelled' ? '用户取消了生图请求' : '未收到生成成功的回执，请先核实结果后再尝试。')).slice(0, 500) : '';
  return { success, historySaved: success && source.historySaved === true, outcome,
    ...(success && source.historySaved === true && typeof source.historyId === 'string' ? { historyId: source.historyId.slice(0, 200) } : {}),
    ...(code ? { code } : {}), ...(error ? { error } : {}),
  };
};

export const agentOperationError = (message, code = 'preflight_failed', outcome = 'blocked') => Object.assign(new Error(message), { code, outcome });

export const agentGenerationFailure = error => normalizeAgentGenerationResult({ success: false, historySaved: false, outcome: error?.outcome, code: error?.code, error: error instanceof Error ? error.message : '生成失败，请查看具体回执。' });
