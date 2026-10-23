import type { PromptChain } from '../types';
import { compilePrompt, getEditableGlobalNegative } from './promptUtils';
import { normalizeRollArtistKey } from './styleRollSeed';

// shortcut: 无画师配方只识别常见媒介／渲染词，确认漏识别样本后再扩词。
const STYLE_TAGS = new Set([
  'watercolor', 'watercolor painting', 'oil painting', 'gouache', 'pastel', 'charcoal',
  'pencil', 'sketch', 'lineart', 'line art', 'ink', 'pixel art', '3d', 'cgi',
  'photorealistic', 'realistic', 'anime', 'manga', 'cel shading', 'soft shading',
  'flat color', 'flat colors', 'impasto', 'chiaroscuro', 'monochrome', 'greyscale',
  'traditional media', 'digital media', 'thick outlines', 'thin lines', 'painterly',
  'no lineart', 'clean lineart', 'thick lineart', 'clean and sharp line art',
  'anime coloring', 'anime style', 'anime screenshot', 'anime style illustration',
  'anime pallet', 'official style', 'official art', 'key visual', 'digital illustration',
  'digital art', 'illustration', 'smooth shading', 'complex shading', 'clean rendering',
  'semi-realistic', 'semi-realistic illustration', 'cinematic illustration', '2d',
  'abstract', 'surreal', 'art nouveau', 'impressionism', 'ligne claire', 'nihonga', 'ukiyo-e',
  'retro artstyle', 'faux traditional media', 'jaggy lines', 'outline', 'vector trace',
  'color trace', 'game cg', 'shikishi', 'oekaki', 'tegaki',
  'low complexity', 'medium complexity', 'high complexity', 'ultra complexity',
]);
const GENERIC_STYLE_TAGS = new Set([
  'anime', 'anime style', 'anime coloring', 'anime screenshot', 'anime style illustration',
  'anime pallet', 'official style', 'official art', 'key visual', 'digital illustration',
  'digital art', 'illustration', 'realistic', 'semi-realistic', 'photorealistic',
  'semi-realistic illustration', 'cinematic illustration', '2d', '3d', 'cgi', 'manga',
]);
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';

export interface ChainPromptToken {
  key: string;
  text: string;
  raw: string;
  weight: string;
  uncertainWeight?: boolean;
}

/** 比较副本按官方权重流分词；独立 :: 重置所有权重，数值范围可延续至末尾。 */
export function parseChainPromptTokens(value: string): ChainPromptToken[] {
  const text = value.replace(/<\/?(?:artist|style)>/gi, '\n');
  const tokens: ChainPromptToken[] = [];
  const closing: Record<string, string> = { '{': '}', '[': ']', '}': '{', ']': '[' };
  const parentStack: { position: number; closing: string }[] = [], pairedParents = new Set<number>();
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '(' || text[index] === '（') parentStack.push({ position: index, closing: text[index] === '(' ? ')' : '）' });
    else if (text[index] === parentStack.at(-1)?.closing) {
      pairedParents.add(parentStack.pop()!.position); pairedParents.add(index);
    }
  }
  let current = '', parentheses = 0, artistDepth = -1;
  let path: string[] = [];
  const wrap = (content: string, weights: string[]) => weights.reduceRight((raw, weight) =>
    weight.endsWith('::') ? `${weight}${raw}::` : `${weight}${raw}${closing[weight]}`, content);
  const flush = () => {
    let content = current.trim(); current = '';
    if (!content) return;
    const original = content;
    const weights = [...path];
    const parentWeight = content.match(new RegExp(`^\\(([\\s\\S]+):\\s*(${NUMBER})\\)$`));
    const parentArtist = /^\(artists?\s*:[\s\S]*\)$/i.test(content);
    if (parentWeight) { content = parentWeight[1]; weights.push(`${parentWeight[2]}::`); }
    else if (parentArtist) content = content.slice(1, -1);
    if (artistDepth >= 0 && !/^artists?\s*:/i.test(content)) content = `artist:${content}`;
    const byWeight = /^(?:by[\s:]+|@)/i.test(content) ? content.match(new RegExp(`^([\\s\\S]+):\\s*(${NUMBER})$`)) : null;
    const comparisonPath = byWeight ? [...weights, `${byWeight[2]}::`] : weights;
    tokens.push({ key: normalizeRollArtistKey(byWeight ? byWeight[1] : content), text: byWeight ? byWeight[1] : content,
      raw: wrap(artistDepth >= 0 ? content : original, path),
      weight: JSON.stringify(comparisonPath.map(weight => weight.endsWith('::') ? `${Number(weight.slice(0, -2))}::` : weight)),
      ...(parentWeight || parentArtist || byWeight || comparisonPath.some(weight => weight.endsWith('::') && !Number.isFinite(Number(weight.slice(0, -2))))
        ? { uncertainWeight: true } : {}) });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) { current += char + text[++index]; continue; }
    if ((char === '(' || char === '（') && pairedParents.has(index)) parentheses++;
    if (!parentheses && char === ':' && text[index + 1] === ':') {
      const prefix = current.match(new RegExp(`(?:^|\\s)(${NUMBER})\\s*$`));
      if (prefix) current = current.slice(0, current.length - prefix[0].length);
      flush();
      // 新数值替换旧数值范围；无数值的 :: 同时取消花／方括号的累计倍率。
      path = prefix ? [...path.filter(weight => !weight.endsWith('::')), `${prefix[1]}::`] : [];
      if (!prefix) artistDepth = -1;
      index++; continue;
    }
    if (!parentheses && '{}[]'.includes(char)) {
      if ((char === '{' || char === '[') && /^\s*artists?\s*:\s*$/i.test(current)) {
        current = ''; artistDepth = path.length + 1;
      } else flush();
      if (path.at(-1) === closing[char]) path.pop(); else path.push(char);
      if (artistDepth > path.length) artistDepth = -1;
      continue;
    }
    if (!parentheses && /[,，;\r\n|]/.test(char)) { flush(); continue; }
    current += char;
    if ((char === ')' || char === '）') && pairedParents.has(index)) parentheses--;
  }
  flush();
  return tokens;
}

export interface ChainStyleFeature {
  key: string;
  raw: string;
  weight: string;
  artist: boolean;
  positive: boolean;
  effectiveWeight: number | null;
}

export interface ChainStyleProfile {
  chain: PromptChain;
  prompt: string;
  features: ChainStyleFeature[];
  other: string[];
  keys: Set<string>;
  signature: string;
  reliable: boolean;
  uncertainWeights: boolean;
  artistWeights: Map<string, number[]> | null;
  weights: Map<string, number[]> | null;
}

export interface ChainSimilarityGroup {
  members: ChainStyleProfile[];
  similarity: number;
}

export interface ChainSimilarityResult {
  groups: ChainSimilarityGroup[];
  insufficient: ChainStyleProfile[];
  total: number;
  matched: number;
}

const isSpecificStyle = (key: string) => !GENERIC_STYLE_TAGS.has(key)
  && !/^(?:year \d{4}|(?:low|medium|high|ultra) complexity)$/.test(key);

export const getChainPromptTokenWeight = (token: ChainPromptToken): number | null => {
  if (token.uncertainWeight) return null;
  let weight = 1;
  for (const part of JSON.parse(token.weight) as string[]) {
    // 官方编辑器的数值 :: 覆盖当前倍率，不能再乘上此前括号的倍率。
    if (part.endsWith('::')) weight = Number(part.slice(0, -2));
    else if (part === '{' || part === ']') weight *= 1.05;
    else if (part === '}' || part === '[') weight /= 1.05;
    else return null;
  }
  return Number.isFinite(weight) ? weight : null;
};

/** 同词、同方向逐次配对，不把重复词求和冒充模型的线性叠加。 */
const featureWeights = (features: ChainStyleFeature[]): Map<string, number[]> | null => {
  const result = new Map<string, number[]>();
  for (const feature of features) {
    const weight = feature.effectiveWeight;
    if (weight === null) return null;
    if (weight === 0) continue;
    const key = `${feature.key}:${weight > 0 ? '+' : '-'}`;
    const entries = result.get(key) || []; entries.push(Math.abs(weight)); result.set(key, entries);
  }
  result.forEach(entries => entries.sort((left, right) => right - left));
  return result;
};

/** 比较副本保留完整权重路径与重复词；未知语法留在差异区，不改写原串。 */
export function describeChainStyle(chain: PromptChain, knownArtists: ReadonlySet<string>): ChainStyleProfile {
  const prompt = compilePrompt(chain, chain.variableValues?.subject || '');
  const features: ChainStyleFeature[] = [], other: string[] = [];
  const tokens = parseChainPromptTokens(prompt);
  for (const token of tokens) {
    const name = token.key.replace(/^(?:artists?\s*:\s*|artists?\s+|by[\s:]+|@)/i, '');
    const artist = !/[:,，\r\n|<>\[\]{}]/.test(name) && Boolean(name)
      && (/^artists?\s*:/i.test(token.key) || knownArtists.has(name));
    const key = artist ? name : token.key;
    if (artist || STYLE_TAGS.has(key) || /\S\s*\(style\)$/.test(key) || /^year \d{4}$/.test(key)) {
      const effectiveWeight = getChainPromptTokenWeight(token);
      features.push({ key: (artist ? 'artist:' : 'style:') + key, raw: token.raw, artist, weight: token.weight,
        effectiveWeight,
        positive: effectiveWeight !== null ? effectiveWeight > 0
          : (JSON.parse(token.weight) as string[]).every(weight => !weight.endsWith('::') || Number.isFinite(Number(weight.slice(0, -2))) && Number(weight.slice(0, -2)) > 0) });
    } else other.push(token.raw);
  }
  const artists = features.filter(feature => feature.artist && feature.positive);
  const specificStyles = features.filter(feature => !feature.artist && isSpecificStyle(feature.key.slice(6)));
  const distinctive = specificStyles.filter(feature => feature.positive);
  const keys = new Set((artists.length ? artists : distinctive).map(feature => feature.key));
  const artistWeights = featureWeights(features.filter(feature => feature.artist));
  const weights = featureWeights(features);
  return { chain, prompt, features, other, keys, reliable: (artists.length > 0 || keys.size >= 2) && artistWeights !== null && weights !== null,
    uncertainWeights: tokens.some(token => token.uncertainWeight) || features.some(feature => feature.effectiveWeight === null),
    artistWeights, weights,
    signature: JSON.stringify(features.map(feature => [feature.key, feature.effectiveWeight === null
      ? feature.weight : Number(feature.effectiveWeight.toPrecision(12))]).sort()) };
}

const weightedOverlap = (left: Map<string, number[]> | null, right: Map<string, number[]> | null) => {
  if (!left || !right) return 0;
  let common = 0, total = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) || [], b = right.get(key) || [];
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      common += Math.min(a[index] || 0, b[index] || 0);
      total += Math.max(a[index] || 0, b[index] || 0);
    }
  }
  return total ? common / total : 1;
};

const overlap = (left: ChainStyleProfile, right: ChainStyleProfile) => {
  const hasArtists = left.features.some(feature => feature.artist && feature.positive);
  if (!left.reliable || !right.reliable || hasArtists !== right.features.some(feature => feature.artist && feature.positive)) return 0;
  if (!left.uncertainWeights && !right.uncertainWeights && left.signature === right.signature) return 1;
  const common = [...left.keys].filter(key => right.keys.has(key)).length;
  const ratio = common / (left.keys.size + right.keys.size - common);
  const threshold = hasArtists ? 0.75 : 0.9;
  if (ratio < threshold || !hasArtists && common < 2) return 0;
  const weighted = Math.min(hasArtists ? weightedOverlap(left.artistWeights, right.artistWeights) : 1, weightedOverlap(left.weights, right.weights));
  return weighted + 1e-12 >= threshold ? Math.max(threshold, weighted) : 0;
};

/** 组分数采用最不相似的一对，删除成员后的局部更新沿用扫描评分。 */
export function getChainGroupSimilarity(members: ChainStyleProfile[]): number {
  if (members.length < 2) return 0;
  let similarity = 1;
  for (let left = 0; left < members.length; left++) for (let right = left + 1; right < members.length; right++) {
    similarity = Math.min(similarity, overlap(members[left], members[right]));
  }
  return similarity;
}

/** 用画师／媒介索引找候选，组内逐项核对，避免 A≈B≈C 被连锁当成 A≈C。 */
export async function findSimilarChains(
  chains: PromptChain[], knownArtists: ReadonlySet<string>, signal: AbortSignal,
  onProgress: (stage: 'extract' | 'group', completed: number, total: number) => void = () => {},
): Promise<ChainSimilarityResult> {
  const source = chains.filter(chain => chain.type === 'style' || !chain.type);
  const profiles: ChainStyleProfile[] = [], index = new Map<string, number[]>();
  let lastYield = performance.now();
  const pause = async (force = false) => {
    signal.throwIfAborted();
    if (!force && performance.now() - lastYield < 12) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    lastYield = performance.now(); signal.throwIfAborted();
  };
  signal.throwIfAborted();
  for (const [position, chain] of source.entries()) {
    const profile = describeChainStyle(chain, knownArtists);
    profiles.push(profile);
    if (profile.reliable) for (const key of profile.keys) {
      const entries = index.get(key) || []; entries.push(position); index.set(key, entries);
    }
    if (position % 40 === 0) { onProgress('extract', position + 1, source.length); await pause(position === 0); }
  }
  const groups: ChainSimilarityGroup[] = [], matched = new Set<string>();
  const neighbors = profiles.map(() => new Map<number, number>()), pending = profiles.map(() => new Set<number>());
  let comparisons = 0;
  for (const [position, anchor] of profiles.entries()) {
    const candidates = new Set([...anchor.keys].flatMap(key => index.get(key) || []));
    for (const candidate of candidates) {
      if (candidate <= position) continue;
      const similarity = overlap(anchor, profiles[candidate]);
      if (similarity >= 0.75) {
        neighbors[position].set(candidate, similarity); neighbors[candidate].set(position, similarity);
        pending[position].add(candidate); pending[candidate].add(position);
      }
      if (++comparisons % 1000 === 0) await pause();
    }
    if (position % 40 === 0) { onProgress('group', position + 1, source.length); await pause(position === 0); }
  }
  for (const [position, anchor] of profiles.entries()) {
    if (!pending[position].size) continue;
    const ranked = [...neighbors[position].keys()].sort((left, right) =>
      Number(profiles[right].chain.params?.model === anchor.chain.params?.model) - Number(profiles[left].chain.params?.model === anchor.chain.params?.model)
      || neighbors[position].get(right)! - neighbors[position].get(left)!);
    while (pending[position].size) {
      const seed = ranked.find(candidate => pending[position].has(candidate))!;
      const members = [position, seed];
      for (const candidate of ranked) {
        if (candidate !== seed && members.every(member => neighbors[member].has(candidate))) members.push(candidate);
        if (++comparisons % 1000 === 0) await pause();
      }
      // 逐条消除已展示的相似边，保留桥接候选；每组仍须两两相似。
      let similarity = 1;
      for (let left = 0; left < members.length; left++) for (let right = left + 1; right < members.length; right++) {
        similarity = Math.min(similarity, neighbors[members[left]].get(members[right])!);
        pending[members[left]].delete(members[right]); pending[members[right]].delete(members[left]);
        if (++comparisons % 1000 === 0) await pause();
      }
      groups.push({ members: members.map(member => profiles[member]), similarity });
      members.forEach(member => matched.add(profiles[member].chain.id));
    }
    await pause();
  }
  groups.sort((left, right) => right.similarity - left.similarity);
  signal.throwIfAborted();
  return { groups, insufficient: profiles.filter(profile => !profile.reliable), total: source.length, matched: matched.size };
}

const stableValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? '';
};
const displayValue = (value: unknown) => value == null || value === '' ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const chainComparisonValues = (chain: PromptChain): [string, unknown][] => [
  ['负面提示词', getEditableGlobalNegative(chain.negativePrompt, chain.params?._promptSections)],
  ['角色配置', chain.params?.characters?.map(({ id: _id, sectionMeta: _meta, ...character }) => character) || []],
  ['Vibe', chain.params?.vibes],
  ['角色／风格参考', chain.params?.characterReferences],
  ['生成参数', Object.fromEntries(Object.entries(chain.params || {}).filter(([key]) => !['characters', 'vibes', 'characterReferences', '_promptSections'].includes(key) && !key.startsWith('_')))],
];

/** 多列对照与两串差异共用同一份字段语义，不展示内部身份及来源快照。 */
export const getChainComparisonDetails = (chain: PromptChain): { label: string; value: string }[] =>
  chainComparisonValues(chain).map(([label, value]) => ({ label, value: displayValue(value) }));

export function compareChainStyles(left: ChainStyleProfile, right: ChainStyleProfile) {
  const common: string[] = [], leftOnly: string[] = [], rightOnly: string[] = [];
  const remaining = [...right.features];
  for (const feature of left.features) {
    const hit = remaining.findIndex(other => other.key === feature.key && (feature.effectiveWeight !== null && other.effectiveWeight !== null
      ? Math.abs(other.effectiveWeight - feature.effectiveWeight) <= 1e-12 * Math.max(1, Math.abs(feature.effectiveWeight), Math.abs(other.effectiveWeight))
      : other.weight === feature.weight));
    if (hit >= 0) { common.push(feature.raw); remaining.splice(hit, 1); } else leftOnly.push(feature.raw);
  }
  rightOnly.push(...remaining.map(feature => feature.raw));
  const differences: { label: string; left: string; right: string }[] = [];
  const add = (label: string, a: unknown, b: unknown) => {
    if (stableValue(a) !== stableValue(b)) differences.push({ label, left: displayValue(a), right: displayValue(b) });
  };
  const rightDetails = chainComparisonValues(right.chain);
  chainComparisonValues(left.chain).forEach(([label, value], index) => add(label, value, rightDetails[index][1]));
  const modelKnown = Boolean(left.chain.params?.model && right.chain.params?.model);
  const sameModel = modelKnown && left.chain.params.model === right.chain.params.model;
  const uncertainWeights = left.uncertainWeights || right.uncertainWeights;
  return { common, leftOnly, rightOnly, differences, uncertainWeights, sameStyle: !uncertainWeights && left.signature === right.signature,
    sharedArtists: [...left.keys].filter(key => key.startsWith('artist:') && right.keys.has(key)).length,
    modelKnown, sameModel };
}
