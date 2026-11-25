import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Pencil, Trash2, Upload } from 'lucide-react';
import { t } from '../../services/i18n';
import {
  COMIC_CUSTOM_ASSET_ACCEPT,
  type ComicCustomAsset,
  type ComicCustomAssetKind,
} from '../../services/comic/comicAssets';
import type { ComicBubbleItem } from '../../services/comic/comicTypes';

interface ComicInspectorAssetLibraryProps {
  customAssets: ComicCustomAsset[];
  selectedBubble?: ComicBubbleItem;
  onUploadCustomAssets?: (files: File[], kind: ComicCustomAssetKind, options?: { insertToCanvas?: boolean; applyToSelectedBubble?: boolean }) => void;
  onInsertCustomAsset?: (asset: ComicCustomAsset, targetBubbleId?: string) => void;
  onRenameCustomAsset?: (id: string, name: string) => void;
  onDeleteCustomAsset?: (id: string) => void;
}

/** 漫画工作台步骤 3：可复用的本地自定义素材库（气泡与透明底图片/贴纸）。 */
export const ComicInspectorAssetLibrary: React.FC<ComicInspectorAssetLibraryProps> = ({
  customAssets,
  selectedBubble,
  onUploadCustomAssets,
  onInsertCustomAsset,
  onRenameCustomAsset,
  onDeleteCustomAsset,
}) => {
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(true);
  const [assetLibraryTab, setAssetLibraryTab] = useState<ComicCustomAssetKind>('bubble');
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [renameAssetValue, setRenameAssetValue] = useState('');
  const libraryAssetInputRef = useRef<HTMLInputElement>(null);

  const customBubbleAssets = useMemo(
    () => customAssets.filter(item => item.kind === 'bubble'),
    [customAssets],
  );
  const customImageAssets = useMemo(
    () => customAssets.filter(item => item.kind === 'image'),
    [customAssets],
  );

  return (
    <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={assetLibraryOpen}
          onClick={() => setAssetLibraryOpen(open => !open)}
          className="flex items-center gap-1.5 font-bold text-gray-700 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300"
        >
          <ImagePlus className="h-3.5 w-3.5 text-emerald-500" />
          <span>{t('自定义素材库')}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {customAssets.length}
          </span>
        </button>
        {onUploadCustomAssets && (
          <div>
            <input
              ref={libraryAssetInputRef}
              type="file"
              multiple
              accept={COMIC_CUSTOM_ASSET_ACCEPT}
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) onUploadCustomAssets(files, assetLibraryTab);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => libraryAssetInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              <Upload className="h-3 w-3" /> {t('批量导入')}
            </button>
          </div>
        )}
      </div>

      {assetLibraryOpen && (
        <div className="space-y-2 rounded-xl border border-gray-200/80 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-800/40">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-200/70 p-0.5 dark:bg-gray-900/70">
            <button
              type="button"
              onClick={() => setAssetLibraryTab('bubble')}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${assetLibraryTab === 'bubble' ? 'bg-white text-indigo-700 shadow-xs dark:bg-gray-800 dark:text-indigo-200' : 'text-gray-600 dark:text-gray-400'}`}
            >
              {t('自定义气泡')} ({customBubbleAssets.length})
            </button>
            <button
              type="button"
              onClick={() => setAssetLibraryTab('image')}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${assetLibraryTab === 'image' ? 'bg-white text-indigo-700 shadow-xs dark:bg-gray-800 dark:text-indigo-200' : 'text-gray-600 dark:text-gray-400'}`}
            >
              {t('图片与贴纸')} ({customImageAssets.length})
            </button>
          </div>

          {(() => {
            const list = assetLibraryTab === 'bubble' ? customBubbleAssets : customImageAssets;
            if (list.length === 0) {
              return (
                <p className="rounded-lg border border-dashed border-gray-200 bg-white/70 p-3 text-center text-[10px] text-gray-400 dark:border-gray-700 dark:bg-gray-900/40">
                  {assetLibraryTab === 'bubble'
                    ? t('支持导入透明底 PNG / WebP / SVG 气泡框')
                    : t('支持导入透明底 PNG / WebP / GIF / SVG 贴纸与特效图')}
                </p>
              );
            }
            return (
              <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto">
                {list.map(asset => {
                  const isRenaming = renamingAssetId === asset.id;
                  return (
                    <div
                      key={asset.id}
                      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-white p-1 transition hover:border-indigo-400 dark:border-gray-700 dark:bg-gray-900"
                    >
                      <button
                        type="button"
                        title={asset.kind === 'bubble' ? t('点击添加该气泡到画布') : t('点击添加到画布')}
                        onClick={() => onInsertCustomAsset?.(asset)}
                        className="flex h-14 w-full items-center justify-center overflow-hidden rounded-md"
                        style={{
                          backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.22) 75%)',
                          backgroundSize: '10px 10px',
                          backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
                        }}
                      >
                        <img src={asset.url} alt={asset.name} className="h-full w-full object-contain" />
                      </button>

                      {isRenaming ? (
                        <input
                          type="text"
                          autoFocus
                          aria-label={t('重命名素材')}
                          value={renameAssetValue}
                          onChange={e => setRenameAssetValue(e.target.value)}
                          onBlur={() => {
                            const clean = renameAssetValue.trim();
                            if (clean && clean !== asset.name) onRenameCustomAsset?.(asset.id, clean);
                            setRenamingAssetId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const clean = renameAssetValue.trim();
                              if (clean && clean !== asset.name) onRenameCustomAsset?.(asset.id, clean);
                              setRenamingAssetId(null);
                            } else if (e.key === 'Escape') {
                              setRenamingAssetId(null);
                            }
                          }}
                          className="mt-1 w-full rounded border border-indigo-400 px-1 py-0.5 text-[10px] outline-none dark:bg-gray-800 dark:text-white"
                        />
                      ) : (
                        <div className="mt-1 flex items-center justify-between gap-0.5 px-0.5">
                          <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-gray-700 dark:text-gray-200">{asset.name}</span>
                        </div>
                      )}

                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        {asset.kind === 'bubble' && selectedBubble && (
                          <button
                            type="button"
                            title={t('套用到当前选中气泡')}
                            onClick={() => onInsertCustomAsset?.(asset, selectedBubble.id)}
                            className="rounded bg-indigo-600/90 px-1 py-0.5 text-[9px] font-semibold text-white hover:bg-indigo-600"
                          >
                            {t('替换')}
                          </button>
                        )}
                        {onRenameCustomAsset && (
                          <button
                            type="button"
                            aria-label={t('重命名素材 {0}', [asset.name])}
                            onClick={() => {
                              setRenamingAssetId(asset.id);
                              setRenameAssetValue(asset.name);
                            }}
                            className="rounded bg-white/90 p-0.5 text-gray-600 shadow-xs hover:text-indigo-600 dark:bg-gray-800/90 dark:text-gray-300"
                          >
                            <Pencil className="h-2.5 w-2.5" />
                          </button>
                        )}
                        {onDeleteCustomAsset && (
                          <button
                            type="button"
                            aria-label={t('删除素材 {0}', [asset.name])}
                            onClick={() => onDeleteCustomAsset(asset.id)}
                            className="rounded bg-white/90 p-0.5 text-gray-500 shadow-xs hover:text-red-500 dark:bg-gray-800/90 dark:text-gray-300"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
