import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitivePath, scanText } from './secret-scan.mjs';

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
