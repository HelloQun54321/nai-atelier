import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon } from 'lucide-react';
import { getStyleBundleEntryPreview, type StyleBundlePreview as BundlePreview } from '../../services/styleBundle';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../../services/imageDisplayPreferences';
import { t } from '../../services/i18n';
import { getNaiModelDisplayLabel } from '../../services/naiModels';
import { MediaCardShell } from '../DesignSystem';
import { ImageLightbox } from '../ImageLightbox';
import { ShortestColumnMasonry, useMasonryColumnCount } from '../ShortestColumnMasonry';

// 卡片与大图各自持有 URL，筛选卸载卡片时不提前释放正在查看的原图。
function useCoverUrl(blob?: Blob) {
  const [current, setCurrent] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setCurrent({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return current?.blob === blob ? current?.url : undefined;
}

function BundleEntryCard({ preview, id, selected, imported, disabled, failure, onSelect, onOpen }: {
  preview: BundlePreview; id: string; selected: boolean; imported: boolean; disabled: boolean;
  failure?: string; onSelect: () => void; onOpen: () => void;
}) {
  const entry = useMemo(() => getStyleBundleEntryPreview(preview, id), [preview, id]);
  const src = useCoverUrl(entry.coverBlob);
  const [ratio, setRatio] = useState(() => Number(entry.params.width) > 0 && Number(entry.params.height) > 0 ? Number(entry.params.width) / Number(entry.params.height) : 1);
  const [expandedPreview, setExpandedPreview] = useState<BundlePreview>();
  const [descriptionPreview, setDescriptionPreview] = useState<BundlePreview>();
  const expanded = expandedPreview === preview;
  const descriptionExpanded = descriptionPreview === preview;
  const { description } = entry;
  return <div className="mobile-gallery-item min-w-0 space-y-2" data-bundle-entry={id}>
    <MediaCardShell pressReveal selected={selected} data-safe-mode-work="true" className="appearance-group gallery-image-card gallery-card-visual group relative flex flex-col rounded-xl">
      <div className="appearance-media mobile-gallery-frame relative flex items-center justify-center overflow-hidden border-b border-gray-200 bg-gray-200 md:aspect-square dark:border-gray-700 dark:bg-gray-900" style={{ '--mobile-image-ratio': String(ratio) } as React.CSSProperties}>
        <label className={`mobile-touch absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border shadow backdrop-blur ${selected ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-white/80 bg-black/35 text-transparent'} ${disabled || imported ? 'opacity-50' : 'cursor-pointer'}`} onClick={event => event.stopPropagation()}>
          <input type="checkbox" aria-label={entry.name} checked={selected} disabled={disabled || imported} onChange={onSelect} className="peer sr-only" /><Check aria-hidden="true" className="h-4 w-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-white" />
        </label>
        {entry.coverBlob ? <button type="button" aria-label={t('查看封面：{0}', [entry.name])} onClick={onOpen} className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          {src && <img src={src} alt={entry.name} loading="lazy" decoding="async" className="h-full w-full object-contain" onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight); }} />}
        </button> : <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-gray-600"><ImageIcon className="h-12 w-12" strokeWidth={1.5} /><span className="text-xs">{t('无封面')}</span></div>}
      </div>
      <div className="gallery-card-caption flex h-12 flex-col justify-center px-3">
        {imported && <span className="gallery-card-meta text-xs text-gray-500">{t('已导入')}</span>}
        <div className="flex items-center justify-between"><h3 data-safe-mode-title="true" className="w-full truncate pr-1 text-sm font-bold text-gray-900 dark:text-gray-100 md:pr-2" title={entry.name}>{entry.name}</h3><span className="gallery-card-badge ml-1 flex-shrink-0 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-micro font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300" title={t('生成模型')}>{getNaiModelDisplayLabel(entry.params.model)}</span></div>
      </div>
    </MediaCardShell>
    <details open={expanded} onToggle={event => { setExpandedPreview(event.currentTarget.open ? preview : undefined); if (!event.currentTarget.open) setDescriptionPreview(undefined); }} className="text-xs text-gray-600 dark:text-gray-300">
      <summary className="mobile-touch cursor-pointer rounded-lg px-2 py-1.5 font-semibold">{t('配方详情')}</summary>
      {expanded && <div className="space-y-2 px-2 pb-2"><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-3 font-mono dark:bg-gray-800">{JSON.stringify({ ...entry, coverBlob: undefined, description: undefined }, null, 2)}</pre>
        {description && <details open={descriptionExpanded} onToggle={event => setDescriptionPreview(event.currentTarget.open ? preview : undefined)}><summary className="mobile-touch cursor-pointer py-1.5 font-semibold">{t('原始描述')}</summary>{descriptionExpanded && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-3 dark:bg-gray-800">{description}</pre>}</details>}
      </div>}
    </details>
    {failure && <p role="alert" className="break-words text-xs text-red-600 dark:text-red-400">{t(failure)}</p>}
  </div>;
}

export function StyleBundlePreview({ preview, entries, selected, imported, disabled, failures, onSelect }: {
  preview: BundlePreview; entries: BundlePreview['entries']; selected: Set<string>; imported: Set<string>; disabled: boolean;
  failures: Record<string, string>; onSelect: (id: string) => void;
}) {
  const preferences = useMobileImageDisplayPreferences('chains');
  const container = useRef<HTMLDivElement>(null);
  const columns = useMasonryColumnCount(preferences, undefined, container);
  const [opened, setOpened] = useState<{ preview: BundlePreview; id: string; name: string; src: string }>();
  const activeImage = opened?.preview === preview ? opened : undefined;
  const images = useMemo(() => preview.entries.filter(entry => entry.cover), [preview]);
  useEffect(() => {
    if (opened?.preview === preview) return () => URL.revokeObjectURL(opened.src);
  }, [opened, preview]);
  const openImage = (id: string) => {
    const entry = getStyleBundleEntryPreview(preview, id);
    if (entry.coverBlob) setOpened({ preview, id, name: entry.name, src: URL.createObjectURL(entry.coverBlob) });
  };
  const renderCard = (entry: BundlePreview['entries'][number]) => <BundleEntryCard key={entry.id} preview={preview} id={entry.id} selected={selected.has(entry.id)} imported={imported.has(entry.id)} disabled={disabled} failure={failures[entry.id]} onSelect={() => onSelect(entry.id)} onOpen={() => openImage(entry.id)} />;
  return <div ref={container}>
    {preferences.layout === 'masonry' ? <ShortestColumnMasonry items={entries} columns={columns} getItemKey={entry => entry.id} estimateItemHeight={(entry, width) => { const { params } = getStyleBundleEntryPreview(preview, entry.id); return width * (Number(params.height) > 0 && Number(params.width) > 0 ? Number(params.height) / Number(params.width) : 1) + 84; }} renderItem={renderCard} />
      : <div className={`${mobileGalleryClassName(preferences)} workspace-card-grid workspace-chain-grid`} style={mobileGalleryStyle(preferences, columns)}>{entries.map(renderCard)}</div>}
    {activeImage && <ImageLightbox src={activeImage.src} alt={activeImage.name} hideShareActions onClose={() => setOpened(undefined)} pager={{ index: images.findIndex(entry => entry.id === activeImage.id), count: images.length, onChange: index => openImage(images[index].id) }} />}
  </div>;
}
