import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch, ProxyAgent } from 'undici';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 词库先写入暂存目录、全部成功后再原子替换正式目录：
// 生成中途失败（磁盘满/进程被杀）只会留下废弃暂存目录，不会破坏现有词库。
const OUTPUT_ROOT = process.env.NAI_PACKAGED === '1' ? process.cwd() : ROOT;
const FINAL_OUTPUT_DIR = process.env.NAI_TAG_DATA_DIR || path.join(OUTPUT_ROOT, 'public', 'tag-data');
const STAGING_OUTPUT_DIR = `${FINAL_OUTPUT_DIR}.staging`;
let OUTPUT_DIR = FINAL_OUTPUT_DIR;
const MANIFEST_FILE = path.join(FINAL_OUTPUT_DIR, 'manifest.json');
const NAI_TAGS_FILE = path.join(ROOT, 'data', 'novelai-v45-tags.json');
const TRANSLATION_DATABASE_URL = process.env.NAI_TAG_DATABASE_URL
  || 'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite';
// jsDelivr 对该文件限制 20 MB，当前词库已超限；备用源只使用明确配置的地址。
const TRANSLATION_DATABASE_FALLBACK_URL = process.env.NAI_TAG_DATABASE_FALLBACK_URL || '';
const TRANSLATION_PROJECT_URL = 'https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table';
const USER_AGENT = 'NAI-Atelier/0.5.0 (private local tag dictionary updater)';
const CHARACTER_SEARCH_SHARD_COUNT = 128;

const categoryNames = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  6: 'novelai'
};

const normalizeTag = (name) => String(name)
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const normalizeChinese = (name) => String(name)
  .replace(/\s+/g, ' ')
  .trim();

const rankEntries = (a, b) => b[4] - a[4] || b[3] - a[3] || a[0].localeCompare(b[0]);

const splitSearchSegments = (value) => String(value)
  .normalize('NFKC')
  .toLowerCase()
  .match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) || [];

const buildCharacterSearchTokens = (value) => {
  const tokens = new Set();
  for (const segment of splitSearchSegments(value)) {
    const characters = Array.from(segment);
    if (/^\p{Script=Han}+$/u.test(segment)) {
      for (let index = 0; index < characters.length - 1; index++) {
        tokens.add(characters.slice(index, index + 2).join(''));
      }
      continue;
    }
    if (characters.length === 1) continue;
    for (let length = 2; length <= Math.min(characters.length, 40); length++) {
      tokens.add(characters.slice(0, length).join(''));
    }
  }
  return tokens;
};

const hashSearchToken = (token) => {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % CHARACTER_SEARCH_SHARD_COUNT;
};

async function readCurrentSourceMetadata() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'));
    return {
      canSkipRegeneration: Number(manifest.version) >= 7
        && Array.isArray(manifest.artistPages)
        && Array.isArray(manifest.artistNamePages)
        && Array.isArray(manifest.characterPages)
        && Array.isArray(manifest.characterNamePages)
        && Array.isArray(manifest.characterSearchShards)
        && typeof manifest.characterSearchRecords === 'string',
      validators: manifest.sourceValidators || {
        [manifest.sourceDownloadUrl || TRANSLATION_DATABASE_URL]: {
          etag: manifest.sourceEtag || '',
          lastModified: manifest.sourceLastModified || ''
        }
      }
    };
  } catch {
    return { canSkipRegeneration: false, validators: {} };
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const describeNetworkError = error => {
  const code = error?.cause?.code || error?.code;
  if (code === 'ECONNRESET') return '连接被远端中断（ECONNRESET）';
  if (code === 'ETIMEDOUT' || error?.name === 'TimeoutError') return '连接超时';
  if (code === 'ENOTFOUND') return '无法解析下载服务器地址';
  if (code === 'ECONNREFUSED') return '下载服务器拒绝连接';
  if (error?.message === 'fetch failed') return '无法连接下载服务器';
  return error instanceof Error ? error.message : String(error);
};

async function downloadTranslationDatabase(targetPath) {
  console.log('TAG_UPDATE_PHASE=checking');
  console.log('Downloading the latest bilingual Danbooru tag database...');
  const currentSource = await readCurrentSourceMetadata();
  const sources = [...new Set([TRANSLATION_DATABASE_URL, TRANSLATION_DATABASE_FALLBACK_URL].filter(Boolean))];
  const proxyUrl = process.env.NAI_TAG_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : null;
  const failures = [];

  try {
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const sourceUrl = sources[sourceIndex];
      const validator = currentSource.validators[sourceUrl] || {};
      const sourceLabel = `${sourceIndex === 0 ? '主线路' : '备用线路'}（${new URL(sourceUrl).host}）`;
      let lastError;

      if (sourceIndex > 0) {
        console.log(`TAG_UPDATE_MESSAGE=${encodeURIComponent('主线路下载失败，正在切换备用线路…')}`);
        console.log('Switching to the configured fallback...');
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        const headers = { 'User-Agent': USER_AGENT };
        if (currentSource.canSkipRegeneration && validator.etag) headers['If-None-Match'] = validator.etag;
        if (currentSource.canSkipRegeneration && !validator.etag && validator.lastModified) headers['If-Modified-Since'] = validator.lastModified;

        try {
          const response = await fetch(sourceUrl, {
            cache: 'no-store',
            headers,
            signal: AbortSignal.timeout(45000),
            ...(proxyAgent ? { dispatcher: proxyAgent } : {})
          });
          if (response.status === 304) {
            console.log('TAG_UPDATE_RESULT=unchanged');
            return null;
          }
          if (!response.ok) {
            let detail = '';
            if (response.headers.get('content-type')?.startsWith('text/plain')) {
              detail = (await response.text()).trim().replace(/\s+/g, ' ').slice(0, 200);
              const sizeLimit = detail.match(/File size exceeded the configured limit of (\d+\s*MB)/i)?.[1];
              if (sizeLimit) detail = `文件超过下载源的大小限制（${sizeLimit}）`;
            } else await response.body?.cancel();
            throw Object.assign(new Error(`下载服务器返回 ${response.status} ${response.statusText}${detail ? `：${detail}` : ''}`), { status: response.status });
          }

          console.log('TAG_UPDATE_PHASE=downloading');
          const bytes = new Uint8Array(await response.arrayBuffer());
          await writeFile(targetPath, bytes);
          console.log(`Downloaded ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`);
          return {
            downloadUrl: sourceUrl,
            validators: {
              ...currentSource.validators,
              [sourceUrl]: {
                etag: response.headers.get('etag') || '',
                lastModified: response.headers.get('last-modified') || ''
              }
            }
          };
        } catch (error) {
          lastError = error;
          const reason = describeNetworkError(error);
          if (error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) break;
          if (attempt < 3) {
            const delayMs = attempt * 1500;
            console.warn(`${reason}; retrying in ${delayMs}ms (${attempt}/3)`);
            console.log(`TAG_UPDATE_MESSAGE=${encodeURIComponent(`${sourceLabel}：${reason}，${delayMs / 1000} 秒后重试（${attempt}/3）…`)}`);
            await wait(delayMs);
          }
        }
      }
      failures.push(`${sourceLabel}：${describeNetworkError(lastError)}`);
    }
    throw new Error(failures.join('\n'));
  } finally {
    await proxyAgent?.close();
  }
}

/**
 * 手动导入：内置下载线路不可用时，用户把词库原址的 tag.sqlite 交给工坊。
 * 文件先复制成本次临时库，后续生成流程与在线更新完全一致；来源校验值留空，
 * 下次检查更新按无条件下载处理，避免把导入文件的上游缓存标记当成最新版本。
 */
async function useImportedDatabase(targetPath) {
  console.log('TAG_UPDATE_PHASE=generating');
  const sourceFile = process.env.NAI_TAG_LOCAL_SOURCE || '';
  const handle = await open(sourceFile, 'r').catch(() => null);
  if (!handle) throw new Error('导入的词库文件读取失败，请重新选择后再试');
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 16, 0);
  } finally {
    await handle.close();
  }
  if (header.toString('latin1') !== 'SQLite format 3\u0000') {
    throw new Error('导入的文件不是有效的 SQLite 词库，请在词库来源下载 tag.sqlite 后重试');
  }
  if ((await stat(sourceFile)).size === 0) throw new Error('导入的词库文件是空的，请重新下载后再试');
  await copyFile(sourceFile, targetPath);
  return { downloadUrl: 'manual-import', validators: {} };
}

async function writeShards(shards, directoryName) {
  const directory = path.join(OUTPUT_DIR, directoryName);
  await mkdir(directory, { recursive: true });
  const shardMap = {};
  const sortedKeys = [...shards.keys()].sort();

  for (let index = 0; index < sortedKeys.length; index++) {
    const key = sortedKeys[index];
    const filename = `${String(index).padStart(4, '0')}.json`;
    shardMap[key] = filename;
    await writeFile(path.join(directory, filename), JSON.stringify(shards.get(key).sort(rankEntries)));
  }

  return shardMap;
}

async function writeArtistPages(entries, directoryName, pageSize = 500) {
  const directory = path.join(OUTPUT_DIR, directoryName);
  await mkdir(directory, { recursive: true });
  const pages = [];

  for (let offset = 0; offset < entries.length; offset += pageSize) {
    const filename = `${String(pages.length).padStart(4, '0')}.json`;
    await writeFile(path.join(directory, filename), JSON.stringify(entries.slice(offset, offset + pageSize)));
    pages.push(filename);
  }

  return { pages, pageSize };
}

async function writeCharacterSearchShards(entries) {
  const directory = path.join(OUTPUT_DIR, 'character-search-shards');
  await mkdir(directory, { recursive: true });
  const shards = Array.from({ length: CHARACTER_SEARCH_SHARD_COUNT }, () => new Map());

  entries.forEach((entry, entryIndex) => {
    const tokens = new Set([
      ...buildCharacterSearchTokens(entry[0]),
      ...buildCharacterSearchTokens(entry[1])
    ]);
    for (const token of tokens) {
      const shard = shards[hashSearchToken(token)];
      const indices = shard.get(token) || [];
      indices.push(entryIndex);
      shard.set(token, indices);
    }
  });

  const filenames = [];
  for (let index = 0; index < shards.length; index++) {
    const filename = `${String(index).padStart(4, '0')}.json`;
    const payload = Object.fromEntries([...shards[index].entries()].sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(path.join(directory, filename), JSON.stringify(payload));
    filenames.push(filename);
  }
  return filenames;
}

async function main() {
  const temporaryDatabase = path.join(tmpdir(), `nai-tag-translation-${process.pid}.sqlite`);
  let database;

  try {
    const sourceMetadata = process.env.NAI_TAG_LOCAL_SOURCE
      ? await useImportedDatabase(temporaryDatabase)
      : await downloadTranslationDatabase(temporaryDatabase);
    if (!sourceMetadata) return;
    console.log('TAG_UPDATE_PHASE=generating');
    database = new DatabaseSync(temporaryDatabase, { readOnly: true });

    const categoryCounts = Object.fromEntries(Object.values(categoryNames).map(name => [name, 0]));
    const deduplicated = new Map();
    const rows = database.prepare(`
      SELECT name, category, cn_name, post_count
      FROM tags
      WHERE name IS NOT NULL
        AND cn_name IS NOT NULL
        AND TRIM(cn_name) <> ''
        AND post_count >= 10
    `).iterate();

    for (const row of rows) {
      const name = normalizeTag(row.name);
      const chinese = normalizeChinese(row.cn_name);
      const category = Number(row.category);
      if (!name || !chinese) continue;
      deduplicated.set(name, [name, chinese, category, Number(row.post_count), 0]);
      const categoryName = categoryNames[category];
      if (categoryName) categoryCounts[categoryName]++;
    }

    const naiConfig = JSON.parse(await readFile(NAI_TAGS_FILE, 'utf8'));
    const specialTags = [...naiConfig.tags];
    for (let year = naiConfig.yearTagRange.start; year <= naiConfig.yearTagRange.end; year++) {
      specialTags.push({ name: `year ${year}`, zh: `${year}年风格` });
    }

    for (const tag of specialTags) {
      const name = normalizeTag(tag.name);
      deduplicated.set(name, [name, normalizeChinese(tag.zh), 6, Number.MAX_SAFE_INTEGER, 1]);
    }
    categoryCounts.novelai = specialTags.length;

    const englishShards = new Map();
    const chineseShards = new Map();
    for (const entry of deduplicated.values()) {
      const englishKey = entry[0].slice(0, 2).padEnd(2, ' ');
      const englishBucket = englishShards.get(englishKey) || [];
      englishBucket.push(entry);
      englishShards.set(englishKey, englishBucket);

      const chineseFirstCharacter = Array.from(entry[1])[0];
      if (chineseFirstCharacter) {
        const chineseKey = (chineseFirstCharacter.codePointAt(0) % 256).toString(16).padStart(2, '0');
        const chineseBucket = chineseShards.get(chineseKey) || [];
        chineseBucket.push(entry);
        chineseShards.set(chineseKey, chineseBucket);
      }
    }

    await rm(STAGING_OUTPUT_DIR, { recursive: true, force: true });
    OUTPUT_DIR = STAGING_OUTPUT_DIR;
    await mkdir(OUTPUT_DIR, { recursive: true });
    const shardMap = await writeShards(englishShards, 'shards');
    const chineseShardMap = await writeShards(chineseShards, 'zh-shards');

    const popularCandidates = new Map();
    for (const [key, entries] of englishShards) {
      const firstCharacter = key[0];
      const candidates = popularCandidates.get(firstCharacter) || [];
      candidates.push(...entries.slice(0, 24));
      popularCandidates.set(firstCharacter, candidates);
    }

    const popular = {};
    for (const [prefix, entries] of popularCandidates) {
      popular[prefix] = entries.sort(rankEntries).slice(0, 24);
    }

    const rankedArtists = [...deduplicated.values()]
      .filter(entry => entry[2] === 1)
      .sort(rankEntries);
    const popularArtists = rankedArtists.slice(0, 1000);
    const artistPagination = await writeArtistPages(rankedArtists, 'artist-pages');
    const artistsByName = [...rankedArtists].sort((a, b) => a[0].localeCompare(b[0], 'en'));
    const artistNamePagination = await writeArtistPages(artistsByName, 'artist-name-pages');

    const rankedCharacters = [...deduplicated.values()]
      .filter(entry => entry[2] === 4)
      .sort(rankEntries);
    const popularCharacters = rankedCharacters.slice(0, 1000);
    const characterPagination = await writeArtistPages(rankedCharacters, 'character-pages');
    const charactersByName = [...rankedCharacters].sort((a, b) => a[0].localeCompare(b[0], 'en'));
    const characterNamePagination = await writeArtistPages(charactersByName, 'character-name-pages');
    const characterSearchShards = await writeCharacterSearchShards(rankedCharacters);
    const characterSearchRecords = 'character-search-records.json';
    await writeFile(
      path.join(OUTPUT_DIR, characterSearchRecords),
      JSON.stringify(rankedCharacters.map(entry => [entry[0], entry[1], entry[3]]))
    );

    const manifest = {
      version: 7,
      generatedAt: new Date().toISOString(),
      sourceDownloadUrl: sourceMetadata.downloadUrl,
      sourceValidators: sourceMetadata.validators,
      sources: {
        translations: TRANSLATION_PROJECT_URL,
        translationDatabase: TRANSLATION_DATABASE_URL,
        novelai: naiConfig.source
      },
      count: deduplicated.size,
      categoryCounts,
      categories: categoryNames,
      shards: shardMap,
      chineseShards: chineseShardMap,
      popular,
      popularArtists,
      artistPageSize: artistPagination.pageSize,
      artistPages: artistPagination.pages,
      artistNamePages: artistNamePagination.pages,
      popularCharacters,
      characterPageSize: characterPagination.pageSize,
      characterPages: characterPagination.pages,
      characterNamePages: characterNamePagination.pages,
      characterSearchShardCount: CHARACTER_SEARCH_SHARD_COUNT,
      characterSearchShards,
      characterSearchRecords
    };

    await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest));
    // manifest 就绪后原子替换：正式目录从这一刻起整体切换为新词库
    await rm(FINAL_OUTPUT_DIR, { recursive: true, force: true });
    await rename(STAGING_OUTPUT_DIR, FINAL_OUTPUT_DIR);
    OUTPUT_DIR = FINAL_OUTPUT_DIR;
    console.log(`Wrote ${manifest.count} bilingual tags across ${englishShards.size} English and ${chineseShards.size} Chinese shards`);
    console.log('TAG_UPDATE_RESULT=updated');
  } finally {
    database?.close();
    await rm(temporaryDatabase, { force: true });
    // 失败路径下清理残留暂存目录（成功路径已被 rename 走，force 保证幂等）
    await rm(STAGING_OUTPUT_DIR, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(error => {
  console.error(`TAG_UPDATE_ERROR=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`);
  console.error(error);
  process.exitCode = 1;
});
