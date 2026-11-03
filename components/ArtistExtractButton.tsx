import React, { useRef, useState } from 'react';
import { Brush, Heart, LoaderCircle } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { favoriteArtistsFrom, type ArtistExtractionSource } from '../services/artistFavoriteExtraction';
import { IMAGE_CARD_ACTION_CLASS } from './ImageShareActions';

const listNames = (tags: readonly string[]) => tags.length > 5 ? `${tags.slice(0, 5).join(', ')} +${tags.length - 5}` : tags.join(', ');

/** 图片上的「收藏这串的画师」：整串画师一次补进画师收藏，只加不减，结果就地通知。 */
export const ArtistExtractButton: React.FC<{
  source: ArtistExtractionSource;
  notify?: (message: string, type?: 'success' | 'error') => void;
  /** 同屏多张卡片时带上编号或名称，读屏可区分。 */
  label?: string;
  revealClassName?: string;
}> = ({ source, notify, label, revealClassName = 'hover-reveal-md' }) => {
  useLanguage();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const { tags, added, existing, failed, error } = await favoriteArtistsFrom(source);
      if (!tags.length) notify?.(t('没有在这串里认出画师'), 'error');
      else if (failed.length) notify?.(added.length
        ? t('已收藏 {0} 位画师，{1} 位失败：{2}', [added.length, failed.length, t(error || '收藏失败')])
        : t('{0} 位画师收藏失败：{1}', [failed.length, t(error || '收藏失败')]), 'error');
      else if (!added.length) notify?.(t('这串的 {0} 位画师都已在收藏里', [existing.length]), 'success');
      else notify?.(existing.length
        ? t('已收藏 {0} 位画师：{1}（{2} 位原本已收藏）', [added.length, listNames(added), existing.length])
        : t('已收藏 {0} 位画师：{1}', [added.length, listNames(added)]), 'success');
    } catch (cause) {
      notify?.(t(cause instanceof Error ? cause.message : '收藏失败'), 'error');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const title = t('收藏这串的画师');
  return <button type="button" data-card-action="true" aria-label={label || title} title={title} aria-busy={busy} disabled={busy}
    onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void run(); }}
    className={`${revealClassName} ${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition disabled:cursor-wait disabled:opacity-50`}>
    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      : <span className="relative h-4 w-4" aria-hidden="true"><Brush className="h-4 w-4" /><Heart className="absolute -bottom-1 -right-1 h-2.5 w-2.5 fill-current" strokeWidth={3} /></span>}
  </button>;
};
