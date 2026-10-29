import { describe, expect, it } from 'vitest';
import messages from '../../locales/messages.json';
import { translate } from '../../locales/index.mjs';

const referenceMessages = [
  '氛围参考', '氛围参考 ({0})', '氛围参考 {0}', '氛围参考 {0}：{1}',
  '这份氛围参考编码', '这个氛围参考',
  '浏览器草稿无法读取，无法核对引用；已保留氛围参考，请先检查草稿后再删除',
  '氛围参考导入失败', '这个氛围参考不含原图，无法追加新的提取量',
  '生成永久氛围参考', '永久氛围参考编码已保存', '氛围参考编码失败',
  '一次最多启用 {0} 个氛围参考', '编码已保存，当前选择已变化，请重新选择该氛围参考',
  '未命名氛围参考', '已找到相同图片，直接打开现有氛围参考', '图片导入失败',
  '氛围参考组合已保存', '氛围参考文件已保存', '已开始下载氛围参考文件',
  '已永久删除氛围参考', '氛围参考组合已更新', '归档这个氛围参考？', '未知氛围参考',
  '永久氛围参考编码 · {0}', '永久删除氛围参考', '搜索我的氛围参考…',
  '上传氛围参考图片', '氛围参考导入方式', '导入氛围参考编码文件',
  '在参考窗口按 Ctrl+V', '粘贴图片', '粘贴中…',
  '没有已归档的氛围参考', '还没有永久氛围参考', '氛围参考选择管理',
  '未选择氛围参考', '{0} 个氛围参考',
  '将用当前 {0} 个氛围参考和强度设置替换这个组合。',
  '只删除组合配置，不会删除任何氛围参考资产或编码。',
  '与氛围参考互斥 · {0} Anlas／张／次', '氛围参考 {0} 张 · {1} 个槽',
  '氛围参考资产', '氛围参考分组', '氛围参考编码',
  '搜索氛围参考', '设置氛围参考', '读取氛围参考组合', '从历史创建氛围参考',
  '更新氛围参考', '保存氛围参考组合', '准备氛围参考编码',
];
const pasteErrors = [
  '当前浏览器无法直接读取剪贴板图片，请在参考窗口按 Ctrl+V，或使用 localhost／HTTPS 打开',
  '剪贴板读取未获允许，请允许浏览器访问，或在参考窗口按 Ctrl+V',
  '剪贴板读取失败，请重新复制图片后粘贴，或在参考窗口按 Ctrl+V',
  ...['氛围参考', '精准参考'].flatMap(purpose => [
    `请粘贴 PNG、JPEG 或 WebP 图片作为${purpose}`,
    `剪贴板中没有图片，请先使用「复制图片」；复制链接或文字不能作为${purpose}`,
  ]),
];
const placeholders = (value: string) => (value.match(/\{\d+\}/g) || []).sort();
const previewMessages = ['管理氛围参考', '管理精准参考', '查看参考：{0}', '暂无预览', '已停用', '已启用', '已选 {0} 张', '未知氛围参考', '未知参考', '未选择参考图', '管理'];

describe.each(['zh-TW', 'en', 'ja', 'ko'])('参考管理器文案：%s', language => {
  it('摘要预览与管理入口有完整译文，区分启停并保留参考原名及数量', () => {
    const index = ['zh-TW', 'en', 'ja', 'ko'].indexOf(language);
    for (const key of previewMessages) {
      const variants = (messages as Record<string, string[]>)[key];
      expect(variants, key).toHaveLength(4);
      expect(variants.every(variant => Boolean(variant.trim())), key).toBe(true);
      expect(translate(language, key), key).toBe(variants[index]);
      expect(placeholders(variants[index]), key).toEqual(placeholders(key));
    }
    expect(translate(language, '已启用')).not.toBe(translate(language, '已停用'));
    expect(translate(language, '查看参考：{0}', ['原名_Vibe.png'])).toContain('原名_Vibe.png');
    expect(translate(language, '已选 {0} 张', [12])).toContain('12');
    expect(translate(language, '已选 {0} 张', [12])).not.toContain('{0}');
  });

  it('功能、指标、助手动作和粘贴失败均有完整译文，保留全部参数', () => {
    for (const key of [...referenceMessages, ...pasteErrors]) {
      const variants = (messages as Record<string, string[]>)[key];
      expect(variants, key).toHaveLength(4);
      const translated = translate(language, key);
      expect(translated.trim(), key).not.toBe('');
      expect(translated, key).not.toBe(key);
      expect(placeholders(translated), key).toEqual(placeholders(key));
    }
    expect(translate(language, '氛围参考 {0} 张 · {1} 个槽', [2, 5])).toMatch(/2.*5/);
    expect(translate(language, '在参考窗口按 Ctrl+V')).toContain('Ctrl+V');
    expect(translate(language, pasteErrors[0])).toContain('localhost');
    expect(translate(language, pasteErrors[3])).toMatch(/PNG.*JPEG.*WebP/);
  });

  it('只翻译功能名，资产原名和官方文件扩展名原样保留', () => {
    const assetName = '我的Vibe素材.naiv4vibe';
    const bundleName = 'Vibe_original.naiv4vibeBundle';
    const label = translate(language, '氛围参考 {0}：{1}', [2, assetName]);
    expect(label).toContain(assetName);
    expect(label).toContain('2');
    expect(label).not.toMatch(/\{\d+\}/);
    expect(translate(language, '氛围参考 {0}', [bundleName])).toContain(bundleName);
  });
});

it('繁体中文统一使用氛圍參考，保留英文词条中的官方功能名称', () => {
  for (const key of referenceMessages.filter(key => key.includes('氛围参考'))) {
    expect(translate('zh-TW', key), key).toContain('氛圍參考');
    expect(translate('zh-TW', key), key).not.toMatch(/Vibe|氛围/);
  }
  expect(translate('en', '氛围参考')).toBe('Vibe Transfer');
});
