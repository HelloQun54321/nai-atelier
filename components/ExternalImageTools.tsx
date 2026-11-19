import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { Copy, FlaskConical } from 'lucide-react';
import { copyTagText } from '../services/externalImageTags';
import { IconButton } from './DesignSystem';

interface ExternalImageToolsProps {
  source: 'danbooru' | 'pixiv';
  sourcePrompt: string;
  sourceCopy?: string;
  onImport: (prompt: string) => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  /** 当前图片的站内状态操作；来源导航由详情标题栏承载。 */
  trailingAction?: React.ReactNode;
  /** 操作行左侧内容（收藏数、浏览量、作者等）；缺省时右侧操作仍靠右。 */
  leading?: React.ReactNode;
  sourceTags: React.ReactNode;
}

/**
 * 外部图站的「原站 Tag」操作区：复制原站标注、把原站 Tag 送往实验室。
 * 操作行由调用方通过 leading / trailingAction 决定内容：Pixiv 与 Danbooru 在这里
 * 放作者信息与图片级操作（用作底图、反推 Tag），下方正文仍以原站 Tag 为主体。
 */
export const ExternalImageTools: React.FC<ExternalImageToolsProps> = ({ source, sourcePrompt, sourceCopy = sourcePrompt, onImport, notify, trailingAction, leading, sourceTags }) => {
  useLanguage();
  const copy = async (prompt: string, label: string) => {
    try { await copyTagText(prompt); notify(`已复制${label}`); }
    catch { notify('复制失败，请重试', 'error'); }
  };
  return <>
    {trailingAction && <div role="group" aria-label={t("图片操作")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {leading}
      <div className="ml-auto flex flex-none items-center gap-1">{trailingAction}</div>
    </div>}
    <section className={trailingAction ? 'space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800' : 'space-y-3'}>
      {/* 原站标注的两个动作与原图操作同一套 ghost 图标，按钮语言在详情页里只保留这一种。 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-xs font-black">{source === 'danbooru' ? t("Danbooru 原站 Tag") : t("Pixiv 原站标签")}</h3>
        <div className="flex flex-none items-center gap-1">
          <IconButton
            label={source === 'danbooru' ? t("复制 Danbooru Tag") : t("复制 Pixiv 标签")}
            tone="ghost"
            disabled={!sourceCopy.trim()}
            onClick={() => void copy(sourceCopy, source === 'danbooru' ? 'Danbooru Tag' : 'Pixiv 标签')}
          ><Copy /></IconButton>
          {source === 'danbooru' && <IconButton
            label={t("原站 Tag 送往实验室")}
            tone="ghost"
            disabled={!sourcePrompt.trim()}
            onClick={() => onImport(sourcePrompt)}
          ><FlaskConical /></IconButton>}
        </div>
      </div>
      {sourceTags}
    </section>
  </>;
};
