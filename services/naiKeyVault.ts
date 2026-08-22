import { createUuid } from './id';

/**
 * NovelAI 多密钥保管箱。
 *
 * 保管箱本身保存在 localStorage（密钥清单与命名备注持久化）；「当前使用的密钥」
 * 仍写入既有的 nai_api_key 槽位（sessionStorage / localStorage，由“记住”开关
 * 决定持久性），因此所有既有消费方（生图、限额查询、网关代理）无需改动。
 */

export interface NaiKeyEntry {
  id: string;
  name: string;
  key: string;
  createdAt: number;
}

const VAULT_STORAGE_KEY = 'nai_api_key_vault';

const readActiveKey = () => sessionStorage.getItem('nai_api_key') || localStorage.getItem('nai_api_key') || '';

const readVault = (): NaiKeyEntry[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.key === 'string' && item.key)
      .map(item => ({ id: item.id, name: item.name || '未命名密钥', key: item.key, createdAt: Number(item.createdAt) || Date.now() }));
  } catch {
    return [];
  }
};

const writeVault = (entries: NaiKeyEntry[]) => {
  if (entries.length) localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(entries));
  else localStorage.removeItem(VAULT_STORAGE_KEY);
};

const broadcastActiveKey = (key: string) => {
  window.dispatchEvent(new CustomEvent<string>('nai-api-key-changed', { detail: key }));
  // 切换账号后立即用新 Key 刷新 Opus 限额，不等下一分钟轮询。
  window.dispatchEvent(new CustomEvent('nai-novelai-usage-refresh'));
};

/** 密钥脱敏展示：保留前缀与末 4 位。 */
export const maskNaiKey = (key: string) => {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return trimmed ? '****' : '';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

export const naiKeyVault = {
  /** 读取保管箱；首次访问时把当前单密钥收编为默认条目。 */
  list(): NaiKeyEntry[] {
    const vault = readVault();
    const active = readActiveKey();
    if (active && !vault.some(entry => entry.key === active)) {
      const migrated = [...vault, { id: createUuid(), name: vault.length ? '未命名密钥' : '默认密钥', key: active, createdAt: Date.now() }];
      writeVault(migrated);
      return migrated;
    }
    return vault;
  },

  /** 新增密钥；与已有条目重复时返回 null（同一把 Key 不存两份）。 */
  add(name: string, key: string): NaiKeyEntry | null {
    const trimmedKey = key.trim();
    if (!trimmedKey) return null;
    const vault = readVault();
    if (vault.some(entry => entry.key === trimmedKey)) return null;
    const entry: NaiKeyEntry = {
      id: createUuid(),
      name: name.trim().slice(0, 30) || `密钥 ${vault.length + 1}`,
      key: trimmedKey,
      createdAt: Date.now(),
    };
    writeVault([...vault, entry]);
    return entry;
  },

  rename(id: string, name: string): NaiKeyEntry[] {
    const trimmed = name.trim().slice(0, 30);
    const vault = readVault().map(entry => entry.id === id ? { ...entry, name: trimmed || entry.name } : entry);
    writeVault(vault);
    return vault;
  },

  remove(id: string): NaiKeyEntry[] {
    const vault = readVault().filter(entry => entry.id !== id);
    writeVault(vault);
    return vault;
  },

  /** 把某把密钥设为当前使用（沿用“记住”开关的持久化语义）。 */
  activate(entry: NaiKeyEntry, remember: boolean) {
    sessionStorage.setItem('nai_api_key', entry.key);
    if (remember) localStorage.setItem('nai_api_key', entry.key);
    else localStorage.removeItem('nai_api_key');
    broadcastActiveKey(entry.key);
  },

  /** 当前激活的密钥值（供设置界面高亮）。 */
  activeKey(): string {
    return readActiveKey();
  },

  /** 清空当前密钥（删除激活条目时使用）。 */
  clearActive() {
    sessionStorage.removeItem('nai_api_key');
    localStorage.removeItem('nai_api_key');
    broadcastActiveKey('');
  },
};
