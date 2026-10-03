export const TRANSPARENT_WEIGHT_MIN: number;
export const TRANSPARENT_WEIGHT_MAX: number;
export const TRANSPARENT_WEIGHT_STEP: number;
export const TRANSPARENT_WEIGHT_DEFAULT: number;
export function normalizeTransparentWeight(value: unknown): number;
export function resolveTransparentWeight(value: unknown, prompt?: string): number;
export function splitNaiTextPrompt(prompt: string): { description: string; text: string };
export function joinNaiTextPrompt(description: string, text: string): string;
export function withTransparentPromptTags(prompt: string, value?: unknown): string;
