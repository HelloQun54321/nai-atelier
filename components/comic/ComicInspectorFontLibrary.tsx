import React, { useState } from 'react';
import { Download, Pencil, Star, Trash2, Type, Upload } from 'lucide-react';
import { t } from '../../services/i18n';
import { resolveComicFont } from '../../services/comic/comicArtwork';
import type { ComicFontCatalogState } from '../../services/comic/comicFonts';
import type { ComicBubbleItem, ComicTextItem } from '../../services/comic/comicTypes';
import { InlineSpinner } from '../DesignSystem';

interface ComicInspectorFontLibraryProps {
  fontCatalog: ComicFontCatalogState;
  defaultFontId?: string | null;
  downloadingFontId: string | null;
  selectedBubble?: ComicBubbleItem;
  selectedText?: ComicTextItem;
  onTriggerFontUpload: () => void;
  onDownloadFont: (id: string) => void;
  onRenameCustomFont?: (id: string, name: string) => void;
  onSetDefaultFont?: (fontId: string | null) => void;
  onDeleteFont: (id: string) => void;
  onUpdateBubble: (id: string, updater: (item: ComicBubbleItem) => ComicBubbleItem, commit?: boolean) => void;
  onUpdateText: (id: string, updater: (item: ComicTextItem) => ComicTextItem, commit?: boolean) => void;
}

/** 漫画工作台步骤 3：开源漫画字体与本机导入字体管理区。 */
export const ComicInspectorFontLibrary: React.FC<ComicInspectorFontLibraryProps> = ({
  fontCatalog,
  defaultFontId = null,
  downloadingFontId,
  selectedBubble,
  selectedText,
  onTriggerFontUpload,
  onDownloadFont,
  onRenameCustomFont,
  onSetDefaultFont,
  onDeleteFont,
  onUpdateBubble,
  onUpdateText,
}) => {
  const [fontManagerOpen, setFontManagerOpen] = useState(false);
  const [renamingFontId, setRenamingFontId] = useState<string | null>(null);
  const [renameFontValue, setRenameFontValue] = useState('');

  return (
    <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={fontManagerOpen}
          onClick={() => setFontManagerOpen(open => !open)}
          className="flex items-center gap-1.5 font-bold text-gray-700 hover:text-indigo-600 dark:text-gray-200 dark:hover:text-indigo-300"
        >
          <Type className="h-3.5 w-3.5 text-indigo-500" />
          <span>{t('开源漫画字体库')}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {fontCatalog.fonts.filter(f => f.installed).length + fontCatalog.customFonts.length}/{fontCatalog.fonts.length}
          </span>
        </button>
        <div>
          <button
            type="button"
            onClick={onTriggerFontUpload}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
          >
            <Upload className="h-3 w-3" /> {t('导入本机字体')}
          </button>
        </div>
      </div>

      {fontManagerOpen && (
        <div className="space-y-1.5 rounded-xl border border-gray-200/80 bg-gray-50/70 p-2 dark:border-gray-800 dark:bg-gray-800/40">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            {t('开源商用字体，支持批量导入 .ttf / .otf / .woff2')}
          </p>
          {fontCatalog.fonts.map(font => {
            const isBusy = downloadingFontId === font.id || font.downloading;
            const isDefault = defaultFontId === font.id;
            return (
              <div
                key={font.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/80 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate font-semibold text-gray-800 dark:text-gray-100">{font.name}</span>
                    {font.installed && (
                      <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                        {t('已缓存')}
                      </span>
                    )}
                    {isDefault && (
                      <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        {t('默认')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-gray-400">
                    {font.styleTag} · ~{font.approxSizeMB}MB
                  </div>
                  {font.installed && (
                    <div
                      style={{ fontFamily: resolveComicFont(font.id).cssFamily }}
                      className="mt-0.5 truncate text-[12px] text-gray-700 dark:text-gray-200"
                    >
                      {t('「就是现在！」 Abc 123')}
                    </div>
                  )}
                </div>
                {font.installed ? (
                  <div className="flex flex-none items-center gap-1">
                    {onSetDefaultFont && (
                      <button
                        type="button"
                        title={isDefault ? t('取消默认字体') : t('设为新建气泡/文字默认字体')}
                        aria-label={isDefault ? t('取消默认字体') : t('设为默认字体')}
                        onClick={() => onSetDefaultFont(font.id)}
                        className={`rounded p-1 transition ${isDefault ? 'text-amber-500' : 'text-gray-400 hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-950/40'}`}
                      >
                        <Star className={`h-3 w-3 ${isDefault ? 'fill-amber-400' : ''}`} />
                      </button>
                    )}
                    {(selectedBubble || selectedText) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedBubble) onUpdateBubble(selectedBubble.id, i => ({ ...i, fontFamily: font.id }), true);
                          else if (selectedText) onUpdateText(selectedText.id, i => ({ ...i, fontFamily: font.id }), true);
                        }}
                        className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                      >
                        {t('应用')}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t('移除缓存字体 {0}', [font.name])}
                      onClick={() => onDeleteFont(font.id)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(downloadingFontId) || isBusy}
                    onClick={() => onDownloadFont(font.id)}
                    className="inline-flex flex-none items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {isBusy ? <InlineSpinner className="h-3 w-3 text-white" /> : <Download className="h-3 w-3" />}
                    <span>{isBusy ? t('下载中…') : t('下载')}</span>
                  </button>
                )}
              </div>
            );
          })}

          {fontCatalog.customFonts.length > 0 && (
            <div className="space-y-1 border-t border-gray-200/80 pt-1.5 dark:border-gray-700">
              <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{t('我导入的本机字体')}</div>
              {fontCatalog.customFonts.map(font => {
                const isDefault = defaultFontId === font.id;
                const isRenaming = renamingFontId === font.id;
                return (
                  <div
                    key={font.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/70 bg-white px-2 py-1.5 dark:border-indigo-900/60 dark:bg-gray-900"
                  >
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <input
                          type="text"
                          autoFocus
                          aria-label={t('重命名字体')}
                          value={renameFontValue}
                          onChange={e => setRenameFontValue(e.target.value)}
                          onBlur={() => {
                            const clean = renameFontValue.trim();
                            if (clean && clean !== font.name) onRenameCustomFont?.(font.id, clean);
                            setRenamingFontId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const clean = renameFontValue.trim();
                              if (clean && clean !== font.name) onRenameCustomFont?.(font.id, clean);
                              setRenamingFontId(null);
                            } else if (e.key === 'Escape') {
                              setRenamingFontId(null);
                            }
                          }}
                          className="w-full rounded border border-indigo-400 px-1 py-0.5 text-[11px] font-medium outline-none dark:bg-gray-800 dark:text-white"
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-100">{font.name}</span>
                          {isDefault && (
                            <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              {t('默认')}
                            </span>
                          )}
                        </div>
                      )}
                      <div
                        style={{ fontFamily: resolveComicFont(font.id).cssFamily }}
                        className="mt-0.5 truncate text-[12px] text-gray-700 dark:text-gray-200"
                      >
                        {t('「就是现在！」 Abc 123')}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5">
                      {onSetDefaultFont && (
                        <button
                          type="button"
                          title={isDefault ? t('取消默认字体') : t('设为新建气泡/文字默认字体')}
                          aria-label={isDefault ? t('取消默认字体') : t('设为默认字体')}
                          onClick={() => onSetDefaultFont(font.id)}
                          className={`rounded p-1 transition ${isDefault ? 'text-amber-500' : 'text-gray-400 hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-950/40'}`}
                        >
                          <Star className={`h-3 w-3 ${isDefault ? 'fill-amber-400' : ''}`} />
                        </button>
                      )}
                      {onRenameCustomFont && (
                        <button
                          type="button"
                          aria-label={t('重命名字体 {0}', [font.name])}
                          onClick={() => {
                            setRenamingFontId(font.id);
                            setRenameFontValue(font.name);
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-gray-800"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                      {(selectedBubble || selectedText) && (
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedBubble) onUpdateBubble(selectedBubble.id, i => ({ ...i, fontFamily: font.id }), true);
                            else if (selectedText) onUpdateText(selectedText.id, i => ({ ...i, fontFamily: font.id }), true);
                          }}
                          className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
                        >
                          {t('应用')}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={t('删除导入字体 {0}', [font.name])}
                        onClick={() => onDeleteFont(font.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
