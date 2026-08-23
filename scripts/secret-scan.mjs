#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_MARKER = 'secret-scan: allow';
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

const SECRET_RULES = [
  ['NovelAI persistent token', /pst-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI or Anthropic API key', /sk-(?:(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|ant-api03-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['AWS access key', /AKIA[0-9A-Z]{16}/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['npm token', /npm_[A-Za-z0-9]{20,}/g],
  ['JWT token', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['hardcoded bearer token', /Bearer\s+[A-Za-z0-9._~+/-]{24,}/g],
  ['credential-bearing URL', /https?:\/\/[^/@\s]+:[^/@\s]+@/g],
];

const NAMED_SECRET = /\b(?:[A-Z0-9_]*(?:PASSWORD|PASSCODE|CLIENT_SECRET|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PRIVATE_KEY)[A-Z0-9_]*)\b\s*[:=]\s*["'`]([^"'`\r\n]{8,})["'`]/gi;
const PLACEHOLDER = /^(?:<|\$|your[-_ ]|replace[-_ ]|example[-_ ]|test[-_ ]|dummy[-_ ]|fake[-_ ])/i;

export const isSensitivePath = file => {
  const normalized = file.replaceAll('\\', '/');
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === '.env.example' || base === '.env.sample') return false;
  return /^\.env(?:\.|$)/i.test(base)
    || /\.(?:pem|key|p12|pfx)$/i.test(base)
    || /^(?:credentials|secrets)\.json$/i.test(base)
    || /^(?:id_rsa|id_ed25519)$/i.test(base);
};

const lineNumberAt = (text, index) => text.slice(0, index).split('\n').length;

const looksLikePlaceholderUrl = value => {
  try {
    const url = new URL(value);
    return ['user', 'username', 'u', 'test'].includes(url.username.toLowerCase())
      && ['pass', 'password', 'p', 'test'].includes(url.password.toLowerCase());
  } catch {
    return false;
  }
};

export const scanText = (file, text) => {
  const findings = [];
  const fixtureFile = /(?:^|\/)tests?\/|\.test\.[cm]?[jt]sx?$/i.test(file.replaceAll('\\', '/'));
  for (const [rule, pattern] of SECRET_RULES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index) === -1 ? text.length : text.indexOf('\n', match.index));
      if (line.includes(ALLOW_MARKER)) continue;
      if (fixtureFile && rule === 'credential-bearing URL') continue;
      if (rule === 'credential-bearing URL' && looksLikePlaceholderUrl(match[0])) continue;
      findings.push({ file, line: lineNumberAt(text, match.index), rule });
    }
  }

  NAMED_SECRET.lastIndex = 0;
  for (const match of text.matchAll(NAMED_SECRET)) {
    const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index) === -1 ? text.length : text.indexOf('\n', match.index));
    if (fixtureFile || line.includes(ALLOW_MARKER) || PLACEHOLDER.test(match[1])) continue;
    findings.push({ file, line: lineNumberAt(text, match.index), rule: 'named secret with literal value' });
  }
  return findings;
};

const git = args => execFileSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
const splitNull = buffer => buffer.toString('utf8').split('\0').filter(Boolean);

const readIndexFile = file => {
  try {
    return git(['show', `:${file}`]);
  } catch {
    return null;
  }
};

export const scanRepository = ({ staged = false } = {}) => {
  const files = staged
    ? splitNull(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
    : splitNull(git(['ls-files', '-z']));
  const findings = [];

  for (const file of files) {
    if (isSensitivePath(file)) {
      findings.push({ file, line: 1, rule: 'sensitive filename' });
      continue;
    }
    let content;
    try {
      content = staged ? readIndexFile(file) : readFileSync(path.join(root, file));
    } catch {
      continue;
    }
    if (!content || content.length > MAX_TEXT_FILE_BYTES || content.includes(0)) continue;
    findings.push(...scanText(file, content.toString('utf8')));
  }
  return findings;
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const staged = process.argv.includes('--staged');
  const findings = scanRepository({ staged });
  if (findings.length) {
    console.error(`密钥扫描失败：发现 ${findings.length} 个疑似敏感内容（不会回显原值）：`);
    findings.forEach(item => console.error(`- ${item.file}:${item.line} [${item.rule}]`));
    console.error(`如确认是必须公开的固定值，请在同一行添加“${ALLOW_MARKER}”并写明原因。`);
    process.exit(1);
  }
  console.log(`密钥扫描通过：${staged ? '暂存区' : '全部 Git 跟踪文件'}未发现疑似凭据。`);
}
