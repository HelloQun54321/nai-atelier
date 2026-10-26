export const VIBE_MODELS: Readonly<Record<string, string>>;
export function vibeBaseModel(model?: string): string;
export function vibeModelKey(model?: string): string | undefined;
export function defaultVibeInformation(model?: string): number;
export function vibeStrength(value: unknown, fallback?: number): number;
export function normalizeReferenceStrengths(values: number[], enabled?: boolean): number[];
export function vibeParameterKey(parameters?: Record<string, unknown> | null): string;
