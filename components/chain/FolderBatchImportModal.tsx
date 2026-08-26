import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckSquare, EyeOff, FolderOpen, FolderUp, Layers, Loader2, Sparkles, Square, Trash2, X } from 'lucide-react';
import { extractMetadata, parseNovelAIMetadata } from '../../services/metadataService';
import { api } from '../../services/api';
import { db } from '../../services/dbService';
import { UNTESTED_CHAIN_TAG } from '../DesignSystem';
import { getNaiModelDisplayLabel } from '../../services/naiModels';
import { NAIParams, PromptChain } from '../../types';

export interface DetectedChainItem {
  id: string;
  file: File;
  name: string;
  prompt: string;
  negativePrompt: string;
  params: NAIParams;
  previewUrl: string;
  selected: boolean;
  isDuplicate?: boolean;
  duplicateOfName?: string;
}

interface FolderBatchImportModalProps {
  isOpen: boolean;
  existingChains?: PromptChain[];
  onClose: () => void;
  onSuccess: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const computeChainFingerprint = (
  prompt: string,
  negativePrompt?: string,
  params?: Partial<NAIParams>
): string => {
  const p = (prompt || '').trim();
  const np = (negativePrompt || '').trim();
  const steps = params?.steps ?? '';
  const model = params?.model ?? '';
  const w = params?.width ?? '';
  const h = params?.height ?? '';
  return `${p}:::${np}:::${steps}:::${model}:::${w}x${h}`;
};

const getCleanPresetName = (fileName: string): string => {
  return fileName.replace(/\.[^/.]+$/, '').trim() || '未命名预设';
};

export const FolderBatchImportModal: React.FC<FolderBatchImportModalProps> = ({
  isOpen,
  existingChains = [],
  onClose,
  onSuccess,
  notify,
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string }>({
    current: 0,
    total: 0,
    fileName: '',
  });

  const [detectedItems, setDetectedItems] = useState<DetectedChainItem[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);

  const [markUntested, setMarkUntested] = useState(true);
  const [customTag, setCustomTag] = useState('');

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; name: string }>({
    current: 0,
    total: 0,
    name: '',
  });

  // 构建已有风格串指纹索引表
  const existingFingerprintsMap = useMemo(() => {
    const map = new Map<string, PromptChain>();
    existingChains.forEach(chain => {
      if (chain.type === 'style' || !chain.type) {
        const fp = computeChainFingerprint(chain.basePrompt, chain.negativePrompt, chain.params);
        if (fp && !map.has(fp)) {
          map.set(fp, chain);
        }
      }
    });
    return map;
  }, [existingChains]);

  // 释放 ObjectURL 防止内存泄漏
  const detectedItemsRef = useRef<DetectedChainItem[]>([]);
  detectedItemsRef.current = detectedItems;

  const cleanupObjectUrls = useCallback(() => {
    detectedItemsRef.current.forEach(item => {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      cleanupObjectUrls();
    };
  }, [cleanupObjectUrls]);

  const handleModalClose = () => {
    if (isImporting || isScanning) return;
    cleanupObjectUrls();
    setDetectedItems([]);
    setIgnoredCount(0);
    onClose();
  };

  // 递归读取拖拽或选中的文件条目
  const scanAndProcessFiles = async (files: File[]) => {
    if (!files.length) return;

    setIsScanning(true);
    cleanupObjectUrls();
    setDetectedItems([]);
    setIgnoredCount(0);

    const validImageFiles = files.filter(
      file => file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
    );
    const nonPngCount = files.length - validImageFiles.length;

    setScanProgress({ current: 0, total: validImageFiles.length, fileName: '准备扫描...' });

    const newDetected: DetectedChainItem[] = [];
    let noMetaCount = nonPngCount;

    // 并发批次扫描文件元数据
    const BATCH_SIZE = 4;
    for (let i = 0; i < validImageFiles.length; i += BATCH_SIZE) {
      const batch = validImageFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (file, batchIdx) => {
          const currentIndex = i + batchIdx + 1;
          setScanProgress({ current: currentIndex, total: validImageFiles.length, fileName: file.name });

          try {
            const rawMeta = await extractMetadata(file);
            if (rawMeta) {
              const parsed = parseNovelAIMetadata(rawMeta);
              // 检查是否包含有效的生成提示词或参数
              if (parsed.prompt || parsed.params.steps || parsed.negativePrompt) {
                const previewUrl = URL.createObjectURL(file);
                const fp = computeChainFingerprint(parsed.prompt, parsed.negativePrompt, parsed.params);
                const existing = existingFingerprintsMap.get(fp);
                const isDuplicate = Boolean(existing);

                newDetected.push({
                  id: `${file.name}-${file.size}-${currentIndex}-${Math.random().toString(36).slice(2, 6)}`,
                  file,
                  name: getCleanPresetName(file.name),
                  prompt: parsed.prompt,
                  negativePrompt: parsed.negativePrompt,
                  params: parsed.params,
                  previewUrl,
                  selected: !isDuplicate, // 新图片默认勾选，已有预设默认不勾选去重
                  isDuplicate,
                  duplicateOfName: existing?.name,
                });
                return;
              }
            }
            noMetaCount++;
          } catch {
            noMetaCount++;
          }
        })
      );
    }

    setDetectedItems(newDetected);
    setIgnoredCount(noMetaCount);
    setIsScanning(false);
  };

  // 处理拖拽文件夹或文件
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isScanning || isImporting) return;

    const items = Array.from(e.dataTransfer.items || []);
    const files: File[] = [];

    const readEntry = async (entry: any): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise<void>(resolve => {
          entry.file(
            (file: File) => {
              files.push(file);
              resolve();
            },
            () => resolve()
          );
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async (): Promise<void> => {
          return new Promise<void>(resolve => {
            dirReader.readEntries(
              async (entries: any[]) => {
                if (!entries.length) {
                  resolve();
                } else {
                  for (const subEntry of entries) {
                    await readEntry(subEntry);
                  }
                  await readEntries();
                  resolve();
                }
              },
              () => resolve()
            );
          });
        };
        await readEntries();
      }
    };

    for (const item of items) {
      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          await readEntry(entry);
          continue;
        }
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }

    if (files.length > 0) {
      void scanAndProcessFiles(files);
    } else {
      notify('未检测到可读取的图片文件', 'error');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      void scanAndProcessFiles(files);
    }
    e.target.value = '';
  };

  const toggleSelectItem = (id: string) => {
    setDetectedItems(prev => prev.map(item => (item.id === id ? { ...item, selected: !item.selected } : item)));
  };

  const selectOnlyNewItems = () => {
    setDetectedItems(prev => prev.map(item => ({ ...item, selected: !item.isDuplicate })));
  };

  const toggleSelectAll = () => {
    const allSelected = detectedItems.every(item => item.selected);
    setDetectedItems(prev => prev.map(item => ({ ...item, selected: !allSelected })));
  };

  const updateItemName = (id: string, newName: string) => {
    setDetectedItems(prev => prev.map(item => (item.id === id ? { ...item, name: newName } : item)));
  };

  const removeItem = (id: string) => {
    setDetectedItems(prev => {
      const target = prev.find(item => item.id === id);
      if (target?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter(item => item.id !== id);
    });
  };

  const newItemsCount = detectedItems.filter(item => !item.isDuplicate).length;
  const duplicateItemsCount = detectedItems.filter(item => item.isDuplicate).length;
  const selectedCount = detectedItems.filter(item => item.selected).length;

  // 执行批量导入
  const handleExecuteImport = async () => {
    const targets = detectedItems.filter(item => item.selected);
    if (!targets.length) {
      notify('请至少勾选一张要导入的图片', 'error');
      return;
    }

    setIsImporting(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setImportProgress({ current: i + 1, total: targets.length, name: item.name });

      try {
        // 1. 上传图片作为封面，无需二次生成
        const uploadResult = await api.uploadFile(item.file, 'covers');

        // 2. 组装 Tags
        const tags: string[] = [];
        if (markUntested) tags.push(UNTESTED_CHAIN_TAG);
        if (customTag.trim()) {
          const extraTags = customTag.split(/[,，\s]+/).filter(Boolean);
          extraTags.forEach(t => {
            if (!tags.includes(t)) tags.push(t);
          });
        }

        // 3. 创建风格预设
        const chainId = await db.createChain(item.name || '批量导入预设', '批量导入自本地图片', undefined, 'style');

        // 4. 更新预设完整内容与封面
        await db.updateChain(chainId, {
          tags,
          basePrompt: item.prompt,
          negativePrompt: item.negativePrompt,
          params: item.params,
          previewImage: uploadResult.url,
          variableValues: { subject: '1girl' },
        });

        successCount++;
      } catch (err) {
        console.error('导入单个风格串失败:', item.name, err);
        failCount++;
      }
    }

    setIsImporting(false);
    if (successCount > 0) {
      notify(`成功导入 ${successCount} 个风格串${markUntested ? '（已标记为待实测）' : ''}${failCount > 0 ? `，${failCount} 个失败` : ''}`);
      onSuccess();
      handleModalClose();
    } else {
      notify('批量导入失败，请查看控制台日志', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 md:p-6" onClick={handleModalClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <FolderUp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">批量导入文件夹图片为风格串</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">智能过滤已存在预设并使用原图作为封面</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleModalClose}
            disabled={isScanning || isImporting}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 space-y-5">
          {/* Dropzone & Pickers */}
          {detectedItems.length === 0 && !isScanning && (
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 md:p-12 text-center transition-colors ${
                isDragOver
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                  : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600 bg-gray-50/50 dark:bg-gray-800/20'
              }`}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100/70 text-indigo-600 dark:bg-indigo-950/80 dark:text-indigo-400">
                <FolderOpen className="h-8 w-8" />
              </div>
              <h3 className="mb-1 text-base font-bold text-gray-800 dark:text-gray-200">
                将图片文件夹或多张图片拖到此处
              </h3>
              <p className="mb-6 max-w-md text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                自动提取 NovelAI 生成参数、智能排除已存在的相同预设，并以原图为封面沉淀为风格串
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory is standard for folder picker
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <input
                  ref={filesInputRef}
                  type="file"
                  accept="image/png"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 transition active:scale-[0.98]"
                >
                  <FolderOpen className="h-4 w-4" />
                  选择文件夹
                </button>
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-750 transition"
                >
                  选择多张 PNG 图片
                </button>
              </div>
            </div>
          )}

          {/* Scanning In Progress */}
          {isScanning && (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400" />
              <div>
                <h4 className="text-base font-bold text-gray-800 dark:text-gray-200">正在分析图片元数据并比对现有库...</h4>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  已扫描 {scanProgress.current} / {scanProgress.total} 张
                </p>
                <p className="mt-0.5 text-[11px] font-mono text-gray-400 truncate max-w-md">{scanProgress.fileName}</p>
              </div>
              <div className="w-64 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 h-1.5">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{ width: `${scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Detected List & Options */}
          {detectedItems.length > 0 && !isScanning && (
            <div className="space-y-4">
              {/* Scan summary banner */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/80 px-4 py-3 border border-indigo-100 dark:border-indigo-900/40 dark:bg-indigo-950/30">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                    成功识别 <b className="text-indigo-600 dark:text-indigo-400">{detectedItems.length}</b> 张图片
                    {duplicateItemsCount > 0 ? (
                      <>
                        （含 <b className="text-emerald-600 dark:text-emerald-400">{newItemsCount}</b> 张新素材，
                        <span className="text-gray-500 dark:text-gray-400">{duplicateItemsCount} 张已在库中已自动排除</span>）
                      </>
                    ) : (
                      <span>（全部为新素材）</span>
                    )}
                    {ignoredCount > 0 && `，跳过 ${ignoredCount} 张无生成参数的文件`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {duplicateItemsCount > 0 && (
                    <button
                      type="button"
                      onClick={selectOnlyNewItems}
                      className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                    >
                      <Layers className="h-3.5 w-3.5" /> 仅选新素材 ({newItemsCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    {detectedItems.every(i => i.selected) ? (
                      <>
                        <CheckSquare className="h-4 w-4" /> 取消全选
                      </>
                    ) : (
                      <>
                        <Square className="h-4 w-4" /> 全选
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cleanupObjectUrls();
                      setDetectedItems([]);
                      setIgnoredCount(0);
                    }}
                    className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400"
                  >
                    重新扫描
                  </button>
                </div>
              </div>

              {/* Items Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 max-h-[42vh] overflow-y-auto pr-1">
                {detectedItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => toggleSelectItem(item.id)}
                    className={`group relative flex flex-col rounded-xl border p-2.5 transition cursor-pointer select-none ${
                      item.selected
                        ? 'border-indigo-500 bg-indigo-50/30 dark:border-indigo-500/80 dark:bg-indigo-950/20 shadow-sm'
                        : item.isDuplicate
                          ? 'border-gray-200 bg-gray-100/60 dark:border-gray-800 dark:bg-gray-900/60 opacity-60 hover:opacity-90'
                          : 'border-gray-200 bg-gray-50/50 opacity-60 hover:opacity-100 dark:border-gray-800 dark:bg-gray-850'
                    }`}
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 flex items-center justify-center">
                      <img src={item.previewUrl} alt={item.name} className="h-full w-full object-contain" />
                      <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-md backdrop-blur-md shadow-sm transition ${
                            item.selected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-black/40 text-gray-300 group-hover:bg-black/60'
                          }`}
                        >
                          {item.selected ? <Check className="h-3.5 w-3.5" /> : null}
                        </div>
                      </div>
                      {item.isDuplicate && (
                        <div
                          className="absolute right-1.5 top-1.5 max-w-[65%] truncate rounded bg-gray-900/85 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 border border-gray-700/60 backdrop-blur-sm"
                          title={`已存在同参数预设: ${item.duplicateOfName || '现有预设'}`}
                        >
                          已在库中
                        </div>
                      )}
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-mono text-gray-200 backdrop-blur-sm">
                        {item.params.width}×{item.params.height}
                      </span>
                    </div>

                    <div className="mt-2 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={item.name}
                          onChange={e => updateItemName(item.id, e.target.value)}
                          placeholder="预设名称"
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                        <span className="truncate">{getNaiModelDisplayLabel(item.params.model)}</span>
                        <span className="flex-none font-mono">{item.params.steps} 步</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[10px] text-gray-400 font-mono break-all leading-tight">
                        {item.prompt || '(无正面提示词)'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                      className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-white/90 text-gray-400 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-500 dark:bg-black/70 dark:hover:bg-red-950/50 md:group-hover:flex"
                      title="移除此项"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Import Options Panel */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3.5 dark:border-gray-800 dark:bg-gray-855 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={markUntested}
                      onChange={e => setMarkUntested(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-gray-200">
                      <EyeOff className="h-3.5 w-3.5 text-amber-500" />
                      <span>标记为「待实测」</span>
                      <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                        （在工坊首次生成后会自动去除）
                      </span>
                    </div>
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-none">附加标签:</span>
                    <input
                      type="text"
                      value={customTag}
                      onChange={e => setCustomTag(e.target.value)}
                      placeholder="可选，例如：外部收集, 2026-08"
                      className="h-8 w-48 rounded-lg border border-gray-300 bg-white px-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Importing In Progress */}
          {isImporting && (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
              <div>
                <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200">正在保存风格串与封面...</h4>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  进度：{importProgress.current} / {importProgress.total}（{importProgress.name}）
                </p>
              </div>
              <div className="w-64 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 h-2">
                <div
                  className="h-full bg-indigo-600 transition-all duration-150"
                  style={{ width: `${(importProgress.current / Math.max(1, importProgress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex flex-none items-center justify-between border-t border-gray-200 px-5 py-3.5 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/50 rounded-b-2xl">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {detectedItems.length > 0 && !isScanning && !isImporting && (
              <span>
                已选中 <b className="text-indigo-600 dark:text-indigo-400">{selectedCount}</b> / {detectedItems.length} 个预设
                {duplicateItemsCount > 0 && (
                  <span className="ml-1 text-gray-400">（已自动排除 {duplicateItemsCount} 个已有预设）</span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleModalClose}
              disabled={isScanning || isImporting}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750 disabled:opacity-40"
            >
              取消
            </button>
            {detectedItems.length > 0 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isScanning || isImporting || selectedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:bg-indigo-500 disabled:opacity-40 transition active:scale-[0.98]"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在导入...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    导入选中的 {selectedCount} 个风格串
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
