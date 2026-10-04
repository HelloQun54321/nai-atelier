import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import { DEFAULT_IMAGE_TAGGER_MODEL, IMAGE_TAGGER_MODELS } from '../../../services/imageTaggerModels.mjs';
import { type RouteContext } from '../../../worker/routes/types';

it('模型选择落既有设置表，重读恢复，不改写其他设置', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('private_setting', 'keep');");
  try {
    const db = { prepare: (query: string) => {
      let values: string[] = [];
      return { bind: (...next: string[]) => { values = next; return {
        first: async () => sqlite.prepare(query).get(...values), run: async () => sqlite.prepare(query).run(...values),
      }; } };
    } };
    const invoke = (method: string, model?: unknown, headers: Record<string, string> = { 'x-nai-client-ip': '127.0.0.1', 'x-nai-tagger-control': 'true' }) => {
      const url = new URL('http://localhost/api/internal/image-tagger/preferences');
      const request = new Request(url, { method, headers, ...(method === 'PUT' ? { body: JSON.stringify({ model }) } : {}) });
      return handleSettingsRoute({ request, url, path: url.pathname, method, db } as unknown as RouteContext);
    };
    expect(await (await invoke('GET'))?.json()).toEqual({ model: DEFAULT_IMAGE_TAGGER_MODEL });
    expect((await invoke('PUT', IMAGE_TAGGER_MODELS[2].id))?.status).toBe(200);
    expect(await (await invoke('GET'))?.json()).toEqual({ model: IMAGE_TAGGER_MODELS[2].id });
    expect((await invoke('PUT', '../bad'))?.status).toBe(400);
    expect((await invoke('PUT', IMAGE_TAGGER_MODELS[0].id, { 'x-nai-client-ip': '192.168.1.2', 'x-nai-tagger-control': 'true' }))?.status).toBe(403);
    expect((await invoke('GET', undefined, {}))?.status).toBe(403);
    expect((await invoke('POST'))?.status).toBe(405);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'private_setting'").get()?.value).toBe('keep');
  } finally { sqlite.close(); }
});
