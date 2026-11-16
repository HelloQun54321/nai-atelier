// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readSafeModeStartupPreference } from '../../services/safeModePreferences';

describe('安全模式启动偏好', () => {
  it('无本地记录时默认关闭', () => {
    expect(readSafeModeStartupPreference({ getItem: () => null })).toBe(false);
  });

  it('仅显式 true 视为开启', () => {
    expect(readSafeModeStartupPreference({ getItem: () => 'true' })).toBe(true);
    expect(readSafeModeStartupPreference({ getItem: () => 'false' })).toBe(false);
    expect(readSafeModeStartupPreference({ getItem: () => '' })).toBe(false);
  });

  it('读取失败时回落为关闭', () => {
    expect(readSafeModeStartupPreference({
      getItem: () => {
        throw new Error('storage blocked');
      },
    })).toBe(false);
  });
});
