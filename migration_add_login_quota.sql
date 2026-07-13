-- 用户管理界面增强 - 数据库迁移脚本
-- 添加最后登录时间和最大配额字段

-- 1. 添加 last_login 字段
ALTER TABLE users ADD COLUMN last_login INTEGER;

-- 2. 添加 max_storage 字段（默认 300MB = 314572800 字节）
ALTER TABLE users ADD COLUMN max_storage INTEGER DEFAULT 314572800;

-- 3. 为现有用户设置默认最大配额
UPDATE users SET max_storage = 314572800 WHERE max_storage IS NULL;

-- 验证：查看更新后的表结构
-- SELECT sql FROM sqlite_master WHERE type='table' AND name='users';
