import type { MediaVariant } from './mobileImageCache';
import { createUuid } from './id';

/** 页面／封面各自拥有预热租约，切换后撤销旧任务；不取消其他页面共同需要的图片。 */
export const createMediaPrewarmSession = () => {
  const owner = `danbooru-${createUuid()}`;
  let generation = 1;
  const post = (body: object) => {
    void fetch('/api/media/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  };
  return {
    enqueue(sources: string[], variant: Exclude<MediaVariant, 'original'>, pin = false, priority = 2) {
      const valid = [...new Set(sources.filter(Boolean))];
      if (valid.length) post({ sources: valid, variant, pin, priority, owner, generation });
    },
    cancel() { post({ cancel: true, owner, generation }); generation++; },
  };
};
