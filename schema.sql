-- NAI Atelier 数据库结构参考快照（勿手工执行）
--
-- 运行时真源是 worker/index.ts 内嵌的 INIT_SQL 与 initDB/ensure* 自愈逻辑：worker 每次启动
-- 会自动建表、补列，本文件仅作为人读的结构参考，由开发者在改动 INIT_SQL 时同步更新。
-- 历史一次性迁移见 migration_*.sql；vibe/aitag 等延迟创建的表由 ensure* 函数负责。
-- 与旧版的区别：不再包含具破坏性的 DROP TABLE，列清单与 worker 实际写入保持一致。

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


-- ---------------------------------------------------------------------------
-- initDB 的自愈补列（已存在的库执行时静默跳过）
-- ---------------------------------------------------------------------------
-- ALTER TABLE chains ADD COLUMN user_id TEXT;
-- ALTER TABLE chains ADD COLUMN username TEXT;
-- ALTER TABLE chains ADD COLUMN variable_values TEXT DEFAULT '{}';
-- ALTER TABLE chains ADD COLUMN type TEXT DEFAULT 'style';
-- ALTER TABLE chains ADD COLUMN guest_hidden INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE inspirations ADD COLUMN user_id TEXT;
-- ALTER TABLE inspirations ADD COLUMN username TEXT;
-- ALTER TABLE inspirations ADD COLUMN negative_prompt TEXT DEFAULT '';
-- ALTER TABLE inspirations ADD COLUMN params TEXT;
-- ALTER TABLE artists ADD COLUMN preview_url TEXT;
-- ALTER TABLE artists ADD COLUMN benchmarks TEXT DEFAULT '[]';

-- 延迟创建的表（结构以 worker/index.ts 的 ensure* 函数为准）：
--   settings、vibe_assets、vibe_encodings、vibe_groups、character_reference_assets、
--   aitag_cache_*、local_generation_history（含 external_source/external_id 唯一索引）
