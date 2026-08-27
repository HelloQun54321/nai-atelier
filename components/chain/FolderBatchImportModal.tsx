import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, CheckSquare, EyeOff, FileQuestion, FolderOpen, FolderUp, Layers, Loader2, RefreshCw, Sparkles, Square, Trash2, X } from 'lucide-react';
import { extractMetadata, parseNovelAIMetadata } from '../../services/metadataService';
import { api } from '../../services/api';
import { db } from '../../services/dbService';
import { UNTESTED_CHAIN_TAG } from '../DesignSystem';
import { getNaiModelDisplayLabel } from '../../services/naiModels';
import { NAIParams, PromptChain } from '../../types';

export interface DetectedChainItem {
  id: string;
  file: File;
  dirHandle?: any;
  relativePath?: string;
  name: string;
  prompt: string;
  negativePrompt: string;
  params: NAIParams;
  previewUrl: string;
  selected: boolean;
  isDuplicate?: boolean;
  duplicateOfName?: string;
  isBatchDuplicate?: boolean;
}

export interface IgnoredFileItem {
  id: string;
  file: File;
  dirHandle?: any;
  relativePath?: string;
  name: string;
  size: number;
  reason: 'no-metadata' | 'non-png' | 'parse-error';
  reasonText: string;
  previewUrl?: string;
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
  _params?: Partial<NAIParams>
): string => {
  const p = (prompt || '').trim();
  const np = (negativePrompt || '').trim();
  return `${p}:::${np}`;
};

const getCleanPresetName = (fileName: string): string => {
  return fileName.replace(/\.[^/.]+$/, '').trim() || '未命名预设';
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const rootDirectoryHandleRef = useRef<any>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string }>({
    current: 0,
    total: 0,
    fileName: '',
  });

  const [detectedItems, setDetectedItems] = useState<DetectedChainItem[]>([]);
  const [ignoredFiles, setIgnoredFiles] = useState<IgnoredFileItem[]>([]);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupCategory, setCleanupCategory] = useState<'all' | 'no-metadata' | 'duplicate'>('all');
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

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
  const ignoredFilesRef = useRef<IgnoredFileItem[]>([]);
  ignoredFilesRef.current = ignoredFiles;

  const cleanupObjectUrls = useCallback(() => {
    detectedItemsRef.current.forEach(item => {
      if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    ignoredFilesRef.current.forEach(item => {
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
    if (isImporting || isScanning || isDeleting) return;
    cleanupObjectUrls();
    setDetectedItems([]);
    setIgnoredFiles([]);
    setShowCleanupModal(false);
    onClose();
  };

  // 统一批次扫描与元数据提取
  const processScannedFiles = async (
    fileEntries: { file: File; dirHandle?: any; relativePath?: string }[]
  ) => {
    if (!fileEntries.length) return;

    setIsScanning(true);
    cleanupObjectUrls();
    setDetectedItems([]);
    setIgnoredFiles([]);
    setShowCleanupModal(false);

    setScanProgress({ current: 0, total: fileEntries.length, fileName: '准备扫描...' });

    const newDetected: DetectedChainItem[] = [];
    const newIgnored: IgnoredFileItem[] = [];
    const scannedBatchFingerprints = new Set<string>();

    const BATCH_SIZE = 4;
    for (let i = 0; i < fileEntries.length; i += BATCH_SIZE) {
      const batch = fileEntries.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (entry, batchIdx) => {
          const currentIndex = i + batchIdx + 1;
          const { file, dirHandle, relativePath } = entry;
          setScanProgress({ current: currentIndex, total: fileEntries.length, fileName: file.name });

          const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
          if (!isPng) {
            const previewUrl = file.type.startsWith('image/') || file.name.match(/\.(jpe?g|webp|gif|bmp)$/i)
              ? URL.createObjectURL(file)
              : undefined;
            newIgnored.push({
              id: `ignored-${file.name}-${file.size}-${currentIndex}`,
              file,
              dirHandle,
              relativePath,
              name: file.name,
              size: file.size,
              reason: 'non-png',
              reasonText: '非 PNG 格式（NovelAI 元数据多存储于 PNG）',
              previewUrl,
            });
            return;
          }

          try {
            const rawMeta = await extractMetadata(file);
            if (rawMeta) {
              const parsed = parseNovelAIMetadata(rawMeta);
              if (parsed.prompt || parsed.params.steps || parsed.negativePrompt) {
                const previewUrl = URL.createObjectURL(file);
                const fp = computeChainFingerprint(parsed.prompt, parsed.negativePrompt, parsed.params);
                const existing = existingFingerprintsMap.get(fp);
                const isExistingDuplicate = Boolean(existing);
                const isBatchDuplicate = scannedBatchFingerprints.has(fp);
                scannedBatchFingerprints.add(fp);

                const isDuplicate = isExistingDuplicate || isBatchDuplicate;

                newDetected.push({
                  id: `${file.name}-${file.size}-${currentIndex}-${Math.random().toString(36).slice(2, 6)}`,
                  file,
                  dirHandle,
                  relativePath,
                  name: getCleanPresetName(file.name),
                  prompt: parsed.prompt,
                  negativePrompt: parsed.negativePrompt,
                  params: parsed.params,
                  previewUrl,
                  selected: !isDuplicate, // 新图片默认勾选，已有或批次重复默认不勾选
                  isDuplicate,
                  duplicateOfName: existing?.name || (isBatchDuplicate ? '本次导入的前序重复图' : undefined),
                  isBatchDuplicate,
                });
                return;
              }
            }

            const previewUrl = URL.createObjectURL(file);
            newIgnored.push({
              id: `ignored-${file.name}-${file.size}-${currentIndex}`,
              file,
              dirHandle,
              relativePath,
              name: file.name,
              size: file.size,
              reason: 'no-metadata',
              reasonText: '未检测到 NovelAI 生成元数据',
              previewUrl,
            });
          } catch {
            const previewUrl = URL.createObjectURL(file);
            newIgnored.push({
              id: `ignored-${file.name}-${file.size}-${currentIndex}`,
              file,
              dirHandle,
              relativePath,
              name: file.name,
              size: file.size,
              reason: 'parse-error',
              reasonText: '生成参数解析失败或损坏',
              previewUrl,
            });
          }
        })
      );
    }

    setDetectedItems(newDetected);
    setIgnoredFiles(newIgnored);
    setIsScanning(false);
  };

  // 通过现代 File System Access API 扫描目录
  const scanDirectoryHandle = async (rootHandle: any) => {
    setIsScanning(true);
    cleanupObjectUrls();
    setDetectedItems([]);
    setIgnoredFiles([]);
    setShowCleanupModal(false);

    const fileEntries: { file: File; dirHandle?: any; relativePath?: string }[] = [];

    async function collect(dir: any, currentPath = '') {
      for await (const entry of dir.values()) {
        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
          try {
            const file = await entry.getFile();
            fileEntries.push({ file, dirHandle: dir, relativePath: entryPath });
          } catch (e) {
            console.warn('读取目录文件失败:', entry.name, e);
          }
        } else if (entry.kind === 'directory') {
          await collect(entry, entryPath);
        }
      }
    }

    try {
      await collect(rootHandle);
      await processScannedFiles(fileEntries);
    } catch (err) {
      console.error('扫描目录句柄失败:', err);
      notify('扫描文件夹失败，请检查文件夹访问权限', 'error');
      setIsScanning(false);
    }
  };

  // 点击选择文件夹按钮：优先使用支持直接读写删除的 showDirectoryPicker
  const handleSelectFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        rootDirectoryHandleRef.current = rootHandle;
        await scanDirectoryHandle(rootHandle);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // 用户取消选择
        console.warn('showDirectoryPicker 降级到传统 input:', err);
      }
    }
    folderInputRef.current?.click();
  };

  // 处理拖拽文件夹或文件
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (isScanning || isImporting || isDeleting) return;

    const items = Array.from(e.dataTransfer.items || []);
    const fileEntries: { file: File; relativePath?: string }[] = [];

    const readEntry = async (entry: any, currentPath = ''): Promise<void> => {
      if (!entry) return;
      const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        await new Promise<void>(resolve => {
          entry.file(
            (file: File) => {
              fileEntries.push({ file, relativePath: entryPath });
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
                    await readEntry(subEntry, entryPath);
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
      if (file) fileEntries.push({ file });
    }

    if (fileEntries.length > 0) {
      void processScannedFiles(fileEntries);
    } else {
      notify('未检测到可读取的图片文件', 'error');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isScanning && !isImporting && !isDeleting) {
        handleModalClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isScanning, isImporting, isDeleting, handleModalClose]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      void processScannedFiles(files.map(file => ({ file, relativePath: file.webkitRelativePath || file.name })));
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
  const duplicateDetectedItems = detectedItems.filter(item => item.isDuplicate);
  const duplicateItemsCount = duplicateDetectedItems.length;
  const selectedCount = detectedItems.filter(item => item.selected).length;
  const totalJunkCount = ignoredFiles.length + duplicateItemsCount;

  // 打开清理弹窗：默认勾选全部无意义图片
  const handleOpenCleanupModal = () => {
    const initialIds = new Set<string>();
    ignoredFiles.forEach(f => initialIds.add(f.id));
    duplicateDetectedItems.forEach(d => initialIds.add(d.id));
    setSelectedCleanupIds(initialIds);
    setCleanupCategory('all');
    setShowCleanupModal(true);
  };

  // 切换清理项勾选
  const toggleCleanupItemSelection = (id: string) => {
    setSelectedCleanupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 获取当前分类下所有可清理项目
  const currentCategoryJunkItems = useMemo(() => {
    const list: {
      id: string;
      file: File;
      dirHandle?: any;
      relativePath?: string;
      name: string;
      size: number;
      reasonType: 'no-metadata' | 'duplicate';
      reasonText: string;
      previewUrl?: string;
      isDetected: boolean;
    }[] = [];

    if (cleanupCategory === 'all' || cleanupCategory === 'no-metadata') {
      ignoredFiles.forEach(item => {
        list.push({
          id: item.id,
          file: item.file,
          dirHandle: item.dirHandle,
          relativePath: item.relativePath,
          name: item.name,
          size: item.size,
          reasonType: 'no-metadata',
          reasonText: item.reasonText,
          previewUrl: item.previewUrl,
          isDetected: false,
        });
      });
    }

    if (cleanupCategory === 'all' || cleanupCategory === 'duplicate') {
      duplicateDetectedItems.forEach(item => {
        list.push({
          id: item.id,
          file: item.file,
          dirHandle: item.dirHandle,
          relativePath: item.relativePath,
          name: item.name,
          size: item.file.size,
          reasonType: 'duplicate',
          reasonText: item.duplicateOfName ? `与预设「${item.duplicateOfName}」提示词完全重复` : '与工坊已有预设提示词重复',
          previewUrl: item.previewUrl,
          isDetected: true,
        });
      });
    }

    return list;
  }, [cleanupCategory, ignoredFiles, duplicateDetectedItems]);

  const selectAllCurrentCategoryJunk = () => {
    setSelectedCleanupIds(prev => {
      const next = new Set(prev);
      currentCategoryJunkItems.forEach(item => next.add(item.id));
      return next;
    });
  };

  const deselectAllCurrentCategoryJunk = () => {
    setSelectedCleanupIds(prev => {
      const next = new Set(prev);
      currentCategoryJunkItems.forEach(item => next.delete(item.id));
      return next;
    });
  };

  // 真实从本地磁盘物理删除选中的文件
  const executeDeleteJunkFiles = async () => {
    const targets = currentCategoryJunkItems.filter(item => selectedCleanupIds.has(item.id));
    if (!targets.length) {
      notify('请至少勾选一个要删除的文件', 'error');
      return;
    }

    // 1. 如果尚未获取 rootDirectoryHandle，尝试唤起目录授权
    let rootHandle = rootDirectoryHandleRef.current;
    if (!rootHandle && 'showDirectoryPicker' in window) {
      try {
        notify('正在请求选择目标文件夹以获得删除写入权限...', 'success');
        rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        rootDirectoryHandleRef.current = rootHandle;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        notify('未能获取文件夹写入权限，无法删除本地文件', 'error');
        return;
      }
    }

    if (!rootHandle && !targets[0].dirHandle) {
      notify('当前浏览器环境未授予本地文件系统删除权限', 'error');
      return;
    }

    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: targets.length });

    let deletedCount = 0;
    let failCount = 0;
    const deletedIds = new Set<string>();

    async function removeFileFromDisk(
      root: any,
      targetFile: File,
      specificDir?: any,
      relPath?: string
    ): Promise<boolean> {
      if (specificDir) {
        try {
          await specificDir.removeEntry(targetFile.name);
          return true;
        } catch {
          // specificDir 失败时继续回退到 root 递归查找
        }
      }

      if (root) {
        // 根据相对路径逐级进入子目录
        const path = relPath || targetFile.webkitRelativePath || targetFile.name;
        const parts = path.split(/[\/\\]+/).filter(Boolean);

        async function searchAndRemove(dir: any, subParts: string[]): Promise<boolean> {
          if (subParts.length <= 1) {
            const fileName = subParts[0] || targetFile.name;
            try {
              await dir.removeEntry(fileName);
              return true;
            } catch {
              return false;
            }
          }
          const nextDirName = subParts[0];
          try {
            const nextDir = await dir.getDirectoryHandle(nextDirName);
            return await searchAndRemove(nextDir, subParts.slice(1));
          } catch {
            return false;
          }
        }

        if (await searchAndRemove(root, parts)) return true;

        // 如果路径无法逐级命中，直接在根目录尝试
        try {
          await root.removeEntry(targetFile.name);
          return true;
        } catch {
          return false;
        }
      }

      return false;
    }

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setDeleteProgress({ current: i + 1, total: targets.length });

      const success = await removeFileFromDisk(
        rootHandle,
        item.file,
        item.dirHandle,
        item.relativePath
      );

      if (success) {
        deletedCount++;
        deletedIds.add(item.id);
      } else {
        failCount++;
      }
    }

    setIsDeleting(false);

    // 从状态列表中移除已删除项
    setDetectedItems(prev => prev.filter(item => !deletedIds.has(item.id)));
    setIgnoredFiles(prev => prev.filter(item => !deletedIds.has(item.id)));

    if (deletedCount > 0) {
      notify(`已成功从本地文件夹删除 ${deletedCount} 张无意义图片${failCount > 0 ? `，${failCount} 个失败` : ''}`);
      setShowCleanupModal(false);
    } else {
      notify('删除失败，请检查文件夹访问权限', 'error');
    }
  };

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
                  onClick={handleSelectFolder}
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
          {(detectedItems.length > 0 || ignoredFiles.length > 0) && !isScanning && (
            <div className="space-y-4">
              {/* Scan summary banner */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/80 px-4 py-3 border border-indigo-100 dark:border-indigo-900/40 dark:bg-indigo-950/30">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 flex-none" />
                  <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                    成功识别 <b className="text-indigo-600 dark:text-indigo-400">{detectedItems.length}</b> 张有效预设
                    {duplicateItemsCount > 0 ? (
                      <>
                        （含 <b className="text-emerald-600 dark:text-emerald-400">{newItemsCount}</b> 张新素材，
                        <span className="text-gray-500 dark:text-gray-400">{duplicateItemsCount} 张已在库中已自动排除</span>）
                      </>
                    ) : (
                      <span>（全部为新素材）</span>
                    )}
                    {ignoredFiles.length > 0 && `，跳过 ${ignoredFiles.length} 张无生成参数的文件`}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {totalJunkCount > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenCleanupModal}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-600 shadow-sm transition hover:bg-rose-100 hover:border-rose-300 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
                      title="删除无元数据图片与已在库中重复的图片"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>清理无意义图片 ({totalJunkCount})</span>
                    </button>
                  )}
                  {duplicateItemsCount > 0 && (
                    <button
                      type="button"
                      onClick={selectOnlyNewItems}
                      className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                    >
                      <Layers className="h-3.5 w-3.5" /> 仅选新素材 ({newItemsCount})
                    </button>
                  )}
                  {detectedItems.length > 0 && (
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
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      cleanupObjectUrls();
                      setDetectedItems([]);
                      setIgnoredFiles([]);
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

      {/* Junk Files Cleanup Modal */}
      {showCleanupModal && (
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 md:p-6"
          onClick={() => !isDeleting && setShowCleanupModal(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            onClick={e => e.stopPropagation()}
          >
            {/* Cleanup Header */}
            <div className="flex flex-none items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">清理本地无意义图片</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">从本地文件夹中物理删除无元数据、非 NAI 或重复图片</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCleanupModal(false)}
                disabled={isDeleting}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:opacity-30"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Cleanup Category Tabs & Batch Selection */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-2.5 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/40">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCleanupCategory('all')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    cleanupCategory === 'all'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-200/60 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  全部 ({totalJunkCount})
                </button>
                {ignoredFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCleanupCategory('no-metadata')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      cleanupCategory === 'no-metadata'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-200/60 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    无元数据/非NAI ({ignoredFiles.length})
                  </button>
                )}
                {duplicateItemsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setCleanupCategory('duplicate')}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      cleanupCategory === 'duplicate'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-gray-600 hover:bg-gray-200/60 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    重复预设 ({duplicateItemsCount})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllCurrentCategoryJunk}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400"
                >
                  全选
                </button>
                <span className="text-gray-300 dark:text-gray-700">|</span>
                <button
                  type="button"
                  onClick={deselectAllCurrentCategoryJunk}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  清空选择
                </button>
              </div>
            </div>

            {/* Cleanup Items List */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 space-y-2.5 max-h-[46vh]">
              {currentCategoryJunkItems.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400">当前分类下没有可清理的图片</div>
              ) : (
                currentCategoryJunkItems.map(item => {
                  const isSelected = selectedCleanupIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => !isDeleting && toggleCleanupItemSelection(item.id)}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 transition cursor-pointer select-none ${
                        isSelected
                          ? 'border-rose-300 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20'
                          : 'border-gray-200 bg-white opacity-70 hover:opacity-100 dark:border-gray-800 dark:bg-gray-850'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border transition ${
                            isSelected
                              ? 'border-rose-600 bg-rose-600 text-white'
                              : 'border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900'
                          }`}
                        >
                          {isSelected && <Check className="h-3.5 w-3.5" />}
                        </div>

                        <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-lg bg-gray-100 border border-gray-200 dark:border-gray-800 dark:bg-gray-900">
                          {item.previewUrl ? (
                            <img src={item.previewUrl} alt={item.name} className="h-full w-full object-contain" />
                          ) : (
                            <FileQuestion className="h-5 w-5 text-gray-400" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-gray-800 dark:text-gray-200" title={item.name}>
                            {item.name}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                            <span
                              className={`rounded px-1.5 py-0.5 font-medium ${
                                item.reasonType === 'no-metadata'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {item.reasonType === 'no-metadata' ? '无元数据' : '重复素材'}
                            </span>
                            <span className="text-gray-400 truncate">{item.reasonText}</span>
                            <span className="font-mono text-gray-400 flex-none">{formatFileSize(item.size)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Cleanup Danger Warning & Footer */}
            <div className="flex flex-none flex-col gap-3 border-t border-gray-200 p-4 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/60 rounded-b-2xl">
              <div className="flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 flex-none" />
                <span>注意：删除操作将直接修改本地文件系统，物理删除选中的文件且无法从回收站恢复，请谨慎操作。</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  已勾选 <b className="text-rose-600 dark:text-rose-400">{selectedCleanupIds.size}</b> / {totalJunkCount} 个文件
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCleanupModal(false)}
                    disabled={isDeleting}
                    className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750 disabled:opacity-40"
                  >
                    返回
                  </button>
                  <button
                    type="button"
                    onClick={executeDeleteJunkFiles}
                    disabled={isDeleting || selectedCleanupIds.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-500 disabled:opacity-40 transition active:scale-[0.98]"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在删除 ({deleteProgress.current}/{deleteProgress.total})...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-3.5 w-3.5" />
                        彻底删除选中的 {selectedCleanupIds.size} 个本地文件
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
