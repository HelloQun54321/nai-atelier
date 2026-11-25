import type { CharacterReferenceSelection } from '../types';

export interface PreciseReferenceBucketGeometry {
  width: number;
  height: number;
  resizeWidth: number;
  resizeHeight: number;
  left: number;
  top: number;
  unchanged: boolean;
}

export interface PreciseReferenceModelCapabilityLike {
  supportsCharacterReferences?: boolean;
  supportsCharacterReferenceInpainting?: boolean;
  supportsOutfitReferences?: boolean;
}

export declare const PRECISE_REFERENCE_BUCKETS: ReadonlyArray<readonly [number, number]>;
export declare function selectPreciseReferenceBucket(width: number, height: number): PreciseReferenceBucketGeometry;
export declare function isPreferSameOutfitEnabled(slot?: Pick<CharacterReferenceSelection, 'type' | 'preferSameOutfit'> | null): boolean;
export declare function filterEffectiveCharacterReferences<T extends { type?: string }>(
  slots: readonly T[] | null | undefined,
  capability: PreciseReferenceModelCapabilityLike | null | undefined,
  isInpaint?: boolean,
): T[];
export declare function resolvePreciseReferenceCaption(
  slot: Pick<CharacterReferenceSelection, 'type' | 'preferSameOutfit'> | null | undefined,
  supportsOutfitReferences?: boolean,
): string | null;
