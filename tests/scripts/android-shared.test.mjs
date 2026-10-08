import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { androidDictionaryGenerator } from '../../scripts/android-dictionary.mjs';
import { projectRoot } from '../support/workspace.mjs';
import { DEFAULT_NAI_RUNTIME, computeNaiRuntimeSync } from '../../scripts/media-gateway.mjs';
import { NAI_MEDIUM_BILLING_BUNDLE } from '../fixtures/nai-runtime.mjs';

test('Android 默认规则和官方提取复用电脑声明，不能带入 Node 文件系统',async()=>{
  const billing=join(projectRoot,'worker/naiBilling.mjs').replace(/\\/g,'/');
  const source=extractAndroidShared(join(projectRoot,'scripts/media-gateway.mjs'),['DEFAULT_NAI_RUNTIME','computeNaiRuntimeSync'],`import {DEFAULT_NAI_BILLING,isNaiBillingRules} from 'file:///${billing}';`);
  const mobile=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.deepEqual(mobile.DEFAULT_NAI_RUNTIME,DEFAULT_NAI_RUNTIME);assert.deepEqual(mobile.computeNaiRuntimeSync('synthetic missing official rules'),computeNaiRuntimeSync('synthetic missing official rules'));
  assert.deepEqual(mobile.computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE), computeNaiRuntimeSync(NAI_MEDIUM_BILLING_BUNDLE));
  assert.doesNotMatch(source,/node:|readFile|process\.cwd/);
});
test('手机词库生成必须留下原子切换，由共用生成器保留字符检索和目录分页',()=>{
  const source=androidDictionaryGenerator(join(projectRoot,'scripts/update-tag-dictionary.mjs'));
  assert.match(source,/characterSearchRecords/);assert.match(source,/artistNamePages/);assert.match(source,/characterNamePages/);
  assert.doesNotMatch(source,/DatabaseSync|await rm\(|rename\(STAGING|local-data/);
});

test('手机共用生图处理器包含通用中转分支，构建注入地址和队列数量依赖', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = extractAndroidShared(join(projectRoot, 'scripts/media-gateway.mjs'), ['handleGenerateRequest', 'handleGenerateStreamRequest']);
  assert.match(source, /getCloudQueueGenerationUrl\(queuePreferences\.serviceUrl\)/);
  assert.match(source, /getCloudQueueGenerationUrl\(queuePreferences\.serviceUrl, true\)/);
  const build = await readFile(join(projectRoot, 'scripts/build-android.mjs'), 'utf8');
  assert.match(build, /import \{ getCloudQueueGenerationUrl \} from '\/worker\/cloudQueueTarget\.mjs'/);
  assert.match(build, /import \{ normalizeCloudQueueCount \} from '\/worker\/cloudQueueNumbers\.mjs'/);
});
