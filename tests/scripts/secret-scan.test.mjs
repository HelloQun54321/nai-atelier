import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitivePath, scanText } from '../../scripts/secret-scan.mjs';

test('secret scanner detects NovelAI and named literal credentials without echoing values', () => {
  const novelAiKey = ['pst', 'A'.repeat(48)].join('-');
  const namedPassword = ['GUEST_PASSCODE', ' = ', JSON.stringify('private-value-123')].join('');
  const findings = scanText('wrangler.toml', `${novelAiKey}\n${namedPassword}`);
  assert.deepEqual(findings.map(item => item.rule), ['NovelAI persistent token', 'named secret with literal value']);
  assert.equal(JSON.stringify(findings).includes(novelAiKey), false);
  assert.equal(JSON.stringify(findings).includes('private-value-123'), false);
});

test('secret scanner permits documented public constants and placeholder credential URLs', () => {
  const publicConstant = ['CLIENT_SECRET', ' = ', JSON.stringify('public-fixed-value'), ' // secret-scan: allow（公开协议固定值）'].join('');
  assert.deepEqual(scanText('public-client.mjs', publicConstant), []);
  assert.deepEqual(scanText('url.test.mjs', "https://user:pass@example.com"), []);
});

test('secret scanner blocks sensitive filenames but permits templates', () => {
  assert.equal(isSensitivePath('.env'), true);
  assert.equal(isSensitivePath('config/.env.production'), true);
  assert.equal(isSensitivePath('certs/private.key'), true);
  assert.equal(isSensitivePath('.env.example'), false);
});

test('密钥扫描拦截 Wrangler 本地变量及环境变体，允许公开示例', () => {
  for (const file of ['.dev.vars', '.dev.vars.production', 'config/.dev.vars.staging', 'config\\.dev.vars.local']) {
    assert.equal(isSensitivePath(file), true, file);
  }
  for (const file of ['.env.example', '.env.sample', '.dev.vars.example', 'config/.dev.vars.sample']) {
    assert.equal(isSensitivePath(file), false, file);
  }
});

test('密钥扫描拦截常见无扩展名 SSH 私钥，保留公钥', () => {
  for (const name of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']) {
    assert.equal(isSensitivePath(name), true, name);
    assert.equal(isSensitivePath(`keys/${name}`), true, name);
    assert.equal(isSensitivePath(`keys/${name}.pub`), false, name);
  }
});

test('secret scanner detects sk-family variants, hf/gitlab/telegram tokens and unquoted named secrets', () => {
  const stripeKey = 'sk_live_' + 'A'.repeat(24);
  const openRouterKey = 'sk-or-v1-' + 'B'.repeat(24);
  const hfToken = 'hf_' + 'C'.repeat(30);
  const gitlabToken = 'glpat-' + 'D'.repeat(22);
  const telegramToken = '1234567890:' + 'AA' + 'E'.repeat(32);
  const unquoted = 'API_KEY = ' + 'F'.repeat(24);
  const findings = scanText('keys.env.local', [
    stripeKey, openRouterKey, hfToken, gitlabToken, telegramToken, unquoted,
  ].join('\n'));
  assert.deepEqual(findings.map(item => item.rule), [
    'OpenAI or Anthropic API key',
    'OpenAI or Anthropic API key',
    'HuggingFace token',
    'GitLab token',
    'Telegram bot token',
    'named secret with literal value',
  ]);
});

test('named secret rule ignores references to env/config lookups', () => {
  const computed = 'export const apiKey = process.env.NOVELAI_API_KEY;';
  assert.deepEqual(scanText('src.ts', computed), []);
});
