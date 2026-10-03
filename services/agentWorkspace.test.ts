// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { operateAgentPage, readAgentPage } from './agentWorkspace';
beforeEach(() => {
  document.body.innerHTML = '<main data-agent-view="history"><h1>最近作品</h1><div style="display:none">旧实验室</div><input aria-label="搜索作品" value="雨天"><button>打开图片</button><button>生成图片</button><input aria-label="API Key" value="synthetic-secret"><aside data-agent-surface>Agent 私人聊天</aside></main>';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('读取真正当前页面，排除隐藏保活页、聊天与密钥；危险按钮不能点击', () => {
  const page = readAgentPage();
  expect(page.title).toBe('生成历史'); expect(page.text).toContain('最近作品');
  expect(page.text).not.toMatch(/旧实验室|私人聊天|synthetic-secret/);
  expect(page.controls.some(item => /API Key/.test(item.label))).toBe(false);
  expect(page.controls.find(item => item.label === '生成图片')?.actions).toEqual([]);
  expect(page.controls.find(item => item.label === '打开图片')?.actions).toEqual(['click']);
});
it('填入字段后返回新页面；输入变化后旧编号失效', async () => {
  const page = readAgentPage(), field = page.controls.find(item => item.label === '搜索作品')!;
  const next = await operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: field.id, value: '星空' });
  expect(next.controls.find(item => item.id === field.id)?.value).toBe('星空'); expect(next.snapshotId).not.toBe(page.snapshotId);
  await expect(operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: field.id, value: '旧输入' })).rejects.toThrow('页面已变化');
  expect((document.querySelector('input') as HTMLInputElement).value).toBe('星空');
});
it('前景窗口取代背景页面，私人设置只报告标题', () => {
  const dialog = document.createElement('section'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '图片详情'); dialog.innerHTML = '<h2>当前图片详情</h2><p>原图参数</p>';
  document.body.append(dialog); const detail = readAgentPage(); expect(detail.title).toBe('当前图片详情'); expect(detail.text).not.toContain('最近作品');
  dialog.dataset.agentPrivate = 'true'; dialog.dataset.agentPageTitle = 'API 设置'; dialog.innerHTML = '<input value="synthetic-secret"><p>私人数据</p>';
  expect(readAgentPage()).toMatchObject({ title: 'API 设置', text: '', controls: [] });
});
it('页面切换等待 App 回执，返回切换后的真实页面', async () => {
  const listener = (event: Event) => { const detail = (event as CustomEvent).detail; document.querySelector<HTMLElement>('main')!.dataset.agentView = detail.view; detail.resolve(); };
  window.addEventListener('nai-agent-page-navigate', listener);
  try { expect((await operateAgentPage({ action: 'navigate', view: 'characters' })).title).toBe('角色库'); }
  finally { window.removeEventListener('nai-agent-page-navigate', listener); }
});
it('填写前校验选择项与数值边界，拒绝时不改变原字段', async () => {
  document.querySelector('main')!.innerHTML = '<select aria-label="模式"><option value="text">文生图</option><option value="disabled" disabled>不可用</option></select><input type="number" aria-label="步数" min="1" max="28" value="20">';
  const page = readAgentPage(), mode = page.controls.find(item => item.label === '模式')!, steps = page.controls.find(item => item.label === '步数')!;
  for (const value of ['missing', 'disabled']) await expect(operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: mode.id, value })).rejects.toThrow('有效选项');
  for (const value of ['29', 'invalid']) await expect(operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: steps.id, value })).rejects.toThrow('允许范围');
  expect(document.querySelector('select')!.value).toBe('text'); expect(document.querySelector('input')!.value).toBe('20');
});
