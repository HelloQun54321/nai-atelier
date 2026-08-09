
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS chains;
DROP TABLE IF EXISTS artists;
DROP TABLE IF EXISTS inspirations;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS sessions;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at INTEGER,
  last_login INTEGER,
  storage_usage INTEGER DEFAULT 0,
  max_storage INTEGER DEFAULT 314572800
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE chains (
  id TEXT PRIMARY KEY,
  user_id TEXT, 
  username TEXT, 
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  preview_image TEXT,
  base_prompt TEXT DEFAULT '',
  negative_prompt TEXT DEFAULT '',
  modules TEXT DEFAULT '[]',
  params TEXT DEFAULT '{}',
  variable_values TEXT DEFAULT '{}', -- 新增字段
  guest_hidden INTEGER NOT NULL DEFAULT 0, -- 游客不可见标记
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  preview_url TEXT,
  benchmarks TEXT
);

CREATE TABLE inspirations (
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

CREATE TABLE inspiration_boards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE local_generation_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_type TEXT DEFAULT 'image/png',
  prompt TEXT DEFAULT '',
  negative_prompt TEXT DEFAULT '',
  params TEXT DEFAULT '{}',
  source_chain_id TEXT,
  source_chain_name TEXT,
  source_chain_type TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  favorite_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_local_history_user_created
  ON local_generation_history(user_id, created_at DESC);

CREATE INDEX idx_local_history_user_favorite_created
  ON local_generation_history(user_id, is_favorite, created_at DESC);
