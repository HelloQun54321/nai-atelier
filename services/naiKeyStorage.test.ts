// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRememberNaiKey, readActiveNaiKey, REMEMBER_NAI_KEY_STORAGE_KEY, NAI_KEY_REMEMBER_CHANGED, restoreRememberedNaiKey, setActiveNaiKey, setRememberNaiKey } from './naiKeyStorage';
import { naiKeyVault } from './naiKeyVault';

vi.mock('./api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }, ApiError: class extends Error {} }));
const entry = (name: string) => ({ id: name, name, key: `mock-nai-key-${name}`, createdAt: 0 });
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe('活动 Key 默认保留与显式会话模式', () => {
  it('空状态默认记住，选择两把 Key 后关闭会话，恢复最后使用的那把', () => {
    expect(getRememberNaiKey()).toBe(true);
    expect(readActiveNaiKey()).toBe('');
    naiKeyVault.activate(entry('a'));
    naiKeyVault.activate(entry('b'));
    sessionStorage.clear();
    restoreRememberedNaiKey();
    expect(readActiveNaiKey()).toBe(entry('b').key);
    expect(sessionStorage.getItem('nai_api_key')).toBe(entry('b').key);
    expect(localStorage.getItem('nai_api_key')).toBe(entry('b').key);
  });

  it('没有 Key 时关闭记住也能保存偏好，之后使用的 Key 仅在当前会话生效', () => {
    setRememberNaiKey(false);
    expect(localStorage.getItem(REMEMBER_NAI_KEY_STORAGE_KEY)).toBe('false');
    naiKeyVault.activate(entry('a'));
    expect(readActiveNaiKey()).toBe(entry('a').key);
    expect(localStorage.getItem('nai_api_key')).toBeNull();
    sessionStorage.clear();
    restoreRememberedNaiKey();
    expect(readActiveNaiKey()).toBe('');
    expect(getRememberNaiKey()).toBe(false);
  });

  it('关闭记住保留当前使用的 Key，开启后重新持久化，偏好变化不触发账号切换', () => {
    localStorage.setItem('nai_api_key', entry('a').key);
    const keyChanged = vi.fn();
    const preferenceChanged = vi.fn();
    window.addEventListener('nai-api-key-changed', keyChanged);
    window.addEventListener(NAI_KEY_REMEMBER_CHANGED, preferenceChanged);
    try {
      setRememberNaiKey(false);
      expect(readActiveNaiKey()).toBe(entry('a').key);
      expect(localStorage.getItem('nai_api_key')).toBeNull();
      setRememberNaiKey(true);
      expect(localStorage.getItem('nai_api_key')).toBe(entry('a').key);
      expect(keyChanged).not.toHaveBeenCalled();
      expect(preferenceChanged).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('nai-api-key-changed', keyChanged);
      window.removeEventListener(NAI_KEY_REMEMBER_CHANGED, preferenceChanged);
    }
  });

  it('旧版会话 Key 自动纳入默认记住，不把已有明确关闭的偏好打开', () => {
    sessionStorage.setItem('nai_api_key', entry('a').key);
    restoreRememberedNaiKey();
    expect(localStorage.getItem('nai_api_key')).toBe(entry('a').key);
    setRememberNaiKey(false);
    restoreRememberedNaiKey();
    expect(localStorage.getItem('nai_api_key')).toBeNull();
    expect(readActiveNaiKey()).toBe(entry('a').key);
    expect(getRememberNaiKey()).toBe(false);
  });

  it('当前会话新 Key 优先于旧持久化值，并通知消费方，不改写预算等其他设置', () => {
    localStorage.setItem('nai_api_key', entry('a').key);
    sessionStorage.setItem('nai_api_key', entry('b').key);
    localStorage.setItem('unrelated-budget-setting', '37');
    const onChange = vi.fn();
    window.addEventListener('nai-api-key-changed', onChange);
    try {
      restoreRememberedNaiKey();
      expect(localStorage.getItem('nai_api_key')).toBe(entry('b').key);
      expect(onChange.mock.calls[0][0].detail).toBe(entry('b').key);
      expect(localStorage.getItem('unrelated-budget-setting')).toBe('37');
    } finally { window.removeEventListener('nai-api-key-changed', onChange); }
  });

  it('清空活动 Key 后不会在重进时复活，也不会改变明确关闭的记住偏好', () => {
    naiKeyVault.activate(entry('a'));
    naiKeyVault.clearActive();
    restoreRememberedNaiKey();
    expect(readActiveNaiKey()).toBe('');
    expect(localStorage.getItem('nai_api_key')).toBeNull();
    naiKeyVault.activate(entry('b'), false);
    naiKeyVault.clearActive();
    expect(getRememberNaiKey()).toBe(false);
  });

  it('活动 Key 去除首尾空白，空值不会被持久化成伪选择', () => {
    setActiveNaiKey(`  ${entry('a').key}  `);
    expect(readActiveNaiKey()).toBe(entry('a').key);
    setActiveNaiKey('   ');
    expect(sessionStorage.getItem('nai_api_key')).toBeNull();
    expect(localStorage.getItem('nai_api_key')).toBeNull();
    expect(getRememberNaiKey()).toBe(true);
  });
});
