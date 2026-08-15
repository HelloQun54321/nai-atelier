// 图片来源校验：从 worker/index.ts 抽出的纯逻辑，供路由与单元测试共用。
// 内部 /api/ 路径走白名单正则；远程图必须 https、无凭据且主机在白名单内。
import { MEDIA_REMOTE_HOSTS as SHARED_REMOTE_HOSTS } from './sharedWhitelist.mjs';

export const MEDIA_VARIANTS = new Set(['thumb-160', 'thumb-240', 'thumb-320', 'thumb-480', 'thumb-640', 'thumb-960', 'original']);

export const MEDIA_REMOTE_HOSTS = new Set(SHARED_REMOTE_HOSTS);

export const MEDIA_INTERNAL_SOURCE = /^\/api\/(?:assets\/.+|local-history\/[^/]+\/image|vibes\/[^/]+\/(?:image|thumbnail)|character-references\/[^/]+\/(?:image|thumbnail)|integrations\/st-chatu8\/history\/[a-f0-9]{64}\/image)(?:\?.*)?$/i;

export const validateMediaSource = (value: string | null) => {
  const source = String(value || '');
  if (!source || source.length > 2048 || /[\r\n]/.test(source)) throw new Error('Invalid image source');
  if (MEDIA_INTERNAL_SOURCE.test(source)) return { source, internal: true };
  const target = new URL(source);
  if (target.protocol !== 'https:' || target.username || target.password || !MEDIA_REMOTE_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error('Remote image host is not allowed');
  }
  return { source: target.toString(), internal: false };
};
