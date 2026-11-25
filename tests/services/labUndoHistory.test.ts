import { describe, expect, it } from 'vitest';
import {
  createLabUndoHistory,
  redoLabHistory,
  recordLabUndoSnapshot,
  undoLabHistory,
} from '../../services/labUndoHistory';

describe('labUndoHistory 实验室撤销/重做栈', () => {
  it('记录历史、撤销、重做并在达到上限时淘汰最旧快照', () => {
    let history = createLabUndoHistory({ v: 0 }, 'fp-0', 3, 1000);
    history = recordLabUndoSnapshot(history, { v: 1 }, 'fp-1', undefined, 1700);
    history = recordLabUndoSnapshot(history, { v: 2 }, 'fp-2', undefined, 2400);
    history = recordLabUndoSnapshot(history, { v: 3 }, 'fp-3', undefined, 3100);
    history = recordLabUndoSnapshot(history, { v: 4 }, 'fp-4', undefined, 3800);

    // 上限 3 条：v:0 已被淘汰，past 剩 [v:1, v:2, v:3]
    expect(history.past.map(entry => entry.value.v)).toEqual([1, 2, 3]);
    expect(history.present.value.v).toBe(4);

    const u1 = undoLabHistory(history);
    expect(u1.restored).toEqual({ v: 3 });
    const u2 = undoLabHistory(u1.history);
    expect(u2.restored).toEqual({ v: 2 });
    const u3 = undoLabHistory(u2.history);
    expect(u3.restored).toEqual({ v: 1 });
    const u4 = undoLabHistory(u3.history);
    expect(u4.restored).toBeNull();

    const r1 = redoLabHistory(u3.history);
    expect(r1.restored).toEqual({ v: 2 });
  });

  it('短时间连续相同 coalesceKey 的文字输入会合并为一步，不同 key 或超时单独记步', () => {
    let history = createLabUndoHistory({ text: 'a' }, 'a', 10, 1000);
    history = recordLabUndoSnapshot(history, { text: 'ab' }, 'ab', 'prompt', 1100);
    history = recordLabUndoSnapshot(history, { text: 'abc' }, 'abc', 'prompt', 1200);
    expect(history.past).toHaveLength(1);
    expect(history.past[0].value.text).toBe('a');
    expect(history.present.value.text).toBe('abc');

    // 超过 600ms 再次输入记为新一步
    history = recordLabUndoSnapshot(history, { text: 'abcd' }, 'abcd', 'prompt', 2000);
    expect(history.past).toHaveLength(2);
    expect(history.past[1].value.text).toBe('abc');
  });

  it('外部输入框自行撤销到上一步或重做回下一步时，自动对齐工作台指针而不追加反向记录', () => {
    let history = createLabUndoHistory({ text: 'init' }, 'init', 10, 1000);
    history = recordLabUndoSnapshot(history, { text: 'edited' }, 'edited', undefined, 2000);
    expect(history.past.map(entry => entry.fingerprint)).toEqual(['init']);

    // 外部输入框按 Ctrl+Z 直接回到 'init'
    history = recordLabUndoSnapshot(history, { text: 'init' }, 'init', undefined, 2100);
    expect(history.past).toHaveLength(0);
    expect(history.present.fingerprint).toBe('init');
    expect(history.future.map(entry => entry.fingerprint)).toEqual(['edited']);

    // 外部再按 Ctrl+Y 重做回 'edited'
    history = recordLabUndoSnapshot(history, { text: 'edited' }, 'edited', undefined, 2200);
    expect(history.past.map(entry => entry.fingerprint)).toEqual(['init']);
    expect(history.present.fingerprint).toBe('edited');
    expect(history.future).toHaveLength(0);
  });
});
