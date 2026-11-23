// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  consumePendingChunkReloadView,
  installVitePreloadErrorRecovery,
  isDynamicImportError,
  recoverFromDynamicImportError,
  setActiveViewForChunkRecovery,
} from '../../services/chunkReload';

describe('chunkReload', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setActiveViewForChunkRecovery('');
  });

  it('准确识别动态导入与分包加载失败，不误判普通业务错误', () => {
    expect(isDynamicImportError(new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/StyleRollPage-abc.js'))).toBe(true);
    expect(isDynamicImportError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isDynamicImportError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isDynamicImportError(new Error('Unable to preload CSS for /assets/foo.css'))).toBe(true);
    expect(isDynamicImportError(new Error('Network timeout'))).toBe(false);
    expect(isDynamicImportError(null)).toBe(false);
  });

  it('命中旧分包错误时记住目标视图并单次自动刷新，冷却期内不重复刷', () => {
    const reload = vi.fn();
    setActiveViewForChunkRecovery('roll');

    expect(recoverFromDynamicImportError(new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/StyleRollPage-old.js'), reload, 10_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(consumePendingChunkReloadView(11_000)).toBe('roll');
    // 消费后立即清除，普通手动刷新不会复用。
    expect(consumePendingChunkReloadView(11_001)).toBeNull();

    // 冷却期内再次失败不再自动刷新，防止服务关闭时无限循环。
    expect(recoverFromDynamicImportError(new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/StyleRollPage-old.js'), reload, 10_000 + CHUNK_RELOAD_COOLDOWN_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // 超过冷却期后允许再次自动恢复。
    setActiveViewForChunkRecovery('comic');
    expect(recoverFromDynamicImportError(new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/ComicStudio-old.js'), reload, 10_000 + CHUNK_RELOAD_COOLDOWN_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(consumePendingChunkReloadView(10_000 + CHUNK_RELOAD_COOLDOWN_MS + 500)).toBe('comic');
  });

  it('监听 vite:preloadError 时阻止默认抛错并触发单次刷新', () => {
    const reload = vi.fn();
    const dispose = installVitePreloadErrorRecovery(reload);
    try {
      setActiveViewForChunkRecovery('history');
      const event = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(consumePendingChunkReloadView()).toBe('history');
    } finally {
      dispose();
    }
  });
});
