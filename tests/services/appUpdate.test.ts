// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { preserveUpdateDrafts, restoreUpdateDrafts } from '../../services/appUpdate';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
it('更新只暂存实验室草稿，不带 Key；重启恢复一次且不覆盖后来编辑', () => {
  const key = 'nai-lab-workspace-v1:playground';
  sessionStorage.setItem(key, '合成文字草稿'); sessionStorage.setItem('nai_api_key', 'synthetic-do-not-copy');
  preserveUpdateDrafts();
  expect(localStorage.getItem('nai-update-lab-drafts')).not.toContain('synthetic-do-not-copy');
  sessionStorage.clear(); restoreUpdateDrafts();
  expect(sessionStorage.getItem(key)).toBe('合成文字草稿'); expect(sessionStorage.getItem('nai_api_key')).toBeNull();
  expect(localStorage.getItem('nai-update-lab-drafts')).toBeNull();
  preserveUpdateDrafts(); sessionStorage.setItem(key, '后来编辑'); restoreUpdateDrafts();
  expect(sessionStorage.getItem(key)).toBe('后来编辑');
});
it('过期或损坏的恢复记录不能覆盖现有会话', () => {
  localStorage.setItem('nai-update-lab-drafts', JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, entries: { 'nai-lab-workspace-v1:playground': '旧内容' } }));
  restoreUpdateDrafts(); expect(sessionStorage.length).toBe(0);
  localStorage.setItem('nai-update-lab-drafts', 'invalid'); restoreUpdateDrafts(); expect(sessionStorage.length).toBe(0);
});
