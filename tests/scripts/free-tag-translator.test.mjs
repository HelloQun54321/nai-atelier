import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { PromptAgentService } from '../../scripts/prompt-agent.mjs';
import {
  handleTagTranslationRequest,
  lookupPromptTagTranslations,
  normalizeFreeProviders,
  resetFreeTranslatorHealth,
  splitInteractionPrefix,
  translateTagsFree,
} from '../../scripts/free-tag-translator.mjs';

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
  body: { cancel: async () => {} },
});

test('互动前缀拆分正确识别 source# / target# / mutual#', () => {
  assert.deepEqual(splitInteractionPrefix('source#holding_hand'), { prefix: 'source', label: '发起：', body: 'holding hand' });
  assert.deepEqual(splitInteractionPrefix('TARGET#surprised'), { prefix: 'target', label: '接收：', body: 'surprised' });
  assert.deepEqual(splitInteractionPrefix('mutual#eye_contact'), { prefix: 'mutual', label: '互相：', body: 'eye contact' });
  assert.deepEqual(splitInteractionPrefix('blue sky'), { prefix: '', label: '', body: 'blue sky' });
});

test('免费翻译池按微软 -> 腾讯 -> B站 -> Google 顺序自动回退，无代理时不调用 Google', async () => {
  resetFreeTranslatorHealth();
  const called = [];
  const fetchNoProxy = async (url, init) => {
    const target = String(url);
    called.push(target);
    if (target.includes('edge.microsoft.com')) return jsonResponse({ error: 'busy' }, 503);
    if (target.includes('transmart.qq.com')) return jsonResponse({ header: { ret_code: 'Auth-Failed' } }, 200);
    if (target.includes('index-translate.bilibili.com')) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'Index-Translate-35B-A3B');
      assert.equal(body.chat_template_kwargs?.enable_thinking, false);
      return jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: '1. 星空下的少女\n2. 拥抱' } }],
      });
    }
    throw new Error(`不应调用未启用线路: ${target}`);
  };

  const result = await translateTagsFree(['girl under starry sky', 'source#hugging', 'artist:ask', 'known artist'], {
    fetchImpl: fetchNoProxy,
    protectedTags: ['known artist'],
  });
  assert.equal(result.provider, 'bilibili');
  assert.equal(result.translations.get('girl under starry sky'), '星空下的少女');
  assert.equal(result.translations.get('source#hugging'), '发起：拥抱');
  assert.equal(result.translations.get('hugging'), '拥抱');
  assert.deepEqual(result.skipped.sort(), ['artist:ask', 'known artist']);
  assert.equal(called.some(url => url.includes('translate.googleapis.com')), false);
});

test('配置代理且前三线均失败时回退 Google 批量接口', async () => {
  resetFreeTranslatorHealth();
  const called = [];
  const fetchWithProxy = async (url, init) => {
    const target = String(url);
    called.push(target);
    if (target.includes('edge.microsoft.com')) return jsonResponse({}, 429);
    if (target.includes('transmart.qq.com')) return jsonResponse({}, 502);
    if (target.includes('index-translate.bilibili.com')) return jsonResponse({}, 504);
    if (target.includes('translate.googleapis.com')) {
      const params = new URLSearchParams(init.body);
      assert.deepEqual(params.getAll('q'), ['neon alley', 'rainy night']);
      return jsonResponse([['霓虹小巷', 'en'], ['雨夜', 'en']]);
    }
    throw new Error(`意外请求: ${target}`);
  };

  const result = await translateTagsFree(['neon alley', 'rainy night'], {
    fetchImpl: fetchWithProxy,
    outboundProxyUrl: 'http://127.0.0.1:7890',
  });
  assert.equal(result.provider, 'google');
  assert.equal(result.translations.get('neon alley'), '霓虹小巷');
  assert.equal(result.translations.get('rainy night'), '雨夜');
  assert.equal(called.length, 4);
});

test('整批英文原样回显时自动拒收并切换下一线路', async () => {
  resetFreeTranslatorHealth();
  const fetchEcho = async url => {
    const target = String(url);
    if (target.includes('edge.microsoft.com')) {
      return jsonResponse([{ translations: [{ text: 'glowing lantern' }] }]);
    }
    if (target.includes('transmart.qq.com')) {
      return jsonResponse({ header: { ret_code: 'succ' }, auto_translation: ['发光的灯笼'] });
    }
    throw new Error(`意外请求: ${target}`);
  };

  const result = await translateTagsFree(['glowing lantern'], { fetchImpl: fetchEcho });
  assert.equal(result.provider, 'transmart');
  assert.equal(result.translations.get('glowing lantern'), '发光的灯笼');
});

test('支持自定义免费线路子集与优先级顺序，并过滤非法线路名', async () => {
  resetFreeTranslatorHealth();
  assert.deepEqual(normalizeFreeProviders(['bilibili', 'invalid', 'microsoft', 'bilibili']), ['bilibili', 'microsoft']);
  assert.deepEqual(normalizeFreeProviders([]), ['microsoft', 'transmart', 'bilibili', 'google']);

  const called = [];
  const customFetch = async (url, init) => {
    const target = String(url);
    called.push(target);
    if (target.includes('index-translate.bilibili.com')) return jsonResponse({}, 503);
    if (target.includes('transmart.qq.com')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.source.text_list, ['golden sunset']);
      return jsonResponse({ header: { ret_code: 'succ' }, auto_translation: ['金色日落'] });
    }
    throw new Error(`不应调用未选线路: ${target}`);
  };

  const result = await translateTagsFree(['golden sunset'], {
    fetchImpl: customFetch,
    providers: ['bilibili', 'transmart'],
  });
  assert.equal(result.provider, 'transmart');
  assert.equal(result.translations.get('golden sunset'), '金色日落');
  assert.equal(called.length, 2);
  assert.ok(called[0].includes('index-translate.bilibili.com'));
  assert.ok(called[1].includes('transmart.qq.com'));

  // 仅选 Google 时，即使未显式配置 HTTP 代理也能按用户指定线路发起直连（兼容系统 TUN/VPN）
  resetFreeTranslatorHealth();
  const googleOnly = await translateTagsFree(['dawn mist'], {
    fetchImpl: async url => {
      assert.ok(String(url).includes('translate.googleapis.com'));
      return jsonResponse([['晨雾', 'en']]);
    },
    providers: ['google'],
  });
  assert.equal(googleOnly.provider, 'google');
  assert.equal(googleOnly.translations.get('dawn mist'), '晨雾');
});

test('路由缓存区分 free / ai 来源：free 不覆盖已有译文，AI 升级可覆盖旧 free 并在失败时无损恢复', async () => {
  resetFreeTranslatorHealth();
  const root = createWorkspace('free-tag-translator-');
  try {
    const service = new PromptAgentService({ lanSecret: 'synthetic', configFile: root });
    await service.init();

    // 1. 写入已有 AI 译文，确保 free 不会覆盖它
    await service.saveTagTranslations(new Map([['ai kept tag', 'AI保留译文']]), { provider: 'deepseek', model: 'deepseek-chat' });

    // 2. 免费翻译补齐新词，写入 source: 'free'
    const freeRes = await handleTagTranslationRequest(service, {
      action: 'translate',
      mode: 'free',
      tags: ['ai kept tag', 'soft moonlight', 'mutual#hand holding'],
    }, {
      fetchImpl: async url => {
        assert.ok(String(url).includes('edge.microsoft.com'));
        return jsonResponse([
          { translations: [{ text: '柔和的月光' }] },
          { translations: [{ text: '牵手' }] },
        ]);
      },
    });
    assert.equal(freeRes.mode, 'free');
    assert.equal(freeRes.provider, 'microsoft');
    const lookupAfterFree = Object.fromEntries(lookupPromptTagTranslations(service, ['ai kept tag', 'soft moonlight', 'mutual#hand holding']).map(item => [item.tag, item]));
    assert.equal(lookupAfterFree['ai kept tag'].chinese, 'AI保留译文');
    assert.equal(lookupAfterFree['ai kept tag'].source, 'ai');
    assert.equal(lookupAfterFree['soft moonlight'].chinese, '柔和的月光');
    assert.equal(lookupAfterFree['soft moonlight'].source, 'free');
    assert.equal(lookupAfterFree['mutual#hand holding'].chinese, '互相：牵手');
    assert.equal(lookupAfterFree['mutual#hand holding'].source, 'free');

    // 3. AI 升级失败时，原 free 缓存必须完整保留
    service.translateTags = async () => { throw Object.assign(new Error('模型不可用'), { status: 502 }); };
    await assert.rejects(
      handleTagTranslationRequest(service, { action: 'translate', mode: 'ai', overwriteFree: true, tags: ['soft moonlight'] }),
      /模型不可用/,
    );
    assert.equal(lookupPromptTagTranslations(service, ['soft moonlight'])[0].chinese, '柔和的月光');
    assert.equal(lookupPromptTagTranslations(service, ['soft moonlight'])[0].source, 'free');

    // 4. AI 升级成功后，覆盖旧 free 缓存并落盘为 ai 来源
    service.translateTags = async tags => {
      await service.saveTagTranslations(new Map(tags.map(tag => [tag, `精译：${tag}`])), { provider: 'deepseek', model: 'deepseek-chat' });
      return { items: service.lookupTagTranslations(tags), provider: 'deepseek', model: 'deepseek-chat', cached: false };
    };
    const aiUpgrade = await handleTagTranslationRequest(service, {
      action: 'translate',
      mode: 'ai',
      overwriteFree: true,
      tags: ['soft moonlight'],
    });
    assert.equal(aiUpgrade.mode, 'ai');
    assert.equal(aiUpgrade.items[0].chinese, '精译：soft moonlight');
    assert.equal(aiUpgrade.items[0].source, 'ai');

    const stored = JSON.parse(await readFile(service.tagTranslationFilePath(), 'utf8'));
    assert.equal(stored.items['soft moonlight'].chinese, '精译：soft moonlight');
    assert.equal(stored.items['mutual#hand holding'].source, 'free');
  } finally {
    removeWorkspace(root);
  }
});
