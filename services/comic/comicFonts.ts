/**
 * 漫画开源字体与本机自定义字体管理器：
 * - 对接本机网关 `/api/comic-fonts/*`（缓存至 local-cache/comic-fonts/，按需下载、永久离线）
 * - 支持直接导入用户本机 .ttf / .otf / .woff2 字体（即使网关未重启也可立即在浏览器内存注册生效）
 * - 自动通过 FontFace API 注册至 document.fonts，确保画布 SVG 预览与导出 PNG 同步使用真实漫画字体
 */

export interface ComicBuiltinFontItem {
  id: string;
  name: string;
  family: string;
  styleTag: string;
  license: string;
  repo: string;
  approxSizeMB: number;
  recommended: boolean;
  installed: boolean;
  downloading: boolean;
  sizeBytes: number;
  format: string;
  url: string | null;
}

export interface ComicCustomFontItem {
  id: string;
  name: string;
  family: string;
  format: string;
  sizeBytes: number;
  url: string;
  /** 离线/后端未重启时的纯浏览器会话临时字体标记 */
  localOnly?: boolean;
}

export interface ComicFontCatalogState {
  fonts: ComicBuiltinFontItem[];
  customFonts: ComicCustomFontItem[];
  serverReachable: boolean;
}

/** 未连接新网关时的内置字体静态目录（让界面随时可见可选开源字体）。 */
export const FALLBACK_BUILTIN_FONTS: ComicBuiltinFontItem[] = [
  {
    id: 'lxgw-marker-gothic',
    name: '霞鹜漫黑',
    family: 'ComicLXGWMarkerGothic',
    styleTag: '主力对白 · 马克笔漫画感',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/LxgwMarkerGothic',
    approxSizeMB: 1.8,
    recommended: true,
    installed: false,
    downloading: false,
    sizeBytes: 0,
    format: 'ttf',
    url: null,
  },
  {
    id: 'smiley-sans',
    name: '得意黑',
    family: 'ComicSmileySans',
    styleTag: '热血拟声 · 斜切冲击标题',
    license: 'SIL OFL 1.1',
    repo: 'atelier-anchor/smiley-sans',
    approxSizeMB: 5.6,
    recommended: true,
    installed: false,
    downloading: false,
    sizeBytes: 0,
    format: 'woff2',
    url: null,
  },
  {
    id: 'genei-antique',
    name: '源暎アンチック',
    family: 'ComicGenEiAntique',
    styleTag: '正统日漫 · FramePlanner 同款',
    license: 'SIL OFL 1.1',
    repo: 'tani/genei-fonts-mirror',
    approxSizeMB: 9.8,
    recommended: true,
    installed: false,
    downloading: false,
    sizeBytes: 0,
    format: 'ttf',
    url: null,
  },
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷 Lite',
    family: 'ComicLXGWWenKai',
    styleTag: '旁白独白 · 温润手写楷体',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/LxgwWenKai-Lite',
    approxSizeMB: 13.6,
    recommended: false,
    installed: false,
    downloading: false,
    sizeBytes: 0,
    format: 'ttf',
    url: null,
  },
  {
    id: 'xiaolai',
    name: '小赖字体',
    family: 'ComicXiaolai',
    styleTag: '日常四格 · 轻松手写体',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/kose-font',
    approxSizeMB: 21.7,
    recommended: false,
    installed: false,
    downloading: false,
    sizeBytes: 0,
    format: 'ttf',
    url: null,
  },
];

// 已通过 FontFace API 注册的字体集合（family -> url），避免重复加载
const registeredFontFaces = new Map<string, string>();
// 全局字体注册表（id -> CSS font-family），供 ComicCanvas 与 comicExporter 同步查询
const fontFamilyLookup = new Map<string, string>();
// 离线会话临时导入字体（未重启后端时依然立即可用）
const sessionCustomFonts: ComicCustomFontItem[] = [];

// 预置内置开源字体 family 映射（即使刚渲染还没拉完 status 也能匹配）
for (const f of FALLBACK_BUILTIN_FONTS) {
  fontFamilyLookup.set(f.id, f.family);
}

export const registerComicFontFace = async (family: string, url: string): Promise<boolean> => {
  if (!family || !url) return false;
  if (registeredFontFaces.get(family) === url) return true;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return false;
  }
  try {
    const face = new FontFace(family, `url("${url}")`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    registeredFontFaces.set(family, url);
    return true;
  } catch {
    return false;
  }
};

export const syncLoadedFontsFromState = async (state: ComicFontCatalogState): Promise<void> => {
  const tasks: Promise<unknown>[] = [];
  for (const font of state.fonts) {
    fontFamilyLookup.set(font.id, font.family);
    if (font.installed && font.url) {
      tasks.push(registerComicFontFace(font.family, font.url));
    }
  }
  for (const custom of state.customFonts) {
    fontFamilyLookup.set(custom.id, custom.family);
    if (custom.url) {
      tasks.push(registerComicFontFace(custom.family, custom.url));
    }
  }
  await Promise.allSettled(tasks);
};

export const lookupRegisteredComicFontFamily = (fontId?: string): string | null => {
  if (!fontId) return null;
  return fontFamilyLookup.get(fontId) || null;
};

export const fetchComicFontsStatus = async (): Promise<ComicFontCatalogState> => {
  try {
    const res = await fetch('/api/comic-fonts/status', { credentials: 'include' });
    if (!res.ok) {
      return {
        fonts: FALLBACK_BUILTIN_FONTS,
        customFonts: [...sessionCustomFonts],
        serverReachable: false,
      };
    }
    const data = await res.json() as { fonts?: ComicBuiltinFontItem[]; customFonts?: ComicCustomFontItem[] };
    const state: ComicFontCatalogState = {
      fonts: Array.isArray(data.fonts) && data.fonts.length ? data.fonts : FALLBACK_BUILTIN_FONTS,
      customFonts: [...(Array.isArray(data.customFonts) ? data.customFonts : []), ...sessionCustomFonts],
      serverReachable: true,
    };
    await syncLoadedFontsFromState(state);
    return state;
  } catch {
    return {
      fonts: FALLBACK_BUILTIN_FONTS,
      customFonts: [...sessionCustomFonts],
      serverReachable: false,
    };
  }
};

export const downloadBuiltinComicFont = async (id: string): Promise<ComicFontCatalogState> => {
  const res = await fetch('/api/comic-fonts/download', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; fonts?: ComicBuiltinFontItem[]; customFonts?: ComicCustomFontItem[] };
  if (!res.ok) {
    throw new Error(data.error || `下载字体失败（HTTP ${res.status}）`);
  }
  const state: ComicFontCatalogState = {
    fonts: Array.isArray(data.fonts) ? data.fonts : FALLBACK_BUILTIN_FONTS,
    customFonts: [...(Array.isArray(data.customFonts) ? data.customFonts : []), ...sessionCustomFonts],
    serverReachable: true,
  };
  await syncLoadedFontsFromState(state);
  return state;
};

export const uploadCustomComicFont = async (file: File): Promise<{ imported: ComicCustomFontItem; state: ComicFontCatalogState }> => {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const res = await fetch('/api/comic-fonts/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Font-Filename': encodeURIComponent(file.name),
      },
      body: arrayBuffer,
    });
    if (res.ok) {
      const data = await res.json() as {
        imported: ComicCustomFontItem;
        fonts: ComicBuiltinFontItem[];
        customFonts: ComicCustomFontItem[];
      };
      const state: ComicFontCatalogState = {
        fonts: Array.isArray(data.fonts) ? data.fonts : FALLBACK_BUILTIN_FONTS,
        customFonts: [...(Array.isArray(data.customFonts) ? data.customFonts : []), ...sessionCustomFonts],
        serverReachable: true,
      };
      await syncLoadedFontsFromState(state);
      return { imported: data.imported, state };
    }
    if (res.status !== 404 && res.status !== 502 && res.status !== 503) {
      const errData = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errData.error || `上传字体失败（HTTP ${res.status}）`);
    }
  } catch (error) {
    // 非网络/404 校验报错直接透传给用户
    if (error instanceof Error && /仅支持|上限|为空/.test(error.message)) {
      throw error;
    }
  }

  // 后端未重启时优雅降级：直接在当前浏览器会话注册 FontFace 立即可用
  const cleanName = file.name.replace(/\.(ttf|otf|woff2|woff)$/i, '').trim() || '自定义漫画字体';
  const id = `custom-local-${Date.now().toString(36)}`;
  const family = `ComicCustom_${id.replace(/[^a-z0-9]/gi, '_')}`;
  const blobUrl = URL.createObjectURL(new Blob([arrayBuffer]));
  const ok = await registerComicFontFace(family, blobUrl);
  if (!ok) {
    URL.revokeObjectURL(blobUrl);
    throw new Error('无法解析该字体文件，请确认它是有效的 .ttf / .otf / .woff2 字体');
  }
  const imported: ComicCustomFontItem = {
    id,
    name: cleanName,
    family,
    format: file.name.split('.').pop()?.toLowerCase() || 'ttf',
    sizeBytes: file.size,
    url: blobUrl,
    localOnly: true,
  };
  sessionCustomFonts.unshift(imported);
  fontFamilyLookup.set(id, family);
  const state: ComicFontCatalogState = {
    fonts: FALLBACK_BUILTIN_FONTS,
    customFonts: [...sessionCustomFonts],
    serverReachable: false,
  };
  return { imported, state };
};

export const deleteComicFont = async (id: string): Promise<ComicFontCatalogState> => {
  const localIdx = sessionCustomFonts.findIndex(item => item.id === id);
  if (localIdx >= 0) {
    const [removed] = sessionCustomFonts.splice(localIdx, 1);
    if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
    return fetchComicFontsStatus();
  }
  const res = await fetch(`/api/comic-fonts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({})) as { error?: string; fonts?: ComicBuiltinFontItem[]; customFonts?: ComicCustomFontItem[] };
  if (!res.ok) {
    throw new Error(data.error || `删除字体失败（HTTP ${res.status}）`);
  }
  return {
    fonts: Array.isArray(data.fonts) ? data.fonts : FALLBACK_BUILTIN_FONTS,
    customFonts: [...(Array.isArray(data.customFonts) ? data.customFonts : []), ...sessionCustomFonts],
    serverReachable: true,
  };
};
