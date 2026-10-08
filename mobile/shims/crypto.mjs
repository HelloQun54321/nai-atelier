import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { md5 } from '@noble/hashes/legacy.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm } from '@noble/ciphers/aes.js';
import { Buffer } from 'buffer';

export const randomUUID = () => globalThis.crypto.randomUUID();
// 浏览器 Buffer 6 没有 base64url；在加密适配边界统一支持 PKCE、会话 ID 与 HMAC。
const cryptoBuffer = bytes => {
  const value=Buffer.from(bytes),toString=value.toString.bind(value);
  value.toString=(encoding,...args)=>encoding==='base64url'?toString('base64',...args).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''):toString(encoding,...args);
  return value;
};
export const randomBytes = size => cryptoBuffer(globalThis.crypto.getRandomValues(new Uint8Array(size)));
export const timingSafeEqual = (a,b) => { if(a.length!==b.length)throw new Error('摘要长度不一致');let result=0;for(let i=0;i<a.length;i++)result|=a[i]^b[i];return result===0; };
export const createHash = name => {
  const hash = ({ sha256, sha512, md5 })[name];
  if (!hash) throw new Error(`不支持摘要算法 ${name}`);
  const state = hash.create();
  return { update(value, encoding) { state.update(Buffer.from(value, encoding)); return this; }, digest(encoding) { const value = cryptoBuffer(state.digest()); return encoding ? value.toString(encoding) : value; } };
};
export const createHmac = (name, key) => {
  const state = hmac.create(({ sha256, sha512 })[name], Buffer.from(key));
  return { update(value) { state.update(Buffer.from(value)); return this; }, digest(encoding) { const value = cryptoBuffer(state.digest()); return encoding ? value.toString(encoding) : value; } };
};
export const createCipheriv = (_name, key, iv) => {
  let tag;
  return { update(value, encoding) { const result = gcm(key, iv).encrypt(Buffer.from(value, encoding)); tag = Buffer.from(result.subarray(-16)); return Buffer.from(result.subarray(0, -16)); }, final: () => Buffer.alloc(0), getAuthTag: () => tag };
};
export const createDecipheriv = (_name, key, iv) => {
  let tag;
  return { setAuthTag(value) { tag = value; }, update(value) { return Buffer.from(gcm(key, iv).decrypt(Buffer.concat([value, tag]))); }, final: () => Buffer.alloc(0) };
};
