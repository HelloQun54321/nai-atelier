import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'tag-data');
const NAI_TAGS_FILE = path.join(ROOT, 'data', 'novelai-v45-tags.json');
const TRANSLATION_DATABASE_URL = 'https://raw.githubusercontent.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table/main/tag.sqlite';
const TRANSLATION_PROJECT_URL = 'https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table';
const USER_AGENT = 'NaiPromptManager/0.5.0 (private local tag dictionary updater)';

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

async function downloadTranslationDatabase(targetPath) {
  console.log('Downloading the latest bilingual Danbooru tag database...');
  const response = await fetch(TRANSLATION_DATABASE_URL, {
    cache: 'no-store',
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) throw new Error(`Translation database download failed: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(targetPath, bytes);
  console.log(`Downloaded ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`);
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

async function main() {
  const temporaryDatabase = path.join(tmpdir(), `nai-tag-translation-${process.pid}.sqlite`);
  let database;

  try {
    await downloadTranslationDatabase(temporaryDatabase);
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

    await rm(OUTPUT_DIR, { recursive: true, force: true });
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

    const manifest = {
      version: 2,
      generatedAt: new Date().toISOString(),
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
      popular
    };

    await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest));
    console.log(`Wrote ${manifest.count} bilingual tags across ${englishShards.size} English and ${chineseShards.size} Chinese shards`);
  } finally {
    database?.close();
    await rm(temporaryDatabase, { force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
