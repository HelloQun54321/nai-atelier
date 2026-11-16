/** 启动时是否自动开启安全模式；无本地记录时默认关闭。 */
export function readSafeModeStartupPreference(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem('nai_safe_mode_startup') === 'true';
  } catch {
    return false;
  }
}
