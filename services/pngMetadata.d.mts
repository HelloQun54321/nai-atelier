export function extractNovelAiMetadataFromPng(buffer: ArrayBuffer): Promise<string | null>;
export function extractNovelAiStealthMetadataFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<string | null>;
export function extractPngMetadata(bytes: Uint8Array, options?: { validatePixels?: boolean; collectibleOnly?: boolean }): Promise<string | null>;
export function hasCollectibleNaiMetadata(raw: string): boolean;
