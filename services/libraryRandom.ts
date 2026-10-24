export type LibraryRandomMode = 'mixed' | 'uniform' | 'popular';

/** 目录按热度降序传入；先避让近期条目，不足时按同一概率补足，整批无重复。 */
export function drawLibraryIndices(total: number, count: number, mode: LibraryRandomMode, recent: readonly (readonly number[])[]): number[] {
  if (total <= 0 || count <= 0) return [];
  const recentIndices = new Set(recent.flat());
  const activePool = Math.min(total, 20_000);
  return Array.from({ length: total }, (_, index) => {
    const weight = mode === 'popular'
      ? Math.pow((index + 1) / total, 1 / 2.3) - Math.pow(index / total, 1 / 2.3)
      : mode === 'mixed' ? 0.3 / total + (index < activePool ? 0.7 / activePool : 0) : 1 / total;
    // 指数竞赛按权重无放回抽样，避免拒绝采样耗尽后顺序补入热门条目。
    return { index, recent: Number(recentIndices.has(index)), score: -Math.log1p(-Math.random()) / weight };
  }).sort((left, right) => left.recent - right.recent || left.score - right.score || left.index - right.index)
    .slice(0, Math.min(count, total)).map(entry => entry.index);
}
