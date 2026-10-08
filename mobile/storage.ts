import { native, writeBlob, fetchFile } from './native';
import type { D1Database, D1PreparedStatement, D1Result, R2Bucket } from '../worker/routes/types';

class Statement implements D1PreparedStatement {
  constructor(readonly sql: string, readonly values: any[] = []) {}
  bind(...values: any[]) { return new Statement(this.sql, values); }
  async all<T>() { return await native.sql({ sql: this.sql, values: this.values }) as D1Result<T>; }
  run<T>() { return this.all<T>(); }
  async first<T>(column?: string) { const row = (await this.all<Record<string, T>>()).results[0]; return (column ? row?.[column] : row) as T ?? null; }
  async raw<T>() { return (await this.all()).results.map(row => Object.values(row as object)) as T[]; }
}
export const db: D1Database = {
  prepare: sql => new Statement(sql),
  async batch<T>(statements: Statement[]) { return (await native.sql({ statements: statements.map(({ sql, values }) => ({ sql, values })) })).results as D1Result<T>[]; },
  async exec(sql) { return db.prepare(sql).run(); },
  async dump() { throw new Error('请使用手机完整备份导出数据库与原图'); },
};
export const bucket: R2Bucket = {
  async put(key, body, options) {
    const blob = body instanceof ReadableStream ? await new Response(body).blob() : new Blob([body]);
    const temporary = await writeBlob(blob);
    return native.object({ action: 'put', key, temporary, mime: options?.httpMetadata?.contentType || blob.type || 'application/octet-stream' });
  },
  async get(key) {
    const object = await native.object({ key });
    if (object.missing) return null;
    return { body: (await fetchFile(object.path)).body!, httpEtag: `"${object.hash}"`, writeHttpMetadata(headers) { headers.set('Content-Type', object.mime); headers.set('X-Atelier-File',object.path); } };
  },
  async delete(key) { await native.object({ action: 'delete', key }); },
};
