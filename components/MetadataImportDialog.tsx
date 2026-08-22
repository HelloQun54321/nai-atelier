import React, { useState } from 'react';
import { Check, Split, X } from 'lucide-react';
import type { ParsedNAIData } from '../services/metadataService';
import type { PromptImportSplit } from '../services/promptImport';
import { getNaiModelDisplayLabel } from '../services/naiModels';

export interface MetadataImportChoice {
  basePrompt: string;
  subjectPrompt: string;
  mode: 'smart' | 'exact';
}

interface MetadataImportDialogProps {
  sourceLabel: string;
  parsed: ParsedNAIData;
  smartSplit: PromptImportSplit;
  onCancel: () => void;
  onConfirm: (choice: MetadataImportChoice) => void;
}

export const MetadataImportDialog: React.FC<MetadataImportDialogProps> = ({
  sourceLabel,
  parsed,
  smartSplit,
  onCancel,
  onConfirm,
}) => {
  const [mode, setMode] = useState<'smart' | 'exact'>('smart');
  const [basePrompt, setBasePrompt] = useState(smartSplit.basePrompt);
  const [subjectPrompt, setSubjectPrompt] = useState(smartSplit.subjectPrompt);
  const exactMode = mode === 'exact';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-2 backdrop-blur-sm md:p-4">
      <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 dark:text-white">确认导入 {sourceLabel} 元数据</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              图片只保存最终提示词，没有记录 Atelier 原来的区域划分。请检查自动拆分结果后再覆盖。
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" aria-label="取消导入">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900/60 dark:text-gray-300 sm:grid-cols-4">
            <div><span className="block text-gray-400">模型</span><strong>{getNaiModelDisplayLabel(parsed.params.model)}</strong></div>
            <div><span className="block text-gray-400">尺寸</span><strong>{parsed.params.width} × {parsed.params.height}</strong></div>
            <div><span className="block text-gray-400">步数</span><strong>{parsed.params.steps}</strong></div>
            <div><span className="block text-gray-400">Seed</span><strong>{parsed.params.seed ?? '随机'}</strong></div>
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('smart')}
              className={`rounded-lg border p-3 text-left transition-colors ${!exactMode ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200' : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300'}`}
            >
              <span className="flex items-center gap-2 font-semibold"><Split className="h-4 w-4" />智能拆分（推荐）</span>
              <span className="mt-1 block text-xs opacity-80">画师、质量、年代和媒介进入基础画风；歧义内容保留在主体。</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('exact')}
              className={`rounded-lg border p-3 text-left transition-colors ${exactMode ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200' : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300'}`}
            >
              <span className="font-semibold">保持完整</span>
              <span className="mt-1 block text-xs opacity-80">不判断内容，基础画风清空，最终提示词原样放入主体区域。</span>
            </button>
          </div>

          {!exactMode ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <span className="mb-2 flex items-center justify-between gap-2">
                  <span>基础画风（风格串）</span>
                  <span className="text-xs font-normal text-gray-400">识别 {smartSplit.styleSegmentCount} 组</span>
                </span>
                <textarea
                  value={basePrompt}
                  onChange={event => setBasePrompt(event.target.value)}
                  className="h-48 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs font-normal leading-relaxed text-gray-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder="未识别出高置信度风格词；可在这里手动调整"
                />
              </label>
              <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <span className="mb-2 flex items-center justify-between gap-2">
                  <span>主体／变量提示词</span>
                  <span className="text-xs font-normal text-gray-400">保留 {smartSplit.subjectSegmentCount} 组</span>
                </span>
                <textarea
                  value={subjectPrompt}
                  onChange={event => setSubjectPrompt(event.target.value)}
                  className="h-48 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs font-normal leading-relaxed text-gray-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
            </div>
          ) : (
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              <span className="mb-2 block">完整提示词将写入主体区域</span>
              <textarea
                value={parsed.prompt}
                readOnly
                className="h-56 w-full resize-y rounded-lg border border-gray-300 bg-gray-50 p-3 font-mono text-xs font-normal leading-relaxed text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>
          )}

          <p className="mt-3 text-xs leading-5 text-amber-600 dark:text-amber-400">
            智能拆分采用高置信度规则，未知词不会擅自移入风格串；数值权重组会整体保留。负面提示词、角色提示词与生成参数同时恢复，现有提示词模块不修改。
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-white">取消</button>
          <button
            type="button"
            onClick={() => onConfirm(exactMode
              ? { basePrompt: '', subjectPrompt: parsed.prompt, mode: 'exact' }
              : { basePrompt: basePrompt.trim(), subjectPrompt: subjectPrompt.trim(), mode: 'smart' })}
            className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-500"
          >
            <Check className="h-4 w-4" />确认覆盖
          </button>
        </div>
      </div>
    </div>
  );
};
