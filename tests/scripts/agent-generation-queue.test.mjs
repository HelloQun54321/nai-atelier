import '../support/node-environment.mjs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runAgentGenerationQueue } from '../../scripts/media-gateway.mjs';
import { GenerationTasks } from '../../worker/generationTasks.mjs';

test('Agent生成队列只提供同Key安全摘要并复用现有队列控制', () => {
  const tasks = new GenerationTasks({ intervalSeconds: 0 });
  const keyHash = 'synthetic-key-hash';
  const otherKeyHash = 'other-synthetic-key-hash';
  const currentToken = 'synthetic-current-task';
  const waitingToken = 'synthetic-waiting-task';
  tasks.reserve(keyHash, currentToken, 2);
  tasks.enqueue(keyHash, waitingToken, 'end', 3);
  tasks.reserve(otherKeyHash, 'other-synthetic-task', 1);
  let cancelledJob = null;
  const jobs = {
    has: (key, token) => key === keyHash && token === currentToken,
    cancel: (key, token) => { cancelledJob = [key, token]; },
  };

  const read = runAgentGenerationQueue('read', keyHash, tasks, jobs);
  assert.deepEqual(read.waiting, [{ position: 1, total: 3, completed: 0 }]);
  assert.ok(!JSON.stringify(read).includes(keyHash));
  assert.ok(!JSON.stringify(read).includes(currentToken));
  assert.ok(!JSON.stringify(read).includes(waitingToken));
  assert.deepEqual(runAgentGenerationQueue('pause', keyHash, tasks, jobs).paused, true);
  assert.deepEqual(runAgentGenerationQueue('resume', keyHash, tasks, jobs).paused, false);

  const cancelled = runAgentGenerationQueue('cancel', keyHash, tasks, jobs);
  assert.deepEqual(cancelledJob, [keyHash, currentToken]);
  assert.equal(cancelled.cancelled, 2);
  assert.equal(cancelled.busy, false);
  assert.equal(tasks.snapshot(otherKeyHash).busy, true);
  assert.throws(() => runAgentGenerationQueue('read', '', tasks, jobs), /缺少 NovelAI API Key/);
  assert.throws(() => runAgentGenerationQueue('click', keyHash, tasks, jobs), /操作无效/);
});
