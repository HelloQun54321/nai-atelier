import { VibeAsset, VibeSelection } from '../types';
import { normalizeReferenceStrengths, vibeParameterKey, vibeStrength } from './vibeProtocol.mjs';

export const VIBE_MAX_SLOTS = 16;

/** 只跨模型复用参数相同的现有编码；未知参数和缺失项交由用户选择。 */
export const resolveVibeSlots = (slots: VibeSelection[], assets: VibeAsset[], model: string): VibeSelection[] => slots.map(slot => {
  const asset = assets.find(item => item.id === slot.vibeId);
  const current = asset?.encodings.find(item => item.id === slot.encodingId);
  if (current?.model === model || current?.informationKnown === false || slot.informationKnown === false) return slot;
  const parameters = current?.parameters || { information_extracted: slot.informationExtracted };
  const matching = asset?.encodings.find(item => item.model === model && item.informationKnown !== false && item.informationExtracted === slot.informationExtracted
    && vibeParameterKey(item.parameters || { information_extracted: item.informationExtracted }) === vibeParameterKey(parameters));
  return matching ? { ...slot, encodingId: matching.id, informationKnown: matching.informationKnown } : slot;
});

export const normalizeVibeSelections = (slots: VibeSelection[], enabled = true): VibeSelection[] => {
  const clean = slots.slice(0, VIBE_MAX_SLOTS).map(slot => ({
    ...slot,
    strength: vibeStrength(slot.strength, 0),
  }));
  const strengths = normalizeReferenceStrengths(clean.map(slot => slot.strength), enabled);
  return clean.map((slot, index) => ({
    ...slot,
    effectiveStrength: strengths[index],
  }));
};
