// 只有明确填写完整生图接口时才使用中转，普通队列地址仍只接收 Key 指纹。
export const getCloudQueueGenerationUrl = (value, streaming = false) => {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
  if (!/\/ai\/generate-image(?:-stream)?\/?$/.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/\/ai\/generate-image(?:-stream)?\/?$/, `/ai/generate-image${streaming ? '-stream' : ''}`);
  return url.href;
};
