import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'public', 'tag-data');
const NAI_TAGS_FILE = path.join(ROOT, 'data', 'novelai-v45-tags.json');
const API_URL = 'https://danbooru.donmai.us/tags.json';
const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const CATEGORY_IDS = [0, 1, 3, 4, 5];
const USER_AGENT = 'NaiPromptManager/0.5.0 (local tag dictionary updater)';

const categoryNames = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  6: 'novelai'
};

const normalizeTag = (name) => name
  .replaceAll('_', ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(category, page, attempt = 1) {
  const url = new URL(API_URL);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('search[category]', String(category));
  url.searchParams.set('search[order]', 'count');

  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 6) throw error;
    const waitMs = Math.min(1000 * (2 ** (attempt - 1)), 15000);
    console.warn(`[Danbooru] category ${category}, page ${page} failed; retrying in ${waitMs}ms`);
    await sleep(waitMs);
    return fetchPage(category, page, attempt + 1);
  }
}

async function fetchCategory(category) {
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await fetchPage(category, page);
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      if (row.is_deprecated || Number(row.post_count) <= 0 || !row.name) continue;
      collected.push([
        normalizeTag(String(row.name)),
        category,
        Number(row.post_count),
        0
      ]);
    }

    if (page % 20 === 0) {
      console.log(`[Danbooru] ${categoryNames[category]}: ${page * PAGE_SIZE} scanned, ${collected.length} kept`);
    }

    if (rows.length < PAGE_SIZE || Number(rows.at(-1)?.post_count || 0) <= 0) break;
  }

  console.log(`[Danbooru] ${categoryNames[category]} complete: ${collected.length} active tags`);
  return collected;
}

const rankEntries = (a, b) => b[3] - a[3] || b[2] - a[2] || a[0].localeCompare(b[0]);

async function main() {
  console.log('Downloading the latest active Danbooru tags from the official API...');
  const byCategory = await Promise.all(CATEGORY_IDS.map(fetchCategory));
  const allEntries = byCategory.flat();

  const naiConfig = JSON.parse(await readFile(NAI_TAGS_FILE, 'utf8'));
  const specialTags = [...naiConfig.tags];
  for (let year = naiConfig.yearTagRange.start; year <= naiConfig.yearTagRange.end; year++) {
    specialTags.push(`year ${year}`);
  }

  const deduplicated = new Map();
  for (const entry of allEntries) deduplicated.set(entry[0], entry);
  for (const tag of specialTags) {
    const normalized = normalizeTag(tag);
    deduplicated.set(normalized, [normalized, 6, Number.MAX_SAFE_INTEGER, 1]);
  }

  const shards = new Map();
  for (const entry of deduplicated.values()) {
    const key = entry[0].slice(0, 2).padEnd(2, ' ');
    const bucket = shards.get(key) || [];
    bucket.push(entry);
    shards.set(key, bucket);
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUTPUT_DIR, 'shards'), { recursive: true });

  const shardMap = {};
  const popularCandidates = new Map();
  const sortedKeys = [...shards.keys()].sort();
  for (let index = 0; index < sortedKeys.length; index++) {
    const key = sortedKeys[index];
    const entries = shards.get(key).sort(rankEntries);
    const filename = `${String(index).padStart(4, '0')}.json`;
    shardMap[key] = filename;
    await writeFile(path.join(OUTPUT_DIR, 'shards', filename), JSON.stringify(entries));

    const firstCharacter = key[0];
    const candidates = popularCandidates.get(firstCharacter) || [];
    candidates.push(...entries.slice(0, 24));
    popularCandidates.set(firstCharacter, candidates);
  }

  const popular = {};
  for (const [prefix, entries] of popularCandidates) {
    popular[prefix] = entries.sort(rankEntries).slice(0, 24);
  }

  const categoryCounts = Object.fromEntries(CATEGORY_IDS.map(category => [
    categoryNames[category],
    byCategory[CATEGORY_IDS.indexOf(category)].length
  ]));
  categoryCounts.novelai = specialTags.length;

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      danbooru: API_URL,
      novelai: naiConfig.source
    },
    count: deduplicated.size,
    categoryCounts,
    categories: categoryNames,
    shards: shardMap,
    popular
  };

  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest));
  console.log(`Wrote ${manifest.count} tags across ${sortedKeys.length} shards to ${OUTPUT_DIR}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
