export interface ChainCoverDecision {
  source: string | null;
  needsUpload: boolean;
}

/**
 * 决定风格串保存时的封面策略：
 * 1. 既有已有封面（persistedPreviewImage）时，右上角常规保存必须保持原有封面不变，不自动覆盖；
 * 2. 仅当既有无封面（!persistedPreviewImage）且当前有可见图片（displayedPreviewImage）时，才自动将其设为初始封面并上传；
 * 3. 若 forceUpload 为 true（例如复制为新串 Fork 时），则强制将当前可见图片作为新串的独立封面。
 */
export const decideCurrentPreviewCover = (
  displayedPreviewImage: string | null | undefined,
  persistedPreviewImage: string | null | undefined,
  forceUpload = false,
): ChainCoverDecision => {
  if (forceUpload) {
    const source = displayedPreviewImage || persistedPreviewImage || null;
    return {
      source,
      needsUpload: Boolean(source),
    };
  }

  // 若已有持久化封面，常规保存时不自动替换已有封面
  if (persistedPreviewImage) {
    return {
      source: persistedPreviewImage,
      needsUpload: false,
    };
  }

  // 仅在未设置封面时，自动将当前可见图片设为初始封面
  const source = displayedPreviewImage || null;
  return {
    source,
    needsUpload: Boolean(source),
  };
};
