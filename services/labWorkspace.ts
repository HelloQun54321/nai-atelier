import { GenerationMode, ImageEditCanvasExpansion, ImageEditOperation, LabImageEditDraft, LabWorkspaceSession, NAIParams } from '../types';
import { normalizeMinimumContextArea } from './imageEdit';
import { getDefaultStepsForModel } from './naiModels';

const SESSION_PREFIX = 'nai-lab-workspace-v1:';
const ASSET_DB_NAME = 'NAI_Lab_Workspace_DB';
const ASSET_STORE_NAME = 'assets';
const ASSET_DB_VERSION = 3;

const emptyExpansion: ImageEditCanvasExpansion = { top: 0, right: 0, bottom: 0, left: 0 };

/** 实验室重置与新建会话共用的默认参数：832×1216（约百万像素免费面积上限）、随机种子、UC 预设 None；步数跟随默认模型（未设置模型时按 V4.5 为 28 步）。 */
export const LAB_DEFAULT_PARAMS: NAIParams = {
    width: 832,
    height: 1216,
    steps: getDefaultStepsForModel(),
    scale: 5,
    sampler: 'k_euler_ancestral',
    seed: undefined,
    qualityToggle: true,
    ucPreset: 4,
    characters: [],
};

/** 生成模式的中文名，用于重置确认弹窗与提示语。 */
export const getLabModeLabel = (mode: GenerationMode): string => (
    mode === 'text-to-image' ? '文生图' : mode === 'image-to-image' ? '图生图' : mode === 'inpaint' ? '局部重绘' : '扩图'
);

export const normalizeParams = (params?: Partial<NAIParams> | null): NAIParams => {
  const safe = params && typeof params === 'object' ? params : {};
  return {
    ...LAB_DEFAULT_PARAMS,
    ...safe,
    width: Number(safe.width) || LAB_DEFAULT_PARAMS.width,
    height: Number(safe.height) || LAB_DEFAULT_PARAMS.height,
    steps: Number(safe.steps) || LAB_DEFAULT_PARAMS.steps,
    scale: Number(safe.scale) || LAB_DEFAULT_PARAMS.scale,
    sampler: safe.sampler || LAB_DEFAULT_PARAMS.sampler,
    characters: Array.isArray(safe.characters) ? safe.characters.map(character => ({ ...character })) : [],
    vibes: safe.vibes ? {
      ...safe.vibes,
      slots: Array.isArray(safe.vibes.slots) ? safe.vibes.slots.map(slot => ({ ...slot })) : [],
    } : undefined,
    characterReferences: safe.characterReferences ? {
      ...safe.characterReferences,
      slots: Array.isArray(safe.characterReferences.slots) ? safe.characterReferences.slots.map(slot => ({ ...slot })) : [],
    } : undefined,
  };
};

const cloneParams = (params: NAIParams): NAIParams => normalizeParams(params);

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
): LabWorkspaceSession => {
  const initialPrompt = [basePrompt, subjectPrompt].filter(Boolean).join(', ') || '';
  return {
    version: 1,
    activeMode: 'text-to-image',
    textToImage: { basePrompt, subjectPrompt, negativePrompt, params: cloneParams(params), activeModules: { ...activeModules } },
    edits: {
      'image-to-image': createLabImageEditDraft('image-to-image', initialPrompt, negativePrompt, params),
      inpaint: createLabImageEditDraft('inpaint', initialPrompt, negativePrompt, params),
      outpaint: createLabImageEditDraft('outpaint', initialPrompt, negativePrompt, params),
    },
    updatedAt: Date.now(),
  };
};

/** 只有实验室入口允许恢复图片编辑模式；风格串／角色串详情始终是文生图工作区。 */
export const scopeLabWorkspaceSessionToEntry = (entryId: string, session: LabWorkspaceSession): LabWorkspaceSession => (
  entryId === 'playground' || session.activeMode === 'text-to-image'
    ? session
    : { ...session, activeMode: 'text-to-image' }
);

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

export const saveLabWorkspaceAsset = async (blob: Blob, id: string = crypto.randomUUID()): Promise<string> => {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE_NAME, 'readwrite').objectStore(ASSET_STORE_NAME).put({ id, blob, mimeType: blob.type, updatedAt: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存图片编辑资产失败'));
  });
  db.close();
  return id;
};

/** 工作区资产按会话、模式和角色复用，重复保存会覆盖同一个 Blob。 */
export const getLabWorkspaceAssetId = (sessionKey: string, operation: ImageEditOperation, role: 'base' | 'mask') =>
  `lab:${encodeURIComponent(sessionKey)}:${operation}:${role}`;

export const deleteLabWorkspaceAsset = async (id: string | undefined) => {
  if (!id) return;
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(ASSET_STORE_NAME, 'readwrite').objectStore(ASSET_STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('删除图片编辑资产失败'));
  });
  db.close();
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

export const dataUrlToWorkspaceAsset = async (dataUrl: string, id?: string) => {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('读取图片编辑资产失败');
  return saveLabWorkspaceAsset(await response.blob(), id);
};

const collectReferencedAssetIds = () => {
  const referenced = new Set<string>();
  if (typeof window === 'undefined') return referenced;
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key?.startsWith(SESSION_PREFIX)) continue;
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || 'null') as any;
      const edits = value?.edits && typeof value.edits === 'object' ? Object.values(value.edits) as Array<Record<string, unknown>> : [];
      for (const edit of edits) {
        if (typeof edit?.baseImageRef === 'string') referenced.add(edit.baseImageRef);
        if (typeof edit?.maskRef === 'string') referenced.add(edit.maskRef);
      }
    } catch {
      // 损坏的会话由正常的工作区恢复逻辑处理，这里不阻断清理。
    }
  }
  return referenced;
};

/** 启动时清理不再被任何实验室会话引用的旧 Blob。 */
export const cleanupLabWorkspaceAssets = async (additionalReferencedIds: string[] = []) => {
  const referenced = collectReferencedAssetIds();
  additionalReferencedIds.filter(Boolean).forEach(id => referenced.add(id));
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as { id?: string };
      if (value.id && !referenced.has(value.id)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('清理图片编辑资产失败'));
    request.onerror = () => reject(request.error || new Error('扫描图片编辑资产失败'));
  });
  db.close();
};

export const getLabWorkspaceSessionKey = (chainId: string) => chainId || 'playground';

export type { GenerationMode };
