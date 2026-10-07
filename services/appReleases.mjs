// 只跟随已发布版本；Git 标签、开发提交和文档版本不会单独触发升级。
export const RELEASE_REPOSITORY = 'HelloQun54321/nai-atelier';
export const RELEASE_PAGE = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`;

export function releaseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value));
  const parts = match?.slice(1).map(Number);
  return parts?.every(Number.isSafeInteger) ? parts : null;
}

export function compareReleaseVersions(left, right) {
  const a = releaseVersion(left), b = releaseVersion(right);
  if (!a || !b) throw new Error('发行版本号无效');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function latestPublishedRelease(releases, allowPrerelease = true) {
  if (!Array.isArray(releases)) throw new Error('发行信息格式无效');
  return releases.filter(item => !item.draft && (allowPrerelease || !item.prerelease)
    && releaseVersion(item.tag_name)
    && item.html_url === `${RELEASE_PAGE}/tag/${item.tag_name}`
    && item.assets?.some(asset => asset.name === `NAI-Atelier-Setup-${item.tag_name.replace(/^v/, '')}-x64.exe`
      && asset.browser_download_url === `https://github.com/${RELEASE_REPOSITORY}/releases/download/${item.tag_name}/${asset.name}`))
    .sort((a, b) => compareReleaseVersions(b.tag_name, a.tag_name))[0] || null;
}

export async function fetchPublishedRelease(allowPrerelease = true, fetchImpl = fetch) {
  const response = await fetchImpl(`${RELEASE_API}?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`无法检查更新（HTTP ${response.status}）`);
  return latestPublishedRelease(await response.json(), allowPrerelease);
}
