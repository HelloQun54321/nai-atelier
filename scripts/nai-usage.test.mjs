import assert from 'node:assert/strict';
import test from 'node:test';
import {
  usagePercentPerDay,
  usageRemainingImages,
  usageRemainingPercent,
} from '../services/naiUsage.ts';

// 这些断言覆盖 NovelAI Opus 限额接口映射：
//   percent: 透支归零，否则保留活动加成后可超过 100 的官方原始值
//   perDay: timeUntilNextPercent <= 0 ? 0 : round(86400 / timeUntilNextPercent * 10) / 10
//   images: round(17.3 * realPercent)
test('Opus 限额剩余百分比保留官方活动加成后的真实值', () => {
  assert.equal(usageRemainingPercent({ percent: 40, isNegative: false, timeUntilNextPercent: 1500 }), 40);
  assert.equal(usageRemainingPercent({ percent: 196, isNegative: false, timeUntilNextPercent: 0 }), 196);
  assert.equal(usageRemainingPercent({ percent: -3, isNegative: false, timeUntilNextPercent: 1500 }), 0);
  // 透支时无论 percent 字段为何值都显示 0。
  assert.equal(usageRemainingPercent({ percent: 40, isNegative: true, timeUntilNextPercent: 1500 }), 0);
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
  assert.equal(usageRemainingImages({ percent: 196, isNegative: false, timeUntilNextPercent: 0 }), 3391);
  assert.equal(usageRemainingImages({ percent: 0, isNegative: false, timeUntilNextPercent: 1500 }), 0);
  assert.equal(usageRemainingImages({ percent: 40, isNegative: true, timeUntilNextPercent: 1500 }), 0);
});
