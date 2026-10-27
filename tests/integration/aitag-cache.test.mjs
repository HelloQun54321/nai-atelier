import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../support/workspace.mjs';

test('真实 D1：首图提示词可搜索，负面词和模型不误命中', async () => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../worker/index.ts', import.meta.url))],
    absWorkingDir: projectRoot, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
  const mf = new Miniflare({ script: bundled.outputFiles[0].text, modules: true, compatibilityDate: '2026-04-09',
    d1Databases: ['DB'], d1Persist: false, bindings: { PERSONAL_MODE_ENABLED: 'true', LOCAL_HISTORY_ENABLED: 'true' }, log: new Log(LogLevel.NONE) });
  try {
    assert.equal((await mf.dispatchFetch('http://localhost/api/init')).status, 200);
    const db = await mf.getD1Database('DB');
    const image = { ai_json: JSON.stringify({ Comment: JSON.stringify({
      v4_prompt: { caption: { base_caption: 'synthetic-positive', char_captions: [{ char_caption: 'synthetic-character' }] } },
      uc: 'synthetic-negative', model: 'synthetic-model',
    }) }) };
    await db.prepare("INSERT INTO aitag_works(id,source_sort,source_page,source_index,ai_type,raw_json,local_cover_url,first_image_json) VALUES(1,'new',1,0,'NAI','{}','/synthetic.png',?)")
      .bind(JSON.stringify(image)).run();
    const search = async prompt => {
      const response = await mf.dispatchFetch(`http://localhost/api/aitag/cache/search?cacheFilter=first-image&prompt=${encodeURIComponent(prompt)}`);
      assert.equal(response.status, 200);
      return (await response.json()).items.map(item => item.id);
    };
    assert.deepEqual(await search('synthetic-positive'), [1]);
    assert.deepEqual(await search('synthetic-character'), [1]);
    assert.deepEqual(await search('synthetic-negative'), []);
    assert.deepEqual(await search('synthetic-model'), []);
  } finally {
    await mf.dispose();
  }
});
