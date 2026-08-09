
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/dbService';
import { api } from '../services/api';
import { Inspiration, User, NAIParams } from '../types';
import { extractMetadata, parseNovelAIMetadata, ParsedNAIData, IMPORT_SESSION_KEY } from '../services/metadataService';
import { ParamsViewer } from './ParamsViewer';
import { useConfirmDialog } from './ConfirmDialog';
import { OriginalImage, SmartImage } from './SmartImage';
import { useMobileHistoryLayer } from './MobileUI';
import { createUuid } from '../services/id';
import { mobileGalleryClassName, mobileGalleryStyle, useMobileImageDisplayPreferences } from '../services/imageDisplayPreferences';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { IconButton, ToolbarButton, ToolbarSearch, WorkspaceToolbar } from './DesignSystem';

interface InspirationGalleryProps {
    currentUser: User;
    // New props for caching
    inspirationsData: Inspiration[] | null;
    onRefresh: () => Promise<void>;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
}

interface InspirationLightboxProps {
    lightboxImg: {item: Inspiration, isEditing: boolean};
    setLightboxImg: React.Dispatch<React.SetStateAction<{item: Inspiration, isEditing: boolean} | null>>;
    handleSaveEdit: () => Promise<void>;
    copyPrompt: (prompt: string, e?: React.MouseEvent) => void;
    canEdit: (item: Inspiration) => boolean;
    getDownloadFilename: () => string;
    notify: (msg: string, type?: 'success' | 'error') => void;
    onNavigateToPlayground?: () => void;
}

const LazyImage = SmartImage;

const InspirationLightbox: React.FC<InspirationLightboxProps> = ({
    lightboxImg,
    setLightboxImg,
    handleSaveEdit,
    copyPrompt,
    canEdit,
    getDownloadFilename,
    notify,
    onNavigateToPlayground
}) => {
    const closeLightbox = useMobileHistoryLayer(true, () => setLightboxImg(null), 'inspiration-detail');
    // 尝试解析灵感图的 prompt 字符串，提取结构化参数，使用 useMemo 避免重复重排
    const parsedData: ParsedNAIData | null = useMemo(() => {
        try {
            if (lightboxImg.item.params) {
                const parsedFromPrompt = lightboxImg.item.prompt ? parseNovelAIMetadata(lightboxImg.item.prompt) : null;
                return {
                    prompt: parsedFromPrompt?.prompt || lightboxImg.item.prompt,
                    negativePrompt: lightboxImg.item.negativePrompt || parsedFromPrompt?.negativePrompt || '',
                    params: lightboxImg.item.params
                };
            }
            if (lightboxImg.item.prompt && lightboxImg.item.prompt.trim()) {
                const parsed = parseNovelAIMetadata(lightboxImg.item.prompt);
                return {
                    ...parsed,
                    negativePrompt: lightboxImg.item.negativePrompt || parsed.negativePrompt,
                };
            }
        } catch { /* 解析失败不影响展示 */ }
        if (lightboxImg.item.negativePrompt) {
            return {
                prompt: lightboxImg.item.prompt,
                negativePrompt: lightboxImg.item.negativePrompt,
                params: lightboxImg.item.params || {
                    width: 832,
                    height: 1216,
                    steps: 28,
                    scale: 5,
                    sampler: 'k_euler_ancestral',
                    seed: undefined,
                    qualityToggle: true,
                    ucPreset: 4,
                    characters: [],
                    useCoords: false,
                    variety: false,
                    cfgRescale: 0,
                },
            };
        }
        return null;
    }, [lightboxImg.item.prompt, lightboxImg.item.negativePrompt, lightboxImg.item.params]);

    return (
        <div className="fixed inset-0 z-[1050] bg-black/90 backdrop-blur-sm flex items-center justify-center p-0 md:p-8" onClick={closeLightbox}>
            <div className="bg-white dark:bg-gray-900 w-full max-w-none md:max-w-[90vw] h-[100dvh] md:h-[90vh] rounded-none md:rounded-2xl shadow-2xl overflow-hidden flex flex-col lg:flex-row border-gray-700 md:border" onClick={e => e.stopPropagation()}>
                <div className="flex-1 bg-gray-100 dark:bg-black/50 flex items-center justify-center p-4 relative overflow-hidden h-1/2 lg:h-auto">
                    <OriginalImage src={lightboxImg.item.imageUrl} className="max-w-full max-h-full object-contain" />
                </div>
                <div className="w-full lg:w-[480px] bg-white dark:bg-gray-900 flex flex-col border-l border-gray-200 dark:border-gray-800 p-4 md:p-6 h-1/2 lg:h-auto">
                    <div className="flex justify-between items-start mb-4">
                        {lightboxImg.isEditing ? (
                            <input className="text-xl font-bold bg-gray-100 dark:bg-gray-800 border-none rounded p-1 w-full dark:text-white" value={lightboxImg.item.title} onChange={e => setLightboxImg({...lightboxImg, item: {...lightboxImg.item, title: e.target.value}})} />
                        ) : (
                            <div>
                                <h2 className="line-clamp-1 text-lg font-bold text-gray-900 dark:text-white md:text-xl">{lightboxImg.item.title}</h2>
                            </div>
                        )}
                        <button onClick={closeLightbox} className="mobile-touch text-gray-400 hover:text-white">✕</button>
                    </div>

                    <div className="flex-1 overflow-y-auto mb-4 custom-scrollbar">
                        {lightboxImg.isEditing ? (
                            <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-800 h-full">
                                <textarea className="w-full h-full bg-transparent outline-none resize-none font-mono text-sm dark:text-gray-300" value={lightboxImg.item.prompt} onChange={e => setLightboxImg({...lightboxImg, item: {...lightboxImg.item, prompt: e.target.value}})} />
                            </div>
                        ) : parsedData ? (
                            /* 解析成功：使用 ParamsViewer 展示完整参数 */
                            <ParamsViewer
                                params={parsedData.params}
                                prompt={parsedData.prompt}
                                negativePrompt={parsedData.negativePrompt}
                                notify={notify}
                            />
                        ) : (
                            /* 解析失败或无数据：展示原始 prompt 文本 */
                            <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-800">
                                <p className="text-xs md:text-sm font-mono text-gray-800 dark:text-gray-300 break-words whitespace-pre-wrap">{lightboxImg.item.prompt}</p>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex flex-col gap-3">
                        {lightboxImg.isEditing ? (
                            <div className="flex gap-2">
                                <button onClick={handleSaveEdit} className="flex-1 bg-green-600 text-white py-2 rounded">保存</button>
                                <button onClick={() => setLightboxImg({...lightboxImg, isEditing: false})} className="flex-1 bg-gray-500 text-white py-2 rounded">取消</button>
                            </div>
                        ) : (
                            <>
                              {/* 导入到编辑器 */}
                              {parsedData && (
                                  <button
                                      onClick={() => {
                                          sessionStorage.setItem(IMPORT_SESSION_KEY, JSON.stringify(parsedData));
                                          void db.logClientEvent({
                                              category: 'inspiration',
                                              action: 'inspiration_import_playground',
                                              resourceType: 'inspiration',
                                              resourceId: lightboxImg.item.id,
                                              message: `从灵感导入参数到实验室：${lightboxImg.item.title}`,
                                              metadata: {
                                                  title: lightboxImg.item.title,
                                                  promptLength: parsedData.prompt.length,
                                                  negativeLength: parsedData.negativePrompt.length,
                                                  width: parsedData.params.width,
                                                  height: parsedData.params.height,
                                                  seed: parsedData.params.seed ?? 'random',
                                              },
                                          }).catch(console.error);
                                          setLightboxImg(null);
                                          notify('参数已准备就绪，正在跳转到编辑器...');
                                          onNavigateToPlayground?.();
                                      }}
                                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-500"
                                  >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                      导入到编辑器
                                  </button>
                              )}
                              <button onClick={() => copyPrompt(lightboxImg.item.prompt)} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">复制 Prompt</button>
                              {canEdit(lightboxImg.item) && (
                                  <button onClick={() => setLightboxImg({...lightboxImg, isEditing: true})} className="w-full py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg">编辑详情</button>
                              )}
                              <a 
                                  href={lightboxImg.item.imageUrl} 
                                  download={getDownloadFilename()}
                                  className="w-full py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-center"
                              >
                                  下载原图
                              </a>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const InspirationGallery: React.FC<InspirationGalleryProps> = ({ currentUser, inspirationsData, onRefresh, notify, onNavigateToPlayground }) => {
  const RENDER_BATCH_SIZE = 60;
  const confirmAction = useConfirmDialog();
  const imageDisplay = useMobileImageDisplayPreferences();
  const [searchTerm, setSearchTerm] = useState('');
  const [lightboxImg, setLightboxImg] = useState<{item: Inspiration, isEditing: boolean} | null>(null);
  const [uploadMode, setUploadMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(RENDER_BATCH_SIZE);
  
  // Upload State
  const [upTitle, setUpTitle] = useState('');
  const [upImg, setUpImg] = useState('');
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upPrompt, setUpPrompt] = useState('');

  useEffect(() => () => {
      if (upImg.startsWith('blob:')) URL.revokeObjectURL(upImg);
  }, [upImg]);

  // Initial load handled by App.tsx now
  // removed empty useEffect that called load

  const handleRefresh = async () => {
      setIsLoading(true);
      await onRefresh();
      setIsLoading(false);
  };

  const getDownloadFilename = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      return `NAI-${timestamp}.png`;
  };

  const copyPrompt = (prompt: string, e?: React.MouseEvent) => {
    if(e) e.stopPropagation();
    navigator.clipboard.writeText(prompt);
    notify('Prompt 已复制');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
            notify('只支持 PNG、JPEG 或 WebP 图片', 'error');
            e.target.value = '';
            return;
        }
        if (!file.size || file.size > 12 * 1024 * 1024) {
            notify('灵感图片不能超过 12 MB', 'error');
            e.target.value = '';
            return;
        }
        setUpFile(file);
        setUpImg(URL.createObjectURL(file));
        const meta = await extractMetadata(file);
        if (meta) {
            setUpPrompt(meta);
            if (!upTitle) setUpTitle(file.name.replace(/\.[^/.]+$/, ""));
        }
    }
  };

  const handleUpload = async () => {
      if (!upTitle || !upFile) return;
      let parsedParams: NAIParams | undefined = undefined;
      let parsedNegativePrompt = '';
      if (upPrompt && upPrompt.trim()) {
          try {
              const parsed = parseNovelAIMetadata(upPrompt);
              parsedParams = parsed.params;
              parsedNegativePrompt = parsed.negativePrompt;
          } catch { /* 解析失败时 params 为 undefined */ }
      }
      const uploaded = await api.uploadFile(upFile, 'inspirations');
      await db.saveInspiration({
          id: createUuid(),
          title: upTitle,
          imageUrl: uploaded.url,
          prompt: upPrompt,
          negativePrompt: parsedNegativePrompt,
          params: parsedParams,
          userId: currentUser.id,
          username: currentUser.username,
          createdAt: Date.now()
      });
      setUploadMode(false);
      setUpTitle(''); setUpImg(''); setUpFile(null); setUpPrompt('');
      onRefresh();
  };

  const handleSaveEdit = async () => {
      if (!lightboxImg) return;
      await db.updateInspiration(lightboxImg.item.id, {
          title: lightboxImg.item.title,
          prompt: lightboxImg.item.prompt,
          negativePrompt: lightboxImg.item.negativePrompt || ''
      });
      setLightboxImg(null);
      onRefresh();
  };

  const toggleSelection = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
  };

  const handleBulkDelete = async () => {
      if (selectedIds.size === 0) return;
      if (!await confirmAction({
          title: `删除选中的 ${selectedIds.size} 张图片？`,
          message: '这些灵感图片及其提示词数据将被永久删除，此操作无法撤销。',
          confirmLabel: '确认删除',
          tone: 'danger',
      })) return;
      await db.bulkDeleteInspirations(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectionMode(false);
      onRefresh();
  };

  const canEdit = (item: Inspiration) => item.userId === currentUser.id || currentUser.role === 'admin';

  const filtered = useMemo(() => {
    const query = searchTerm.toLowerCase();
    return (inspirationsData || []).filter(i =>
      i.title.toLowerCase().includes(query) ||
      i.prompt.toLowerCase().includes(query) ||
      (i.negativePrompt || '').toLowerCase().includes(query)
    );
  }, [inspirationsData, searchTerm]);
  useEffect(() => setVisibleCount(RENDER_BATCH_SIZE), [inspirationsData, searchTerm]);
  const visibleItems = filtered.slice(0, visibleCount);

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      {/* Header */}
      <WorkspaceToolbar>
          <div className="workspace-toolbar flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-1">
              {selectionMode ? (
                  <>
                    <span className="text-sm text-gray-500 flex-1">已选 {selectedIds.size}</span>
                    <ToolbarButton tone="danger" onClick={handleBulkDelete}><Trash2 className="h-4 w-4" />删除</ToolbarButton>
                    <button onClick={() => {setSelectionMode(false); setSelectedIds(new Set())}} className="text-gray-500 px-3">取消</button>
                  </>
              ) : (
                  <>
                    <ToolbarSearch
                        type="text"
                        placeholder="搜索标题或提示词"
                        containerClassName="md:w-[30rem] md:flex-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <IconButton label="刷新灵感库" onClick={handleRefresh}><RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /></IconButton>
                      <ToolbarButton onClick={() => setSelectionMode(true)}>管理</ToolbarButton>
                      <ToolbarButton tone="primary" onClick={() => setUploadMode(true)}><Plus className="h-4 w-4" />上传</ToolbarButton>
                    </div>
                  </>
              )}
          </div>
      </WorkspaceToolbar>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 relative">
             {isLoading && (
                 <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-20">
                     <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                 </div>
             )}
            
             {/* Updated Grid for Mobile: 2 cols */}
             <div className={`${mobileGalleryClassName(imageDisplay)} workspace-card-grid workspace-inspiration-grid md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-6`} style={mobileGalleryStyle(imageDisplay)}>
                 {visibleItems.map(item => (
                     <div 
                        key={item.id} 
                        className={`mobile-gallery-item group bg-white dark:bg-gray-800 rounded-xl overflow-hidden border transition-[border-color,box-shadow,transform] flex flex-col relative ${selectionMode && selectedIds.has(item.id) ? 'ring-2 ring-indigo-600 border-indigo-600' : 'border-gray-200 dark:border-gray-700'}`}
                        onClick={() => selectionMode ? toggleSelection(item.id) : null}
                     >
                         <div 
                            className="mobile-gallery-frame md:aspect-square relative overflow-hidden cursor-zoom-in"
                            style={{ '--mobile-image-ratio': `${item.params?.width || 832} / ${item.params?.height || 1216}` } as React.CSSProperties}
                            onClick={() => !selectionMode && setLightboxImg({item, isEditing: false})}
                          >
                             {/* Lazy Image */}
                             <LazyImage src={item.imageUrl} alt={item.title} />

                             {selectionMode && (
                                 <div className={`absolute inset-0 flex items-center justify-center bg-black/40`}>
                                     {selectedIds.has(item.id) && <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                 </div>
                             )}
                         </div>
                         <div className="p-2 md:p-3">
                             <div className="flex justify-between items-start">
                                <h3 className="flex-1 truncate text-sm font-bold text-gray-900 dark:text-white" title={item.title}>{item.title}</h3>
                             </div>
                             <p className="mt-1 hidden truncate font-mono text-[11px] text-gray-400 md:block" title={item.prompt}>{item.prompt}</p>
                         </div>
                     </div>
                 ))}
             </div>
             {visibleCount < filtered.length && <div className="flex justify-center py-6"><button type="button" onClick={() => setVisibleCount(count => count + RENDER_BATCH_SIZE)} className="mobile-touch rounded-xl border border-gray-300 bg-white px-5 text-sm font-bold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">加载更多（{filtered.length - visibleCount}）</button></div>}
      </div>

      {/* Upload Modal */}
      {uploadMode && (
          <div className="fixed inset-0 z-[1050] bg-black/50 backdrop-blur-sm flex items-center justify-center p-0 md:p-4">
              <div className="h-[100dvh] overflow-y-auto bg-white dark:bg-gray-800 w-full max-w-lg rounded-none p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl md:h-auto md:rounded-xl md:p-6">
                  <h2 className="text-xl font-bold mb-4 dark:text-white">上传灵感图</h2>
                  <div className="space-y-4">
                      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileUpload} className="hidden" id="up-file" />
                          <label htmlFor="up-file" className="cursor-pointer block">
                              {upImg ? <img src={upImg} className="h-32 mx-auto object-contain" /> : <span className="text-gray-500">点击选择图片 (自动读取 Prompt)</span>}
                          </label>
                      </div>
                      <input type="text" placeholder="标题" className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" value={upTitle} onChange={e => setUpTitle(e.target.value)} />
                      <textarea placeholder="Prompt" className="w-full p-2 border rounded h-24 dark:bg-gray-900 dark:border-gray-600 dark:text-white" value={upPrompt} onChange={e => setUpPrompt(e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-3 mt-6">
                      <button onClick={() => setUploadMode(false)} className="px-4 py-2 text-gray-500">取消</button>
                      <button onClick={handleUpload} className="px-4 py-2 bg-indigo-600 text-white rounded">上传</button>
                  </div>
              </div>
          </div>
      )}

      {/* Lightbox / Details Editor */}
      {lightboxImg && (
          <InspirationLightbox
              lightboxImg={lightboxImg}
              setLightboxImg={setLightboxImg}
              handleSaveEdit={handleSaveEdit}
              copyPrompt={copyPrompt}
              canEdit={canEdit}
              getDownloadFilename={getDownloadFilename}
              notify={notify}
              onNavigateToPlayground={onNavigateToPlayground}
          />
      )}
    </div>
  );
};
