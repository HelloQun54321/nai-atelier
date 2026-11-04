import { createHash } from 'node:crypto';

// 协议校验不改写正文。来源、校验值和预览说明留在描述信息里，不进入提示词。
export const validatePromptBlocks = (blocks = []) => {
  if (!Array.isArray(blocks) || blocks.length > 8) throw new Error('每个插件最多注册 8 个静态提示词片段');
  const ids = new Set(); let chars = 0;
  return blocks.map(block => {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(block?.id || '') || ids.has(block.id)) throw new Error('提示词片段 ID 无效或重复');
    if (typeof block.text !== 'string' || !block.text.trim() || block.text.length > 20000 || (chars += block.text.length) > 32000) throw new Error('提示词片段须为非空文本，单段最多 20000 字符、每个插件合计最多 32000 字符');
    ids.add(block.id);
    return { id: block.id, title: typeof block.title === 'string' ? block.title.slice(0, 160) : block.id, text: block.text };
  });
};

export const describePromptBlock = ({ text, ...block }) => ({ ...block, chars: text.length, sha256: createHash('sha256').update(text).digest('hex') });
export const formatPluginPromptBlocks = blocks => (blocks || []).map(block => block.text).join('\n\n');
