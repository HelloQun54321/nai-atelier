import type { LocalGenItem } from '../../types';
import { deleteR2File } from './settingsRoutes';
import { error, json, type RouteContext } from './types';

const SETTINGS_KEY = (userId: string) => `prompt_library_cover_template_v1:${userId}`;
const validText = (value: unknown, maximum = 32_000): value is string => typeof value === 'string' && value.length <= maximum;
const validParams = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const params = value as Record<string, unknown>;
  return typeof params.model === 'string' && /^nai-diffusion-(?:4|4-5|5)-/.test(params.model) && !String(params.model).endsWith('-inpainting')
    && Number.isSafeInteger(params.seed) && Number(params.seed) >= 0 && Number(params.seed) <= 4294967295
    && [params.width, params.height].every(item => Number.isSafeInteger(item) && Number(item) >= 64 && Number(item) <= 4096 && Number(item) % 64 === 0)
    && Number.isSafeInteger(params.steps) && Number(params.steps) >= 1 && Number(params.steps) <= 50
    && Number.isFinite(params.scale) && Number(params.scale) >= 0 && Number(params.scale) <= 10
    && typeof params.sampler === 'string' && params.sampler.length < 100;
};

const parseTemplate = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('封面模板无效'), { status: 400 });
  const template = value as { prompt?: unknown; negativePrompt?: unknown; characterPrompt?: unknown; params?: unknown };
  const prompt = template.prompt;
  const character = template.characterPrompt;
  if (!validText(prompt) || !validText(template.negativePrompt) || prompt.split('{content}').length !== 2 || prompt.split('{character}').length > 2 ||
    (character !== undefined && (!validText(character) || /\{(?:content|character)\}/.test(character))) || !validParams(template.params)) {
    throw Object.assign(new Error('公共提示词需要且只能包含一个 {content} 占位符，角色提示词不能包含替换位'), { status: 400 });
  }
  return {
    prompt,
    negativePrompt: template.negativePrompt,
    ...(typeof character === 'string' ? { characterPrompt: character } : {}),
    params: template.params,
  };
};

/** 只有卡片本轮明确标记的新历史才能自动写封面；复用已持久化的同一原图资产。 */
export async function archivePromptLibraryCoverHistory(context: RouteContext, item: LocalGenItem, imageKey: string): Promise<void> {
  if (context.currentUser.role === 'guest' || item.edit || (item.params as { _local_edit?: unknown })._local_edit || !Array.isArray(item.modules)) return;
  const markers = item.modules.filter(module => typeof module?.id === 'string' && module.id.startsWith('prompt-library-cover-target:'));
  if (markers.length !== 1) return;
  const marker = markers[0];
  if (marker.isActive !== false || marker.name !== '提示词库封面') return;
  let target: { chainId?: unknown };
  try { target = JSON.parse(marker.content); } catch { return; }
  const chainId = typeof target?.chainId === 'string' ? target.chainId : '';
  if (!chainId || marker.id !== `prompt-library-cover-target:${chainId}` || item.sourceChainId !== `prompt-library-cover:${chainId}`) return;
  await applyCoverAsset(context, chainId, imageKey);
}

async function applyCoverAsset(context: RouteContext, chainId: string, imageKey: string): Promise<string> {
  const { db, currentUser, env } = context;
  if (!imageKey || /[\\?#\u0000]/.test(imageKey) || imageKey.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Object.assign(new Error('封面原图尚未保存，请重试'), { status: 400 });
  }
  if (!env.BUCKET || !await env.BUCKET.get(imageKey)) throw Object.assign(new Error('封面原图尚未保存，请重试'), { status: 400 });
  const chain = await db.prepare('SELECT id, user_id, preview_image FROM chains WHERE id = ?')
    .bind(chainId).first<{ id: string; user_id: string; preview_image: string | null }>();
  if (!chain || chain.user_id !== currentUser.id) throw Object.assign(new Error('未找到对应的提示词库条目'), { status: 404 });
  const previewImage = `/api/assets/${encodeURIComponent(imageKey)}`;
  if (chain.preview_image === previewImage) return previewImage;
  const now = Date.now();
  await db.prepare('UPDATE chains SET preview_image = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(previewImage, now, chainId, currentUser.id).run();
  if (chain.preview_image && chain.preview_image !== previewImage) {
    try { await deleteR2File(env, chain.preview_image, db); }
    catch (cause) { console.error('提示词库旧封面清理失败，新封面已写入', cause); }
  }
  return previewImage;
}

/** 私人封面模板沿用 settings；成图写回 chains.preview_image，不改库结构。 */
export async function handlePromptLibraryCoverRoute(context: RouteContext): Promise<Response | null> {
  const { path, method, request, db, currentUser } = context;
  if (path !== '/api/prompt-library-cover-data') return null;
  const key = SETTINGS_KEY(currentUser.id);
  if (method === 'GET') {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row?.value) return json({ template: null });
    try { return json({ template: parseTemplate(JSON.parse(row.value)) }); }
    catch { return error('封面模板损坏，请保留资料并检查备份', 500); }
  }
  if (method !== 'POST') return error('Method not allowed', 405);
  if (currentUser.role === 'guest') return error('访客无法保存封面模板', 403);
  const raw = await request.text();
  if (raw.length > 256_000) return error('封面配置过大，请减少参考内容', 413);
  let body: { action?: string; template?: unknown; chainId?: unknown; historyId?: unknown };
  try { body = JSON.parse(raw); } catch { return error('封面配置格式无效', 400); }
  if (body.action === 'template') {
    let template;
    try { template = parseTemplate(body.template); }
    catch (cause) { return error((cause as Error).message || '封面模板无效', (cause as { status?: number }).status || 400); }
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, JSON.stringify(template)).run();
    return json({ success: true });
  }
  if (body.action === 'apply') {
    const chainId = typeof body.chainId === 'string' ? body.chainId : '';
    const historyId = typeof body.historyId === 'string' ? body.historyId : '';
    if (!chainId || !historyId) return error('封面写入目标无效', 400);
    const history = await db.prepare('SELECT image_key, modules, source_chain_id, params FROM local_generation_history WHERE id = ? AND user_id = ?')
      .bind(historyId, currentUser.id).first<{ image_key: string; modules: string; source_chain_id: string | null; params: string }>();
    if (!history?.image_key) return error('未找到对应的生成历史', 404);
    let modules: Array<{ id?: string; name?: string; content?: string; isActive?: boolean }> = [];
    try { modules = JSON.parse(history.modules || '[]'); } catch { return error('历史标记无效', 400); }
    const marker = modules.find(module => module.id === `prompt-library-cover-target:${chainId}`);
    if (!marker || marker.name !== '提示词库封面' || marker.isActive !== false || history.source_chain_id !== `prompt-library-cover:${chainId}`) {
      return error('当前图片与封面目标不一致', 400);
    }
    try {
      let target: { chainId?: unknown };
      try { target = JSON.parse(String(marker.content || '')); } catch { return error('当前图片与封面目标不一致', 400); }
      if (target.chainId !== chainId) return error('当前图片与封面目标不一致', 400);
      let params: { _local_edit?: unknown } = {};
      try { params = JSON.parse(history.params || '{}'); } catch { /* 无编辑标记即可 */ }
      if (params._local_edit) return error('编辑图不能写入封面', 400);
      const previewImage = await applyCoverAsset(context, chainId, history.image_key);
      return json({ previewImage });
    } catch (cause) {
      return error((cause as Error).message || '封面写入失败', (cause as { status?: number }).status || 500);
    }
  }
  return error('不支持的封面操作', 400);
}
