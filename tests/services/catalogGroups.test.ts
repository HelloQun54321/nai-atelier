import { expect, it } from 'vitest';
import { emptyCatalogGroups, readCatalogGroups, matchesCatalogGroup, updateCatalogGroupMemberships, removeCatalogGroup } from '../../services/catalogGroups';

const initial = () => ({ revision: 2, groups: [{ id: 'g1', name: '线条' }, { id: 'g2', name: '色彩' }, { id: 'g3', name: '构图' }],
  memberships: { 'artist:画师 A': ['g1', 'g2'], 'artist:画师_a': ['g3'], 'catalog:角色': ['g1'], 'custom:角色': ['g2'] } });
it('空分组兼容旧目录，原始 Tag 与自定义身份互不合并', () => {
  expect(emptyCatalogGroups()).toEqual({ revision: 0, groups: [], memberships: {} });
  expect(readCatalogGroups(initial())).toEqual(initial());
  expect(matchesCatalogGroup(initial(), 'g1', 'artist:画师 A')).toBe(true);
  expect(matchesCatalogGroup(initial(), 'g1', 'artist:画师_a')).toBe(false);
  expect(matchesCatalogGroup(initial(), '*', 'artist:未分组')).toBe(true);
  expect(matchesCatalogGroup(initial(), '', 'artist:未分组')).toBe(true);
  expect(matchesCatalogGroup(initial(), '', 'catalog:角色')).toBe(false);
});
it('批量只改触及组，保留每项其他组和未选对象，不修改输入', () => {
  const original = initial();
  const next = updateCatalogGroupMemberships(original, ['artist:画师 A', 'artist:新画师', 'artist:画师 A'], { g1: false, g3: true });
  expect(next.memberships['artist:画师 A']).toEqual(['g2', 'g3']);
  expect(next.memberships['artist:新画师']).toEqual(['g3']);
  expect(next.memberships['artist:画师_a']).toEqual(['g3']);
  expect(next.memberships['custom:角色']).toEqual(['g2']);
  expect(original).toEqual(initial());
});
it('删组仅移除该归属，其他组和对象身份不变', () => {
  const next = removeCatalogGroup(initial(), 'g1');
  expect(next.groups.map(group => group.id)).toEqual(['g2', 'g3']);
  expect(next.memberships['artist:画师 A']).toEqual(['g2']);
  expect(next.memberships['catalog:角色']).toBeUndefined();
  expect(next.memberships['custom:角色']).toEqual(['g2']);
});
it.each([
  null, { ...initial(), revision: -1 }, { ...initial(), groups: [{ id: '__proto__', name: '坏组' }] },
  { ...initial(), memberships: JSON.parse('{"__proto__":["g1"]}') },
  { ...initial(), memberships: { 'artist:画师': ['missing'] } },
  { ...initial(), memberships: { 'artist:画师': ['g1', 'g1'] } },
  { ...initial(), memberships: { 'artist:': ['g1'] } },
  { ...initial(), groups: [{ id: 'g1', name: 'same' }, { id: 'g2', name: ' SAME ' }] },
])('非法分组整份拒绝 %j', value => expect(() => readCatalogGroups(value)).toThrow());
it('增删归属拒绝无效对象和未知组', () => {
  expect(() => updateCatalogGroupMemberships(initial(), ['__proto__'], { g1: true })).toThrow();
  expect(() => updateCatalogGroupMemberships(initial(), ['artist:画师'], { missing: true })).toThrow();
});

it('旧根组保持原格式，深层同名只限制同一父级，筛选覆盖任意后代', () => {
  const groups = [{ id: 'root', name: '根' }, { id: 'other', name: '其它', parentId: null },
    { id: 'child', name: '同名', parentId: 'root' }, { id: 'grand', name: '同名', parentId: 'child' }, { id: 'peer', name: '同名', parentId: 'other' }];
  const state = { revision: 4, groups, memberships: { 'artist:A': ['grand', 'peer'], 'catalog:A': ['child'], 'custom:A': ['other'] } };
  expect(readCatalogGroups(state)).toEqual(state);
  expect(readCatalogGroups(state).groups[0]).not.toHaveProperty('parentId');
  expect(matchesCatalogGroup(state, 'root', 'artist:A')).toBe(true);
  expect(matchesCatalogGroup(state, 'child', 'artist:A')).toBe(true);
  expect(matchesCatalogGroup(state, 'grand', 'catalog:A')).toBe(false);
  expect(matchesCatalogGroup(state, 'root', 'custom:A')).toBe(false);
  expect(() => readCatalogGroups({ ...state, groups: [...groups, { id: 'duplicate', name: ' 同名 ', parentId: 'root' }] })).toThrow('已有同名分组');
});
it.each([
  [{ id: 'a', name: 'A', parentId: 'missing' }],
  [{ id: 'a', name: 'A', parentId: 'a' }],
  [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }],
  [{ id: 'a', name: 'A', parentId: 12 }],
])('拒绝缺父、自父、循环与无效父级 %j', (...groups) => {
  expect(() => readCatalogGroups({ revision: 0, groups, memberships: {} })).toThrow();
});
it('删除单节点提升直接孩子并避同父重名，孙级及多归属均保留', () => {
  const state = { revision: 8, groups: [{ id: 'top', name: '根' }, { id: 'removed', name: '待删', parentId: 'top' },
    { id: 'same', name: '同名', parentId: 'top' }, { id: 'same2', name: '同名 (2)', parentId: 'top' },
    { id: 'child', name: '同名', parentId: 'removed' }, { id: 'grand', name: '孙级', parentId: 'child' }],
    memberships: { 'artist:A': ['removed', 'child', 'grand'], 'custom:A': ['removed'], 'catalog:A': ['same'] } };
  const next = removeCatalogGroup(state, 'removed');
  expect(next.groups.find(group => group.id === 'child')).toEqual({ id: 'child', name: '同名 (3)', parentId: 'top' });
  expect(next.groups.find(group => group.id === 'grand')).toEqual(state.groups[5]);
  expect(next.memberships).toEqual({ 'artist:A': ['child', 'grand'], 'catalog:A': ['same'] });
  expect(readCatalogGroups(next)).toEqual(next);
  expect(state.groups[4].parentId).toBe('removed');
});
it('节点数量上限内可连续细分到500层，旧根组与深层归属不受固定深度限制', () => {
  const state = { revision: 0, groups: Array.from({ length: 500 }, (_, index) => ({ id: `g${index}`, name: '细分', ...(index ? { parentId: `g${index - 1}` } : {}) })), memberships: { 'artist:深层': ['g499'] } };
  expect(readCatalogGroups(state)).toEqual(state);
  expect(matchesCatalogGroup(state, 'g0', 'artist:深层')).toBe(true);
  expect(matchesCatalogGroup(state, 'g498', 'artist:深层')).toBe(true);
  expect(removeCatalogGroup(state, 'g0').groups[0]).toEqual({ id: 'g1', name: '细分', parentId: null });
});
