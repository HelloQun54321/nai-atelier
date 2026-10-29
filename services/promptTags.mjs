const normalizeTagQuery = value => value
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const unwrapToken = (raw, start = 0, group) => {
  const leading = raw.search(/\S/);
  let value = raw.trim();
  const tokenStart = leading >= 0 ? start + leading : start;
  const tokenEnd = leading >= 0 ? tokenStart + value.length : start + raw.length;
  value = value.replace(/^[{\[\s]+/, '').replace(/[}\]\s]+$/, '').trim();
  value = value.replace(/^\{+([\s\S]*?)\}+$/, '$1').replace(/^\[+([\s\S]*?)\]+$/, '$1').trim();
  value = value.replace(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)::\s*/, '').replace(/\s*::$/, '').trim();
  value = value.replace(/^\(([\s\S]*?)(?::\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))\)$/, '$1').trim();
  value = value.replace(/^\(([\s\S]*)\)$/, '$1').trim();
  const artistPrefix = /^artists?\s*:\s*/i.test(value);
  if (artistPrefix) value = value.replace(/^artists?\s*:\s*/i, '').trim();
  const { id: _id, ...metadata } = group || {};
  return { displayTag: value, lookupTag: normalizeTagQuery(value), start: tokenStart, end: tokenEnd, ...metadata };
};

const parseSegment = (prompt, rawStart, rawEnd, group) =>
  [...prompt.slice(rawStart, rawEnd).matchAll(/[^,，\n|]+/g)].flatMap(match => {
    const token = unwrapToken(match[0], rawStart + match.index, group);
    return token.lookupTag && /[\p{L}\p{N}]/u.test(token.lookupTag) ? [token] : [];
  });

export const parsePromptTags = prompt => {
  const tokens = [];
  let segmentStart = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let numericStart = -1;
  const flush = (end, contentStart = segmentStart, contentEnd = end) => {
    if (end <= segmentStart || contentEnd <= contentStart) return;
    // leading 必须取自未 trim 的切片：trimmed.search(/\S/) 恒为 0，会让 raw 首部多算空白、
    // 尾部少截同样长度，导致 `", 1.2::tag::"` 之类的后续权重组因 raw 不以 :: 结尾而丢失分组。
    const segment = prompt.slice(segmentStart, end);
    const trimmed = segment.trim();
    const leading = segment.search(/\S/);
    const groupStart = leading < 0 ? segmentStart : segmentStart + leading;
    const groupEnd = groupStart + trimmed.length;
    const raw = prompt.slice(groupStart, groupEnd);
    let start = contentStart;
    let finalEnd = contentEnd;
    let groupKind;
    let groupWeight;
    let groupLevel;

    if (numericStart >= 0 && raw.endsWith('::')) {
      groupKind = 'numeric';
      groupWeight = prompt.slice(groupStart, numericStart).trim();
      start = numericStart + 2;
      finalEnd = groupEnd - 2;
    } else {
      // 只计算确实包住整段的层级，不能把首尾两个不同子组的括号算成共同权重。
      if (raw[0] === '{' || raw[0] === '[') {
        const close = raw[0] === '{' ? '}' : ']';
        let level = 0;
        while (raw[level] === raw[0] && raw[raw.length - level - 1] === close) {
          let depth = 0, complete = true;
          for (let index = level; index < raw.length - level; index++) {
            if (raw[index] === raw[0]) depth++;
            if (raw[index] === close) depth--;
            if (depth === 0 && index < raw.length - level - 1) { complete = false; break; }
          }
          if (!complete || depth !== 0) break;
          level++;
        }
        if (level) {
          groupKind = raw[0] === '{' ? 'brace' : 'bracket';
          groupLevel = level;
          start = groupStart + level;
          finalEnd = groupEnd - level;
        }
      }
    }

    const group = groupKind ? { groupId: `${groupStart}:${groupEnd}`, groupStart, groupEnd, groupWeight, groupKind, groupLevel } : undefined;
    tokens.push(...parseSegment(prompt, start, finalEnd, group));
  };
  for (let i = 0; i < prompt.length; i += 1) {
    const char = prompt[i];
    if (char === ':' && prompt[i + 1] === ':' && numericStart >= 0) {
      flush(i + 2, numericStart + 2, i);
      segmentStart = i + 2;
      numericStart = -1;
      i += 1;
    } else if (char === ':' && prompt[i + 1] === ':' && numericStart < 0) {
      const prefix = prompt.slice(segmentStart, i).trim();
      if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(prefix)) numericStart = i;
      i += 1;
    } else if (char === '{') braceDepth += 1;
    else if (char === '}' && braceDepth) braceDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']' && bracketDepth) bracketDepth -= 1;
    if ((char === ',' || char === '，' || char === '\n' || char === '|') && !braceDepth && !bracketDepth && numericStart < 0) {
      flush(i);
      segmentStart = i + 1;
      numericStart = -1;
    }
  }
  flush(prompt.length);
  // 标记每个 token 在权重组内的位置：一对权重包裹多个 Tag 时，开口语法渲染在首项、闭合语法渲染在末项。
  const groupTotals = new Map();
  tokens.forEach(token => { if (token.groupId) groupTotals.set(token.groupId, (groupTotals.get(token.groupId) || 0) + 1); });
  const groupSeen = new Map();
  tokens.forEach(token => {
    if (!token.groupId) return;
    const seen = groupSeen.get(token.groupId) || 0;
    const total = groupTotals.get(token.groupId) || 1;
    token.groupEdge = total === 1 ? 'both' : seen === 0 ? 'open' : seen === total - 1 ? 'close' : undefined;
    groupSeen.set(token.groupId, seen + 1);
  });
  return tokens.map((item, index) => ({ ...item, id: `${index}:${item.lookupTag}` }));
};
