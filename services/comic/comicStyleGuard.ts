import { isNovelAiStyleTag } from '../promptImport';
import { lookupTagDictionaryEntries, normalizeTagQuery, type TagSuggestion } from '../tagDictionary';
import { parsePromptTags, removePromptTagTokens, type PromptTagToken } from '../tagTranslations';

export type StyleCharacterReason = 'character' | 'copyright' | 'count' | 'appearance' | 'outfit' | 'pose';

export interface StyleCharacterHit {
  token: PromptTagToken;
  lookupTag: string;
  reason: StyleCharacterReason;
  reasonLabel: string;
}

const REASON_LABELS: Record<StyleCharacterReason, string> = {
  character: '角色名',
  copyright: '作品/IP 名',
  count: '人数/主体词',
  appearance: '人物外貌特征',
  outfit: '服饰/配饰',
  pose: '表情/动作/构图主体',
};

/** 明确属于画风/媒介/光影/色调的词，永远不标红，避免误伤小众画风描述。 */
const STYLE_SAFE_PATTERNS = [
  /^(?:artist\s*:|by\s+)/,
  /(?:^|\s)(?:style|lineart|line art|linework|shading|illustration|palette|brushstrokes?|rendering|texture|lighting|backlight|rim light|color|colour|monochrome|greyscale|grayscale|comic|manga|anime|screentone|halftone|aesthetic|quality|contrast|saturation|bokeh|bloom|film grain|chromatic aberration|vignette|depth of field)$/,
  /\((?:medium|style)\)$/,
];

/** 明确的人物数量、角色前缀或 NovelAI 互动语法。 */
const COUNT_PATTERNS = [
  /^\d+\+?(?:girl|girls|boy|boys|other|others|female|male|woman|women|man|men|person|people)$/,
  /^(?:solo|solo focus|couple|multiple girls|multiple boys|multiple others|group|everyone|chibi|no humans|male focus|female focus)$/,
  /^(?:character\s*:|source#|target#|mutual#)/,
];

/** 高置信度人物外貌 / 发型 / 瞳色 / 身体特征。 */
const APPEARANCE_EXACT = new Set([
  'ahoge', 'bangs', 'blunt bangs', 'swept bangs', 'parted bangs', 'sidelocks', 'hair over one eye',
  'ponytail', 'side ponytail', 'high ponytail', 'low ponytail', 'twintails', 'twin braids', 'braid', 'braids',
  'hair bun', 'double bun', 'bob cut', 'hime cut', 'short hair', 'medium hair', 'long hair', 'very long hair', 'absurdly long hair', 'floating hair',
  'freckles', 'blush', 'blushing', 'fang', 'fangs', 'skin fang', 'pointy ears', 'elf', 'animal ears', 'cat ears', 'fox ears', 'wolf ears', 'rabbit ears', 'dog ears',
  'cat girl', 'fox girl', 'kemonomimi', 'tail', 'cat tail', 'fox tail', 'wings', 'angel wings', 'demon wings', 'horns', 'demon horns', 'halo',
  'glasses', 'eyepatch', 'scar', 'tattoo', 'mole', 'mole under eye', 'pale skin', 'dark skin', 'tan', 'tanned',
  'small breasts', 'medium breasts', 'large breasts', 'flat chest', 'cleavage', 'thighs', 'navel', 'midriff', 'collarbone', 'bare shoulders', 'barefoot',
  'heterochromia', 'empty eyes', 'glowing eyes', 'sparkling eyes', 'half-closed eyes', 'closed eyes', 'one eye closed',
]);

const APPEARANCE_SUFFIX = /(?:^|\s)(?:hair|eyes|pupils|eyelashes|eyebrows|ponytail|twintails|braid|braids|ahoge|bangs|sidelocks|ears|tail|wings|horns|breasts|skin)$/;

/** 高置信度服装 / 配饰词。 */
const OUTFIT_EXACT = new Set([
  'school uniform', 'sailor uniform', 'serafuku', 'sailor collar', 'blazer', 'vest', 'cardigan', 'sweater',
  'shirt', 'white shirt', 'collared shirt', 'blouse', 't-shirt', 'hoodie', 'jacket', 'coat', 'trench coat', 'cape', 'cloak',
  'dress', 'sundress', 'wedding dress', 'maid', 'maid headdress', 'maid apron', 'apron', 'kimono', 'yukata', 'hanfu', 'china dress', 'cheongsam',
  'skirt', 'pleated skirt', 'miniskirt', 'long skirt', 'plaid skirt', 'shorts', 'jeans', 'pants', 'trousers',
  'swimsuit', 'school swimsuit', 'one-piece swimsuit', 'bikini', 'lingerie', 'underwear', 'bra', 'panties',
  'thighhighs', 'stockings', 'pantyhose', 'black pantyhose', 'kneehighs', 'socks', 'loose socks', 'boots', 'shoes', 'loafers', 'high heels', 'sandals',
  'hat', 'beret', 'cap', 'witch hat', 'straw hat', 'crown', 'tiara', 'hairband', 'headband', 'hairpin', 'hair ornament', 'hair ribbon', 'hair bow', 'flower in hair',
  'ribbon', 'neck ribbon', 'necktie', 'bowtie', 'scarf', 'choker', 'collar', 'necklace', 'earrings', 'bracelet', 'ring', 'gloves', 'fingerless gloves',
  'armor', 'plate armor', 'bodysuit', 'plugsuit', 'leotard', 'robe', 'suit', 'business suit', 'tuxedo', 'labcoat', 'military uniform',
]);

const OUTFIT_SUFFIX = /(?:^|\s)(?:uniform|dress|skirt|shirt|blouse|sweater|cardigan|hoodie|jacket|coat|swimsuit|bikini|thighhighs|stockings|pantyhose|kneehighs|socks|kimono|yukata|gloves|scarf|ribbon|necktie|bowtie|choker|armor|boots|loafers|heels|hat|beret|hairpin|hairband|headband)$/;

/** 高置信度表情 / 视线 / 动作 / 人物构图词。 */
const POSE_EXACT = new Set([
  'looking at viewer', 'looking away', 'looking back', 'looking up', 'looking down', 'looking to the side', 'looking at another',
  'smile', 'smiling', 'light smile', 'gentle smile', 'grin', 'smirk', 'laughing', 'open mouth', 'closed mouth', 'parted lips', 'pout', 'frown',
  'wink', 'tears', 'crying', 'angry', 'annoyed', 'sad', 'surprised', 'shocked', 'embarrassed', 'shy', 'nervous', 'expressionless', 'serious',
  'standing', 'sitting', 'kneeling', 'lying', 'on back', 'on stomach', 'walking', 'running', 'jumping', 'leaning forward', 'leaning back',
  'arms up', 'arm up', 'hand up', 'hands up', 'hands on hips', 'crossed arms', 'arms behind back', 'hand on own chest', 'hand on own chin',
  'peace sign', 'v', 'pointing', 'waving', 'hugging', 'holding hands', 'holding', 'carrying', 'eating', 'drinking', 'sleeping', 'reading',
  'upper body', 'lower body', 'full body', 'cowboy shot', 'portrait', 'close-up', 'face', 'profile', 'from behind', 'from side', 'from above', 'from below', 'selfie',
]);

const POSE_PREFIX = /^(?:looking |holding |wearing |sitting |standing |lying |leaning |hand on |hands on |arms |from )/;

function classifyCharacterReason(
  tag: string,
  categories?: ReadonlyMap<string, TagSuggestion>,
): StyleCharacterReason | null {
  if (!tag) return null;
  const entry = categories?.get(tag);
  if (entry?.category === 1 || entry?.category === 5) return null;
  if (STYLE_SAFE_PATTERNS.some(pattern => pattern.test(tag))) return null;
  if (isNovelAiStyleTag(tag, categories || new Map())) return null;

  if (entry?.category === 4) return 'character';
  if (entry?.category === 3) return 'copyright';
  if (COUNT_PATTERNS.some(pattern => pattern.test(tag))) return 'count';
  if (APPEARANCE_EXACT.has(tag) || APPEARANCE_SUFFIX.test(tag)) return 'appearance';
  if (OUTFIT_EXACT.has(tag) || OUTFIT_SUFFIX.test(tag)) return 'outfit';
  if (POSE_EXACT.has(tag) || POSE_PREFIX.test(tag)) return 'pose';
  return null;
}

/** 纯本地同步检测：识别混入全局画风提示词中的角色名、作品名、人数与外貌/服饰/动作词。 */
export function detectStyleCharacterTags(
  prompt: string,
  categories?: ReadonlyMap<string, TagSuggestion>,
): StyleCharacterHit[] {
  if (!prompt.trim()) return [];
  const hits: StyleCharacterHit[] = [];
  for (const token of parsePromptTags(prompt)) {
    const normalized = normalizeTagQuery(token.lookupTag);
    const reason = classifyCharacterReason(normalized, categories);
    if (!reason) continue;
    hits.push({
      token,
      lookupTag: token.lookupTag,
      reason,
      reasonLabel: REASON_LABELS[reason],
    });
  }
  return hits;
}

/** 结合本地 Danbooru 词库（category=4 角色、category=3 作品）进行纯本地检测，词库未就绪时无缝降级为内置规则。 */
export async function inspectStyleCharacterTags(prompt: string): Promise<StyleCharacterHit[]> {
  if (!prompt.trim()) return [];
  const tokens = parsePromptTags(prompt);
  let categories: ReadonlyMap<string, TagSuggestion> = new Map();
  try {
    categories = await lookupTagDictionaryEntries(tokens.map(token => token.lookupTag));
  } catch {
    categories = new Map();
  }
  return detectStyleCharacterTags(prompt, categories);
}

/** 转为 TagAutocompleteTextarea 所需的标红映射（lookupTag -> 悬停警示说明）。 */
export function buildStyleWarningTagMap(hits: readonly StyleCharacterHit[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const hit of hits) {
    if (!map.has(hit.lookupTag)) {
      map.set(hit.lookupTag, `疑似${hit.reasonLabel}，建议从全页画风中移除`);
    }
  }
  return map;
}

/** 安全移除所有标红的角色/主体词，保留外层权重组与相邻画风词语法。 */
export function removeFlaggedStyleTags(prompt: string, hits: readonly StyleCharacterHit[]): string {
  if (!hits.length) return prompt;
  return removePromptTagTokens(prompt, hits.map(hit => hit.token));
}
