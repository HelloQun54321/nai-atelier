import React from 'react';
import { Bot, History, Image, Sparkles, Star, Upload } from 'lucide-react';
import { Inspiration, InspirationSourceType, NAIParams, User } from '../../types';
import { normalizeInspirationTags } from '../../services/inspirationUtils';

export type SmartCollection = 'all' | 'unorganized' | 'pinned' | 'recent' | 'archived' | `source:${InspirationSourceType}`;
export type SortMode = 'created' | 'used' | 'popular' | 'rating';

export const DEFAULT_PARAMS: NAIParams = {
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: undefined,
  qualityToggle: true, ucPreset: 4, characters: [], useCoords: false, variety: false, cfgRescale: 0,
};

export const BOARD_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#10b981', '#06b6d4', '#64748b'];

export const sourceIcon = (source?: InspirationSourceType) => {
  if (source === 'history') return History;
  if (source === 'aitag') return Sparkles;
  if (source === 'upload') return Upload;
  if (source === 'agent') return Bot;
  return Image;
};

export const formatDate = (value?: number) => value
  ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
  : '从未使用';

export const splitTags = (value: string) => normalizeInspirationTags(value.split(/[,，\n]+/));
export const canEditItem = (item: Inspiration, user: User) => user.role === 'admin' || item.userId === user.id;

export const fetchImageFile = async (item: Inspiration) => {
  const response = await fetch(item.imageUrl);
  if (!response.ok) throw new Error(`图片读取失败 (${response.status})`);
  const blob = await response.blob();
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  return new File([blob], `${item.title || 'inspiration'}.${extension}`, { type: blob.type || 'image/png' });
};

export const CollectionButton: React.FC<{
  active: boolean; count: number; icon: React.ReactNode; label: string; onClick: () => void;
}> = ({ active, count, icon, label, onClick }) => (
  <button type="button" onClick={onClick} className={`flex h-10 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold transition ${active ? 'border-gray-200 bg-white text-indigo-700 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-indigo-300' : 'border-transparent text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'}`}>
    <span className="flex h-5 w-5 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span><span className="text-[11px] font-medium text-gray-400">{count}</span>
  </button>
);

export const RatingStars: React.FC<{ value: number; onChange?: (value: number) => void; compact?: boolean }> = ({ value, onChange, compact }) => (
  <div className="flex items-center gap-0.5" aria-label={`${value} 星`}>
    {[1, 2, 3, 4, 5].map(star => <button key={star} type="button" disabled={!onChange} onClick={event => { event.stopPropagation(); onChange?.(value === star ? 0 : star); }} className={`${compact ? 'h-5 w-5' : 'h-8 w-8'} flex items-center justify-center disabled:cursor-default`} aria-label={`${star} 星`}><Star className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} ${star <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-gray-700'}`} /></button>)}
  </div>
);
