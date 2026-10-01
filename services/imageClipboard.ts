const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 只读取用户主动粘贴的图片，不解析普通文本或图片链接。 */
export const getPastedImageFile = (data: DataTransfer): File | null => {
  const files = Array.from(data.files || []);
  const image = files.find(file => file.type.startsWith('image/') || /\.(?:png|jpe?g|webp)$/i.test(file.name));
  if (image) return image;
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
};

/** 提示词、数字输入和可编辑文字继续使用浏览器原本的粘贴行为。 */
export const isTextPasteTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea')) return true;
  const editable = target.closest('[contenteditable]');
  return Boolean(editable && editable.getAttribute('contenteditable') !== 'false');
};

export const readClipboardImage = async ({ pasteHint = '在编辑区按 Ctrl+V', imagePurpose = '底图' }: { pasteHint?: string; imagePurpose?: string } = {}): Promise<File> => {
  if (window.isSecureContext === false || !navigator.clipboard?.read) {
    throw new Error(`当前浏览器无法直接读取剪贴板图片，请${pasteHint}，或使用 localhost／HTTPS 打开`);
  }
  let items: ClipboardItem[];
  try {
    // 在点击事件内立即发起读取，保留浏览器的用户操作授权。
    items = await navigator.clipboard.read();
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new Error(`剪贴板读取未获允许，请允许浏览器访问，或${pasteHint}`);
    }
    throw new Error(`剪贴板读取失败，请重新复制图片后粘贴，或${pasteHint}`);
  }
  for (const item of items) {
    const type = IMAGE_TYPES.find(type => item.types.includes(type));
    if (type) {
      const blob = await item.getType(type);
      return new File([blob], `clipboard.${extensions[type]}`, { type });
    }
  }
  if (items.some(item => item.types.some(type => type.startsWith('image/')))) {
    throw new Error(`请粘贴 PNG、JPEG 或 WebP 图片作为${imagePurpose}`);
  }
  throw new Error(`剪贴板中没有图片，请先使用「复制图片」；复制链接或文字不能作为${imagePurpose}`);
};
