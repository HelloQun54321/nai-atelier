export type AgentMedia = { kind: string; id: string; title: string; path: string };

/** 只接受服务端工具给出的项目资产路径，不执行回答里的外部图片网址。 */
export const isAgentImagePath = (path: unknown): path is string => {
  if (typeof path === 'string' && path.startsWith('/api/prompt-agent/local-image?') && path.length < 800) {
    try {
      const url = new URL(path, 'http://localhost'); const session = url.searchParams.get('sessionId');
      return url.pathname === '/api/prompt-agent/local-image' && !url.hash && [...url.searchParams.keys()].length === 2 && url.searchParams.getAll('sessionId').length === 1 && url.searchParams.getAll('id').length === 1 && Boolean(session && session.length <= 200 && !/[\u0000-\u001f]/.test(session)) && /^[a-f0-9]{32}$/.test(url.searchParams.get('id') || '');
    } catch { return false; }
  }
  if (typeof path !== 'string' || path.length > 800 || /[\\?#\u0000-\u001f]/.test(path)) return false;
  try {
    const decoded = decodeURIComponent(path);
    if (/[\\?#\u0000-\u001f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return false;
    return /^\/api\/(?:assets\/.+|(?:local-history|inspirations|vibes|character-references)\/[^/]+\/(?:image|thumbnail))$/.test(path);
  } catch { return false; }
};

export const extractAgentMedia = (result: unknown): AgentMedia[] => {
  const parts = Array.isArray(result) ? result : (result as { content?: unknown[] } | null)?.content || [];
  const images: AgentMedia[] = [];
  for (const part of parts) {
    const text = (part as { text?: string })?.text;
    if (typeof text !== 'string') continue;
    try {
      const parsed = JSON.parse(text);
      for (const image of parsed.displayImages || parsed.data?.displayImages || []) {
        if (isAgentImagePath(image.path) && typeof image.id === 'string') images.push({ kind: String(image.kind || ''), id: image.id.slice(0, 200), title: String(image.title || '项目图片').slice(0, 160), path: image.path });
      }
    } catch { /* 普通工具文字不是图片收据。 */ }
  }
  return images.filter((image, index) => images.findIndex(item => item.path === image.path) === index).slice(0, 4);
};
