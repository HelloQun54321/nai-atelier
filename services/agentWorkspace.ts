/** 当前标签页的语义页面桥；每次工具调用重新读 DOM，不把保活实验室当成当前页面。 */
export interface AgentPageSnapshot {
  snapshotId: string; view: string; title: string; capturedAt: number;
  text: string; controls: Array<{ id: string; role: string; label: string; value?: string; actions: string[] }>;
}
export interface AgentPageOperation { action: 'read' | 'click' | 'fill' | 'navigate'; snapshotId?: string; controlId?: string; value?: string; view?: string }
const pages: Record<string, string> = { list: '风格串', characters: '角色库', library: '画师库', aitag: 'AITag', danbooru: 'Danbooru', pixiv: 'Pixiv', inspiration: '灵感库', history: '生成历史', playground: '生图实验室', edit: '风格串编辑器' };
const privateSelector = '[data-agent-private],.agent-overlay,[data-agent-surface],script,style,[type="password"],[type="hidden"]';
let revision = 0, signature = '', lastRead: AgentPageSnapshot | null = null;
let controls = new Map<string, HTMLElement>();
const visible = (element: HTMLElement): boolean => {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};
const labelOf = (element: HTMLElement) => (element.getAttribute('aria-label') || element.getAttribute('title') || ('labels' in element ? Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent).join(' ') : '') || element.getAttribute('placeholder') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const safeField = (element: HTMLElement) => !/key|token|secret|password|密钥|密码|令牌|凭据/i.test(`${labelOf(element)} ${element.getAttribute('name')} ${element.id}`);
const safeClick = (element: HTMLElement) => {
  const label = labelOf(element);
  if (/生成|生图|删除|清空|清理|移除|编码|下载|保存|导入|同步|授权|权限|付款|余额|generate|delete|save|encode|download|login/i.test(label)) return false;
  return element.dataset.agentSafe === 'true' || element.tagName === 'SUMMARY' || element.tagName === 'IMG' || /打开|返回|查看|展开|收起|上一|下一|更多|搜索|筛选|选择|切换|关闭|预览|取消|放大/.test(label);
};
const dispatchRead = (snapshot: AgentPageSnapshot) => {
  lastRead = snapshot;
  window.dispatchEvent(new CustomEvent('nai-agent-page-read', { detail: snapshot }));
};
export const getLastAgentPageRead = () => lastRead;
/** 只观察工坊界面变化，排除 Agent 自身渲染，避免读取栏更新造成循环。 */
export const observeAgentPage = (refresh: () => void) => {
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); }); };
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const element = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      return element && !element.closest('.agent-overlay,[data-agent-surface]');
    })) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-agent-view', 'data-agent-page-title', 'aria-modal', 'hidden', 'aria-hidden', 'style'] });
  const input = (event: Event) => { if (event.target instanceof HTMLElement && !event.target.closest(privateSelector)) schedule(); };
  document.addEventListener('input', input, true); document.addEventListener('change', input, true);
  return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); document.removeEventListener('input', input, true); document.removeEventListener('change', input, true); };
};
export const readAgentPage = (): AgentPageSnapshot => {
  const app = document.querySelector<HTMLElement>('[data-agent-view]');
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter(element => visible(element) && !element.closest('.agent-overlay,[data-agent-surface]'));
  const foreground = dialogs.sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0)).at(-1);
  const scope = foreground || app;
  const view = foreground ? 'dialog' : app?.dataset.agentView || 'unknown';
  const title = foreground ? foreground.dataset.agentPageTitle || foreground.querySelector('h1,h2,h3')?.textContent || foreground.getAttribute('aria-label') || '项目窗口' : pages[view] || '页面尚未就绪';
  const elements = scope ? Array.from(scope.querySelectorAll<HTMLElement>('button,input,textarea,select,summary,img,[role="button"]')).filter(element => visible(element) && !element.closest(privateSelector) && safeField(element)).slice(0, 60) : [];
  const nextControls = new Map<string, HTMLElement>();
  const descriptors = elements.map((element, index) => {
    const id = `control-${index + 1}`; nextControls.set(id, element);
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const editable = field && !element.disabled && !('readOnly' in element && element.readOnly) && !['file', 'checkbox', 'radio', 'range', 'submit', 'button'].includes((element as HTMLInputElement).type);
    const disabled = 'disabled' in element && Boolean(element.disabled);
    return { id, role: element.getAttribute('role') || element.tagName.toLowerCase(), label: labelOf(element) || (element.tagName === 'IMG' ? element.getAttribute('alt') || '图片预览' : '未命名控件'), ...(field ? { value: element.value.slice(0, 400) } : {}), actions: disabled ? [] : [...(editable ? ['fill'] : []), ...(safeClick(element) ? ['click'] : [])] };
  });
  const parts: string[] = [];
  if (scope && !scope.matches('[data-agent-private]')) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node: Node | null, total = 0;
    while ((node = walker.nextNode()) && total < 6000) {
      const parent = node.parentElement;
      if (!parent || parent.closest(privateSelector) || !visible(parent)) continue;
      const value = node.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (value) { parts.push(value.slice(0, 6000 - total)); total += value.length; }
    }
  }
  const nextSignature = JSON.stringify([view, title, parts, descriptors]);
  if (nextSignature !== signature) { signature = nextSignature; revision++; }
  controls = nextControls;
  const snapshot = { snapshotId: `page-${revision}`, view, title: title.trim().slice(0, 160), capturedAt: Date.now(), text: parts.join('\n'), controls: descriptors };
  dispatchRead(snapshot); return snapshot;
};
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
export const operateAgentPage = async (operation: AgentPageOperation): Promise<AgentPageSnapshot> => {
  if (operation.action === 'read') return readAgentPage();
  if (operation.action === 'navigate') {
    if (!operation.view || !pages[operation.view] || operation.view === 'edit') throw new Error('请选择支持的项目页面');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('页面切换未收到回执')), 8000);
      window.dispatchEvent(new CustomEvent('nai-agent-page-navigate', { detail: { view: operation.view, resolve: () => { clearTimeout(timer); resolve(); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } } }));
    });
  } else {
    const snapshot = readAgentPage();
    if (operation.snapshotId !== snapshot.snapshotId) throw new Error('页面已变化，请重新读取后操作');
    const descriptor = snapshot.controls.find(item => item.id === operation.controlId);
    const element = controls.get(operation.controlId || '');
    if (!descriptor?.actions.includes(operation.action) || !element?.isConnected) throw new Error('该控件不支持此操作；生成、保存、删除请使用业务工具');
    if (operation.action === 'click') element.click();
    else if (operation.action === 'fill') {
      const value = String(operation.value || '').slice(0, 8000);
      if (element instanceof HTMLSelectElement && !Array.from(element.options).some(option => option.value === value && !option.disabled)) throw new Error('请选择页面提供的有效选项');
      if (element instanceof HTMLInputElement && element.type === 'number' && value !== '') {
        const number = Number(value);
        if (!Number.isFinite(number) || element.min !== '' && number < Number(element.min) || element.max !== '' && number > Number(element.max)) throw new Error('数值超出页面允许范围');
      }
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
    } else throw new Error('未知的页面操作');
  }
  await paint();
  const next = readAgentPage();
  if (operation.action === 'navigate' && next.view !== operation.view) throw new Error(`页面尚未切换到目标，当前为 ${next.title}`);
  return next;
};
