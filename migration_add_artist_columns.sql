-- 迁移文件：为 artists 表添加缺失的列
-- 执行时间：2026-03-25
-- 描述：添加 preview_url 和 benchmarks 列以支持画师基准测试图片功能

-- 添加 preview_url 列（如果不存在）
ALTER TABLE artists ADD COLUMN preview_url TEXT;

-- 添加 benchmarks 列（如果不存在）
ALTER TABLE artists ADD COLUMN benchmarks TEXT;
