/** 按顶层逗号拆分，保留括号及 :: 权重组内部原文。
 * @param {string} value
 * @returns {string[]}
 */
export const splitPromptSegments = (value) => {
  const text = String(value || '');
  const out = [];
  let current = '';
  let parenDepth = 0;
  let inGroup = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === ':' && text[index + 1] === ':') {
      inGroup = !inGroup;
      current += '::';
      index += 1;
      continue;
    }
    if (!inGroup) {
      if ('({[（'.includes(char)) parenDepth += 1;
      else if (')}]）'.includes(char) && parenDepth > 0) parenDepth -= 1;
    }
    if ((char === ',' || char === '，') && !inGroup && parenDepth === 0) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

