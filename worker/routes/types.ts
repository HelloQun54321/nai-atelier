// Shared types and helpers for the worker route modules.
// Original definitions lived in worker/index.ts before the domain split;
// names and behavior are unchanged.

// Add missing D1 type definitions locally
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: any;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec<T = unknown>(query: string): Promise<D1Result<T>>;
}

// R2 Type Definitions
export interface R2ObjectBody {
  body: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
  httpEtag: string;
}

export interface R2Bucket {
    put(key: string, body: ReadableStream | ArrayBuffer | string, options?: any): Promise<any>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
}

export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: D1Database;
  BUCKET?: R2Bucket; // R2 Binding
  R2_PUBLIC_URL?: string; // Kept for legacy compatibility if needed
  LOCAL_HISTORY_ENABLED?: string;
  PERSONAL_MODE_ENABLED?: string;
  LAN_ACCESS_PIN?: string;
  LAN_ACCESS_SECRET?: string;
  AITAG_LOCAL_PROXY_URL?: string;
  DANBOORU_LOCAL_PROXY_URL?: string;
  // GUEST_PASSCODE removed, now stored in DB
}

export interface WorkerContext {
  waitUntil(promise: Promise<any>): void;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, Server-Timing',
  'Access-Control-Allow-Credentials': 'true',
};

export const json = (data: any, status = 200, headers: Record<string, string> = {}) => 
  new Response(JSON.stringify(data), { 
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...headers }, 
    status 
  });

export const error = (msg: string, status = 500) => 
  new Response(JSON.stringify({ error: msg }), { headers: { 'Content-Type': 'application/json', ...corsHeaders }, status });

export const clampInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function parseStoredJson(value: string | null | undefined, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export const MAX_MANAGED_IMAGE_BYTES = 12 * 1024 * 1024;

// Shared context handed to every route handler. The fields mirror the
// variables that the original fetch() body closed over.
export interface RouteContext {
  request: Request;
  env: Env;
  url: URL;
  path: string;
  method: string;
  db: D1Database;
  currentUser: any;
  initDB: () => Promise<void>;
  ctx?: WorkerContext;
}

// Full initial database schema (originally const INIT_SQL in worker/index.ts).
export const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS chains (
    id TEXT PRIMARY KEY,
    user_id TEXT, 
    username TEXT, 
    type TEXT DEFAULT 'style',
    name TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    preview_image TEXT,
    base_prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    params TEXT DEFAULT '{}',
    variable_values TEXT DEFAULT '{}',
    guest_hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    preview_url TEXT,
    benchmarks TEXT
  );
  CREATE TABLE IF NOT EXISTS inspirations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    title TEXT NOT NULL,
    image_url TEXT,
    prompt TEXT,
    negative_prompt TEXT DEFAULT '',
    params TEXT,
    board_id TEXT,
    notes TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    source_type TEXT,
    source_id TEXT,
    source_url TEXT,
    rating INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT,
    analysis TEXT DEFAULT '{}',
    image_key TEXT,
    image_type TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS inspiration_boards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS local_generation_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_key TEXT NOT NULL,
    image_type TEXT DEFAULT 'image/png',
    prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    params TEXT DEFAULT '{}',
    base_prompt TEXT DEFAULT '',
    subject_prompt TEXT DEFAULT '',
    modules TEXT DEFAULT '[]',
    structure_version INTEGER NOT NULL DEFAULT 0,
    source_chain_id TEXT,
    source_chain_name TEXT,
    source_chain_type TEXT,
    external_source TEXT,
    external_id TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    favorite_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_local_history_user_created
    ON local_generation_history(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS vibe_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT,
    original_type TEXT,
    thumbnail_key TEXT,
    thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vibe_encodings (
    id TEXT PRIMARY KEY,
    vibe_id TEXT NOT NULL,
    model TEXT NOT NULL,
    model_key TEXT NOT NULL,
    information_extracted REAL NOT NULL,
    encoding_key TEXT NOT NULL,
    encoding_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(vibe_id, model, information_extracted)
  );
  CREATE TABLE IF NOT EXISTS vibe_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slots TEXT NOT NULL DEFAULT '[]',
    normalize_strengths INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS character_reference_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_hash TEXT NOT NULL UNIQUE,
    original_key TEXT NOT NULL,
    original_type TEXT NOT NULL,
    thumbnail_key TEXT,
    thumbnail_type TEXT,
    default_strength REAL NOT NULL DEFAULT 0.6,
    default_fidelity REAL NOT NULL DEFAULT 0.6,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;
