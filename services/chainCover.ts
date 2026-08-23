export interface ChainCoverDecision {
  source: string | null;
  needsUpload: boolean;
}

/** 保存风格串时，预览区当前可见图片优先于既有封面。 */
export const decideCurrentPreviewCover = (
  displayedPreviewImage: string | null | undefined,
  persistedPreviewImage: string | null | undefined,
  forceUpload = false,
): ChainCoverDecision => {
  const source = displayedPreviewImage || persistedPreviewImage || null;
  return {
    source,
    needsUpload: Boolean(source && (forceUpload || source !== persistedPreviewImage)),
  };
};
