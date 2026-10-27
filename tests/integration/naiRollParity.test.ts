import { describe, expect, it } from 'vitest';
import { KINDS, constraintsOf, contentRead, contentSnapshotOf } from '../../services/contentRoll';
import type { RollRow } from '../../services/contentRoll';
import { draw, evidenceOf, poolFingerprint, poolOf, replay, rerollOne } from '../../services/contentRollDraw';
import fragment from '../../tools/nai-roll/patches/roll/core.mjs';

/**
 * 产物侧与源码侧的**语义一致性**回归（跨模块）。
 *
 * `tools/nai-roll/patches/roll/core.mjs` 是注入到已发布产物的那份纯逻辑核；
 * `services/contentRoll*.ts` 已扩展为动态目录 v2；原型 v1 固定作为旧六类兼容基线。
 * 旧内容、约束与抽取证据仍须一致，动态目录由源码侧单独验证。
 *
 * 这里只依赖纯函数，不需要已安装应用、不需要网络，因此在 CI 里可以常规运行。
 */

/* fragment 是没有类型的 JS，这里统一放宽 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remote = fragment as any;

const chain = (kind: string, index: number) => ({
  id: `${kind}-${index}`, type: kind, name: `${kind} ${index}`,
  basePrompt: `${kind}_${index}_tag, shared_tag`, negativePrompt: '',
  tags: ['基线'], description: '', previewImage: '', updatedAt: 1700000000000 + index,
  params: { _wardrobe: { bilingual: '', facets: { hair: 'blonde', accessory: '__none__', mystery: 'x' } } },
});
const chains = KINDS.flatMap(kind => [3, 1, 2].map(index => chain(kind, index)));

const idsOf = (result: { picks: Record<string, RollRow> }) =>
  Object.fromEntries(KINDS.map(kind => [kind, result.picks[kind]?.id || '']));
const reasonsOf = (result: { picks: Record<string, RollRow> }) =>
  Object.fromEntries(KINDS.map(kind => [kind, result.picks[kind]?.reason || '']));

describe('产物片段与源码服务的语义一致性', () => {
  it('池子与候选池指纹一致', () => {
    for (const kind of KINDS) {
      const mine = poolOf(chains, kind);
      const theirs = remote.poolOf(chains, kind);
      expect(mine.map(item => item.id)).toEqual(theirs.map((item: { id: string }) => item.id));
      expect(poolFingerprint(mine)).toBe(remote.poolFingerprint(theirs));
    }
  });

  it('同随机码抽取逐栏一致（条目与理由）', () => {
    for (const seed of ['r-parity', 'r-parity-2', 'r0']) {
      const mine = draw({ chains, seed });
      const theirs = remote.draw({ chains, seed });
      expect(idsOf(mine)).toEqual(idsOf(theirs));
      expect(reasonsOf(mine)).toEqual(reasonsOf(theirs));
      expect(mine.seeds).toEqual(theirs.seeds);
    }
  });

  it('固定项、未参与、空库三种状态结论一致', () => {
    const input = { chains, seed: 'r-parity', locked: { pose: 'pose-2' }, checks: { camera: false } };
    const mine = draw(input);
    const theirs = remote.draw(input);
    expect(idsOf(mine)).toEqual(idsOf(theirs));
    expect(reasonsOf(mine)).toEqual(reasonsOf(theirs));
    const noCamera = chains.filter(item => item.type !== 'camera');
    expect(reasonsOf(draw({ chains: noCamera, seed: 's' })))
      .toEqual(reasonsOf(remote.draw({ chains: noCamera, seed: 's' })));
  });

  it('单栏重抽与按记录还原一致', () => {
    const mine = draw({ chains, seed: 'r-parity' });
    const theirs = remote.draw({ chains, seed: 'r-parity' });
    const mineReroll = rerollOne({ chains, checks: mine.checks, locked: mine.locked, picks: mine.picks }, 'pose', 'r-next');
    const theirsReroll = remote.rerollOne({ chains, checks: theirs.checks, locked: theirs.locked, picks: theirs.picks }, 'pose', 'r-next');
    expect(mineReroll.ok).toBe(theirsReroll.ok);
    expect(mineReroll.row?.id).toBe(theirsReroll.row.id);

    const mineReplay = replay({ chains }, mine);
    const theirsReplay = remote.replay({ chains }, theirs);
    expect(idsOf(mineReplay)).toEqual(idsOf(theirsReplay));
    expect(mineReplay.restored).toBe(theirsReplay.restored);
    expect(mineReplay.redrawn).toBe(theirsReplay.redrawn);
  });

  it('纯内容快照、白名单读取与四态约束派生一致', () => {
    const mine = draw({ chains, seed: 'r-parity' });
    const theirs = remote.draw({ chains, seed: 'r-parity' });
    const mineSnapshot = contentSnapshotOf(mine, 'T')!;
    const theirsSnapshot = remote.contentSnapshotOf(theirs, 'T');
    expect(mineSnapshot.version).toBe(2);
    expect(theirsSnapshot.version).toBe(1);
    expect(mineSnapshot).toEqual({ ...theirsSnapshot, version: 2 });
    const legacyRead = remote.contentRead(theirsSnapshot);
    for (const snapshot of [theirsSnapshot, mineSnapshot]) {
      const { items, ...read } = contentRead(snapshot);
      expect(items).toEqual([]);
      expect(read).toEqual({ ...legacyRead, version: snapshot.version });
    }
    for (const entry of chains.slice(0, 6)) {
      expect(constraintsOf(entry)).toEqual(remote.constraintsOf(entry));
    }
    expect(evidenceOf({ ...mine, chains })).toEqual(remote.evidenceOf({ ...theirs, chains }));
  });

  it.each(['character', 'global'] as const)('v2 动态目录 %s 的内容与来源往返保留，独立于源条目和读取副本', scope => {
    const row = {
      kind: 'directory:custom-eyes', filled: true, scope,
      directoryName: '眼睛', directoryPath: ['自定义人物', '眼睛'],
      text: '1.2::blue eyes::, blue eyes', negative: 'closed eyes',
      constraintNotes: '明确没有：配饰（条目声明的缺席约束）',
      meta: { source: 'library', entryId: 'eyes-1', entryName: '蓝眼睛', entryBasePrompt: '1.2::blue eyes::, blue eyes' },
      params: { steps: 99 }, basePrompt: '不应带入的画师串',
    };
    const input = { picks: { [row.kind]: row }, seed: 'dynamic-seed' };
    const before = structuredClone(input);
    const snapshot = contentSnapshotOf(input, 'T')!;
    expect(input).toEqual(before);
    expect(snapshot.version).toBe(2);
    const expected = [{
      unitId: 'directory:custom-eyes', directoryId: 'custom-eyes', directoryName: '眼睛',
      directoryPath: ['自定义人物', '眼睛'], scope,
      text: '1.2::blue eyes::, blue eyes', negative: 'closed eyes',
      constraintNotes: '明确没有：配饰（条目声明的缺席约束）',
      meta: { source: 'library', entryId: 'eyes-1', entryName: '蓝眼睛', entryBasePrompt: '1.2::blue eyes::, blue eyes', needsReview: false },
    }];
    expect(snapshot.items).toEqual(expected);
    expect(snapshot).not.toHaveProperty('params');
    expect(snapshot).not.toHaveProperty('basePrompt');
    row.text = 'changed'; row.negative = 'changed'; row.directoryPath.push('changed'); row.meta.entryName = 'changed';
    const read = contentRead(snapshot);
    expect(read.ok).toBe(true);
    expect(read.warnings).toEqual([]);
    expect(read.items).toEqual(expected);
    expect(read.anyRole).toBe(scope === 'character');
    expect(read.anyGlobal).toBe(scope === 'global');
    expect(read.roll?.seed).toBe('dynamic-seed');
    read.items[0].directoryPath.push('reader change');
    read.items[0].meta!.entryName = 'reader change';
    expect(contentRead(snapshot).items).toEqual(expected);
  });
});
