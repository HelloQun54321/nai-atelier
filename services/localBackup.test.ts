import { describe, it, expect } from 'vitest';
import { formatBytes, formatBackupDate } from './localBackup';

describe('localBackup frontend utils', () => {
  it('formatBytes 正确格式化字节大小', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(7113155424)).toBe('6.6 GB');
  });

  it('formatBackupDate 正确格式化日期时间', () => {
    expect(formatBackupDate('')).toBe('未知');
    expect(formatBackupDate(null)).toBe('未知');
    const date = new Date('2026-08-27T21:19:45.000Z');
    const formatted = formatBackupDate(date.toISOString());
    expect(formatted).not.toBe('未知');
  });
});
