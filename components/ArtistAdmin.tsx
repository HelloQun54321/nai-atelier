
import React, { useState, useEffect } from 'react';
import { db } from '../services/dbService';
import { Artist, User, UsageStats, SystemLogResponse } from '../types';
import { ROLE_POLICY } from '../config/rolePolicy';

interface ExtendedArtistAdminProps {
    currentUser: User;
    artistsData: Artist[] | null;
    usersData: User[] | null;
    onRefreshArtists: () => Promise<void>;
    onRefreshUsers: () => Promise<void>;
    isDark?: boolean;
    toggleTheme?: () => void;
    onLogout?: () => void;
}

export const ArtistAdmin: React.FC<ExtendedArtistAdminProps> = ({
    currentUser, artistsData, usersData, onRefreshArtists, onRefreshUsers,
    isDark, toggleTheme, onLogout
}) => {
  // 使用统一的角色策略
  const isAdmin = currentUser.role === 'admin';
  const isVip = currentUser.role === 'vip';
  const canManageArtists = ROLE_POLICY.canManageArtists(currentUser.role);
  const [activeTab, setActiveTab] = useState<'artist' | 'users' | 'profile' | 'stats' | 'logs'>(
    isAdmin ? 'artist' : (isVip ? 'artist' : 'profile')
  );
  
  // Artist State (Managed via props now, filtered here if needed)
  const artists = artistsData || [];
  
  // User Management State
  const users = usersData || [];
  
  const [artistName, setArtistName] = useState('');
  const [artistImg, setArtistImg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // 配额编辑状态
  const [editingQuotaUserId, setEditingQuotaUserId] = useState<string | null>(null);
  const [newQuotaMB, setNewQuotaMB] = useState<string>('');

  // Guest Code State
  const [guestCode, setGuestCode] = useState('');
  const [isUpdatingGuest, setIsUpdatingGuest] = useState(false);
  const [showGuestCode, setShowGuestCode] = useState(false); // Visibility toggle

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<string[]>([]);

  // Profile State
  const [myNewPassword, setMyNewPassword] = useState('');

  // Usage Stats State
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState<SystemLogResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const [logCategory, setLogCategory] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  // Storage calculation helpers - 使用统一的角色策略
  const getMaxStorage = () => {
    if (ROLE_POLICY.isUnlimitedStorage(currentUser.role)) return Infinity;
    return currentUser?.maxStorage || ROLE_POLICY.getDefaultQuota(currentUser.role) || 300 * 1024 * 1024;
  };
  const formatBytes = (bytes?: number) => {
      if (!bytes) return '0 MB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  const getUsagePercentage = () => {
      if (!currentUser || !currentUser.storageUsage) return 0;
      return Math.min(100, (currentUser.storageUsage / getMaxStorage()) * 100);
  };

  const handleRefresh = async () => {
      setIsLoading(true);
      if (activeTab === 'artist') await onRefreshArtists();
      if (activeTab === 'users') await onRefreshUsers();
      if (activeTab === 'stats') await loadUsageStats();
      if (activeTab === 'logs') await loadSystemLogs(logsPage);
      setIsLoading(false);
  };

  const loadUsageStats = async () => {
      if (!isAdmin) return;
      setStatsLoading(true);
      try {
          setUsageStats(await db.getUsageStats());
      } catch (e) {
          console.error(e);
      } finally {
          setStatsLoading(false);
      }
  };

  const loadSystemLogs = async (page = logsPage) => {
      if (!isAdmin) return;
      setLogsLoading(true);
      try {
          const data = await db.getSystemLogs({
              page,
              pageSize: 100,
              category: logCategory || undefined,
              status: logStatus || undefined,
              q: logSearch.trim() || undefined
          });
          setSystemLogs(data);
          setLogsPage(data.pagination.page);
      } catch (e) {
          console.error(e);
      } finally {
          setLogsLoading(false);
      }
  };

  const handleArtistSave = async () => {
    if (!artistName.trim() || !artistImg.trim()) return;
    setIsLoading(true);
    const id = editingId || crypto.randomUUID();
    
    // Find existing artist to preserve benchmarks if editing
    const existing = artists.find(a => a.id === id);
    const payload = {
        id,
        name: artistName.trim(),
        imageUrl: artistImg,
        previewUrl: existing?.previewUrl,
        benchmarks: existing?.benchmarks
    };

    await db.saveArtist(payload);
    
    setArtistName(''); 
    setArtistImg(''); 
    setEditingId(null);
    await onRefreshArtists();
    setIsLoading(false);
  };

  const handleEditArtist = (artist: Artist) => {
      setEditingId(artist.id);
      setArtistName(artist.name);
      setArtistImg(artist.imageUrl);
  };

  const handleCancelEdit = () => {
      setEditingId(null);
      setArtistName('');
      setArtistImg('');
  };

  const handleArtistDelete = async (id: string) => {
      if(confirm('确定删除该画师吗？')) {
          setIsLoading(true);
          await db.deleteArtist(id);
          await onRefreshArtists();
          setIsLoading(false);
      }
  };

  const handleCreateUser = async () => {
      if(!newUsername || !newPassword) return;
      setIsLoading(true);
      try {
        await db.createUser(newUsername, newPassword);
        setNewUsername(''); setNewPassword('');
        await onRefreshUsers();
        alert('用户创建成功');
      } catch(e) { alert('创建失败：用户名可能已存在'); }
      setIsLoading(false);
  };

  const handleDeleteUser = async (id: string) => {
      if(confirm('删除用户？')) {
          setIsLoading(true);
          await db.deleteUser(id);
          await onRefreshUsers();
          setIsLoading(false);
      }
  };

  const handleUpdateQuota = async (userId: string) => {
      const mb = parseFloat(newQuotaMB);
      if (isNaN(mb) || mb < 0) {
          alert('请输入有效的配额数值（非负数）');
          return;
      }
      
      // 验证配额上限（100GB）
      const MAX_QUOTA_MB = 100 * 1024; // 100GB in MB
      if (mb > MAX_QUOTA_MB) {
          alert(`配额值超出上限，最大允许 ${MAX_QUOTA_MB} MB (100GB)`);
          return;
      }
      
      const bytes = Math.round(mb * 1024 * 1024);
      setIsLoading(true);
      try {
          await db.updateUserQuota(userId, bytes);
          await onRefreshUsers();
          setEditingQuotaUserId(null);
          setNewQuotaMB('');
          alert('配额更新成功');
      } catch(e: any) {
          // 提供更具体的错误信息
          let errorMessage = '更新失败';
          if (e.message) {
              if (e.message.includes('User not found')) {
                  errorMessage = '用户不存在，请刷新页面重试';
              } else if (e.message.includes('Invalid maxStorage')) {
                  errorMessage = '配额值无效，请检查输入';
              } else if (e.message.includes('Forbidden')) {
                  errorMessage = '权限不足，请确认管理员权限';
              } else if (e.message.includes('network') || e.message.includes('fetch')) {
                  errorMessage = '网络错误，请检查网络连接';
              } else {
                  errorMessage = `更新失败: ${e.message}`;
              }
          }
          alert(errorMessage);
          console.error('配额更新失败:', e);
      }
      setIsLoading(false);
  };

  // Fetch Guest Code when Users Tab is active
  useEffect(() => {
      if (isAdmin && activeTab === 'users') {
          db.getGuestCode().then(setGuestCode).catch(console.error);
      }
  }, [activeTab, isAdmin]);

  // Fetch Usage Stats when Stats Tab is active
  useEffect(() => {
      if (isAdmin && activeTab === 'stats') {
          loadUsageStats();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  useEffect(() => {
      if (isAdmin && activeTab === 'logs') {
          loadSystemLogs(logsPage);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin, logsPage, logCategory, logStatus]);

  // 清理旧日志
  const handleClearLogs = async () => {
      if (!confirm('确定要清理 30 天前的登录日志吗？')) return;
      setClearingLogs(true);
      try {
          await db.clearOldLogs();
          // 刷新统计数据
          await loadUsageStats();
          if (activeTab === 'logs') await loadSystemLogs(0);
          alert('旧日志已清理');
      } catch (e) {
          alert('清理失败');
      }
      setClearingLogs(false);
  };

  // 格式化日期时间（包含时间）
  const formatDateTime = (timestamp: number | string) => {
      if (!timestamp || isNaN(Number(timestamp))) return '未知';
      return new Date(Number(timestamp)).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
      });
  };

  // 格式化日期（仅日期）
  const formatDate = (timestamp: number | string) => {
      if (!timestamp || isNaN(Number(timestamp))) return '未知';
      return new Date(Number(timestamp)).toLocaleDateString('zh-CN');
  };

  const handleUpdateGuestCode = async () => {
      if (!guestCode) return;
      setIsUpdatingGuest(true);
      try {
          await db.updateGuestCode(guestCode);
          alert('游客口令已更新');
      } catch(e) { alert('更新失败'); }
      setIsUpdatingGuest(false);
  };

  const handleChangePassword = async () => {
      if(!myNewPassword) return;
      await db.updatePassword(myNewPassword);
      setMyNewPassword('');
      alert('密码修改成功');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => setArtistImg(reader.result as string);
          reader.readAsDataURL(file);
      }
  };

  // --- GitHub Import Logic ---
  const handleGithubImport = async () => {
      if (!confirm('这将从 twoearcat/nai-artists 仓库抓取所有图片并导入数据库。\n过程可能较慢，请勿关闭页面。')) return;
      
      setIsImporting(true);
      setImportProgress(0);
      setImportLog(['Fetching file list from GitHub API...']);

      try {
          // 1. Fetch File List from GitHub API
          const repoApi = "https://api.github.com/repos/twoearcat/nai-artists/contents/images";
          const res = await fetch(repoApi);
          if (!res.ok) throw new Error('GitHub API Limit or Network Error');
          
          const files = await res.json();
          const imageFiles = Array.isArray(files) ? files.filter((f: any) => f.name.match(/\.(png|jpg|jpeg)$/i)) : [];
          
          if (imageFiles.length === 0) {
              setImportLog(prev => [...prev, 'No images found in repository.']);
              setIsImporting(false);
              return;
          }

          setImportLog(prev => [...prev, `Found ${imageFiles.length} images. Starting import...`]);
          
          // 2. Process Loop
          let successCount = 0;
          for (let i = 0; i < imageFiles.length; i++) {
              const file = imageFiles[i];
              const rawUrl = file.download_url; // API provides direct download link
              // Name: Remove extension and underscores
              const name = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
              
              try {
                  // Call Backend to Fetch & Save
                  await db.importArtistFromGithub(name, rawUrl);
                  successCount++;
                  // Update log every 5 items to reduce render spam
                  if (i % 5 === 0) setImportLog(prev => [`[${i + 1}/${imageFiles.length}] Imported: ${name}`, ...prev.slice(0, 10)]);
              } catch (err: any) {
                  setImportLog(prev => [`[ERROR] Failed: ${name} - ${err.message}`, ...prev]);
              }

              setImportProgress(Math.round(((i + 1) / imageFiles.length) * 100));
          }

          setImportLog(prev => [`Done! Successfully imported ${successCount} artists.`, ...prev]);
          await onRefreshArtists();

      } catch (e: any) {
          setImportLog(prev => [`FATAL ERROR: ${e.message}`, ...prev]);
      } finally {
          setIsImporting(false);
      }
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-900 p-8 overflow-y-auto relative">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">系统管理</h1>
            {canManageArtists && activeTab !== 'profile' && (
                <button
                    onClick={handleRefresh}
                    className={`p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors`}
                    title="刷新列表"
                >
                    <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
            )}
        </div>

        <div className="flex space-x-4 mb-8 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {/* 画师管理：admin和vip可见 */}
            {(isAdmin || isVip) && (
                <button onClick={() => setActiveTab('artist')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'artist' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>画师管理</button>
            )}
            {/* 用户管理、使用统计：仅admin可见 */}
            {isAdmin && (
                <>
                    <button onClick={() => setActiveTab('users')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'users' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>用户管理</button>
                    <button onClick={() => setActiveTab('stats')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'stats' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>使用统计</button>
                    <button onClick={() => setActiveTab('logs')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'logs' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>日志</button>
                </>
            )}
            <button onClick={() => setActiveTab('profile')} className={`pb-3 px-2 border-b-2 whitespace-nowrap ${activeTab === 'profile' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>个人设置</button>
        </div>

        {/* --- ARTIST TAB --- */}
        {activeTab === 'artist' && canManageArtists && (
            <>
                {/* Import Block */}
                <div className="mb-6 bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-bold text-indigo-800 dark:text-indigo-300 text-sm">快速导入</h3>
                    </div>
                    {isImporting ? (
                        <div className="space-y-2">
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                                <div className="bg-green-500 h-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono h-20 overflow-y-auto bg-white dark:bg-black/20 p-2 rounded">
                                {importLog.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                        </div>
                    ) : (
                        <button 
                            onClick={handleGithubImport}
                            className="bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-4 py-2 rounded text-sm font-medium hover:opacity-90 flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                            一键从 GitHub 导入 (twoearcat/nai-artists)
                        </button>
                    )}
                </div>

                {/* Sticky Header Container */}
                <div className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-4 pt-2 -mt-2">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
                        <h2 className="font-bold dark:text-white mb-4">{editingId ? '编辑画师' : '添加画师'}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <input type="text" value={artistName} onChange={e => setArtistName(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="画师名称" />
                            <div className="flex gap-2">
                                <input type="file" onChange={handleFileUpload} className="hidden" id="art-up" />
                                <label htmlFor="art-up" className="px-3 py-2 bg-gray-200 rounded cursor-pointer text-sm flex items-center hover:bg-gray-300 transition-colors whitespace-nowrap">上传</label>
                                <input type="text" value={artistImg} onChange={e => setArtistImg(e.target.value)} className="flex-1 min-w-0 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="图片 URL/Base64" />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleArtistSave} className="bg-indigo-600 text-white px-6 py-2 rounded hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/30">{editingId ? '保存修改' : '添加'}</button>
                            {editingId && <button onClick={handleCancelEdit} className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-300 transition-colors">取消</button>}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-20">
                    {artists.map(a => (
                        <div key={a.id} className="bg-white dark:bg-gray-800 p-4 rounded shadow flex items-center justify-between group hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-2 overflow-hidden">
                                <img src={a.imageUrl} className="w-8 h-8 rounded object-cover flex-shrink-0" loading="lazy" />
                                <span className="dark:text-white font-bold text-sm truncate">{a.name}</span>
                            </div>
                            <div className="flex gap-2 text-xs flex-shrink-0 ml-2">
                                <button onClick={() => handleEditArtist(a)} className="text-indigo-500 hover:text-indigo-700 font-medium">编辑</button>
                                <button onClick={() => handleArtistDelete(a.id)} className="text-red-500 hover:text-red-700">删除</button>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        )}

        {/* --- USER TAB --- */}
        {activeTab === 'users' && isAdmin && (
            <div className="space-y-6">
                {/* Create User Block */}
                 <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
                    <h2 className="font-bold dark:text-white mb-4">创建用户</h2>
                    <div className="flex flex-col md:flex-row gap-4 mb-4">
                        <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="用户名" />
                        <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="flex-1 p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white" placeholder="密码" />
                        <button onClick={handleCreateUser} className="bg-indigo-600 text-white px-4 py-2 rounded">创建</button>
                    </div>
                </div>

                {/* Guest Settings Block */}
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6 rounded-xl shadow">
                    <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-2">游客访问设置</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">设置游客登录时使用的全局口令。下方显示的是当前生效的口令。</p>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <input 
                                type={showGuestCode ? "text" : "password"}
                                value={guestCode} 
                                onChange={e => setGuestCode(e.target.value)} 
                                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 dark:text-white font-mono pr-10" 
                                placeholder="游客口令" 
                            />
                            <button 
                                onClick={() => setShowGuestCode(!showGuestCode)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 p-1"
                                title={showGuestCode ? "隐藏口令" : "显示口令"}
                            >
                                {showGuestCode ? (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                )}
                            </button>
                        </div>
                        <button 
                            onClick={handleUpdateGuestCode} 
                            disabled={isUpdatingGuest}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                            {isUpdatingGuest ? '更新中...' : '更新口令'}
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full bg-white dark:bg-gray-800 rounded shadow">
                        <thead><tr className="text-left border-b dark:border-gray-700 text-gray-500 p-2">
                            <th className="p-4">用户名</th>
                            <th className="p-4">角色</th>
                            <th className="p-4">注册时间</th>
                            <th className="p-4">最后登录</th>
                            <th className="p-4">存储配额</th>
                            <th className="p-4">操作</th>
                        </tr></thead>
                        <tbody>
                            {users.map(u => {
                                const usagePercent = u.maxStorage ? Math.min(100, ((u.storageUsage || 0) / u.maxStorage) * 100) : 0;
                                const isAdminUser = u.role === 'admin';
                                return (
                                <tr key={u.id} className={`border-b dark:border-gray-700 last:border-0 dark:text-white ${u.role === 'vip' ? 'bg-yellow-50/30 dark:bg-yellow-900/10' : ''}`}>
                                    <td className="p-4">
                                        <span className={u.role === 'vip' ? 'vip-username font-medium' : ''}>{u.username}</span>
                                        {u.role === 'vip' && <span className="vip-crown ml-1" title="VIP">👑</span>}
                                    </td>
                                    <td className="p-4">
                                        <select
                                            value={u.role}
                                            onChange={async (e) => {
                                                const newRole = e.target.value;
                                                try {
                                                    // 角色变更时不自动重置配额，保留用户现有配额
                                                    await db.updateUserRole(u.id, newRole, false);
                                                    await onRefreshUsers();
                                                } catch (err) {
                                                    alert('角色更新失败');
                                                }
                                            }}
                                            className={`px-2 py-1 rounded text-xs border-0 cursor-pointer ${ROLE_POLICY.getRoleBadgeClass(u.role as any)}`}
                                            disabled={u.id === currentUser.id}
                                        >
                                            <option value="user">{ROLE_POLICY.getRoleDisplayName('user')}</option>
                                            <option value="vip">{ROLE_POLICY.getRoleDisplayName('vip')}</option>
                                            <option value="admin">{ROLE_POLICY.getRoleDisplayName('admin')}</option>
                                        </select>
                                    </td>
                                    <td className="p-4 text-sm text-gray-500">{formatDate(u.createdAt)}</td>
                                    <td className="p-4 text-sm text-gray-500">{formatDateTime(u.lastLogin)}</td>
                                    <td className="p-4">
                                        {ROLE_POLICY.isUnlimitedStorage(u.role) ? (
                                            <div className="text-xs text-gray-500">
                                                <span className="text-green-600 dark:text-green-400 font-medium">无限制</span>
                                                <div className="text-gray-400 mt-1">管理员不受存储配额限制</div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="text-xs text-gray-500 mb-1">
                                                    {formatBytes(u.storageUsage)} / {formatBytes(u.maxStorage || ROLE_POLICY.getDefaultQuota(u.role) || 0)}
                                                </div>
                                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                                        style={{ width: `${usagePercent}%` }}
                                                    ></div>
                                                </div>
                                                {editingQuotaUserId === u.id ? (
                                                    <div className="flex gap-1 mt-2">
                                                        <input
                                                            type="number"
                                                            value={newQuotaMB}
                                                            onChange={e => setNewQuotaMB(e.target.value)}
                                                            className="w-20 p-1 text-xs border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white"
                                                            placeholder="MB"
                                                        />
                                                        <button onClick={() => handleUpdateQuota(u.id)} className="text-xs text-green-600 hover:text-green-700">保存</button>
                                                        <button onClick={() => { setEditingQuotaUserId(null); setNewQuotaMB(''); }} className="text-xs text-gray-500 hover:text-gray-700">取消</button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => { setEditingQuotaUserId(u.id); setNewQuotaMB(String(Math.round((u.maxStorage || 0) / (1024 * 1024)))); }}
                                                        className="text-xs text-indigo-500 hover:text-indigo-700 mt-1"
                                                    >
                                                        修改配额
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </td>
                                    <td className="p-4">
                                        {u.id !== currentUser.id && u.role !== 'guest' && <button onClick={() => handleDeleteUser(u.id)} className="text-red-500">删除</button>}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* --- STATS TAB --- */}
        {activeTab === 'stats' && isAdmin && (
            <div className="space-y-6">
                {statsLoading ? (
                    <div className="text-center py-12 text-gray-500">加载中...</div>
                ) : usageStats ? (
                    <>
                        {/* 存储概览卡片 */}
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                                <div className="text-2xl font-bold text-indigo-600">{usageStats.storage.userCount}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">注册用户</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                                <div className="text-2xl font-bold text-green-600">{usageStats.storage.chainsCount}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">画师串/角色串</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                                <div className="text-2xl font-bold text-purple-600">{usageStats.storage.inspirationsCount}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">灵感图</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                                <div className="text-2xl font-bold text-orange-600">{usageStats.storage.artistsCount}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">画师库</div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow">
                                <div className="text-2xl font-bold text-blue-600">{formatBytes(usageStats.storage.totalUserStorage)}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">R2 存储</div>
                            </div>
                        </div>

                        {/* 每日统计 */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
                            <h3 className="font-bold dark:text-white mb-4">近期登录统计</h3>
                            {usageStats.dailyStats.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left border-b dark:border-gray-700 text-gray-500">
                                                <th className="pb-2">日期</th>
                                                <th className="pb-2">游客登录</th>
                                                <th className="pb-2">用户登录</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usageStats.dailyStats.slice(0, 7).map((stat) => (
                                                <tr key={stat.date} className="border-b dark:border-gray-700 last:border-0">
                                                    <td className="py-2 dark:text-gray-200">{stat.date}</td>
                                                    <td className="py-2">
                                                        <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded text-xs font-medium">
                                                            {stat.guestLogins}
                                                        </span>
                                                    </td>
                                                    <td className="py-2">
                                                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                                                            {stat.userLogins}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-gray-500 text-center py-4">暂无统计数据</div>
                            )}
                        </div>

                        {/* 登录日志 */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold dark:text-white">登录日志（最近 50 条）</h3>
                                <button 
                                    onClick={handleClearLogs}
                                    disabled={clearingLogs}
                                    className="text-sm px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                                >
                                    {clearingLogs ? '清理中...' : '清理 30 天前日志'}
                                </button>
                            </div>
                            {usageStats.recentLogs.length > 0 ? (
                                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-white dark:bg-gray-800">
                                            <tr className="text-left border-b dark:border-gray-700 text-gray-500">
                                                <th className="pb-2 pr-4">时间</th>
                                                <th className="pb-2 pr-4">用户</th>
                                                <th className="pb-2 pr-4">角色</th>
                                                <th className="pb-2 pr-4">IP</th>
                                                <th className="pb-2">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usageStats.recentLogs.map((log) => (
                                                <tr key={log.id} className={`border-b dark:border-gray-700 last:border-0 ${log.role === 'guest' ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}`}>
                                                    <td className="py-2 pr-4 dark:text-gray-300 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                                                    <td className="py-2 pr-4 dark:text-gray-200 font-medium">{log.username}</td>
                                                    <td className="py-2 pr-4">
                                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                                            log.role === 'admin' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                                            log.role === 'guest' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                            'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                                        }`}>
                                                            {log.role}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 pr-4 dark:text-gray-400 font-mono text-xs">{log.ip}</td>
                                                    <td className="py-2 dark:text-gray-400">{log.action}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-gray-500 text-center py-4">暂无登录日志</div>
                            )}
                        </div>

                        {/* Cloudflare 免费额度提示 */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800">
                            <h4 className="font-bold text-blue-800 dark:text-blue-300 text-sm mb-2">📊 Cloudflare 免费额度参考</h4>
                            <div className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                                <div>• Workers: 每日 10 万次请求</div>
                                <div>• D1 数据库: 每日 500 万行读取 / 10 万行写入</div>
                                <div>• R2 存储: 10GB 存储 + 每月 1000 万次操作</div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-12 text-gray-500">无法加载统计数据</div>
                )}
            </div>
        )}

        {/* --- LOGS TAB --- */}
        {activeTab === 'logs' && isAdmin && (
            <div className="space-y-4">
                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-100 dark:border-gray-700">
                    <div className="flex flex-col xl:flex-row xl:items-end gap-3">
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">搜索</label>
                            <input
                                value={logSearch}
                                onChange={e => setLogSearch(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { setLogsPage(0); loadSystemLogs(0); } }}
                                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="用户 / 动作 / 资源 ID / 路径 / 详情"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">分类</label>
                            <select
                                value={logCategory}
                                onChange={e => { setLogCategory(e.target.value); setLogsPage(0); }}
                                className="w-full xl:w-36 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white text-sm outline-none"
                            >
                                <option value="">全部</option>
                                <option value="auth">登录</option>
                                <option value="user">用户</option>
                                <option value="chain">串库</option>
                                <option value="artist">画师库</option>
                                <option value="inspiration">灵感</option>
                                <option value="generation">生图</option>
                                <option value="aitag">aitag</option>
                                <option value="upload">上传</option>
                                <option value="settings">设置</option>
                                <option value="history">历史</option>
                                <option value="system">系统</option>
                                <option value="client">客户端</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">状态</label>
                            <select
                                value={logStatus}
                                onChange={e => { setLogStatus(e.target.value); setLogsPage(0); }}
                                className="w-full xl:w-32 px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white text-sm outline-none"
                            >
                                <option value="">全部</option>
                                <option value="success">成功</option>
                                <option value="warning">警告</option>
                                <option value="error">错误</option>
                            </select>
                        </div>
                        <button
                            onClick={() => { setLogsPage(0); loadSystemLogs(0); }}
                            disabled={logsLoading}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium disabled:opacity-50"
                        >
                            搜索
                        </button>
                        <button
                            onClick={handleClearLogs}
                            disabled={clearingLogs}
                            className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                        >
                            {clearingLogs ? '清理中...' : '清理 30 天前'}
                        </button>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-bold dark:text-white">系统日志</h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                共 {systemLogs?.pagination.total || 0} 条，当前第 {(systemLogs?.pagination.page || 0) + 1} / {Math.max(1, systemLogs?.pagination.totalPages || 1)} 页
                            </p>
                        </div>
                        <button
                            onClick={() => loadSystemLogs(logsPage)}
                            disabled={logsLoading}
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50"
                            title="刷新日志"
                        >
                            <svg className={`w-5 h-5 ${logsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                    </div>

                    {logsLoading ? (
                        <div className="text-center py-12 text-gray-500">加载中...</div>
                    ) : systemLogs && systemLogs.data.length > 0 ? (
                        <>
                            <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
                                        <tr className="text-left border-b dark:border-gray-700 text-gray-500">
                                            <th className="p-3 whitespace-nowrap">时间</th>
                                            <th className="p-3 whitespace-nowrap">用户</th>
                                            <th className="p-3 whitespace-nowrap">分类</th>
                                            <th className="p-3 whitespace-nowrap">状态</th>
                                            <th className="p-3 whitespace-nowrap">动作</th>
                                            <th className="p-3 whitespace-nowrap">资源</th>
                                            <th className="p-3 whitespace-nowrap">详情</th>
                                            <th className="p-3 whitespace-nowrap">路径</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {systemLogs.data.map(log => {
                                            const isExpanded = expandedLogId === log.id;
                                            let metadataText = '';
                                            if (typeof log.metadata === 'string' && log.metadata.trim()) {
                                                try {
                                                    metadataText = JSON.stringify(JSON.parse(log.metadata), null, 2);
                                                } catch {
                                                    metadataText = log.metadata;
                                                }
                                            } else if (log.metadata) {
                                                metadataText = JSON.stringify(log.metadata, null, 2);
                                            }

                                            return (
                                                <React.Fragment key={log.id}>
                                                    <tr
                                                        className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900/40 cursor-pointer"
                                                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                                    >
                                                        <td className="p-3 dark:text-gray-300 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                                                        <td className="p-3 dark:text-gray-200 whitespace-nowrap">
                                                            <div className="font-medium">{log.username || 'anonymous'}</div>
                                                            <div className="text-[11px] text-gray-400">{log.role || 'unknown'}</div>
                                                        </td>
                                                        <td className="p-3">
                                                            <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium">
                                                                {log.category || 'auth'}
                                                            </span>
                                                        </td>
                                                        <td className="p-3">
                                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                                log.status === 'error' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                                                log.status === 'warning' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                                                                'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                                            }`}>
                                                                {log.status || 'success'}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 dark:text-gray-200 whitespace-nowrap font-mono text-xs">{log.action}</td>
                                                        <td className="p-3 text-xs text-gray-500 dark:text-gray-400">
                                                            <div>{log.resourceType || '-'}</div>
                                                            {log.resourceId && <div className="font-mono max-w-40 truncate" title={log.resourceId}>{log.resourceId}</div>}
                                                        </td>
                                                        <td className="p-3 text-gray-700 dark:text-gray-300 min-w-[220px]">
                                                            <div className="line-clamp-2">{log.message || '-'}</div>
                                                            {log.durationMs !== undefined && log.durationMs !== null && (
                                                                <div className="text-[11px] text-gray-400 mt-1">{log.durationMs} ms</div>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                            <div className="font-mono">{log.method || '-'}</div>
                                                            <div className="font-mono max-w-48 truncate" title={log.path}>{log.path || '-'}</div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60">
                                                            <td colSpan={8} className="p-4">
                                                                <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                                                                        <div><span className="font-medium">IP:</span> {log.ip || '-'}</div>
                                                                        <div><span className="font-medium">User Agent:</span></div>
                                                                        <div className="break-all">{log.userAgent || '-'}</div>
                                                                    </div>
                                                                    <pre className="text-xs bg-white dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded p-3 overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{metadataText || '无额外数据'}</pre>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                                <button
                                    onClick={() => setLogsPage(Math.max(0, logsPage - 1))}
                                    disabled={logsLoading || logsPage <= 0}
                                    className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-50 dark:text-gray-300"
                                >
                                    上一页
                                </button>
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                    第 {logsPage + 1} / {Math.max(1, systemLogs.pagination.totalPages)} 页
                                </span>
                                <button
                                    onClick={() => setLogsPage(Math.min(Math.max(0, systemLogs.pagination.totalPages - 1), logsPage + 1))}
                                    disabled={logsLoading || logsPage >= systemLogs.pagination.totalPages - 1}
                                    className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-50 dark:text-gray-300"
                                >
                                    下一页
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-12 text-gray-500">暂无日志</div>
                    )}
                </div>
            </div>
        )}

        {/* --- PROFILE TAB --- */}
        {activeTab === 'profile' && (
            <div className="space-y-6">
                {/* Guest cannot change password - uses shared passcode */}
                {currentUser.role !== 'guest' && (
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
                        <h2 className="font-bold dark:text-white mb-4">修改密码</h2>
                        <input type="password" value={myNewPassword} onChange={e => setMyNewPassword(e.target.value)} className="w-full p-2 border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white mb-4" placeholder="新密码" />
                        <button onClick={handleChangePassword} className="bg-indigo-600 text-white px-6 py-2 rounded">更新密码</button>
                    </div>
                )}
                
                {/* Guest info notice */}
                {currentUser.role === 'guest' && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-6 rounded-xl border border-yellow-200 dark:border-yellow-800 max-w-md">
                        <h3 className="font-bold text-yellow-800 dark:text-yellow-300 mb-2">游客模式提示</h3>
                        <p className="text-sm text-yellow-700 dark:text-yellow-400">您正以游客身份浏览，密码修改功能已禁用。游客使用共享口令登录，无法更改个人密码。</p>
                    </div>
                )}
                
                {/* Mobile / Convenient Settings */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md">
                     <h2 className="font-bold dark:text-white mb-4">应用设置</h2>
                     <div className="space-y-4">
                        {/* Storage Usage Display (Added for Mobile) */}
                        {currentUser.role !== 'admin' && currentUser.role !== 'guest' && (
                            <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    <span>云端存储空间</span>
                                    <span>{formatBytes(currentUser.storageUsage)} / 300MB</span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${getUsagePercentage() > 90 ? 'bg-red-500' : 'bg-indigo-500'}`} 
                                        style={{ width: `${getUsagePercentage()}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}

                        {toggleTheme && (
                            <button onClick={toggleTheme} className="w-full flex items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                <span>{isDark ? '🌙 深色模式' : '☀️ 亮色模式'}</span>
                                <span className="text-xs text-gray-500">点击切换</span>
                            </button>
                        )}
                        {onLogout && (
                            <button onClick={onLogout} className="w-full flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                                <span>退出登录</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        )}
                     </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
