
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
  created_at INTEGER
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
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_local_history_user_created
  ON local_generation_history(user_id, created_at DESC);

-- 访问日志表（用于统计）
CREATE TABLE access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  username TEXT,
  role TEXT,
  ip TEXT,
  user_agent TEXT,
  action TEXT,
  category TEXT DEFAULT 'auth',
  status TEXT DEFAULT 'success',
  method TEXT,
  path TEXT,
  resource_type TEXT,
  resource_id TEXT,
  message TEXT,
  metadata TEXT,
  duration_ms INTEGER,
  created_at INTEGER
);

CREATE INDEX idx_access_logs_created_at ON access_logs(created_at);
CREATE INDEX idx_access_logs_role ON access_logs(role);
CREATE INDEX idx_access_logs_category ON access_logs(category);
CREATE INDEX idx_access_logs_status ON access_logs(status);

-- 每日统计表（按日聚合）
CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  total_requests INTEGER DEFAULT 0,
  api_requests INTEGER DEFAULT 0,
  guest_logins INTEGER DEFAULT 0,
  user_logins INTEGER DEFAULT 0,
  generate_requests INTEGER DEFAULT 0
);
