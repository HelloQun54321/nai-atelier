import { expect, it, vi } from 'vitest';
import { handleSettingsRoute } from '../../../worker/routes/settingsRoutes';
import type { RouteContext } from '../../../worker/routes/types';
it('主动图片上传接收 37.6MiB 原图，超过 64MiB 拒绝且不写存储', async () => {
  const put = vi.fn(async () => {});
  const file = new File([new Uint8Array(39_460_518)], 'pixiv.jpg', { type: 'image/jpeg' });
  const route = async (size: number) => {
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    const form = new FormData(); form.set('file', file);
    const request = new Request('http://localhost/api/upload', { method: 'POST' });
    vi.spyOn(request, 'formData').mockResolvedValue(form);
    return handleSettingsRoute({ request, path: '/api/upload', method: 'POST', url: new URL(request.url), env: { BUCKET: { put } }, currentUser: { id: 'synthetic', role: 'admin' } } as unknown as RouteContext);
  };
  expect((await route(39_460_518))?.status).toBe(200);
  expect(put).toHaveBeenCalledTimes(1);
  const denied = await route(65 * 1024 * 1024);
  expect(denied?.status).toBe(413);
  expect(await denied?.text()).toContain('64MB');
  expect(put).toHaveBeenCalledTimes(1);
});
