export function extractNovelAiMetadataFromPng(buffer: ArrayBuffer): Promise<string | null>;
export function extractNovelAiStealthMetadataFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<string | null>;
export function extractPngMetadata(bytes: Uint8Array, options?: { validatePixels?: boolean; collectibleOnly?: boolean }): Promise<string | null>;
export function extractImageMetadata(bytes: Uint8Array, options?: { validatePixels?: boolean; collectibleOnly?: boolean }): Promise<string | null>;
export function extractWebpExifPayload(bytes: Uint8Array): Uint8Array | null;
export function hasCollectibleNaiMetadata(raw: string): boolean;
