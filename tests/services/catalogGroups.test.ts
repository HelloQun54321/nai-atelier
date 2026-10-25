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
