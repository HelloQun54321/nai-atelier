/**
 * 参考资料库的入库命名：粘贴、拖拽和截图来源常常只有哈希或 blob 文件名，
 * 直接沿用会让资料库全是乱码名，无法辨认。可读文件名保持原样，其余按时间生成。
 */
const OPAQUE_NAME = /^blob$/i;
const HASH_NAME = /^[0-9a-f]{16,}$/i;
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_NAME = /^[\d_-]{12,}$/;

export const referenceDisplayName = (fileName: string, fallback: string, now = new Date()) => {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
  if (base && !OPAQUE_NAME.test(base) && !HASH_NAME.test(base) && !UUID_NAME.test(base) && !DIGITS_NAME.test(base)) return base.slice(0, 100);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${fallback} ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
};
