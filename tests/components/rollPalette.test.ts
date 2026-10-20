import { describe, expect, it } from 'vitest';
import { ROLL_ARTIST_SLOTS, ROLL_OVERFLOW_COLOR, buildRollWeightBand, rollBandColor } from '../../components/roll/rollPalette';

const tags = (...items: Array<[string, number]>) => items.map(([tag, weight]) => ({ tag, weight }));

describe('Roll 画师权重色带', () => {
  it('按权重降序铺开，颜色跟着画师走而不是跟着位置走', () => {
    const band = buildRollWeightBand(tags(['a', 0.8], ['b', 1.4], ['c', 1.0]));
    expect(band.map(segment => segment.key)).toEqual(['b', 'c', 'a']);
    // 原串索引：a=0、b=1、c=2；排序后颜色仍应指回各自那一行
    expect(band[0].color).toBe(rollBandColor(1));
    expect(band[1].color).toBe(rollBandColor(2));
    expect(band[2].color).toBe(rollBandColor(0));
    expect(band[0].label).toBe('b: 1.4');
  });

  it('色板容量以内每位画师独占一段，颜色不重复', () => {
    const items = Array.from({ length: ROLL_ARTIST_SLOTS }, (_, index) => [`artist-${index}`, 1] as [string, number]);
    const band = buildRollWeightBand(tags(...items));
    expect(band).toHaveLength(ROLL_ARTIST_SLOTS);
    expect(new Set(band.map(segment => segment.color)).size).toBe(ROLL_ARTIST_SLOTS);
    expect(band.some(segment => segment.key === '__rest__')).toBe(false);
  });

  it('超过色板容量时只留权重最高的若干位，其余合并且总占比仍为 1', () => {
    const items = Array.from({ length: ROLL_ARTIST_SLOTS + 3 }, (_, index) => [`artist-${index}`, (index + 1) / 10] as [string, number]);
    const band = buildRollWeightBand(tags(...items));
    expect(band).toHaveLength(ROLL_ARTIST_SLOTS + 1);
    expect(band[0].key).toBe(`artist-${ROLL_ARTIST_SLOTS + 2}`);
    expect(band[ROLL_ARTIST_SLOTS - 1].key).toBe('artist-3');
    expect(band[ROLL_ARTIST_SLOTS].key).toBe('__rest__');
    expect(band[ROLL_ARTIST_SLOTS].color).toBe(ROLL_OVERFLOW_COLOR);
    expect(band[ROLL_ARTIST_SLOTS].label).toContain('3');
    expect(band.reduce((sum, segment) => sum + segment.pct, 0)).toBeCloseTo(1, 10);
  });

  it('权重低于 0.1 时按 0.1 计入，避免出现零宽段', () => {
    const band = buildRollWeightBand(tags(['zero', 0], ['half', 0.2]));
    expect(band.map(segment => segment.key)).toEqual(['half', 'zero']);
    expect(band[1].pct).toBeCloseTo(1 / 3, 10);
  });

  it('没有画师时不产生分段', () => {
    expect(buildRollWeightBand([])).toEqual([]);
  });
});
