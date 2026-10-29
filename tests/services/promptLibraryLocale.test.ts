import { PROMPT_PURPOSE_GROUPS, PROMPT_PURPOSES } from '../../services/promptPurposes.mjs';
import { expect, it } from 'vitest';
import dictionary from '../../locales/messages.json';
import { PROMPT_LIBRARY_KINDS } from '../../components/promptLibraryConfig';

it('四类库的分类、生成条件和选项具有完整的四语译文，模板变量保持一致', () => {
  const keys = new Set<string>(['图片提示词库', '画师串', '人物', '服饰', '姿势', '补充',
    '使用当前创作助手模型生成提示词，模型服务可能收费；不消耗生图额度。',
    '过滤后内容过少，已保留原文，请检查。', '已过滤 {0} 个越界标签：{1}']);
  for (const config of Object.values(PROMPT_LIBRARY_KINDS)) {
    for (const value of Object.values(config)) if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value)) keys.add(value);
    for (const facet of config.facets) { keys.add(facet.label); facet.options.filter(Boolean).forEach(option => keys.add(option)); }
  }
  for (const key of keys) {
    const variants = (dictionary as Record<string, string[]>)[key];
    expect(variants, key).toHaveLength(4);
    for (const value of variants) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), key)
        .toEqual([...key.matchAll(/\{\d+\}/g)].map(match => match[0]).sort());
    }
  }
});

it('动态目录界面文案具有完整的四语译文，模板变量保持一致', () => {
  const keys = [
    '全部目录', '片段目录', '管理目录', '管理提示词目录', '新目录名称', '上级目录', '顶层目录',
    '目录目标范围', '继承上级范围', '全局内容', '人物内容', '目录名称', '重命名目录：{0}',
    '删除目录：{0}', '删除目录「{0}」？', '只删除目录，子目录提升到上级；关联条目会变为未归类。',
    '目录树为空，可新增顶层目录。', '未归类', '请选择目录', '正在读取目录…',
    '请为目录无效的候选选择实际目录，或明确设为未归类', '目录已变更，请选择实际目录或明确设为未归类',
    '{0}目录', '{0}（{1}）', '已保存，提示词库生成立即使用最新内容', '用于当前目录的提示词生成。',
    '通用片段', '看图分类同时发送当前提示词目录的名称与路径。',
    '同一目录同时包含全局和角色内容，请先调整归属后保存组合', '组合分类导航', '组合分类', '选择组合分类',
    '分类「{0}」', '这一组没有可保存的内容', '搭配保存的内容组合', '提示词目录加载失败',
    '新建目录', '重命名目录', '选择目录', '根目录', '上级目录：{0}', '收藏夹目录', '上级收藏夹', '编辑目录',
    '仅移除本收藏夹归属，作品与其他归属保留；没有其他归属的作品会回到“未整理”。子收藏夹将提升到本夹的上级。',
    '目录树无效', '目录 ID 重复', '目录不能作为自己的上级', '上级目录不存在', '目录不能循环嵌套',
    '上级分类已不存在', '不能移动到自身或下级分类', '删除分类「{0}」？',
    '将解除 {0} 条组合的此分类，子分类提升一级，组合内容和其他分类保留。', '删除分类',
    '新增子分类', '新增子分类：{0}', '重命名分类', '重命名分类：{0}', '合并分类', '合并分类：{0}',
    '更改上级分类', '更改上级分类：{0}', '删除分类：{0}', '新分类上级', '顶层', '上级分类',
    '组合分类树无效', '组合分类节点无效', '组合分类不存在', '不支持的分类目录操作',
    '组合分类树无法读取，请保留现有数据并检查备份', '组合分类树资料过大',
    '组合分类树已在其他窗口更新，请读取最新目录后重试',
    '移到根目录', '移入目录「{0}」', '目录不存在', '重新读取目录',
    '提示词目录', '提示词目录导航', '选择提示词目录', '已选 {0} 个目录',
    '展开目录', '收起目录', '展开目录「{0}」', '收起目录「{0}」',
  ];
  for (const key of keys) {
    const variants = (dictionary as Record<string, string[]>)[key];
    expect(variants, key).toHaveLength(4);
    for (const value of variants) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), key)
        .toEqual([...key.matchAll(/\{\d+\}/g)].map(match => match[0]).sort());
    }
  }
});


it('固定用途的名称与含义均具有四语翻译', () => {
  for (const item of PROMPT_PURPOSES) for (const key of [item.label, item.description]) {
    expect((dictionary as Record<string, string[]>)[key], key).toHaveLength(4);
  }
});

it('大区与原有分类名称使用四语翻译', () => {
  for (const key of [...PROMPT_PURPOSE_GROUPS.map(group => group.label), '原有分类']) expect((dictionary as Record<string, string[]>)[key], key).toHaveLength(4);
});

it('搭配工作台状态与操作文案具有完整四语译文和一致变量', () => {
  for (const key of ["提示词搭配", "参与 {0} / {1} 项", "参与用途", "可抽取", "本次结果", "等待抽取", "暂无可抽取片段", "可手写或选择片段", "当前范围没有可随机抽取的片段，可更换目录或手写。", "请选择参与抽取的用途", "{0} 条未参与随机", "查看原因", "已固定 {0} 项", "填入预览", "收起全文", "展开全文", "保留原有画风与未参与内容", "读取失败"]) {
    const values = (dictionary as Record<string, string[]>)[key];
    expect(values, key).toHaveLength(4);
    for (const value of values) {
      expect(value.trim(), key).not.toBe('');
      expect(value.match(/\{\d+\}/g) || [], key).toEqual(key.match(/\{\d+\}/g) || []);
    }
  }
});
