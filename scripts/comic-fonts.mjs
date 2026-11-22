import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';

export const COMIC_FONT_UPLOAD_LIMIT = 40 * 1024 * 1024; // 40 MB

/**
 * 精选 5 款 SIL OFL 1.1 开源免费商用漫画字体（按需下载至 local-cache/comic-fonts/，不膨胀代码仓库）。
 */
export const BUILTIN_COMIC_FONT_CATALOG = [
  {
    id: 'lxgw-marker-gothic',
    name: '霞鹜漫黑',
    family: 'ComicLXGWMarkerGothic',
    styleTag: '主力对白 · 马克笔漫画感',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/LxgwMarkerGothic',
    approxSizeMB: 1.8,
    urls: [
      'https://cdn.jsdelivr.net/gh/lxgw/LxgwMarkerGothic@main/fonts/ttf/LXGWMarkerGothic-Regular.ttf',
      'https://raw.githubusercontent.com/lxgw/LxgwMarkerGothic/main/fonts/ttf/LXGWMarkerGothic-Regular.ttf',
    ],
    format: 'ttf',
    recommended: true,
  },
  {
    id: 'smiley-sans',
    name: '得意黑',
    family: 'ComicSmileySans',
    styleTag: '热血拟声 · 斜切冲击标题',
    license: 'SIL OFL 1.1',
    repo: 'atelier-anchor/smiley-sans',
    approxSizeMB: 5.6,
    urls: [
      'https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip',
    ],
    zipExtractPattern: /SmileySans-Oblique\.(ttf\.woff2|woff2|ttf|otf)$/i,
    format: 'woff2',
    recommended: true,
  },
  {
    id: 'genei-antique',
    name: '源暎アンチック',
    family: 'ComicGenEiAntique',
    styleTag: '正统日漫 · FramePlanner 同款',
    license: 'SIL OFL 1.1',
    repo: 'tani/genei-fonts-mirror',
    approxSizeMB: 9.8,
    urls: [
      'https://github.com/tani/genei-fonts-mirror/releases/download/mirror/GenEiAntique_v5.1.zip',
    ],
    zipExtractPattern: /GenEiAntiqueP[^/]*\.(ttf|otf|woff2)$/i,
    format: 'ttf',
    recommended: true,
  },
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷 Lite',
    family: 'ComicLXGWWenKai',
    styleTag: '旁白独白 · 温润手写楷体',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/LxgwWenKai-Lite',
    approxSizeMB: 13.6,
    urls: [
      'https://github.com/lxgw/LxgwWenKai-Lite/releases/download/v1.530/LXGWWenKaiLite-Regular.ttf',
    ],
    format: 'ttf',
    recommended: false,
  },
  {
    id: 'xiaolai',
    name: '小赖字体',
    family: 'ComicXiaolai',
    styleTag: '日常四格 · 轻松手写体',
    license: 'SIL OFL 1.1',
    repo: 'lxgw/kose-font',
    approxSizeMB: 21.7,
    urls: [
      'https://github.com/lxgw/kose-font/releases/download/v3.126/Xiaolai-Regular.ttf',
    ],
    format: 'ttf',
    recommended: false,
  },
];

const SAFE_FONT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export const detectFontFormat = (buffer, fallbackExt = '') => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const sig4 = buffer.subarray(0, 4).toString('ascii');
  if (sig4 === 'wOF2') return 'woff2';
  if (sig4 === 'wOFF') return 'woff';
  if (sig4 === 'OTTO') return 'otf';
  if (sig4 === 'true' || sig4 === 'ttcf') return 'ttf';
  if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) return 'ttf';
  const ext = fallbackExt.toLowerCase().replace(/^\./, '');
  if (ext === 'woff2' || ext === 'ttf' || ext === 'otf' || ext === 'woff') return ext;
  return null;
};

export const fontContentType = format => {
  if (format === 'woff2') return 'font/woff2';
  if (format === 'woff') return 'font/woff';
  if (format === 'otf') return 'font/otf';
  return 'font/ttf';
};

const isValidZip = buffer =>
  Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

const extractFontFromZip = async (zipBuffer, pattern) => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const candidates = Object.values(zip.files)
    .filter(entry => !entry.dir && /\.(woff2|ttf|otf)$/i.test(entry.name))
    .sort((a, b) => {
      // 优先命中正则，其次优先 woff2 体积更小
      const aMatch = pattern && pattern.test(a.name) ? 0 : 1;
      const bMatch = pattern && pattern.test(b.name) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const aWoff2 = /\.woff2$/i.test(a.name) ? 0 : 1;
      const bWoff2 = /\.woff2$/i.test(b.name) ? 0 : 1;
      return aWoff2 - bWoff2;
    });
  const picked = candidates[0];
  if (!picked) throw new Error('压缩包中未找到可用的 .woff2 / .ttf / .otf 字体文件');
  const bytes = await picked.async('nodebuffer');
  const format = detectFontFormat(bytes, extname(picked.name));
  if (!format) throw new Error('提取出的文件不是有效的字体格式');
  return { buffer: bytes, format };
};

export const createComicFontManager = ({ cacheRoot, fetchImpl = fetch } = {}) => {
  const fontsDir = join(cacheRoot, 'comic-fonts');
  const builtinDir = join(fontsDir, 'builtin');
  const customDir = join(fontsDir, 'custom');
  const customManifestPath = join(fontsDir, 'custom-manifest.json');
  const activeDownloads = new Map();

  const ensureDirs = async () => {
    await mkdir(builtinDir, { recursive: true });
    await mkdir(customDir, { recursive: true });
  };

  const readCustomManifest = async () => {
    try {
      const raw = JSON.parse(await readFile(customManifestPath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  };

  const writeCustomManifest = async items => {
    await ensureDirs();
    const tmp = `${customManifestPath}.tmp`;
    await writeFile(tmp, JSON.stringify(items, null, 2), 'utf8');
    await rename(tmp, customManifestPath);
  };

  const findInstalledBuiltinFile = async entry => {
    for (const ext of ['woff2', 'ttf', 'otf', 'woff']) {
      const filePath = join(builtinDir, `${entry.id}.${ext}`);
      try {
        const info = await stat(filePath);
        if (info.isFile() && info.size > 1024) {
          return { filePath, format: ext, sizeBytes: info.size };
        }
      } catch {
        // 文件不存在则继续检查下一扩展名
      }
    }
    return null;
  };

  const status = async () => {
    const builtin = await Promise.all(BUILTIN_COMIC_FONT_CATALOG.map(async entry => {
      const installed = await findInstalledBuiltinFile(entry);
      return {
        id: entry.id,
        name: entry.name,
        family: entry.family,
        styleTag: entry.styleTag,
        license: entry.license,
        repo: entry.repo,
        approxSizeMB: entry.approxSizeMB,
        recommended: entry.recommended,
        installed: Boolean(installed),
        downloading: activeDownloads.has(entry.id),
        sizeBytes: installed?.sizeBytes || 0,
        format: installed?.format || entry.format,
        url: installed ? `/api/comic-fonts/file/${encodeURIComponent(entry.id)}` : null,
      };
    }));

    const rawCustom = await readCustomManifest();
    const customFonts = [];
    for (const item of rawCustom) {
      if (!item?.id || !item?.filename) continue;
      const filePath = join(customDir, item.filename);
      try {
        const info = await stat(filePath);
        if (info.isFile() && info.size > 0) {
          customFonts.push({
            id: item.id,
            name: item.name || item.id,
            family: item.family || `ComicCustom_${item.id}`,
            format: item.format || 'ttf',
            sizeBytes: info.size,
            url: `/api/comic-fonts/file/${encodeURIComponent(item.id)}`,
          });
        }
      } catch {
        // 已被外部删掉的自定义字体自动忽略
      }
    }

    return { fonts: builtin, customFonts };
  };

  const downloadBuiltin = async id => {
    const entry = BUILTIN_COMIC_FONT_CATALOG.find(item => item.id === id);
    if (!entry) {
      const err = new Error(`未知内置字体：${id}`);
      err.status = 404;
      throw err;
    }
    if (activeDownloads.has(id)) {
      return activeDownloads.get(id);
    }

    const promise = (async () => {
      await ensureDirs();
      let lastError = null;
      for (const sourceUrl of entry.urls) {
        try {
          const response = await fetchImpl(sourceUrl, {
            redirect: 'follow',
            headers: { 'User-Agent': 'NAI-Atelier-Comic-Studio' },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const rawBuffer = Buffer.from(await response.arrayBuffer());
          let finalBuffer = rawBuffer;
          let finalFormat = null;
          if (isValidZip(rawBuffer)) {
            const extracted = await extractFontFromZip(rawBuffer, entry.zipExtractPattern);
            finalBuffer = extracted.buffer;
            finalFormat = extracted.format;
          } else {
            finalFormat = detectFontFormat(rawBuffer, entry.format);
          }
          if (!finalFormat || finalBuffer.length < 1024) {
            throw new Error('下载的文件不是有效的字体格式');
          }

          // 清理旧格式同名文件，原子写入新文件
          for (const ext of ['woff2', 'ttf', 'otf', 'woff']) {
            if (ext === finalFormat) continue;
            await unlink(join(builtinDir, `${entry.id}.${ext}`)).catch(() => {});
          }
          const targetPath = join(builtinDir, `${entry.id}.${finalFormat}`);
          const partPath = `${targetPath}.part`;
          await writeFile(partPath, finalBuffer);
          await rename(partPath, targetPath);
          return await status();
        } catch (error) {
          lastError = error;
        }
      }
      const err = new Error(`下载字体「${entry.name}」失败：${lastError?.message || '网络不可达'}`);
      err.status = 502;
      throw err;
    })().finally(() => {
      activeDownloads.delete(id);
    });

    activeDownloads.set(id, promise);
    return promise;
  };

  const uploadCustomFont = async ({ filename, label, buffer }) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 128) {
      const err = new Error('字体文件内容为空或过小');
      err.status = 400;
      throw err;
    }
    if (buffer.length > COMIC_FONT_UPLOAD_LIMIT) {
      const err = new Error(`字体文件超过 ${Math.round(COMIC_FONT_UPLOAD_LIMIT / 1024 / 1024)} MB 上限`);
      err.status = 413;
      throw err;
    }
    const format = detectFontFormat(buffer, extname(filename || ''));
    if (!format) {
      const err = new Error('仅支持有效的 .ttf / .otf / .woff2 / .woff 字体文件');
      err.status = 400;
      throw err;
    }

    await ensureDirs();
    const id = `custom-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const cleanName = String(label || filename || '自定义漫画字体')
      .replace(/\.(ttf|otf|woff2|woff)$/i, '')
      .trim()
      .slice(0, 48) || '自定义漫画字体';
    const storedFilename = `${id}.${format}`;
    const targetPath = join(customDir, storedFilename);
    const partPath = `${targetPath}.part`;
    await writeFile(partPath, buffer);
    await rename(partPath, targetPath);

    const existing = await readCustomManifest();
    const record = {
      id,
      name: cleanName,
      family: `ComicCustom_${id.replace(/[^a-z0-9]/gi, '_')}`,
      filename: storedFilename,
      format,
      createdAt: Date.now(),
    };
    await writeCustomManifest([record, ...existing]);
    return {
      imported: {
        id: record.id,
        name: record.name,
        family: record.family,
        format: record.format,
        sizeBytes: buffer.length,
        url: `/api/comic-fonts/file/${encodeURIComponent(record.id)}`,
      },
      ...(await status()),
    };
  };

  const deleteFont = async id => {
    if (!SAFE_FONT_ID_RE.test(id)) {
      const err = new Error('非法的字体 ID');
      err.status = 400;
      throw err;
    }
    const builtinEntry = BUILTIN_COMIC_FONT_CATALOG.find(item => item.id === id);
    if (builtinEntry) {
      for (const ext of ['woff2', 'ttf', 'otf', 'woff']) {
        await unlink(join(builtinDir, `${builtinEntry.id}.${ext}`)).catch(() => {});
      }
      return await status();
    }

    const existing = await readCustomManifest();
    const target = existing.find(item => item.id === id);
    if (target?.filename) {
      await unlink(join(customDir, target.filename)).catch(() => {});
      await writeCustomManifest(existing.filter(item => item.id !== id));
    }
    return await status();
  };

  const readFontFile = async id => {
    if (!SAFE_FONT_ID_RE.test(id)) return null;
    const builtinEntry = BUILTIN_COMIC_FONT_CATALOG.find(item => item.id === id);
    if (builtinEntry) {
      const found = await findInstalledBuiltinFile(builtinEntry);
      if (!found) return null;
      return {
        buffer: await readFile(found.filePath),
        format: found.format,
        contentType: fontContentType(found.format),
      };
    }
    const existing = await readCustomManifest();
    const target = existing.find(item => item.id === id);
    if (!target?.filename) return null;
    try {
      const buffer = await readFile(join(customDir, target.filename));
      return {
        buffer,
        format: target.format || 'ttf',
        contentType: fontContentType(target.format || 'ttf'),
      };
    } catch {
      return null;
    }
  };

  return {
    status,
    downloadBuiltin,
    uploadCustomFont,
    deleteFont,
    readFontFile,
  };
};
