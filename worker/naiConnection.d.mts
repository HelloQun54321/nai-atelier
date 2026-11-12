export function normalizeNaiGatewayUrl(value: unknown): string;
export const NAI_BILLING_PER_USE: 'per-use';
export function normalizeNaiBillingMode(value: unknown): 'per-use' | '';
export function validateNaiApiKey(value: unknown, gatewayUrl?: string): string;
export function resolveNaiGatewayUrl(authorization: string, entries: { key: string; gatewayUrl?: string }[]): string;
