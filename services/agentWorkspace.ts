/** 工坊页面语义桥：按前景、状态和可验证结果协作，不把 DOM 点击当成任务完成。 */
export interface AgentPageControl {
  id: string; role: string; label: string; actions: string[];
  value?: string; valueLength?: number; valueOffset?: number; nextValueOffset?: number;
  checked?: boolean; selected?: boolean; expanded?: boolean; pressed?: boolean;
  disabled: boolean; readOnly: boolean; inViewport: boolean; blocked: boolean; focused: boolean;
  min?: string; max?: string; step?: string; maxLength?: number; multiple?: boolean;
  options?: Array<{ value: string; label: string; disabled: boolean; selected: boolean }>;
  optionTotal?: number; optionsOffset?: number; nextOptionsOffset?: number;
}
export interface AgentPageSnapshot {
  snapshotId: string; view: string; title: string; capturedAt: number; text: string;
  controls: AgentPageControl[]; totalControls: number; offset: number; nextOffset?: number;
  textLength: number; textOffset: number; nextTextOffset?: number; busy: boolean;
  foreground: string; viewport: { width: number; height: number }; scroll: { top: number; left: number; height: number; clientHeight: number };
  verification?: { action: string; status: 'changed' | 'unchanged' | 'matched'; message: string; control?: AgentPageControl };
}
export interface AgentPageReadOptions { query?: string; offset?: number; limit?: number; controlId?: string; valueOffset?: number; optionsOffset?: number; textOffset?: number; snapshotId?: string }
export interface AgentPageExpectation { label?: string; text?: string; view?: string; value?: string; checked?: boolean; selected?: boolean; expanded?: boolean; pressed?: boolean }
export interface AgentPageOperation extends AgentPageReadOptions {
  action: 'read' | 'click' | 'fill' | 'select' | 'check' | 'navigate' | 'scroll' | 'press' | 'hover' | 'wait';
  value?: string; values?: string[]; checked?: boolean; view?: string; key?: string; commit?: boolean;
  direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; timeoutMs?: number; expect?: AgentPageExpectation;
  permissionMode?: 'read_only' | 'standard' | 'full';
}
const pages: Record<string, string> = { list: '风格串', characters: '角色库', library: '画师库', aitag: 'AITag', danbooru: 'Danbooru', pixiv: 'Pixiv', inspiration: '灵感库', history: '生成历史', playground: '生图实验室', edit: '风格串编辑器' };
const privateSelector = '[data-agent-private],.agent-overlay,[data-agent-surface],script,style,[type="password"],[type="hidden"]';
const controlSelector = 'button,input,textarea,select,summary,img,a[href],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="option"],[role="menuitem"],[role="slider"],[contenteditable="true"]';
const bootId = Math.random().toString(36).slice(2, 10);
let revision = 0, signature = '', lastRead: AgentPageSnapshot | null = null, serial = 0;
const ids = new WeakMap<HTMLElement, string>();
let controls = new Map<string, HTMLElement>();
let hoveredGroup: HTMLElement | null = null;
export const clearAgentPageHover = () => { hoveredGroup?.removeAttribute('data-agent-hover'); hoveredGroup = null; };
let styles = new WeakMap<HTMLElement, CSSStyleDeclaration>();
const styleOf = (element: HTMLElement) => { let style = styles.get(element); if (!style) { style = getComputedStyle(element); styles.set(element, style); } return style; };
const field = (element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
const visible = (element: HTMLElement): boolean => {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = styleOf(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (node instanceof HTMLDetailsElement && !node.open && node !== element && !node.querySelector('summary')?.contains(element)) return false;
  }
  return true;
};
const labelOf = (element: HTMLElement) => (element.getAttribute('aria-label') || element.getAttribute('title') || ('labels' in element ? Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent).join(' ') : '') || element.getAttribute('placeholder') || element.getAttribute('alt') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const safeField = (element: HTMLElement) => !element.closest(privateSelector) && !/api\s*key|(?:^|[\s_-])key(?:$|[\s_-])|token|secret|password|密钥|密码|口令|令牌|凭据/i.test(`${labelOf(element)} ${element.getAttribute('name')} ${element.id}`);
const disabled = (element: HTMLElement) => element.matches(':disabled') || ('disabled' in element && Boolean(element.disabled)) || Boolean(element.closest('[inert],[aria-disabled="true"]'));
const roleOf = (element: HTMLElement) => element.getAttribute('role') || (element instanceof HTMLInputElement ? element.type === 'checkbox' || element.type === 'radio' ? element.type : element.type === 'range' ? 'slider' : 'input' : element.tagName.toLowerCase());
const safeClick = (element: HTMLElement) => {
  const role = roleOf(element);
  if (element.dataset.agentAction === 'business' || element.closest('[data-agent-action="business"]')) return false;
  if (['browse', 'select'].includes(element.dataset.agentAction || '')) return true;
  // 选项和标签页是选择行为；不能因“图生图”等名称把切换模式误当作执行生图。
  if (['tab', 'option'].includes(role)) return true;
  if (/删除|清空|清理|移除|编码|下载|保存|导入|同步|授权|权限|付款|余额|生成|生图$|generate|delete|save|encode|download|login/i.test(labelOf(element))) return false;
  if (element instanceof HTMLAnchorElement) return element.origin === location.origin && element.target !== '_blank';
  return element.dataset.agentSafe === 'true' || ['button', 'checkbox', 'radio', 'switch', 'menuitem', 'summary', 'img'].includes(role);
};
const layerOf = (element: HTMLElement) => {
  let layer = 0;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) layer = Math.max(layer, Number(styleOf(node).zIndex) || 0);
  return layer;
};
const pageScope = () => {
  const app = document.querySelector<HTMLElement>('[data-agent-view]');
  // 桌面作品详情是侧栏，不是模态窗口；同样应作为当前阅读对象，避免列表吞掉详情。
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-page-scope="detail"],[aria-modal="true"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')).filter(element => visible(element) && !element.closest('.agent-overlay,[data-agent-surface]'));
  const foreground = overlays.reduce<HTMLElement | undefined>((current, element) => !current || current.contains(element) || !element.contains(current) && layerOf(element) >= layerOf(current) ? element : current, undefined);
  const scope = foreground || app;
  const kind = foreground?.dataset.agentPageScope === 'detail' ? 'detail' : foreground?.getAttribute('role') || '';
  const view = foreground && kind !== 'detail' ? 'dialog' : app?.dataset.agentView || 'unknown';
  const title = foreground ? foreground.dataset.agentPageTitle || foreground.getAttribute('aria-label') || foreground.querySelector('h1,h2,h3')?.textContent || ({ listbox: '候选建议', menu: '操作菜单' }[kind] || '项目窗口') : pages[view] || '页面尚未就绪';
  return { app, scope, view, title: `${kind === 'detail' ? `${pages[view] || '工坊'} · ` : ''}${title.trim()}`.slice(0, 160), foreground: kind };
};
const bounds = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  // 无布局环境只用于语义读取；真实浏览器必须检查视口、裁切与遮挡。
  let inViewport = rect.width === 0 && rect.height === 0 && typeof document.elementFromPoint !== 'function' || rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  for (let node = element.parentElement; inViewport && node; node = node.parentElement) {
    if (/(hidden|clip|auto|scroll)/.test(`${styleOf(node).overflow} ${styleOf(node).overflowY} ${styleOf(node).overflowX}`)) {
      const clip = node.getBoundingClientRect();
      if (clip.width && clip.height) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); if (right <= left || bottom <= top) inViewport = false; }
    }
  }
  let blocked = false;
  if (inViewport && typeof document.elementFromPoint === 'function' && rect.width && rect.height) {
    const x = Math.min(innerWidth - 1, (left + right) / 2), y = Math.min(innerHeight - 1, (top + bottom) / 2);
    const hit = document.elementFromPoint(x, y);
    blocked = Boolean(hit && !element.contains(hit) && !(hit instanceof HTMLLabelElement && hit.control === element));
  }
  return { inViewport, blocked };
};
const rawValue = (element: HTMLElement) => field(element) ? element.value : element.isContentEditable ? element.textContent || '' : undefined;
const boolAttr = (element: HTMLElement, name: string) => element.hasAttribute(name) ? element.getAttribute(name) === 'true' : undefined;
const checkedOf = (element: HTMLElement) => element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.checked : boolAttr(element, 'aria-checked');
const scrollContainer = (scope: HTMLElement | null | undefined) => {
  if (scope) {
    const candidates = [scope, ...Array.from(scope.querySelectorAll<HTMLElement>('*'))].filter(element => (element.scrollHeight > element.clientHeight + 2 && /(auto|scroll)/.test(styleOf(element).overflowY) || element.scrollWidth > element.clientWidth + 2 && /(auto|scroll)/.test(styleOf(element).overflowX)) && visible(element) && !element.closest(privateSelector));
    if (candidates.length) return candidates.sort((a, b) => b.clientHeight - a.clientHeight)[0];
  }
  return document.scrollingElement as HTMLElement || document.documentElement;
};
const capture = () => {
  styles = new WeakMap();
  const page = pageScope(), scope = page.scope;
  const elements = scope ? Array.from(scope.querySelectorAll<HTMLElement>(controlSelector)).filter(element => visible(element) && safeField(element)) : [];
  const nextControls = new Map<string, HTMLElement>();
  const descriptors = elements.map(element => {
    let id = ids.get(element); if (!id) { id = `control-${++serial}`; ids.set(element, id); } nextControls.set(id, element);
    const role = roleOf(element), isDisabled = disabled(element), readOnly = 'readOnly' in element && Boolean(element.readOnly), box = bounds(element);
    const isSelect = element instanceof HTMLSelectElement, checkable = ['checkbox', 'radio', 'switch'].includes(role) || element.hasAttribute('aria-pressed');
    const editable = (field(element) && !['file', 'checkbox', 'radio', 'submit', 'button'].includes((element as HTMLInputElement).type) || element.isContentEditable) && !readOnly;
    const actions = isDisabled ? [] : [...(!box.inViewport ? ['scroll'] : []), ...(box.inViewport && !box.blocked ? [...(editable ? [isSelect ? 'select' : 'fill'] : []), ...(checkable && safeClick(element) ? ['check'] : []), ...(safeClick(element) ? ['click', 'hover'] : []), ...(editable || safeClick(element) ? ['press'] : [])] : [])];
    return { id, role, label: labelOf(element) || '未命名控件', value: rawValue(element), checked: checkedOf(element), selected: boolAttr(element, 'aria-selected'), expanded: element.tagName === 'SUMMARY' ? (element.parentElement as HTMLDetailsElement)?.open : boolAttr(element, 'aria-expanded'), pressed: boolAttr(element, 'aria-pressed'), disabled: isDisabled, readOnly, focused: document.activeElement === element, ...box, actions,
      ...(element instanceof HTMLInputElement ? { min: element.min, max: element.max, step: element.step, maxLength: element.maxLength } : {}),
      ...(isSelect ? { multiple: element.multiple, options: Array.from(element.options).map(option => ({ value: option.value, label: option.label, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled), selected: option.selected })) } : {}) };
  }).sort((a, b) => Number(b.inViewport) - Number(a.inViewport));
  const parts: string[] = [];
  if (scope && !scope.matches('[data-agent-private]')) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT); let node: Node | null;
    while ((node = walker.nextNode())) { const parent = node.parentElement; if (parent && !parent.closest(privateSelector) && visible(parent)) { const value = node.textContent?.replace(/\s+/g, ' ').trim(); if (value) parts.push(value); } }
  }
  const scroll = scrollContainer(scope), text = parts.join('\n');
  const busy = Boolean(scope?.matches('[aria-busy="true"]') || scope?.querySelector('[aria-busy="true"]')) || Boolean(scope && /正在加载|加载中|Loading\.\.\./i.test(text.slice(0, 2000)));
  const nextSignature = JSON.stringify([page.view, page.title, page.foreground, text, descriptors, scroll.scrollTop, scroll.scrollLeft]);
  if (nextSignature !== signature) { signature = nextSignature; revision++; }
  controls = nextControls;
  return { ...page, snapshotId: `page-${bootId}-${revision}`, descriptors, text, busy, scroll };
};
export const getLastAgentPageRead = () => lastRead;
export const getAgentPageClientId = () => {
  try { let id = sessionStorage.getItem('nai-agent-page-client'); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('nai-agent-page-client', id); } return id; } catch { return bootId; }
};
export const readAgentPage = (options: AgentPageReadOptions = {}): AgentPageSnapshot => {
  const page = capture();
  if (options.snapshotId && options.snapshotId !== page.snapshotId) throw new Error('页面已变化，请重新读取后继续');
  const query = options.query?.toLowerCase() || '';
  const filtered = page.descriptors.filter(item => (!options.controlId || item.id === options.controlId) && (!query || `${item.label} ${item.role}`.toLowerCase().includes(query)));
  const offset = Math.max(0, Math.floor(options.offset || 0)), limit = Math.max(1, Math.min(20, Math.floor(options.limit || 12))), valueOffset = Math.max(0, Math.floor(options.valueOffset || 0)), optionsOffset = Math.max(0, Math.floor(options.optionsOffset || 0)), textOffset = Math.max(0, Math.floor(options.textOffset || 0));
  const bounded: AgentPageControl[] = []; let size = 0;
  for (const item of filtered.slice(offset, offset + limit)) {
    const optionPage = item.options?.slice(optionsOffset, optionsOffset + 12);
    const control: AgentPageControl = { ...item, ...(item.value !== undefined ? { value: item.value.slice(valueOffset, valueOffset + 1600), valueLength: item.value.length, valueOffset, ...(item.value.length > valueOffset + 1600 ? { nextValueOffset: valueOffset + 1600 } : {}) } : {}), ...(optionPage ? { options: optionPage, optionTotal: item.options!.length, optionsOffset } : {}) };
    while (optionPage && optionPage.length > 1 && JSON.stringify(control).length > 30_000) optionPage.pop();
    if (optionPage && item.options!.length > optionsOffset + optionPage.length) control.nextOptionsOffset = optionsOffset + optionPage.length;
    const length = JSON.stringify(control).length;
    if (length > 36_000) throw new Error('控件内容过大，请使用对应业务工具读取');
    if (bounded.length && size + length > 36_000) break;
    bounded.push(control); size += length;
  }
  const snapshot: AgentPageSnapshot = { snapshotId: page.snapshotId, view: page.view, title: page.title, foreground: page.foreground, capturedAt: Date.now(), busy: page.busy, text: page.text.slice(textOffset, textOffset + 2400), textLength: page.text.length, textOffset, ...(page.text.length > textOffset + 2400 ? { nextTextOffset: textOffset + 2400 } : {}), controls: bounded, totalControls: filtered.length, offset, ...(filtered.length > offset + bounded.length ? { nextOffset: offset + bounded.length } : {}), viewport: { width: innerWidth, height: innerHeight }, scroll: { top: page.scroll.scrollTop, left: page.scroll.scrollLeft, height: page.scroll.scrollHeight, clientHeight: page.scroll.clientHeight } };
  lastRead = snapshot; window.dispatchEvent(new CustomEvent('nai-agent-page-read', { detail: snapshot })); return snapshot;
};
/** 属性、焦点、滚动和内容变化都可被感知；Agent 自身不会造成读取循环。 */
export const observeAgentPage = (refresh: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; refresh(); }, 100); };
  const observer = new MutationObserver(records => { if (records.some(record => { const element = record.target instanceof HTMLElement ? record.target : record.target.parentElement; return element && !element.closest('.agent-overlay,[data-agent-surface]'); })) schedule(); });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-agent-view', 'data-agent-page-scope', 'data-agent-page-title', 'role', 'aria-label', 'aria-modal', 'aria-expanded', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-disabled', 'aria-busy', 'hidden', 'aria-hidden', 'style', 'class', 'open', 'disabled', 'checked', 'value'] });
  const input = (event: Event) => { if (event.target instanceof HTMLElement && !event.target.closest(privateSelector)) schedule(); };
  const pointer = (event: Event) => { if (event.isTrusted && hoveredGroup && event.target instanceof Node && !hoveredGroup.contains(event.target)) { clearAgentPageHover(); schedule(); } };
  for (const name of ['input', 'change', 'focusin', 'focusout', 'scroll']) document.addEventListener(name, input, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('pointermove', pointer, true);
  return () => { observer.disconnect(); clearTimeout(timer); for (const name of ['input', 'change', 'focusin', 'focusout', 'scroll']) document.removeEventListener(name, input, true); window.removeEventListener('resize', schedule); document.removeEventListener('pointermove', pointer, true); };
};
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener('abort', abort); resolve(); }, timer = setTimeout(finish, ms);
  const abort = () => { clearTimeout(timer); reject(new Error('页面操作已停止')); };
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
const matches = (expectation: AgentPageExpectation, page: ReturnType<typeof capture>, controlId?: string, target?: HTMLElement) => {
  if (expectation.view && page.view !== expectation.view || expectation.text && !page.text.includes(expectation.text)) return false;
  const candidates: Array<Partial<AgentPageControl>> = page.descriptors.filter(item => expectation.label ? item.label.includes(expectation.label) : !controlId || item.id === controlId);
  if (target?.isConnected && (!expectation.label || labelOf(target).includes(expectation.label))) candidates.push({ value: rawValue(target), checked: checkedOf(target), selected: boolAttr(target, 'aria-selected'), expanded: target.tagName === 'SUMMARY' ? (target.parentElement as HTMLDetailsElement)?.open : boolAttr(target, 'aria-expanded'), pressed: boolAttr(target, 'aria-pressed') });
  const states = ['value', 'checked', 'selected', 'expanded', 'pressed'] as const;
  return (!expectation.label && states.every(key => expectation[key] === undefined)) || candidates.some(item => states.every(key => expectation[key] === undefined || item[key] === expectation[key]));
};
const waitForPage = async (before: string, operation: AgentPageOperation, signal?: AbortSignal, target?: HTMLElement) => {
  const deadline = Date.now() + Math.max(200, Math.min(8000, operation.timeoutMs || (operation.action === 'wait' ? 5000 : 3000)));
  let previous = '', stableSince = Date.now();
  while (true) {
    signal?.throwIfAborted(); const page = capture();
    if (page.snapshotId !== previous) { previous = page.snapshotId; stableSince = Date.now(); }
    const ready = operation.expect ? matches(operation.expect, page, operation.controlId, target) : ['wait', 'click', 'scroll'].includes(operation.action) ? page.snapshotId !== before : true;
    if (ready && !page.busy && Date.now() - stableSince >= 160) return page;
    if (Date.now() >= deadline) { if (operation.expect || operation.action === 'wait' || page.busy) throw new Error('等待页面目标状态超时；请重新读取，不要重复切换按钮'); return page; }
    await pause(50, signal);
  }
};
const writableValue = (element: HTMLElement, value: string) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.maxLength >= 0 && value.length > element.maxLength) throw new Error('输入超过页面允许长度');
    if (element instanceof HTMLInputElement && ['number', 'range'].includes(element.type) && value !== '') {
      const number = Number(value);
      if (!Number.isFinite(number) || element.min !== '' && number < Number(element.min) || element.max !== '' && number > Number(element.max)) throw new Error('数值超出页面允许范围');
    }
    const validation = element.cloneNode() as HTMLInputElement | HTMLTextAreaElement; validation.value = value;
    if (!validation.checkValidity()) throw new Error('输入不符合页面格式、步长或必填要求');
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    element.focus();
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  } else if (element.isContentEditable) { element.focus(); element.textContent = value; }
  else throw new Error('该控件不是文本或数值输入');
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
};
export const operateAgentPage = async (operation: AgentPageOperation, signal?: AbortSignal): Promise<AgentPageSnapshot> => {
  signal?.throwIfAborted();
  if (operation.action === 'read') return readAgentPage(operation);
  const before = capture();
  const target = controls.get(operation.controlId || '');
  if (operation.action !== 'navigate' && operation.action !== 'wait' && operation.snapshotId !== before.snapshotId) throw new Error('页面已变化，请重新读取后操作');
  let expectation = operation.expect;
  if (operation.action === 'navigate') {
    if (!operation.view || !pages[operation.view] || operation.view === 'edit') throw new Error('请选择支持的项目页面');
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
      const abort = () => finish(new Error('页面操作已停止'));
      const timer = setTimeout(() => finish(new Error('页面切换未收到回执')), 8000);
      signal?.addEventListener('abort', abort, { once: true });
      window.dispatchEvent(new CustomEvent('nai-agent-page-navigate', { detail: { view: operation.view, resolve: () => finish(), reject: finish } }));
    });
    expectation ||= { view: operation.view };
  } else if (operation.action === 'scroll' && !operation.controlId) {
    const element = before.scroll, horizontal = ['left', 'right'].includes(operation.direction || ''), delta = Math.min(4000, Math.max(1, operation.amount || element.clientHeight * .8 || innerHeight * .8)) * (['up', 'left'].includes(operation.direction || '') ? -1 : 1);
    element.scrollBy({ [horizontal ? 'left' : 'top']: delta, behavior: 'auto' });
  } else if (operation.action !== 'wait') {
    const element = controls.get(operation.controlId || ''), descriptor = before.descriptors.find(item => item.id === operation.controlId);
    const action = operation.action === 'fill' && element instanceof HTMLSelectElement ? 'select' : operation.action;
    if (!element?.isConnected || !descriptor?.actions.includes(action)) throw new Error('该控件不可操作、被遮挡或需使用业务工具；请重新读取');
    if (operation.permissionMode === 'read_only' && !['scroll', 'hover'].includes(action) && !(action === 'click' && (['img', 'summary', 'tab'].includes(descriptor.role) || element.hasAttribute('aria-haspopup') || /打开|返回|查看|关闭|预览/.test(descriptor.label))) && !(action === 'press' && ['Escape', 'Tab', 'Shift+Tab', 'PageDown', 'PageUp'].includes(operation.key || ''))) throw new Error('当前为只读权限，不能填写或改变项目控件');
    if (action === 'scroll') element.scrollIntoView({ block: 'center', behavior: 'auto' });
    else if (action === 'click') element.click();
    else if (action === 'fill') {
      const value = String(operation.value ?? ''); if (value.length > 100_000) throw new Error('输入过长，请使用提示词业务工具');
      writableValue(element, value); if (operation.commit !== false) element.blur();
      expectation ||= { label: descriptor.label, value };
    } else if (action === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('该控件不是下拉选择器');
      const values = operation.values || [operation.value ?? ''];
      if (!element.multiple && values.length !== 1 || values.some(value => !Array.from(element.options).some(option => option.value === value && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)))) throw new Error('请选择页面提供的有效选项');
      element.focus(); for (const option of element.options) option.selected = values.includes(option.value);
      element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); element.blur();
      if (!element.multiple) expectation ||= { label: descriptor.label, value: values[0] };
    } else if (action === 'check') {
      if (typeof operation.checked !== 'boolean') throw new Error('请明确指定勾选或取消');
      if (descriptor.role === 'radio' && !operation.checked) throw new Error('单选项请通过选择其他项取消');
      const pressed = element.hasAttribute('aria-pressed');
      if ((pressed ? boolAttr(element, 'aria-pressed') : checkedOf(element)) !== operation.checked) element.click();
      expectation ||= { label: descriptor.label, [pressed ? 'pressed' : 'checked']: operation.checked };
    } else if (action === 'hover') {
      clearAgentPageHover(); hoveredGroup = element.closest<HTMLElement>('.group'); hoveredGroup?.setAttribute('data-agent-hover', 'true');
      if (typeof PointerEvent === 'function') { element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); }
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    } else if (action === 'press') {
      const key = operation.key || '';
      if (!['Enter', 'Escape', 'Tab', 'Shift+Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) throw new Error('仅支持页面导航和输入提交按键');
      element.focus(); const event = new KeyboardEvent('keydown', { key: key === 'Shift+Tab' ? 'Tab' : key, shiftKey: key === 'Shift+Tab', bubbles: true, cancelable: true }); element.dispatchEvent(event);
      if (!event.defaultPrevented) {
        if (key === 'Tab' || key === 'Shift+Tab') { const list = before.descriptors.filter(item => !item.disabled && item.inViewport && !item.blocked).map(item => controls.get(item.id)!); const index = list.indexOf(element); (list[(index + (key === 'Tab' ? 1 : list.length - 1)) % list.length] || element).focus(); }
        else if (key === 'Enter') { if (!field(element) && !element.isContentEditable && safeClick(element)) element.click(); else element.blur(); } // 不模拟表单提交，生图等操作只能走专用工具。
        else if (element instanceof HTMLSelectElement && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
          const options = Array.from(element.options).filter(option => !option.disabled), index = options.findIndex(option => option.selected), next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (key === 'ArrowDown' ? 1 : -1)));
          if (options[next]) { element.value = options[next].value; element.dispatchEvent(new Event('change', { bubbles: true })); }
        } else if (['PageDown', 'PageUp'].includes(key)) before.scroll.scrollBy({ top: before.scroll.clientHeight * (key === 'PageDown' ? 1 : -1), behavior: 'auto' });
      }
      element.dispatchEvent(new KeyboardEvent('keyup', { key: event.key, bubbles: true }));
    }
  }
  const next = await waitForPage(before.snapshotId, { ...operation, expect: expectation }, signal, target);
  const snapshot = readAgentPage();
  const targetControl = operation.controlId ? next.descriptors.find(item => item.id === operation.controlId) : undefined;
  snapshot.verification = { action: operation.action, status: expectation ? 'matched' : next.snapshotId !== before.snapshotId ? 'changed' : 'unchanged', message: expectation ? '目标状态已确认' : next.snapshotId !== before.snapshotId ? '页面状态已变化；请根据新回执继续' : '未检测到变化；请读取或等待目标状态，不要重复切换按钮', ...(targetControl ? { control: { ...targetControl, value: targetControl.value?.slice(0, 1600), options: undefined } } : {}) };
  return snapshot;
};
