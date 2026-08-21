import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampUsagePercent,
  usagePercentPerDay,
  usageRemainingImages,
} from '../services/naiUsage.ts';

// 这些断言逐条对照 NovelAI Web 应用 2026-08-22 版 bundle 的 Opus 限额映射：
//   clamp:  isNegative ? 0 : min(100, max(0, percent))
//   perDay: timeUntilNextPercent <= 0 ? 0 : round(86400 / timeUntilNextPercent * 10) / 10
//   images: round(17.3 * clampedPercent)
test('Opus 限额剩余百分比按官方规则钳制', () => {
  assert.equal(clampUsagePercent({ percent: 40, isNegative: false, timeUntilNextPercent: 1500 }), 40);
  assert.equal(clampUsagePercent({ percent: 120, isNegative: false, timeUntilNextPercent: 1500 }), 100);
  assert.equal(clampUsagePercent({ percent: -3, isNegative: false, timeUntilNextPercent: 1500 }), 0);
  // 透支时无论 percent 字段为何值都显示 0。
  assert.equal(clampUsagePercent({ percent: 40, isNegative: true, timeUntilNextPercent: 1500 }), 0);
});

test('Opus 限额每日恢复百分比与官方公式一致', () => {
  assert.equal(usagePercentPerDay({ percent: 40, isNegative: false, timeUntilNextPercent: 1500 }), 57.6);
  assert.equal(usagePercentPerDay({ percent: 40, isNegative: false, timeUntilNextPercent: 86400 }), 1);
  // 恢复耗尽或字段异常时按 0 处理。
  assert.equal(usagePercentPerDay({ percent: 40, isNegative: false, timeUntilNextPercent: 0 }), 0);
  assert.equal(usagePercentPerDay({ percent: 40, isNegative: false, timeUntilNextPercent: -5 }), 0);
});

test('Opus 限额剩余张数按官方 17.3 系数换算', () => {
  assert.equal(usageRemainingImages({ percent: 40, isNegative: false, timeUntilNextPercent: 1500 }), 692);
  assert.equal(usageRemainingImages({ percent: 100, isNegative: false, timeUntilNextPercent: 1500 }), 1730);
  assert.equal(usageRemainingImages({ percent: 0, isNegative: false, timeUntilNextPercent: 1500 }), 0);
  assert.equal(usageRemainingImages({ percent: 40, isNegative: true, timeUntilNextPercent: 1500 }), 0);
});
