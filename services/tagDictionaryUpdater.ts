export type TagUpdatePhase = 'idle' | 'checking' | 'downloading' | 'generating' | 'building' | 'completed' | 'unchanged' | 'error';

export interface TagUpdateStatus {
  available: boolean;
  running: boolean;
  phase: TagUpdatePhase;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  manifest: {
    count: number;
    generatedAt: string | null;
    sourceLastModified: string | null;
  };
}

const CONTROL_URL = '/api/tag-dictionary';

const request = async (method: 'GET' | 'POST'): Promise<TagUpdateStatus> => {
  const response = await fetch(CONTROL_URL, {
    method,
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Tag 更新服务请求失败：${response.status}`);
  return body as TagUpdateStatus;
};

export const getTagUpdateStatus = () => request('GET');
export const startTagUpdate = () => request('POST');
