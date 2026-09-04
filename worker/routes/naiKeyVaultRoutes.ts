// NovelAI 多密钥保管箱路由（local-data / D1 settings 表 KV 存储）。
//
// 保管箱整体（密钥清单 + 备注）从浏览器 localStorage 迁移到这里由 Worker 保管，
// settings 表中对应一行：key = 'nai_key_vault'，value = NaiKeyEntry[] 的 JSON。
// 「当前使用的密钥」仍走既有的 nai_api_key 槽位（见 services/naiKeyVault.ts），
// 本路由不参与激活钥的读写，因此所有生图消费方不受影响。
//
// 语义对齐前端原实现（services/naiKeyVault.ts）：
//   - 新增时校验：trim 后为空 / 不以 pst- 开头 / 与现库任一 key 重复 → 400 拒绝；
//   - name trim 后空则生成「密钥 N」序号名，超过 30 字截断；
//   - 新增返回 { status, entry }，改名 / 删除返回 { entries }，便于调用方刷新整箱。
import { json, error, parseStoredJson, type D1Database, type RouteContext } from './types';

export interface NaiKeyEntry {
  id: string;
  name: string;
  key: string;
  createdAt: number;
}

const VAULT_SETTINGS_KEY = 'nai_key_vault';

/** 把响应体解析为普通对象；非 JSON / 非对象一律视为空对象。 */
const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const raw: unknown = await request.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  } catch {
    // 响应体不是 JSON 时按空对象处理，让校验分支给出明确文案。
  }
  return {};
};

/**
 * settings 表值可能因备份恢复/手工编辑而损坏，逐条校验后规范化，
 * 损毁条目丢弃、缺省字段补默认值，避免端点 500 且保证写回内容可预期。
 */
const readVault = async (db: D1Database): Promise<NaiKeyEntry[]> => {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(VAULT_SETTINGS_KEY)
    .first<{ value: string }>();
  const parsed: unknown = parseStoredJson(row?.value, []);
  if (!Array.isArray(parsed)) return [];
  const entries: NaiKeyEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key.trim() : '';
    if (!key) continue;
    const rawName = typeof rec.name === 'string' ? rec.name.trim() : '';
    entries.push({
      id: typeof rec.id === 'string' && rec.id ? rec.id : crypto.randomUUID(),
      name: rawName.slice(0, 30) || '未命名密钥',
      key,
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
    });
  }
  return entries;
};

const writeVault = async (db: D1Database, entries: NaiKeyEntry[]) => {
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .bind(VAULT_SETTINGS_KEY, JSON.stringify(entries))
    .run();
};

export async function handleNaiKeyVaultRoute(ctx: RouteContext): Promise<Response | null> {
  const { db, path, method, request } = ctx;

  if (path === '/api/nai-key-vault' && method === 'GET') {
    return json({ entries: await readVault(db) });
  }

  // 单条新增：trim 非空 → pst- 前缀 → 与现库查重。
  if (path === '/api/nai-key-vault' && method === 'POST') {
    const body = await readJsonBody(request);
    const trimmedKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!trimmedKey) return error('密钥不能为空', 400);
    if (!trimmedKey.startsWith('pst-')) return error('这不像 NovelAI 密钥：官方密钥以 pst- 开头。请检查是否粘贴了其他服务的密钥。', 400);
    const vault = await readVault(db);
    if (vault.some(entry => entry.key === trimmedKey)) return error('这把密钥已经在保管箱里了', 400);
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const entry: NaiKeyEntry = {
      id: crypto.randomUUID(),
      name: rawName.slice(0, 30) || `密钥 ${vault.length + 1}`,
      key: trimmedKey,
      createdAt: Date.now(),
    };
    await writeVault(db, [...vault, entry]);
    return json({ status: 'added', entry });
  }

  // 整体替换：供「首次 list() 时 localStorage 旧库 → 服务端」一次性迁移写入。
  // 必须在本文件 :id 分支之前精确匹配（两者同为 PUT，靠是否带子路径区分）。
  if (path === '/api/nai-key-vault' && method === 'PUT') {
    const body = await readJsonBody(request);
    const rawEntries = Array.isArray(body.entries) ? body.entries : null;
    if (!rawEntries) return error('迁移数据格式不正确', 400);
    const cleaned: NaiKeyEntry[] = [];
    for (const raw of rawEntries) {
      if (!raw || typeof raw !== 'object') return error('迁移数据包含无效条目', 400);
      const rec = raw as Record<string, unknown>;
      const key = typeof rec.key === 'string' ? rec.key.trim() : '';
      if (!key || !key.startsWith('pst-')) return error('迁移数据包含非 NovelAI 密钥（应以 pst- 开头），已中止，本地数据未删除', 400);
      const rawName = typeof rec.name === 'string' ? rec.name.trim() : '';
      cleaned.push({
        id: typeof rec.id === 'string' && rec.id ? rec.id : crypto.randomUUID(),
        name: rawName.slice(0, 30) || '未命名密钥',
        key,
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
      });
    }
    await writeVault(db, cleaned);
    return json({ entries: cleaned });
  }

  // 以下为带 :id 子路径的改名 / 删除。
  const entryIdMatch = path.match(/^\/api\/nai-key-vault\/([^/]+)$/);
  if (entryIdMatch && method === 'PUT') {
    const id = decodeURIComponent(entryIdMatch[1]);
    const body = await readJsonBody(request);
    const vault = await readVault(db);
    const target = vault.find(entry => entry.id === id);
    if (!target) return error('密钥不存在或已被删除', 404);
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const trimmedName = rawName.slice(0, 30);
    const next = vault.map(entry => entry.id === id ? { ...entry, name: trimmedName || entry.name } : entry);
    await writeVault(db, next);
    return json({ entries: next });
  }

  if (entryIdMatch && method === 'DELETE') {
    const id = decodeURIComponent(entryIdMatch[1]);
    const vault = await readVault(db);
    const next = vault.filter(entry => entry.id !== id);
    if (next.length === vault.length) return error('密钥不存在或已被删除', 404);
    await writeVault(db, next);
    return json({ entries: next });
  }

  return null;
}
