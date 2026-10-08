export type Language = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';
export const LANGUAGES: Array<{ code: Language; name: string; instruction: string }>;
export function normalizeLanguage(value: unknown): Language;
export function translate(language: unknown, message: unknown, values?: readonly unknown[]): string;
export function agentLanguagePolicy(value: unknown): string;
