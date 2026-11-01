import { api } from './api';
import { validatePromptLibraryCoverTemplate, type PromptLibraryCoverTemplate } from './promptLibraryCoverTemplate';

export async function getPromptLibraryCoverTemplate(): Promise<PromptLibraryCoverTemplate | null> {
  const data = await api.get('/prompt-library-cover-data') as { template: PromptLibraryCoverTemplate | null };
  return data.template || null;
}

export async function savePromptLibraryCoverTemplate(template: PromptLibraryCoverTemplate): Promise<void> {
  validatePromptLibraryCoverTemplate(template);
  await api.post('/prompt-library-cover-data', { action: 'template', template });
}

/** 保存失败时只重试写封面，不再次投递收费任务。 */
export async function applyPromptLibraryCoverFromHistory(chainId: string, historyId: string): Promise<string> {
  const data = await api.post('/prompt-library-cover-data', { action: 'apply', chainId, historyId }) as { previewImage: string };
  if (!data?.previewImage) throw new Error('图片已保存到历史，但封面写入失败，请重试');
  return data.previewImage;
}
