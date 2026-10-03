import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { promptAgentService } from '../services/promptAgent';
import { type AgentMedia, isAgentImagePath } from '../services/agentMedia';

export const AgentProjectImage: React.FC<{ image: AgentMedia }> = ({ image }) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [safeMode, setSafeMode] = useState(() => Boolean(document.querySelector('.agent-stage.safe-mode')));
  useEffect(() => {
    const root = document.querySelector('.agent-stage');
    if (!root) return;
    const observer = new MutationObserver(() => setSafeMode(root.classList.contains('safe-mode')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, objectUrl = ''; const controller = new AbortController();
    setUrl(''); setError(''); setExpanded(false);
    if (!isAgentImagePath(image.path)) { setError('图片地址无效'); return; }
    const load = image.path.startsWith('/api/prompt-agent/local-image?') ? promptAgentService.getLocalImage(image.path, controller.signal) : api.getBlob(image.path.replace(/^\/api/, ''));
    void load.then(blob => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type) || blob.size > 30 * 1024 * 1024) throw new Error('图片格式无效或超过 30 MB');
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : '图片读取失败'); });
    return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.path]);
  return <figure className={`my-2 min-w-0 ${safeMode && !expanded ? 'safe-mode' : ''}`}>
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : url ? <button type="button" aria-label={expanded ? '收起图片' : `查看图片：${image.title}`} onClick={() => setExpanded(value => !value)} className="block w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-950">
      <img src={url} alt={image.title} data-safe-mode-ignore={expanded ? 'true' : undefined} className={`w-full object-contain ${expanded ? 'max-h-[75dvh]' : 'max-h-64'}`} onError={() => setError('图片无法显示，原文件可能已损坏或移除')} />
    </button> : <p role="status" className="text-xs text-gray-400">正在读取图片…</p>}
    <figcaption className="mt-1 break-words text-micro text-gray-500">{image.title}</figcaption>
  </figure>;
};
