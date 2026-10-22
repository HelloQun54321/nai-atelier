import '../support/node-environment.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createMediaGateway } from '../../scripts/media-gateway.mjs';

test('collector accepts local custom backgrounds above 4 KiB without enlarging other command limits', async () => {
  const server = await createMediaGateway({ port: 0, workerPort: 39999 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Nai-Local-Control': 'true' };
  try {
    const bytes = await readFile(new URL('../../public/themes/wallpapers/cupertino-day.webp', import.meta.url));
    const image = 'data:image/webp;base64,' + bytes.toString('base64');
    assert.ok(image.length > 4096);
    const base = { themeMode: 'light', isDark: false, accentColor: '#007aff', motion: 'off', surfaces: 'translucent' };
    const response = await fetch(origin + '/api/style-collector/appearance', { method: 'POST', headers, body: JSON.stringify({ ...base, backgrounds: { light: { image, fit: 'contain', opacity: .2, tileSize: 64 }, dark: null } }) });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.deepEqual(state.appearance.backgrounds, { light: { fit: 'contain', opacity: .2, tileSize: 64 }, dark: null });
    assert.equal(JSON.stringify(state).includes('base64'), false, 'state events must not rebroadcast image payloads');
    assert.equal(state.enabled, false, 'appearance changes must not open the collector');
    for (const backgrounds of [{ light: { image: 'https://example.invalid/a.webp' } }, { light: { image, fit: 'stretch' } }, { light: { image, opacity: 2 } }, { blue: { image } }]) {
      const invalid = await fetch(origin + '/api/style-collector/appearance', { method: 'POST', headers, body: JSON.stringify({ ...base, backgrounds }) });
      assert.equal(invalid.status, 400);
    }
    await assert.rejects(fetch(origin + '/api/style-collector/mode', { method: 'POST', headers, body: JSON.stringify({ id: 'x'.repeat(5000) }) }), error => error.cause?.code === 'UND_ERR_SOCKET');
    const cleared = await fetch(origin + '/api/style-collector/appearance', { method: 'POST', headers, body: JSON.stringify(base) });
    assert.deepEqual((await cleared.json()).appearance.backgrounds, {});
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
