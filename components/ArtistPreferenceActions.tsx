import React from 'react';
import { ArrowLeftRight, Ban, Heart } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import type { ArtistSamplePack } from '../services/artistSamples';
import { ImageCardActions } from './ImageCardActions';

/** 画师库与 Roll 共用画师级操作，点击不改变卡片选择。 */
export const ArtistPreferenceActions: React.FC<{
  tag: string; blocked: boolean; preferred: boolean; disabled?: boolean;
  onBlock: () => void; onFavorite: () => void;
  pack: ArtistSamplePack; onPackChange: (pack: ArtistSamplePack) => void;
  children?: React.ReactNode;
}> = ({ tag, blocked, preferred, disabled, onBlock, onFavorite, pack, onPackChange, children }) => {
  useLanguage();
  const corner = 'mobile-touch flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 md:h-8 md:w-8';
  const nextPack = pack === 'v45' ? 'v5' : 'v45';
  const switchLabel = t('样张版本 {0}，切换为 {1}', [pack === 'v45' ? 'V4.5' : 'V5 Full', nextPack === 'v45' ? 'V4.5' : 'V5 Full']);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return <>
    <button type="button" data-card-action="true" data-image-action-left="true" aria-label={t(blocked ? '取消屏蔽画师：{0}' : '屏蔽画师：{0}', [tag])} aria-pressed={blocked} disabled={disabled} onPointerDown={stop} onKeyDown={stop} onClick={event => { stop(event); onBlock(); }} className={`${corner} absolute left-2 top-2 z-20 ${blocked ? '!bg-red-600' : ''}`}><Ban className="h-4 w-4" /></button>
    <ImageCardActions singleColumn className="!gap-1" onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <button type="button" data-card-action="true" aria-label={t(preferred ? '取消偏好画师：{0}' : '偏好画师：{0}', [tag])} aria-pressed={preferred} disabled={disabled} onPointerDown={stop} onKeyDown={stop} onClick={event => { stop(event); onFavorite(); }} className={`${corner} ${preferred ? '!text-rose-400' : ''}`}><Heart className={`h-4 w-4 ${preferred ? 'fill-current' : ''}`} /></button>
      {children}
      <button type="button" data-card-action="true" aria-label={switchLabel} title={switchLabel} onPointerDown={stop} onKeyDown={stop} onClick={event => { stop(event); onPackChange(nextPack); }} className={`${corner} hover-reveal-md flex-col gap-0.5`}><span className="text-micro font-bold leading-none">{pack === 'v45' ? 'V4.5' : 'V5F'}</span><ArrowLeftRight className="h-2 w-2" /></button>
    </ImageCardActions>
  </>;
};
