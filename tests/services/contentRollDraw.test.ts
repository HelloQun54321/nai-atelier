import { describe, expect, it } from 'vitest';
import { ALGO, KINDS, LEGACY_ALGO } from '../../services/contentRoll';
import {
  draw,
  describe as describeRoll,
  drawOne,
  evidenceOf,
  normalizeSeed,
  poolOf,
  poolsOf,
  replay,
  rerollOne,
  samePicks,
  toSections,
} from '../../services/contentRollDraw';

/** 造一批词库条目：每个库 3 条，id 故意乱序，用于验证「与接口返回顺序无关」。 */
const chain = (kind: string, index: number) => ({
  id: `${kind}-${index}`, type: kind, name: `${kind} ${index}`,
  basePrompt: `${kind}_${index}_tag, shared_tag`, negativePrompt: '',
  tags: [], description: '', updatedAt: 1700000000000 + index,
  params: { _wardrobe: { bilingual: '', facets: {} } },
});
const chains = ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera']
  .flatMap(kind => [3, 1, 2].map(index => chain(kind, index)));

const idsOf = (result: { picks: Record<string, { id?: string }> }) =>
  Object.fromEntries(KINDS.map(kind => [kind, result.picks[kind]?.id || '']));

describe('池子与随机流', () => {
  it('按 type 取池并按 id 排序，结果与接口返回顺序无关', () => {
    expect(poolOf(chains, 'appearance').map(item => item.id)).toEqual(['appearance-1', 'appearance-2', 'appearance-3']);
    const shuffled = [...chains].reverse();
    expect(poolOf(shuffled, 'appearance').map(item => item.id)).toEqual(['appearance-1', 'appearance-2', 'appearance-3']);
    expect(poolsOf(chains).appearance).toHaveLength(3);
    expect(poolOf(chains, 'unknown_kind')).toHaveLength(0);
  });

  it('同一个随机码两次抽取完全一致；换随机码至少换掉一栏', () => {
    const first = draw({ chains, seed: 'r-seed' });
    const again = draw({ chains, seed: 'r-seed' });
    expect(idsOf(first)).toEqual(idsOf(again));
    expect(first.seed).toBe(normalizeSeed('r-seed'));
    expect(first.algo).toBe(ALGO);
    const other = draw({ chains, seed: 'r-seed-2' });
    expect(KINDS.some(kind => other.picks[kind].id !== first.picks[kind].id)).toBe(true);
  });

  it('每栏独立随机流：让某一栏不参与，其它栏抽到的条目完全不变', () => {
    const all = draw({ chains, seed: 'r-seed' });
    const skipWardrobe = draw({ chains, seed: 'r-seed', checks: { wardrobe: false } });
    for (const kind of KINDS) {
      if (kind === 'wardrobe') {
        expect(skipWardrobe.picks.wardrobe.reason).toBe('unchecked');
        expect(skipWardrobe.picks.wardrobe.filled).toBe(false);
        continue;
      }
      expect(skipWardrobe.picks[kind].id).toBe(all.picks[kind].id);
    }
  });

  it('空库留空并给出说明；固定项生效；固定项失效改为重抽并说明', () => {
    const noCamera = chains.filter(item => item.type !== 'camera');
    const empty = draw({ chains: noCamera, seed: 'r-seed' });
    expect(empty.picks.camera.reason).toBe('empty');
    expect(empty.notes.some(note => note.code === 'pool_empty' && note.kind === 'camera')).toBe(true);

    const locked = draw({ chains, seed: 'r-seed', locked: { pose: 'pose-2' } });
    expect(locked.picks.pose.id).toBe('pose-2');
    expect(locked.picks.pose.reason).toBe('locked');
    const lockedOtherSeed = draw({ chains, seed: 'r-seed-9', locked: { pose: 'pose-2' } });
    expect(lockedOtherSeed.picks.pose.id).toBe('pose-2');

    const missing = draw({ chains, seed: 'r-seed', locked: { pose: 'pose-404' } });
    expect(missing.notes.some(note => note.code === 'lock_missing')).toBe(true);
    expect(missing.picks.pose.id.startsWith('pose-')).toBe(true);
  });

  it('单栏重抽排除当前条目；候选不足时保留并说明', () => {
    const single = drawOne(chains, 'appearance', 'r-avoid', 'appearance-1');
    expect(single.row.id).not.toBe('appearance-1');
    expect(single.note).toBe('');

    const onlyOne = [chain('camera', 1)];
    const short = drawOne(onlyOne, 'camera', 'r-avoid', 'camera-1');
    expect(short.row.id).toBe('camera-1');
    expect(short.note).toBe('avoid_short');
  });
});

describe('单栏「换一个」的拒绝理由', () => {
  const base = draw({ chains, seed: 'r-seed' });

  it('未参与 / 已固定 / 空库 / 只有 1 条 分别给出明确理由', () => {
    expect(rerollOne({ ...base, chains, checks: { ...base.checks, pose: false } }, 'pose', 'r-next').code).toBe('unchecked');
    expect(rerollOne({ ...base, chains, locked: { ...base.locked, pose: base.picks.pose.id } }, 'pose', 'r-next').code).toBe('locked');
    expect(rerollOne({ ...base, chains: chains.filter(item => item.type !== 'camera') }, 'camera', 'r-next').code).toBe('empty');
    expect(rerollOne({ ...base, chains: [chain('camera', 1)] }, 'camera', 'r-next').code).toBe('single');
    expect(rerollOne({ ...base, chains }, 'nope', 'r-next').code).toBe('unknown_kind');
  });

  it('换成功时只动这一栏，其它栏保持不动', () => {
    const result = rerollOne({ ...base, chains }, 'pose', 'r-next');
    expect(result.ok).toBe(true);
    const next = result.row!;
    expect(next.id).not.toBe(base.picks.pose.id);
    expect(next.reason).toBe('ok');
  });
});

describe('按记录还原', () => {
  const first = draw({ chains, seed: 'r-seed' });

  it('条目还在就原样还原（reason = replay），并统计还原条数', () => {
    const restored = replay({ chains }, first);
    expect(idsOf(restored)).toEqual(idsOf(first));
    for (const kind of KINDS) expect(restored.picks[kind].reason).toBe('replay');
    expect(restored.restored).toBe(KINDS.length);
    expect(restored.redrawn).toBe(0);
  });

  it('条目被删掉时按同一个随机码重抽，并说明原因', () => {
    const removed = chains.filter(item => item.id !== first.picks.scene.id);
    const result = replay({ chains: removed }, first);
    expect(result.picks.scene.id).not.toBe(first.picks.scene.id);
    expect(result.redrawn).toBeGreaterThan(0);
    expect(result.notes.some(note => note.code === 'entry_missing' && note.kind === 'scene')).toBe(true);
  });

  it('旧记录（没有 algo）按旧算法版本解释，不谎称是新算法还原', () => {
    const legacy = { ...first, algo: undefined };
    expect(replay({ chains }, legacy).algo).toBe(LEGACY_ALGO);
  });
});

describe('落点分工与证据', () => {
  const result = draw({ chains, seed: 'r-seed' });

  it('全局两栏进 global、角色四栏进 character，并记录实际写入的栏', () => {
    const sections = toSections(result.picks);
    expect(sections.global.scene).toBe(result.picks.scene.text);
    expect(sections.global.camera).toBe(result.picks.camera.text);
    expect(sections.character.appearance).toBe(result.picks.appearance.text);
    expect(sections.character.pose).toBe(result.picks.pose.text);
    expect(sections.character.scene).toBeUndefined();
    expect(sections.global.appearance).toBeUndefined();
    expect(sections.written.sort()).toEqual([...KINDS].sort());
  });

  it('证据里有算法版本、随机码、每栏随机流、每栏条目 id 与候选池指纹', () => {
    const evidence = evidenceOf({ ...result, chains });
    expect(evidence.algo).toBe(ALGO);
    /* 不传 chains 时理应没有池指纹（记录本身不含词库快照），传了才有 */
    expect(evidenceOf(result).pools.appearance.fingerprint).toBe('');
    expect(evidence.seed).toBe(normalizeSeed('r-seed'));
    for (const kind of KINDS) {
      expect(evidence.seeds[kind]).toBe(normalizeSeed('r-seed'));
      expect(evidence.pools[kind].size).toBe(3);
      expect(typeof evidence.pools[kind].fingerprint).toBe('string');
      expect(evidence.pools[kind].fingerprint.length).toBeGreaterThanOrEqual(8);
    }
    expect(samePicks(result.picks, draw({ chains, seed: 'r-seed' }).picks)).toBe(true);
    expect(samePicks(result.picks, draw({ chains, seed: 'r-seed-2' }).picks)).toBe(false);
  });
});


describe('动态目录抽取', () => {
  const directories = { revision: 1, nodes: [{ id: 'custom', parentId: null, name: '自定义' }, { id: 'child', parentId: 'custom', name: '子项' }] };
  const unit = { id: 'directory:custom', directoryId: 'custom', name: '自定义', path: ['自定义'], scope: 'global' as const };
  const entries = [1, 2].map(index => ({ id: 'entry-' + index, type: 'preset', basePrompt: 'custom text ' + index, params: { _promptLibraryDirectoryIds: ['child', 'custom'] } }));
  it('任意目录包含后代、池内去重且不按旧六type过滤；空选择不回落六类', () => {
    const result = draw({ chains: entries, units: [unit], directories, seed: 'custom' });
    expect(Object.keys(result.picks)).toEqual([unit.id]);
    expect(result.picks[unit.id].poolSize).toBe(2);
    expect(result.picks[unit.id].directoryName).toBe('自定义');
    expect(draw({ chains: [...entries].reverse(), units: [unit], directories, seed: 'custom' }).picks).toEqual(result.picks);
    expect(describeRoll(result)).toContain('自定义');
    expect(evidenceOf({ ...result, chains: entries, units: [unit], directories }).pools[unit.id].size).toBe(2);
    expect(draw({ chains, units: [], directories }).picks).toEqual({});
  });
  it('删除目录和源片段后锁定的手写／已编辑文字保持，不用源条目重写', () => {
    const held = { kind: unit.id, directoryId: 'custom', filled: true, id: 'entry-1', text: 'my edited text', negative: 'my negative', scope: 'global' as const };
    const result = draw({ chains: [], units: [unit], directories: { revision: 2, nodes: [] }, picks: { [unit.id]: held }, locked: { [unit.id]: 'entry-1' } });
    expect(result.picks[unit.id]).toMatchObject({ text: 'my edited text', negative: 'my negative', locked: true });
    const restored = replay({ chains: entries, units: [unit], directories }, { picks: { [unit.id]: held } });
    expect(restored.picks[unit.id].text).toBe('my edited text');
  });
  it('单项重抽不改其它结果；未选项和空池保留旧草稿', () => {
    const old = { kind: 'directory:other', filled: true, text: 'keep other' };
    const first = draw({ chains: entries, units: [unit], directories, picks: { 'directory:other': old } });
    expect(first.picks['directory:other']).toBe(old);
    const next = rerollOne({ chains: entries, units: [unit], directories, picks: first.picks }, unit.id, 'next');
    expect(next.ok).toBe(true);
    expect(next.row?.id).not.toBe(first.picks[unit.id].id);
    const skipped = draw({ chains: [], units: [unit], directories, picks: first.picks, checks: { [unit.id]: false } });
    expect(skipped.picks[unit.id]).toBe(first.picks[unit.id]);
  });
});
