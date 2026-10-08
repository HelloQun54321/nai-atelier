import {expect,it,vi} from 'vitest';
import {createHash as nodeHash,createHmac as nodeHmac} from 'node:crypto';
vi.mock('buffer',async()=>await import('buffer/'));
import {randomBytes,createHash,createHmac} from '../../../mobile/shims/crypto.mjs';

it('手机浏览器 Buffer 的 PKCE、登录 ID 和 HMAC 支持无填充 base64url，与 Node 一致',()=>{
  const verifier=randomBytes(32).toString('base64url');
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomBytes(12).toString('base64url')).toMatch(/^[A-Za-z0-9_-]{16}$/);
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(nodeHash('sha256').update(verifier).digest('base64url'));
  expect(createHash('sha256').update(verifier).digest().toString('base64url')).toBe(nodeHash('sha256').update(verifier).digest('base64url'));
  expect(createHmac('sha256','synthetic').update(verifier).digest('base64url')).toBe(nodeHmac('sha256','synthetic').update(verifier).digest('base64url'));
  expect(createHash('md5').update(verifier).digest('hex')).toBe(nodeHash('md5').update(verifier).digest('hex'));
});
