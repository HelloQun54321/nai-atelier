import { describe, expect, it } from 'vitest';
import { VIBE_MAX_SLOTS, normalizeVibeSelections } from './vibeUtils';

describe('Vibe selection limits', () => {
  it('keeps the official sixteen-slot limit and preserves extra-cost slots', () => {
    const slots = Array.from({ length: 17 }, (_, index) => ({
      vibeId: `v${index}`,
      encodingId: `e${index}`,
      informationExtracted: 1,
      strength: 0.1,
    }));
    expect(VIBE_MAX_SLOTS).toBe(16);
    expect(normalizeVibeSelections(slots)).toHaveLength(16);
    expect(normalizeVibeSelections(slots)[15].vibeId).toBe('v15');
  });
});
