/** 活动 Key 与记住偏好独立保存，空 Key 不再被误判为用户关闭了记住。 */
const ACTIVE_KEY = 'nai_api_key';
export const REMEMBER_NAI_KEY_STORAGE_KEY = 'nai_remember_api_key';
export const NAI_KEY_REMEMBER_CHANGED = 'nai-api-key-remember-changed';

export const readActiveNaiKey = () => sessionStorage.getItem(ACTIVE_KEY) || localStorage.getItem(ACTIVE_KEY) || '';
export const getRememberNaiKey = () => localStorage.getItem(REMEMBER_NAI_KEY_STORAGE_KEY) !== 'false';

const persistActiveKey = (key: string, remember: boolean) => {
  if (key) sessionStorage.setItem(ACTIVE_KEY, key);
  else sessionStorage.removeItem(ACTIVE_KEY);
  localStorage.setItem(REMEMBER_NAI_KEY_STORAGE_KEY, String(remember));
  if (remember && key) localStorage.setItem(ACTIVE_KEY, key);
  else localStorage.removeItem(ACTIVE_KEY);
};

export const setActiveNaiKey = (key: string, remember = getRememberNaiKey()) => {
  const value = key.trim();
  persistActiveKey(value, remember);
  window.dispatchEvent(new CustomEvent<string>('nai-api-key-changed', { detail: value }));
};

export const setRememberNaiKey = (remember: boolean) => {
  persistActiveKey(readActiveNaiKey(), remember);
  // 改变记住偏好不切换账号，避免额外触发余额、排队等账号刷新。
  window.dispatchEvent(new Event(NAI_KEY_REMEMBER_CHANGED));
};

/** 启动时将已有会话 Key 纳入默认记住策略，兼容旧版没有偏好字段的状态。 */
export const restoreRememberedNaiKey = () => {
  const key = readActiveNaiKey();
  if (key && getRememberNaiKey()) setActiveNaiKey(key, true);
};
