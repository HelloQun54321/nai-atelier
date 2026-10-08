import messages from './messages.json' with { type: 'json' };

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文', instruction: '简体中文' },
  { code: 'zh-TW', name: '繁體中文', instruction: '繁體中文' },
  { code: 'en', name: 'English', instruction: 'English' },
  { code: 'ja', name: '日本語', instruction: '日本語' },
  { code: 'ko', name: '한국어', instruction: '한국어' },
];
export const normalizeLanguage = value => LANGUAGES.some(item => item.code === value) ? value : 'zh-CN';
// 通知与服务错误可能已经插入数量／路径；只匹配应用字典的整句模板，变量保留原文。
const templates = Object.entries(messages).filter(([key]) => /\{\d+\}/.test(key)).map(([key, variants]) => {
  const positions = [...key.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
  const pattern = key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)');
  return { positions, variants, pattern: new RegExp(`^${pattern}$`) };
}).sort((a, b) => b.pattern.source.replaceAll('([\\s\\S]*?)', '').length - a.pattern.source.replaceAll('([\\s\\S]*?)', '').length);
export const translate = (language, message, values = []) => {
  const source = typeof message === 'string' ? message : String(message ?? '');
  const index = LANGUAGES.findIndex(item => item.code === normalizeLanguage(language)) - 1;
  let translated = index < 0 ? source : messages[source]?.[index];
  let arguments_ = values;
  if (index >= 0 && translated === undefined && !values.length) {
    for (const template of templates) {
      const match = template.pattern.exec(source);
      if (!match) continue;
      const captured = [];
      let consistent = true;
      template.positions.forEach((position, i) => { if (captured[position] !== undefined && captured[position] !== match[i + 1]) consistent = false; captured[position] = match[i + 1]; });
      if (!consistent) continue;
      translated = template.variants[index]; arguments_ = captured; break;
    }
  }
  return (translated ?? source).replace(/\{(\d+)\}/g, (placeholder, position) => Number(position) < arguments_.length ? String(arguments_[Number(position)] ?? '') : placeholder);
};

/** 只插入白名单语言名；客户端输入不能成为额外系统指令。 */
export const agentLanguagePolicy = value => {
  const language = LANGUAGES.find(item => item.code === normalizeLanguage(value));
  return `[本次交流语言 / Response language]\n界面语言：${language.code}（${language.instruction}）。从思考的第一句话开始，所有面向用户的交流、思考／推理、进度、工具说明与最终回答使用${language.instruction}。生图 Prompt、Tag、代码、字段、模型 ID、路径与已有资料保持准确原文；用户明确指定的创作产物语言优先。`;
};
