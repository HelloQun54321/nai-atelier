import { GenerationMode, ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, LabWorkspaceSession, NAIParams } from '../types';
import { normalizeMinimumContextArea } from './imageEdit';

const SESSION_PREFIX = 'nai-lab-workspace-v1:';
const ASSET_DB_NAME = 'NAI_Lab_Workspace_DB';
const ASSET_STORE_NAME = 'assets';
const ASSET_DB_VERSION = 2;

const emptyExpansion: ImageEditCanvasExpansion = { top: 0, right: 0, bottom: 0, left: 0 };

const cloneParams = (params: NAIParams): NAIParams => ({
  ...params,
  characters: params.characters?.map(character => ({ ...character })) || [],
  vibes: params.vibes ? { ...params.vibes, slots: params.vibes.slots.map(slot => ({ ...slot })) } : undefined,
  characterReferences: params.characterReferences ? { ...params.characterReferences, slots: params.characterReferences.slots.map(slot => ({ ...slot })) } : undefined,
});

export const createLabImageEditDraft = (
  operation: ImageEditOperation,
  prompt: string,
  negativePrompt: string,
  params: NAIParams,
  patch: Partial<LabImageEditDraft> = {},
): LabImageEditDraft => ({
  prompt,
  negativePrompt,
  params: cloneParams(params),
  strength: operation === 'image-to-image' ? 0.7 : 1,
  noise: 0,
  brushSize: 64,
  focused: false,
  minimumContextArea: 64,
  expansion: { ...emptyExpansion },
  promptSource: 'current',
  ...patch,
});

export const createLabWorkspaceSession = (
  basePrompt: string,
  subjectPrompt: string,
  negativePrompt: string,
  params: NAIParams,
  activeModules: Record<string, boolean>,
): LabWorkspaceSession => ({
  version: 1,
  activeMode: 'text-to-image',
  textToImage: { basePrompt, subjectPrompt, negativePrompt, params: cloneParams(params), activeModules: { ...activeModules } },
  edits: {
    'image-to-image': createLabImageEditDraft('image-to-image', '', negativePrompt, params),
    inpaint: createLabImageEditDraft('inpaint', '', negativePrompt, params),
    outpaint: createLabImageEditDraft('outpaint', '', negativePrompt, params),
  },
  updatedAt: Date.now(),
});

const isEditDraft = (value: unknown): value is LabImageEditDraft => {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<LabImageEditDraft>;
  return typeof draft.prompt === 'string' && typeof draft.negativePrompt === 'string' && Boolean(draft.params) && typeof draft.strength === 'number';
};

const normalizeSession = (value: unknown, fallback: LabWorkspaceSession): LabWorkspaceSession => {
  if (!value || typeof value !== 'object') return fallback;
  const source = value as Partial<LabWorkspaceSession>;
  return {
    ...fallback,
    ...source,
    activeMode: source.activeMode && ['text-to-image', 'image-to-image', 'inpaint', 'outpaint'].includes(source.activeMode) ? source.activeMode : fallback.activeMode,
    textToImage: {
      ...fallback.textToImage,
      ...(source.textToImage || {}),
      params: source.textToImage?.params ? cloneParams(source.textToImage.params) : fallback.textToImage.params,
      activeModules: { ...fallback.textToImage.activeModules, ...(source.textToImage?.activeModules || {}) },
    },
    edits: {
      ...fallback.edits,
      ...Object.fromEntries((Object.keys(fallback.edits) as ImageEditOperation[]).map(operation => [
        operation,
        isEditDraft(source.edits?.[operation])
        ? { ...fallback.edits[operation], ...source.edits[operation], minimumContextArea: normalizeMinimumContextArea(source.edits[operation]!.minimumContextArea), params: cloneParams(source.edits[operation]!.params), expansion: { ...emptyExpansion, ...(source.edits[operation]!.expansion || {}) } }
          : fallback.edits[operation],
      ])),
    },
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : Date.now(),
  };
};

export const loadLabWorkspaceSession = (key: string, fallback: LabWorkspaceSession): LabWorkspaceSession => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_PREFIX}${key}`);
    return raw ? normalizeSession(JSON.parse(raw), fallback) : fallback;
  } catch {
    return fallback;
  }
};

export const saveLabWorkspaceSession = (key: string, session: LabWorkspaceSession) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${SESSION_PREFIX}${key}`, JSON.stringify({ ...session, updatedAt: Date.now() }));
  } catch {
    // 会话存储空间不足时不阻断当前生成流程。
  }
};

const openAssetDb = async (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(ASSET_DB_NAME, ASSET_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('无法打开图片编辑资产存储'));
});

export const saveLabWorkspaceAsset = async (blob: Blob, id = crypto.randomUUID()): Promise<string> => {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE_NAME, 'readwrite').objectStore(ASSET_STORE_NAME).put({ id, blob, mimeType: blob.type, updatedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存图片编辑资产失败'));
  });
  db.close();
  return id;
};

export const readLabWorkspaceAsset = async (id: string): Promise<Blob | null> => {
  const db = await openAssetDb();
  const value = await new Promise<{ blob?: Blob } | undefined>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE_NAME, 'readonly').objectStore(ASSET_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('读取图片编辑资产失败'));
  });
  db.close();
  return value?.blob || null;
};

export const blobToDataUrl = async (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取图片编辑资产失败'));
  reader.readAsDataURL(blob);
});

export const dataUrlToWorkspaceAsset = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('读取图片编辑资产失败');
  return saveLabWorkspaceAsset(await response.blob());
};

export const getLabWorkspaceSessionKey = (chainId: string) => chainId || 'playground';

export type { GenerationMode };
