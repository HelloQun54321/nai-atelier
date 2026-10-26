import { afterEach, expect, it, vi } from 'vitest';
import { drawLibraryIndices, type LibraryRandomMode } from '../../services/libraryRandom';

afterEach(() => vi.restoreAllMocks());
const seededRandom = (seed = 42) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

it.each(['mixed', 'uniform', 'popular'] as const)('%s：小池近期耗尽后仍能随机换批，不顺序固定为前12位', mode => {
  const random = vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const recent: number[][] = [];
  const batches: string[] = [];
  for (let round = 0; round < 8; round++) {
    const indices = drawLibraryIndices(13, 12, mode, recent);
    expect(new Set(indices).size).toBe(12);
    expect(indices.every(index => index >= 0 && index < 13)).toBe(true);
    recent.push(indices);
    if (recent.length > 5) recent.shift();
    if (round >= 2) batches.push([...indices].sort((a, b) => a - b).join(','));
  }
  expect(new Set(batches).size).toBeGreaterThan(1);
  expect(random).toHaveBeenCalledTimes(13 * 8);
});

it('先取全部非近期候选，再无重复补足；池不足时只取实际人数', () => {
  vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const indices = drawLibraryIndices(10, 4, 'uniform', [[0, 1, 2, 3, 4, 5, 6, 7]]);
  expect(indices.slice(0, 2).sort()).toEqual([8, 9]);
  expect(new Set(indices).size).toBe(4);
  expect(drawLibraryIndices(3, 6, 'uniform', [[0, 1, 2]]).sort()).toEqual([0, 1, 2]);
  expect(drawLibraryIndices(0, 6, 'uniform', [])).toEqual([]);
  expect(drawLibraryIndices(10, 0, 'uniform', [])).toEqual([]);
});

it('均匀模式覆盖全池，热门偏向前段，混合在小池中与均匀模式一致', () => {
  const firstHalfRate = (mode: LibraryRandomMode, total: number) => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom());
    let firstHalf = 0;
    for (let draw = 0; draw < 400; draw++) if (drawLibraryIndices(total, 1, mode, [])[0] < total / 2) firstHalf++;
    return firstHalf / 400;
  };
  const uniform = firstHalfRate('uniform', 40);
  expect(uniform).toBeGreaterThan(0.4);
  expect(uniform).toBeLessThan(0.6);
  expect(firstHalfRate('popular', 40)).toBeGreaterThan(0.65);
  expect(firstHalfRate('mixed', 40)).toBe(uniform);
});

it('混合模式仍可抽到前两万名之外的长尾候选', () => {
  let index = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => index++ === 20_000 ? 0 : 0.5);
  expect(drawLibraryIndices(20_001, 1, 'mixed', [])).toEqual([20_000]);
});

it.each(['mixed', 'uniform', 'popular'] as const)('%s：未传与空排除集合保持原抽取结果', mode => {
  const random = vi.spyOn(Math, 'random');
  const draw = (excluded?: ReadonlySet<number>) => {
    random.mockImplementation(seededRandom());
    return drawLibraryIndices(40, 12, mode, [[0, 2, 4]], excluded);
  };
  const original = draw();
  expect(draw(new Set())).toEqual(original);
});

it.each(['mixed', 'uniform', 'popular'] as const)('%s：排除项不参与随机或近期补位，池不足只取实际人数', mode => {
  const random = vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const excluded = new Set([0, 2]);
  expect(drawLibraryIndices(4, 4, mode, [[1, 3]], excluded).sort()).toEqual([1, 3]);
  expect(drawLibraryIndices(4, 4, mode, [[0, 1, 2, 3]], excluded).sort()).toEqual([1, 3]);
  expect(random).toHaveBeenCalledTimes(4);
  expect(drawLibraryIndices(4, 4, mode, [], new Set([0, 1, 2, 3]))).toEqual([]);
  expect(random).toHaveBeenCalledTimes(4);
});

it.each(['mixed', 'uniform', 'popular'] as const)('%s：排除后仍满批不重复，近期耗尽也不顺序补入', mode => {
  vi.spyOn(Math, 'random').mockImplementation(seededRandom());
  const batches = Array.from({ length: 6 }, () => drawLibraryIndices(15, 12, mode, [Array.from({ length: 15 }, (_, index) => index)], new Set([0, 2])));
  for (const batch of batches) {
    expect(batch).toHaveLength(12);
    expect(new Set(batch).size).toBe(12);
    expect(batch.some(index => index === 0 || index === 2)).toBe(false);
  }
  expect(new Set(batches.map(batch => [...batch].sort((a, b) => a - b).join(','))).size).toBeGreaterThan(1);
});

it('排除不重编号，非近期候选仍先于近期候选', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  expect(drawLibraryIndices(5, 4, 'uniform', [[1, 3]], new Set([0, 2]))).toEqual([4, 1, 3]);
});

it('排除后热门模式仍按原池排名计算权重', () => {
  vi.spyOn(Math, 'random').mockReturnValueOnce(0.6).mockReturnValueOnce(0.35);
  expect(drawLibraryIndices(4, 1, 'popular', [], new Set([0, 2]))).toEqual([3]);
});
