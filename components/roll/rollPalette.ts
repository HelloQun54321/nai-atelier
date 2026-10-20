import { t } from '../../services/i18n';
import type { RollTag } from '../../services/styleRoll';

/**
 * Roll 画师配色：等色相间隔、等明度的低饱和 12 色。
 *
 * 色带、详情面板头像方块、权重条、徽章色点共用这一份，保证同一位画师处处同色。
 * 色相按 30° 均匀排布，相邻段只是明度相近的柔和过渡，不会像高饱和轮转那样在
 * 4px 高度上变成彩色噪声。
 *
 * 12 个槽位同时也是卡片色带最多画出的段数；超过就把尾部合并成一段中性灰。
 */
export const ROLL_ARTIST_SLOTS = 12;

/** 叠在作品上的色带用：偏亮，压在暗槽上仍可辨认。 */
export const ROLL_BAND_COLORS = [
  '#7ba8d5', '#7b7bd5', '#a87bd5', '#d57bd5', '#d57ba8', '#d57b7b',
  '#d5a87b', '#d5d57b', '#a8d57b', '#7bd57b', '#7bd5a8', '#7bd5d5',
] as const;

/** 详情面板的头像方块与权重条用：更深，才能承载白色文字。 */
export const ROLL_CHIP_COLORS = [
  '#3973ac', '#3939ac', '#7339ac', '#ac39ac', '#ac3973', '#ac3939',
  '#ac7339', '#acac39', '#73ac39', '#39ac39', '#39ac73', '#39acac',
] as const;

/** 色板装不下时的合并段。 */
export const ROLL_OVERFLOW_COLOR = '#7d8694';

const wrap = (index: number, size: number) => ((index % size) + size) % size;

export const rollBandColor = (index: number): string => ROLL_BAND_COLORS[wrap(index, ROLL_ARTIST_SLOTS)];

export const rollChipColor = (index: number): string => ROLL_CHIP_COLORS[wrap(index, ROLL_ARTIST_SLOTS)];

export interface RollBandSegment {
  key: string;
  /** 悬停提示：画师与权重，合并段说明被折叠的画师数。 */
  label: string;
  /** 占整条色带的比例，渲染时作为 flexGrow 使用。 */
  pct: number;
  color: string;
}

/**
 * 计算卡片底部占比色带的分段。
 *
 * 颜色锚定画师在原串里的位置（不是色带上的位置），所以按权重降序铺开之后
 * 仍然能在详情面板里按颜色对上某一行；色板放不下的尾部合并成一段中性灰，
 * 避免第 13 位画师开始重新用回第一个颜色。
 */
export const buildRollWeightBand = (tags: readonly RollTag[]): RollBandSegment[] => {
  if (!tags.length) return [];
  const total = tags.reduce((sum, tag) => sum + Math.max(0.1, tag.weight), 0) || 1;
  const rows = tags.map((tag, index) => {
    const weight = Math.max(0.1, tag.weight);
    return { tag: tag.tag, index, weight, pct: weight / total };
  });
  const shown = rows.length > ROLL_ARTIST_SLOTS ? [...rows].sort((a, b) => b.weight - a.weight).slice(0, ROLL_ARTIST_SLOTS) : rows;
  const segments: RollBandSegment[] = [...shown]
    .sort((a, b) => b.weight - a.weight)
    .map(row => ({ key: row.tag, label: `${row.tag}: ${row.weight.toFixed(1)}`, pct: row.pct, color: rollBandColor(row.index) }));
  if (shown.length < rows.length) {
    const used = segments.reduce((sum, item) => sum + item.pct, 0);
    segments.push({ key: '__rest__', label: t('另外 {0} 位画师', [rows.length - shown.length]), pct: Math.max(0, 1 - used), color: ROLL_OVERFLOW_COLOR });
  }
  return segments;
};
