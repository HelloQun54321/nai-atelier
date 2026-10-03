// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearAgentPageHover, observeAgentPage, operateAgentPage, readAgentPage } from './agentWorkspace';
beforeEach(() => {
  document.body.innerHTML = '<main data-agent-view="history"><h1>最近作品</h1><div style="display:none">旧实验室</div><input aria-label="搜索作品" value="雨天"><button>打开图片</button><button>生成图片</button><input aria-label="API Key" value="synthetic-secret"><aside data-agent-surface>Agent 私人聊天</aside></main>';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
});
afterEach(() => { clearAgentPageHover(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('读取真正当前页面，排除隐藏保活页、聊天与密钥；危险按钮不能点击', () => {
  const page = readAgentPage();
  expect(page.title).toBe('生成历史'); expect(page.text).toContain('最近作品');
  expect(page.text).not.toMatch(/旧实验室|私人聊天|synthetic-secret/);
  expect(page.controls.some(item => /API Key/.test(item.label))).toBe(false);
  expect(page.controls.find(item => item.label === '生成图片')?.actions).toEqual([]);
  expect(page.controls.find(item => item.label === '打开图片')?.actions).toContain('click');
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
  document.body.append(dialog); const detail = readAgentPage(); expect(detail.title).toBe('图片详情'); expect(detail.text).not.toContain('最近作品');
  dialog.dataset.agentPrivate = 'true'; dialog.dataset.agentPageTitle = 'API 设置'; dialog.innerHTML = '<input value="synthetic-secret"><p>私人数据</p>';
  expect(readAgentPage()).toMatchObject({ title: 'API 设置', text: '', controls: [] });
});
it('详情中的菜单和确认仍优先，保活页里的旧详情不进入当前回执', () => {
  document.body.innerHTML = '<main data-agent-view="aitag"><p>列表</p><aside data-agent-page-scope="detail" data-agent-page-title="作品详情：合成作品"><p>当前详情</p><section role="menu" aria-label="详情菜单"><button>查看参数</button></section></aside><div hidden><aside data-agent-page-scope="detail" data-agent-page-title="旧详情">旧作品</aside></div></main>';
  expect(readAgentPage().title).toBe('详情菜单'); document.querySelector('[role="menu"]')!.remove();
  expect(readAgentPage()).toMatchObject({ title: 'AITag · 作品详情：合成作品', foreground: 'detail', text: '当前详情' });
  const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', '确认窗口'); modal.style.zIndex = '2000'; document.body.append(modal);
  expect(readAgentPage().title).toBe('确认窗口'); modal.remove(); expect(readAgentPage().title).toContain('合成作品');
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

it('长页面可按名称查找和分页，前景非模态筛选不会被图库挤掉', async () => {
  const main = document.querySelector('main')!;
  main.innerHTML = '<button aria-label="筛选" aria-expanded="false">筛选</button>' + Array.from({ length: 85 }, (_, i) => `<button>查看作品${i}</button>`).join('');
  const initial = readAgentPage(); expect(initial.totalControls).toBe(86); expect(initial.nextOffset).toBe(12);
  const rest = readAgentPage({ offset: 80, snapshotId: initial.snapshotId }); expect(rest.controls).toHaveLength(6);
  expect(readAgentPage({ query: '作品84' }).controls).toHaveLength(1);
  const trigger = main.querySelector('button')!;
  trigger.onclick = () => { trigger.setAttribute('aria-expanded', 'true'); const popup = document.createElement('div'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '筛选与排序'); popup.innerHTML = '<select aria-label="模型筛选"><option value="">全部</option><option value="nai-diffusion-5-full">V5 Full</option></select>'; document.body.append(popup); };
  const result = await operateAgentPage({ action: 'click', snapshotId: initial.snapshotId, controlId: initial.controls[0].id, expect: { label: '模型筛选' } });
  expect(result).toMatchObject({ title: '筛选与排序', totalControls: 1, verification: { status: 'matched' } });
  expect(result.controls[0].options).toContainEqual(expect.objectContaining({ value: 'nai-diffusion-5-full', label: 'V5 Full' }));
  const selected = await operateAgentPage({ action: 'select', snapshotId: result.snapshotId, controlId: result.controls[0].id, value: 'nai-diffusion-5-full' });
  expect(selected.verification?.control?.value).toBe('nai-diffusion-5-full');
});
it('勾选和选中状态进入版本，check 设置目标而非重复切换', async () => {
  document.querySelector('main')!.innerHTML = '<input type="checkbox" aria-label="收藏"><button aria-pressed="false">V5 系列</button><button role="tab">文生图</button><span role="checkbox" tabindex="0" aria-label="自定义勾选" aria-checked="false"></span>';
  const page = readAgentPage(), checkbox = document.querySelector('input')!;
  checkbox.checked = true; const changed = readAgentPage(); expect(changed.snapshotId).not.toBe(page.snapshotId);
  expect(changed.controls[0].checked).toBe(true); expect(changed.controls[1].actions).toContain('click'); expect(changed.controls[2].actions).toContain('click');
  let clicks = 0; checkbox.addEventListener('click', () => clicks++);
  await operateAgentPage({ action: 'check', snapshotId: changed.snapshotId, controlId: changed.controls[0].id, checked: true }); expect(clicks).toBe(0);
  const custom = document.querySelector<HTMLElement>('span')!; custom.onclick = () => custom.setAttribute('aria-checked', String(custom.getAttribute('aria-checked') !== 'true'));
  const current = readAgentPage(); const checked = await operateAgentPage({ action: 'check', snapshotId: current.snapshotId, controlId: current.controls[3].id, checked: true });
  expect(checked.verification?.control?.checked).toBe(true);
});
it('长输入完整参与版本，原文与选项可以继续读取，回执大小受控', () => {
  document.querySelector('main')!.innerHTML = '<textarea aria-label="主体提示词"></textarea><select aria-label="模型">' + Array.from({ length: 44 }, (_, i) => `<option value="id-${i}">模型${i}</option>`).join('') + '</select>';
  const input = document.querySelector('textarea')!; input.value = 'a'.repeat(2400) + '末尾';
  const page = readAgentPage(); expect(page.controls[0].nextValueOffset).toBe(1600);
  expect(readAgentPage({ controlId: page.controls[0].id, valueOffset: 1600 }).controls[0].value).toContain('末尾');
  expect(readAgentPage({ controlId: page.controls[1].id, optionsOffset: 36 }).controls[0].options?.at(-1)?.value).toBe('id-43');
  input.value += '改动'; expect(readAgentPage().snapshotId).not.toBe(page.snapshotId);
  document.querySelector('main')!.innerHTML = Array.from({ length: 20 }, () => '<textarea>' + 'a'.repeat(2000) + '</textarea>').join('');
  const bounded = readAgentPage({ limit: 20 }); expect(JSON.stringify(bounded).length).toBeLessThan(45_000); expect(bounded.nextOffset).toBeDefined();
});
it('失焦提交与保留焦点两种输入流程都返回真实结果', async () => {
  document.querySelector('main')!.innerHTML = '<input aria-label="透明权重数值" value="1">';
  const input = document.querySelector('input')!; let committed = '1'; input.onblur = () => { committed = input.value; };
  let page = readAgentPage(); await operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: '1.5' }); expect(committed).toBe('1.5');
  page = readAgentPage(); await operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: '2', commit: false }); expect(document.activeElement).toBe(input); expect(committed).toBe('1.5');
  page = readAgentPage(); await operateAgentPage({ action: 'press', snapshotId: page.snapshotId, controlId: page.controls[0].id, key: 'Enter' }); expect(committed).toBe('2');
});
it('等待异步浮层并拒绝盲目宣称成功；超时与取消不重试点击', async () => {
  document.querySelector('main')!.innerHTML = '<button>筛选</button>'; const button = document.querySelector('button')!; let clicks = 0;
  button.onclick = () => { clicks++; setTimeout(() => { const panel = document.createElement('div'); panel.setAttribute('role', 'dialog'); panel.innerHTML = '<button>V5 系列</button>'; document.body.append(panel); }, 260); };
  const page = readAgentPage(); const next = await operateAgentPage({ action: 'click', snapshotId: page.snapshotId, controlId: page.controls[0].id, expect: { label: 'V5 系列' } }); expect(next.controls[0].label).toBe('V5 系列'); expect(clicks).toBe(1);
  await expect(operateAgentPage({ action: 'wait', expect: { label: '不存在' }, timeoutMs: 200 })).rejects.toThrow('超时');
  const abort = new AbortController(); const waiting = operateAgentPage({ action: 'wait', expect: { label: '不存在' } }, abort.signal); abort.abort(); await expect(waiting).rejects.toThrow(); expect(clicks).toBe(1);
});
it('前景取祖先层级、独立候选列表和禁用控件的真实语义', () => {
  document.body.innerHTML = '<main data-agent-view="history"><fieldset disabled><input aria-label="禁用输入"></fieldset><button aria-disabled="true">筛选</button><details><summary>参数</summary><input aria-label="隐藏参数"></details></main><div style="z-index:2000"><section role="dialog" aria-label="最高窗口"><button>返回</button></section></div><section role="dialog" aria-label="后挂窗口" style="z-index:100"><button>查看</button></section>';
  expect(readAgentPage().title).toBe('最高窗口'); document.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
  const page = readAgentPage(); expect(page.controls.find(item => item.label === '禁用输入')?.disabled).toBe(true); expect(page.controls.find(item => item.label === '筛选')?.actions).toEqual([]); expect(page.controls.some(item => item.label === '隐藏参数')).toBe(false);
  const popup = document.createElement('div'); popup.setAttribute('role', 'listbox'); popup.innerHTML = '<button role="option" aria-selected="true">masterpiece</button>'; document.body.append(popup);
  expect(readAgentPage()).toMatchObject({ foreground: 'listbox', controls: [expect.objectContaining({ selected: true, label: 'masterpiece' })] });
});
it('可滚动定位视口外控件，遮挡与只读权限阻止修改', async () => {
  const button = document.querySelector('button')!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 40, top: 900, bottom: 940, width: 40, height: 40 } as DOMRect);
  vi.stubGlobal('document', document); Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body });
  Object.defineProperty(button, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const page = readAgentPage(); const control = page.controls.find(item => item.label === '打开图片')!; expect(control.inViewport).toBe(false); expect(control.actions).toContain('scroll');
  await operateAgentPage({ action: 'scroll', snapshotId: page.snapshotId, controlId: control.id, timeoutMs: 200 }); expect(button.scrollIntoView).toHaveBeenCalled();
  vi.mocked(button.getBoundingClientRect).mockReturnValue({ left: 0, right: 40, top: 10, bottom: 50, width: 40, height: 40 } as DOMRect);
  const blocked = readAgentPage().controls.find(item => item.id === control.id)!; expect(blocked.blocked).toBe(true); expect(blocked.actions).toEqual([]);
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  const current = readAgentPage(); const input = current.controls.find(item => item.label === '搜索作品')!;
  await expect(operateAgentPage({ action: 'fill', snapshotId: current.snapshotId, controlId: input.id, value: 'new', permissionMode: 'read_only' })).rejects.toThrow('只读');
  expect(document.querySelector('input')!.value).toBe('雨天');
});
it('步长与必填校验失败不改变字段、焦点或页面版本，取消导航立即结束等待', async () => {
  document.querySelector('main')!.innerHTML = '<input type="number" min="0" max="3" step="0.1" value="1" aria-label="权重"><input required value="原文" aria-label="必填提示词">';
  const page = readAgentPage();
  await expect(operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[0].id, value: '1.15' })).rejects.toThrow('步长');
  await expect(operateAgentPage({ action: 'fill', snapshotId: page.snapshotId, controlId: page.controls[1].id, value: '' })).rejects.toThrow('必填'); expect(readAgentPage().snapshotId).toBe(page.snapshotId);
  const abort = new AbortController(), pending = operateAgentPage({ action: 'navigate', view: 'history' }, abort.signal); abort.abort(); await expect(pending).rejects.toThrow('停止');
});
it('状态与滚动变化触发实时读取，Agent 自身不会形成循环', async () => {
  const changed = vi.fn(), stop = observeAgentPage(changed);
  try { document.querySelector('button')!.setAttribute('aria-expanded', 'true'); await new Promise(resolve => setTimeout(resolve, 130)); expect(changed).toHaveBeenCalledTimes(1); document.querySelector('aside')!.textContent = 'Agent 新回复'; await new Promise(resolve => setTimeout(resolve, 130)); expect(changed).toHaveBeenCalledTimes(1); }
  finally { stop(); }
});
it('侧栏详情身份属性的变化触发实时刷新，不需再点一次读取', async () => {
  const aside = document.createElement('aside'); aside.textContent = '作品详情'; document.querySelector('main')!.append(aside);
  const refresh = vi.fn(), stop = observeAgentPage(refresh);
  try {
    aside.dataset.agentPageScope = 'detail'; aside.dataset.agentPageTitle = '作品详情：甲'; await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    aside.dataset.agentPageTitle = '作品详情：乙'; await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    delete aside.dataset.agentPageScope; await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(3));
  } finally { stop(); }
});
it('悬停展开现有卡片操作，换卡或结束后释放悬停状态', async () => {
  document.querySelector('main')!.innerHTML = '<style>.group .actions{opacity:0}[data-agent-hover] .actions{opacity:1}</style><div class="group"><button>打开第一张图片</button><button class="actions">查看详情</button></div><div class="group"><button>打开第二张图片</button></div>';
  let page = readAgentPage(); expect(page.controls.some(item => item.label === '查看详情')).toBe(false);
  await operateAgentPage({ action: 'hover', snapshotId: page.snapshotId, controlId: page.controls[0].id });
  page = readAgentPage(); expect(page.controls.find(item => item.label === '查看详情')?.actions).toContain('click');
  await operateAgentPage({ action: 'hover', snapshotId: page.snapshotId, controlId: page.controls.find(item => item.label === '打开第二张图片')!.id });
  expect(document.querySelectorAll('[data-agent-hover]')).toHaveLength(1); expect(readAgentPage().controls.some(item => item.label === '查看详情')).toBe(false);
  clearAgentPageHover(); expect(document.querySelectorAll('[data-agent-hover]')).toHaveLength(0);
});
it('横向滚动作用于实际滚动容器，原生按钮按回车只执行一次', async () => {
  document.querySelector('main')!.innerHTML = '<div style="overflow-x:auto"><button>打开图片</button></div>';
  const scroller = document.querySelector('main div') as HTMLElement;
  Object.defineProperties(scroller, { scrollWidth: { value: 900 }, clientWidth: { value: 300 }, clientHeight: { value: 200 }, scrollBy: { value: vi.fn(({ left }: { left: number }) => { scroller.scrollLeft += left; }) } });
  const next = await operateAgentPage({ action: 'scroll', snapshotId: readAgentPage().snapshotId, direction: 'right', amount: 200 });
  expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 200, behavior: 'auto' }); expect(next.scroll.left).toBe(200);
  const click = vi.fn(); document.querySelector('button')!.onclick = click;
  const page = readAgentPage(); await operateAgentPage({ action: 'press', snapshotId: page.snapshotId, controlId: page.controls[0].id, key: 'Enter' }); expect(click).toHaveBeenCalledOnce();
});
