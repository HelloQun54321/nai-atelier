import { expect, it } from 'vitest';
import { agentGenerationFailure, agentOperationError, normalizeAgentGenerationResult } from './agentOperation.mjs';

it.each([false, undefined])('旧回调返回 %s 时仅表示未成功，不推断用户取消', value => {
  expect(normalizeAgentGenerationResult(value)).toMatchObject({ success: false, outcome: 'failed', code: 'generation_failed' });
});
it.each(['cancelled', 'blocked', 'failed'] as const)('结构化 %s 保留具体原因', outcome => {
  expect(agentGenerationFailure(agentOperationError('具体原因', 'test_error', outcome))).toEqual({ success: false, historySaved: false, outcome, code: 'test_error', error: '具体原因' });
});
it('生成成功和历史保存分别核实，不使用失败回执里的历史 ID', () => {
  expect(normalizeAgentGenerationResult({ success: true, historySaved: true, historyId: 'exact' })).toEqual({ success: true, historySaved: true, historyId: 'exact', outcome: 'succeeded' });
  expect(normalizeAgentGenerationResult({ success: false, historySaved: true, historyId: 'stale' })).not.toHaveProperty('historyId');
});
