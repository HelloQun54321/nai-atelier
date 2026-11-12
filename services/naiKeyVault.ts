import { api, ApiError } from './api';
import { createUuid } from './id';
import { readActiveNaiKey, setActiveNaiKey, getRememberNaiKey } from './naiKeyStorage';
import { normalizeNaiGatewayUrl, validateNaiApiKey } from '../worker/naiConnection.mjs';
import { rememberConfirmationConnections } from './dailyConfirmation';

/**
 * NovelAI 多密钥保管箱。
 *
 * 保管箱本体（密钥清单与命名备注）已从浏览器 localStorage 全量迁入 local-data
 * （Worker 端 D1 settings 表 key='nai_key_vault'），这里只是访问它的异步客户端；
 * 「当前使用的密钥」仍写入既有的 nai_api_key 槽位（sessionStorage / localStorage，
 * 默认记住，显式关闭后仅用于当前会话），因此所有既有消费方（生图、限额查询、网关代理）
 * 无需改动。
 *
 * 兜底语义：Worker 不可达时（例如纯 dev 前端模式）本模块回退到原 localStorage
 * 保管箱逻辑，保证单机状态不丢、功能可用；恢复后下一次 list() 会把降级期间新增
 * 的本地条目一并推送到服务端（整体替换），随后清空本地副本。
 */

export interface NaiKeyEntry {
  id: string;
  name: string;
  key: string;
  createdAt: number;
  gatewayUrl?: string;
  /** 'per-use' = 按次渠道：生成照走 gatewayUrl，但不查询点数/额度。 */
  billingMode?: string;
}

export type AddKeyResult =
  | { status: 'added'; entry: NaiKeyEntry }
  | { status: 'empty' }
  | { status: 'duplicate' }
  | { status: 'invalid-gateway' }
  | { status: 'invalid' }
  | { status: 'missing-gateway' };

const VAULT_STORAGE_KEY = 'nai_api_key_vault';
export const NAI_KEY_VAULT_CHANGED = 'nai-key-vault-changed';
/** 最近一次 list() 结果：渠道解析与设置页共用，避免每次读数都打 D1。 */
let vaultSnapshot: NaiKeyEntry[] | null = null;
let vaultSnapshotAt = 0;
const VAULT_SNAPSHOT_TTL = 5000;
export const readCachedNaiKeyVault = () => vaultSnapshot;
const rememberVault = (entries: NaiKeyEntry[]) => { vaultSnapshot = entries; vaultSnapshotAt = Date.now(); };
export const notifyNaiKeyVaultChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(NAI_KEY_VAULT_CHANGED)); };
/** 模块级标记：服务端不可达的 console.warn 只输出一次，避免每次操作刷屏。 */
let warnedFallback = false;

const warnFallback = () => {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn('密钥保管箱服务端不可达，已回退到浏览器本地存储（数据仅保存在此浏览器中）');
};

const readActiveKey = readActiveNaiKey;

/** 兼容旧数据：损坏的本地库回退空数组。 */
const readLocalVault = (): NaiKeyEntry[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .filter(item => typeof item.id === 'string' && typeof item.name === 'string' && typeof item.key === 'string' && item.key)
      .map(item => ({
        id: item.id as string,
        name: (item.name as string) || '未命名密钥',
        key: item.key as string,
        createdAt: typeof item.createdAt === 'number' ? (item.createdAt as number) : Date.now(),
        ...(item.gatewayUrl != null ? { gatewayUrl: item.gatewayUrl as string } : {}),
        ...(item.billingMode === 'per-use' ? { billingMode: 'per-use' as const } : {}),
      }));
  } catch {
    return [];
  }
};

const writeLocalVault = (entries: NaiKeyEntry[]) => {
  if (entries.length) localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(entries));
  else localStorage.removeItem(VAULT_STORAGE_KEY);
};

/** 浏览器侧可用性判断：服务端可达与否以实际请求为准，这里只做最粗的环境区分。 */
const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined' && typeof sessionStorage !== 'undefined';

/**
 * 一次性迁移合流：localStorage 旧库有未合流条目时推给服务端合并，成功后才删除本地副本。
 * 若本地所有 Key 已在服务端存在，则静默清理本地副本，免发无谓网络请求。
 * 返回合流后服务端 entries（供调用方直接使用）；无迁移需求或失败返回 null。
 */
const migrateLegacyVault = async (serverEntries: NaiKeyEntry[] = []): Promise<NaiKeyEntry[] | null> => {
  if (!isBrowser()) return null;
  const legacy = readLocalVault();
  if (!legacy.length) return null;
  const serverKeys = new Set(serverEntries.map(e => e.key));
  if (legacy.every(entry => serverKeys.has(entry.key))) {
    localStorage.removeItem(VAULT_STORAGE_KEY);
    return null;
  }
  try {
    const res = await api.put('/nai-key-vault', { entries: legacy });
    localStorage.removeItem(VAULT_STORAGE_KEY);
    return Array.isArray(res?.entries) ? res.entries as NaiKeyEntry[] : [];
  } catch (err) {
    // 迁移失败绝不删除本地副本，否则旧密钥会丢；交由下一轮 list() 重试。
    if (!(err instanceof ApiError)) warnFallback();
    return null;
  }
};

export const naiKeyVault = {
  /**
   * 读取保管箱。主路径：先取服务端整箱；若浏览器里还残留旧 localStorage 库
   * （升级前版本写入），则一次性整体合流到服务端后删除本地副本。
   * 服务端不可达时回退本地库，并把「当前单密钥」收编为默认条目（原同步语义）。
   */
  async list(): Promise<NaiKeyEntry[]> {
    if (!isBrowser()) return [];
    if (vaultSnapshot && Date.now() - vaultSnapshotAt < VAULT_SNAPSHOT_TTL) return vaultSnapshot;
    try {
      const res = await api.get('/nai-key-vault');
      const entries = Array.isArray(res?.entries) ? res.entries as NaiKeyEntry[] : [];
      // 浏览器里残留旧 localStorage 库时一次性迁移合流，成功后直接用合流结果刷新整箱。
      const migrated = await migrateLegacyVault(entries);
      rememberConfirmationConnections(migrated ?? entries);
      rememberVault(migrated ?? entries);
      return migrated ?? entries;
    } catch {
      // 服务端不可达：整体回退本地保管箱逻辑。
      warnFallback();
      const local = readLocalVault();
      const active = readActiveKey();
      if (active && !local.some(entry => entry.key === active)) {
        const migrated = [...local, { id: createUuid(), name: local.length ? '未命名密钥' : '默认密钥', key: active, createdAt: Date.now() }];
        writeLocalVault(migrated);
        rememberConfirmationConnections(migrated);
        rememberVault(migrated);
        return migrated;
      }
      rememberConfirmationConnections(local);
      rememberVault(local);
      return local;
    }
  },

  /**
   * 官方密钥检查 pst- 前缀；成员 Key 必须明确绑定网关，校验与服务端／本地兜底一致。
   */
  async add(name: string, key: string, gatewayAddress = '', billingMode = ''): Promise<AddKeyResult> {
    const trimmedKey = key.trim();
    if (!trimmedKey) return { status: 'empty' };
    const mode = billingMode === 'per-use' ? 'per-use' : '';
    let gatewayUrl;
    try { gatewayUrl = normalizeNaiGatewayUrl(gatewayAddress); } catch { return { status: 'invalid-gateway' }; }
    if (mode === 'per-use' && !gatewayUrl) return { status: 'missing-gateway' };
    try { validateNaiApiKey(trimmedKey, gatewayUrl); } catch { return { status: 'invalid' }; }
    if (!isBrowser()) return { status: 'invalid' };
    try {
      const res = await api.post('/nai-key-vault', { name, key, ...(gatewayUrl ? { gatewayUrl } : {}), ...(mode ? { billingMode: mode } : {}) });
      rememberConfirmationConnections([res.entry]);
      vaultSnapshot = null;
      notifyNaiKeyVaultChanged();
      return { status: 'added', entry: res.entry as NaiKeyEntry };
    } catch (err) {
      // 服务端把校验失败以 400 返回：err 为 ApiError，剥离回局部判定结果；
      // 网络层失败则回退本地保管箱。
      if (err instanceof ApiError && err.status === 400) {
        const message = err.message || '';
        if (message.includes('不能为空')) return { status: 'empty' };
        if (message.includes('已经在保管箱')) return { status: 'duplicate' };
        if (message.includes('按次渠道需要填写生成地址')) return { status: 'missing-gateway' };
        return { status: 'invalid' };
      }
      warnFallback();
      const local = readLocalVault();
      if (local.some(entry => entry.key === trimmedKey)) return { status: 'duplicate' };
      const entry: NaiKeyEntry = {
        id: createUuid(),
        name: name.trim().slice(0, 30) || `密钥 ${local.length + 1}`,
        key: trimmedKey,
        createdAt: Date.now(),
        ...(gatewayUrl ? { gatewayUrl } : {}),
        ...(mode ? { billingMode: mode } : {}),
      };
      writeLocalVault([...local, entry]);
      rememberConfirmationConnections([entry]);
      vaultSnapshot = null;
      notifyNaiKeyVaultChanged();
      return { status: 'added', entry };
    }
  },

  /** 改名；返回全量 entries（含改名后）。 */
  async rename(id: string, name: string): Promise<NaiKeyEntry[]> {
    const trimmed = name.trim().slice(0, 30);
    if (!isBrowser()) return [];
    try {
      const res = await api.put(`/nai-key-vault/${encodeURIComponent(id)}`, { name });
      const entries = Array.isArray(res?.entries) ? res.entries as NaiKeyEntry[] : [];
      rememberVault(entries);
      notifyNaiKeyVaultChanged();
      return entries;
    } catch {
      warnFallback();
      const next = readLocalVault().map(entry => entry.id === id ? { ...entry, name: trimmed || entry.name } : entry);
      writeLocalVault(next);
      rememberVault(next);
      notifyNaiKeyVaultChanged();
      return next;
    }
  },

  /** 删除；返回过滤后的全量 entries。 */
  async remove(id: string): Promise<NaiKeyEntry[]> {
    if (!isBrowser()) return [];
    try {
      const res = await api.delete(`/nai-key-vault/${encodeURIComponent(id)}`);
      const entries = Array.isArray(res?.entries) ? res.entries as NaiKeyEntry[] : [];
      rememberVault(entries);
      notifyNaiKeyVaultChanged();
      return entries;
    } catch {
      warnFallback();
      const next = readLocalVault().filter(entry => entry.id !== id);
      writeLocalVault(next);
      rememberVault(next);
      notifyNaiKeyVaultChanged();
      return next;
    }
  },

  /** 当前选择默认记住；显式关闭后仅用于当前会话。 */
  activate(entry: NaiKeyEntry, remember = getRememberNaiKey()) {
    rememberConfirmationConnections([entry]);
    setActiveNaiKey(entry.key, remember);
  },

  /** 清空当前密钥（删除激活条目时使用）。 */
  clearActive() {
    setActiveNaiKey('');
  },
};
