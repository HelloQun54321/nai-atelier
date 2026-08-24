import { VibeSelection } from '../types';

export const VIBE_MAX_SLOTS = 16;

export const normalizeVibeSelections = (slots: VibeSelection[], enabled = true): VibeSelection[] => {
  const clean = slots.slice(0, VIBE_MAX_SLOTS).map(slot => ({
    ...slot,
    strength: Math.max(0, Math.min(1, Number(slot.strength) || 0)),
  }));
  const total = clean.reduce((sum, slot) => sum + slot.strength, 0);
  const factor = enabled && total > 1 ? 1 / total : 1;
  return clean.map(slot => ({
    ...slot,
    effectiveStrength: Math.round(slot.strength * factor * 10000) / 10000,
  }));
};
