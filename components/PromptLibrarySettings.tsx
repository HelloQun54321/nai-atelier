import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { PROMPT_LIBRARY_KIND_LABELS, promptAgentService, type PromptLibraryKind } from '../services/promptAgent';

/** 预览可切换的四个库类型，顺序与标签由服务层常量决定。 */
const libraryKinds: PromptLibraryKind[] = ['appearance', 'wardrobe', 'pose', 'scene'];

const libraryFieldClass = 'w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-800 outline-none focus:border-indigo-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100';
const libraryPrimaryButtonClass = 'mobile-touch rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40';
const librarySecondaryButtonClass = 'mobile-touch rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

/**
 * 库生成提示词设置：为人物形象 / 服饰 / 姿势 / 场景四个提示词库置顶追加两段自定义内容，
 * 并可按库类型预览最终系统提示词。仅影响提示词库生成，不改动创作助手。
 */
export const PromptLibrarySettings: React.FC = () => {
  useLanguage();
  const [spec, setSpec] = useState('');
  const [extra, setExtra] = useState('');
  const [saved, setSaved] = useState({ spec: '', extra: '' });
  const [kind, setKind] = useState<PromptLibraryKind>('appearance');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ length: number; systemPrompt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState('');
  // 预览是联网请求：只接受最新一次请求的结果，切库类型或组件卸载后丢弃迟到响应。
  const previewRequest = useRef(0);

  useEffect(() => {
    let active = true;
    promptAgentService.getLibraryPrompts()
      .then(next => {
        if (!active) return;
        setSpec(next.spec);
        setExtra(next.extra);
        setSaved({ spec: next.spec, extra: next.extra });
      })
      .catch(() => { if (active) setNotice(t('读取已保存的库生成提示词失败')); });
    return () => { active = false; previewRequest.current += 1; };
  }, []);

  const dirty = spec !== saved.spec || extra !== saved.extra;

  const loadPreview = async (nextKind: PromptLibraryKind) => {
    const request = previewRequest.current + 1;
    previewRequest.current = request;
    setKind(nextKind);
    setPreviewOpen(true);
    setPreview(null);
    setPreviewing(true);
    setNotice('');
    try {
      const result = await promptAgentService.previewLibrarySystemPrompt({ kind: nextKind, spec, extra });
      if (request !== previewRequest.current) return;
      setPreview({ length: result.length, systemPrompt: result.systemPrompt });
    } catch (error) {
      if (request !== previewRequest.current) return;
      setNotice(error instanceof Error ? error.message : t('预览系统提示词失败'));
    } finally {
      if (request === previewRequest.current) setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      const next = await promptAgentService.saveLibraryPrompts({ spec, extra });
      setSpec(next.spec);
      setExtra(next.extra);
      setSaved({ spec: next.spec, extra: next.extra });
      setNotice(t('已保存，四个提示词库立即使用最新内容'));
      if (previewOpen) void loadPreview(kind);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('保存库生成提示词失败'));
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    setSpec('');
    setExtra('');
    setNotice(t('已清空输入框，点“保存”后生效'));
  };

  const copyPreview = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.systemPrompt);
      setNotice(t('已复制系统提示词全文'));
    } catch {
      setNotice(t('无法复制，请手动选择文本'));
    }
  };

  return (
    <section aria-label={t("库生成提示词")} className="appearance-panel rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">{t("库生成提示词")}</h3>
      <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("这两段内容会置顶追加到提示词库的系统提示词最前面，作用范围是人物形象、服饰与姿势四个库。")}</p>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">{t("规范提示词")}</span>
          <textarea
            rows={5}
            value={spec}
            disabled={saving}
            aria-label={t("规范提示词")}
            onChange={event => setSpec(event.target.value)}
            placeholder={t("一律使用 Danbooru 标准标签写法，小写、下划线连接；每条不少于 12 个标签")}
            className={libraryFieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-500 dark:text-gray-400">{t("附加指令")}</span>
          <textarea
            rows={3}
            value={extra}
            disabled={saving}
            aria-label={t("附加指令")}
            onChange={event => setExtra(event.target.value)}
            placeholder={t("追加到系统提示词末尾的自由文本。留空即不追加。")}
            className={libraryFieldClass}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={saving || previewing} onClick={() => void save()} className={libraryPrimaryButtonClass}>{t("保存")}</button>
        <button type="button" disabled={saving || (!spec && !extra)} onClick={clear} className={librarySecondaryButtonClass}>{t("清空")}</button>
        <button type="button" disabled={previewing} onClick={() => void loadPreview(kind)} className={librarySecondaryButtonClass}>{t("预览最终系统提示词")}</button>
        {dirty && <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{t("有未保存的修改")}</span>}
      </div>
      {notice && <p role="status" className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{notice}</p>}
      {previewOpen && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label={t("提示词库类型")} className="flex flex-wrap items-center gap-2">
              {libraryKinds.map(item => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={kind === item}
                  onClick={() => void loadPreview(item)}
                  className={kind === item
                    ? 'mobile-touch rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white'
                    : librarySecondaryButtonClass}
                >
                  {t(PROMPT_LIBRARY_KIND_LABELS[item])}</button>
              ))}
            </div>
            <button type="button" disabled={!preview} onClick={() => void copyPreview()} className={librarySecondaryButtonClass}>{t("复制全文")}</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("最前面两段是自定义内容（置顶），其后是内置提示词；预览使用输入框当前内容，无需先保存。")}</p>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{t("当前长度 {0} 个字符", [preview?.length ?? 0])}</p>
          <pre aria-label={t("系统提示词预览")} className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white p-3 text-micro leading-5 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">{preview ? preview.systemPrompt : previewing ? t("正在生成预览…") : t("暂无预览内容，请点“预览最终系统提示词”。")}</pre>
        </div>
      )}
    </section>
  );
};
