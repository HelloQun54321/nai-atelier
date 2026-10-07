export interface NaiBillingRules {
  minimumCost: number;
  freeSamples: number;
  freeImageToImage: boolean;
  freeInpainting: boolean;
  freeWithCharacterReference: boolean;
  modelMultipliers: Record<string, number>;
  smeaMultiplier: number;
  smeaDynamicMultiplier: number;
  freeVibeCount: number;
  extraVibeCost: number;
  characterReferenceCost: number;
  vibeEncodingCost: number;
}
export const DEFAULT_NAI_BILLING: NaiBillingRules;
export function isNaiBillingRules(value: unknown): value is NaiBillingRules;
export function estimateNaiBilling(parameters: {
  width: number; height: number; steps: number; samples?: number; strength?: number;
  image?: boolean; mask?: boolean; referenceCount?: number; vibeCount?: number;
  sm?: boolean; sm_dyn?: boolean;
}, model: string, runtime: {
  billing: NaiBillingRules; costCoefficientArea: number; costCoefficientSteps: number;
  freeMaxArea: number; freeMaxSteps: number; usageLimitedModels: string[];
}, opus?: boolean, usageExhausted?: boolean): { cost: number; opusImages: number };
