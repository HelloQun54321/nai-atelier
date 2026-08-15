// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStaleGuard } from './useStaleGuard';

describe('useStaleGuard', () => {
  it('新一次加载使旧序号失效', () => {
    const { result } = renderHook(() => useStaleGuard());
    const first = result.current.begin();
    expect(result.current.isCurrent(first)).toBe(true);

    const second = result.current.begin();
    expect(result.current.isCurrent(first)).toBe(false);
    expect(result.current.isCurrent(second)).toBe(true);
  });

  it('组件卸载后所有序号失效（迟到的响应不再写状态）', () => {
    const { result, unmount } = renderHook(() => useStaleGuard());
    const seq = result.current.begin();
    expect(result.current.isCurrent(seq)).toBe(true);

    unmount();
    expect(result.current.isCurrent(seq)).toBe(false);
    // 卸载后再 begin 的序号同样无效
    const afterUnmount = result.current.begin();
    expect(result.current.isCurrent(afterUnmount)).toBe(false);
  });
});
