// @vitest-environment jsdom
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentLibraryPage, type ContentLibrarySection } from '../../components/ContentLibraryPage';
import { useMobileHistoryLayer } from '../../components/MobileUI';

afterEach(() => cleanup());

/* 只提供打开面板所需的助手配置；本轮不触发模型调用。 */
vi.mock('../../services/promptAgent', () => ({
  promptAgentService: {
    getConfig: async () => ({ provider: 'synthetic', model: 'synthetic-model', imageInput: false }),
    extractCandidates: async () => ({ mode: 'text', provider: 'synthetic', model: 'synthetic-model', items: [], unclassified: null }),
  },
  PROMPT_LIBRARY_KIND_LABELS: { appearance: '人物形象', wardrobe: '服饰', pose: '姿势', expression: '表情状态', scene: '场景', camera: '镜头画面' },
}));
/* 提取面板要用确认框与词库：本文件只验证工具栏入口，桩成最小可用形态。 */
vi.mock('../../components/ConfirmDialog', () => ({ useConfirmDialog: () => async () => true }));
vi.mock('../../services/tagDictionary', () => ({
  normalizeTagQuery: (value: string) => String(value || '').trim().toLowerCase(),
  preloadTagDictionary: () => undefined,
  searchTagDictionary: async () => [],
  lookupTagTranslations: async () => new Map(),
  /* 上游 1.121.1 起输入框会查词典释义；这里同样桩成空表。 */
  lookupTagCatalogEntries: async () => new Map(),
}));

const Tools = ({ slot, label }: { slot: HTMLElement | null; label: string }) => {
  const [value, setValue] = useState('');
  return <div data-testid={label}>{slot && createPortal(<><button>筛选</button><input aria-label={label} value={value} onChange={event => setValue(event.target.value)} /></>, slot)}</div>;
};
const Harness = ({ active = true, onCapture, onExtractSave }: { active?: boolean; onCapture?: (text: string, name: string, category: string) => Promise<void>; onExtractSave?: (draft: { kind: string; name: string; prompt: string }) => Promise<void> }) => {
  const [section, setSection] = useState<ContentLibrarySection>('items');
  const [rollOpen, setRollOpen] = useState(false);
  return <ContentLibraryPage section={section} onSectionChange={setSection} active={active} rollOpen={rollOpen} onRollOpenChange={setRollOpen} onCapture={onCapture} onExtractSave={onExtractSave}
    items={slot => <Tools slot={slot} label="条目搜索" />}
    roll={slot => <Tools slot={slot} label="搭配草稿" />}
    saved={slot => <Tools slot={slot} label="组合搜索" />} originals={slot => <Tools slot={slot} label="原文搜索" />} />;
};

it('AI 提取分类只在提供保存处理器时出现，排在粘贴收录之前，打开与关闭不影响原库', async () => {
  const view = render(<Harness />);
  expect(screen.queryByRole('button', { name: 'AI 提取分类' })).toBeNull();
  const save = vi.fn(async () => {});
  view.rerender(<Harness onCapture={vi.fn(async () => {})} onExtractSave={save} />);
  const toolbar = screen.getByRole('banner');
  const labels = Array.from(toolbar.querySelectorAll('button')).map(node => node.textContent || node.getAttribute('aria-label'));
  expect(labels.indexOf('AI 提取分类')).toBeGreaterThan(-1);
  expect(labels.indexOf('AI 提取分类')).toBeLessThan(labels.indexOf('粘贴收录'));
  /* 窄屏与「粘贴收录」同一套响应式规则：图标常显，文字在 sm 以下收起，靠 aria-label 保持可读 */
  const extractButton = screen.getByRole('button', { name: 'AI 提取分类' });
  expect(extractButton.querySelector('svg')).toBeTruthy();
  expect(extractButton.querySelector('span')?.className).toContain('hidden sm:inline');
  expect(extractButton.getAttribute('aria-haspopup')).toBe('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'AI 提取分类' }));
  const dialog = await screen.findByRole('dialog', { name: 'AI 提取分类' });
  expect(dialog).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭并保留草稿' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it('粘贴收录两库均可达，后台隐藏且返回保留原文，不干扰原列表搜索与焦点', () => {
  const save = vi.fn(async () => {}); const view = render(<Harness onCapture={save} />);
  const trigger = screen.getByRole('button', { name: '粘贴收录' }); trigger.focus(); fireEvent.click(trigger);
  const text = screen.getByRole('textbox', { name: '提示词原文' });
  expect(document.activeElement).toBe(text);
  fireEvent.change(text, { target: { value: 'snow' } });
  view.rerender(<Harness active={false} onCapture={save} />); expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Harness onCapture={save} />);
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('snow');
  fireEvent.keyDown(window, { key: 'Escape' }); expect(document.activeElement).toBe(trigger);
  fireEvent.click(screen.getByRole('tab', { name: '组合' }));
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  expect((screen.getByRole('textbox', { name: '提示词原文' }) as HTMLTextAreaElement).value).toBe('snow');
  expect(save).not.toHaveBeenCalled();
});

it('仅保留片段和组合入口，筛选、搜索、Roll 操作顺序一致，切库保留草稿', () => {
  render(<Harness />);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.queryByRole('tab', { name: '全部' })).toBeNull();
  expect(screen.queryByRole('tab', { name: '原文' })).toBeNull();
  expect(screen.queryByTestId('组合搜索')).toBeNull();
  expect(screen.queryByTestId('搭配草稿')).toBeNull();
  const toolbar = screen.getByRole('banner');
  expect(Array.from(toolbar.querySelectorAll('button,input')).map(node => node.textContent || node.getAttribute('aria-label')))
    .toEqual(['片段', '组合', '筛选', '条目搜索', '随机搭配']);
  fireEvent.change(screen.getByRole('textbox', { name: '条目搜索' }), { target: { value: 'night' } });
  const items = screen.getByTestId('条目搜索');
  fireEvent.keyDown(screen.getByRole('tab', { name: '片段' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: '组合' }).id);
  expect(screen.queryByRole('textbox', { name: '条目搜索' })).toBeNull();
  expect(screen.getByRole('textbox', { name: '组合搜索' }).closest('header')).toBe(toolbar);
  fireEvent.keyDown(screen.getByRole('tab', { name: '组合' }), { key: 'Home' });
  expect(screen.getByTestId('条目搜索')).toBe(items);
  expect((screen.getByRole('textbox', { name: '条目搜索' }) as HTMLInputElement).value).toBe('night');
});

it('旧原文分区请求只读回落片段，不恢复已移除的顶部入口或修改资料', () => {
  const changeSection = vi.fn(); const originals = vi.fn(() => <div>原文旧面板</div>);
  render(<ContentLibraryPage section="originals" onSectionChange={changeSection} rollOpen={false} onRollOpenChange={vi.fn()}
    items={() => <div>片段当前面板</div>} saved={() => null} originals={originals} roll={() => null} />);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['片段', '组合']);
  expect(screen.getByRole('tab', { name: '片段' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('片段当前面板')).toBeTruthy();
  expect(originals).not.toHaveBeenCalled();
  expect(changeSection).not.toHaveBeenCalled();
});

it('Roll 按需打开独立面板，关闭与重新打开保留搭配和原库，焦点回到触发按钮', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: '组合' }));
  const trigger = screen.getByRole('button', { name: '随机搭配' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '随机搭配' });
  expect(screen.getByRole('tab', { name: '组合' }).getAttribute('aria-selected')).toBe('true');
  const input = within(dialog).getByRole('textbox', { name: '搭配草稿' });
  fireEvent.change(input, { target: { value: '月下漫步' } });
  expect(within(dialog).getByRole('button', { name: '关闭搭配面板' })).toBe(document.activeElement);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByRole('textbox', { name: '搭配草稿' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe('月下漫步');
  fireEvent.click(screen.getByRole('button', { name: '关闭搭配面板' }));
  expect(screen.getByRole('tab', { name: '组合' }).getAttribute('aria-selected')).toBe('true');
});

it('页面进入后台后隐藏 portal 面板，重新激活保留草稿；Tab 不移出弹窗', () => {
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '随机搭配' }));
  const input = screen.getByRole('textbox', { name: '搭配草稿' }); input.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭搭配面板' }));
  view.rerender(<Harness active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<Harness />);
  expect(screen.getByRole('textbox', { name: '搭配草稿' })).toBe(input);
});

it('统一浏览替换原分区，收录成功通过临时查看回调定位新资料', async () => {
  const save = vi.fn(async () => 'new-entry');
  const saved = vi.fn(); const view = vi.fn();
  render(<ContentLibraryPage section="items" onSectionChange={vi.fn()} rollOpen={false} onRollOpenChange={vi.fn()}
    onCapture={save} onCaptureSaved={saved} onViewCaptured={view}
    browse={slot => <Tools slot={slot} label="统一搜索" />} items={() => <div>旧片段</div>} saved={() => null} roll={() => null} />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByText('旧片段')).toBeNull();
  expect(screen.getByRole('textbox', { name: '统一搜索' }).closest('header')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '粘贴收录' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提示词原文' }), { target: { value: 'new prompt' } });
  fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith('new-entry'));
  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  expect(view).toHaveBeenCalledWith('new-entry');
  expect(save).toHaveBeenCalledWith('new prompt', '', '', []);
});

it('统一浏览普通入口称搭配，固定目标沿用随机搭配，旧分区默认名称保持兼容', () => {
  const props = { section: 'items' as const, onSectionChange: vi.fn(), rollOpen: true, onRollOpenChange: vi.fn(), browse: (slot: HTMLElement | null) => <Tools slot={slot} label="统一搜索" />,
    items: () => null, saved: () => null, roll: () => null };
  const view = render(<ContentLibraryPage {...props} />);
  expect(screen.getByRole('button', { name: '搭配' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: '搭配' })).toBeTruthy();
  view.rerender(<ContentLibraryPage {...props} rollTitle="随机搭配" />);
  expect(screen.getByRole('button', { name: '随机搭配' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: '随机搭配' })).toBeTruthy();
});

it('手机父搭配与子使用层逐次返回只关闭一层，不越过搭配直接离站', async () => {
  const originalMatchMedia = window.matchMedia;
  const originalState = window.history.state;
  const pageUrl = window.location.href;
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
  window.history.replaceState({ testBase: true }, '');
  const ChildUse = () => {
    const [open, setOpen] = useState(false);
    const close = useMobileHistoryLayer(open, () => setOpen(false), 'test-use');
    return <><button onClick={() => setOpen(true)}>打开使用层</button>{open && createPortal(<div role="dialog" aria-label="使用提示词"><button onClick={close}>关闭使用层</button></div>, document.body)}</>;
  };
  const NestedHarness = () => {
    const [open, setOpen] = useState(false);
    return <ContentLibraryPage section="items" onSectionChange={vi.fn()} rollOpen={open} onRollOpenChange={setOpen}
      items={() => null} saved={() => null} roll={() => <ChildUse />} />;
  };
  const view = render(<NestedHarness />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '随机搭配' }));
    await waitFor(() => expect(window.history.state.__naiMobileLayer).toMatch(/^content-roll-/));
    const parentMarker = window.history.state.__naiMobileLayer;
    fireEvent.click(screen.getByRole('button', { name: '打开使用层' }));
    await waitFor(() => expect(window.history.state.__naiMobileLayer).toMatch(/^test-use-/));
    expect(window.history.state.__naiMobileLayers).toContain(parentMarker);
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '使用提示词' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '随机搭配' })).toBeTruthy();
    expect(window.history.state.__naiMobileLayer).toBe(parentMarker);
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '随机搭配' })).toBeNull());
    expect(window.history.state).toEqual({ testBase: true });
    expect(window.location.href).toBe(pageUrl);
  } finally {
    view.unmount(); window.matchMedia = originalMatchMedia;
    window.history.replaceState(originalState, '');
  }
});

it('统一浏览收录与搭配仅局部设为手机44桌面40，不改变顶栏与把手尺寸', () => {
  render(<ContentLibraryPage section="items" onSectionChange={vi.fn()} rollOpen={false} onRollOpenChange={vi.fn()} onCapture={async () => {}}
    browse={slot => <Tools slot={slot} label="统一搜索" />} items={() => null} saved={() => null} roll={() => null} />);
  for (const name of ['粘贴收录', '搭配']) {
    const button = screen.getByRole('button', { name });
    expect(button.classList.contains('!h-11')).toBe(true);
    expect(button.classList.contains('md:!h-10')).toBe(true);
    expect(button.classList.contains('!w-11')).toBe(true);
  }
  const toolbar = screen.getByRole('banner');
  expect(toolbar.classList.contains('!h-11')).toBe(false);
  expect(toolbar.classList.contains('md:!h-10')).toBe(false);
});


it('统一浏览保留搜索与紧凑 AI 提取入口，隐藏页面释放提取层且不恢复旧分区', async () => {
  const props = { section: 'items' as const, onSectionChange: vi.fn(), rollOpen: false, onRollOpenChange: vi.fn(), onExtractSave: vi.fn(),
    browse: (slot: HTMLElement | null) => <Tools slot={slot} label="统一搜索" />, items: () => null, saved: () => null, roll: () => null };
  const view = render(<ContentLibraryPage {...props} />);
  const entry = screen.getByRole('button', { name: 'AI 提取分类' });
  expect(entry.classList.contains('!w-11')).toBe(true);
  expect(entry.classList.contains('md:!h-10')).toBe(true);
  expect(screen.getByRole('textbox', { name: '统一搜索' })).toBeTruthy();
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.click(entry);
  expect(screen.getByRole('dialog', { name: 'AI 提取分类' })).toBeTruthy();
  view.rerender(<ContentLibraryPage {...props} active={false} />);
  expect(screen.queryByRole('dialog', { name: 'AI 提取分类' })).toBeNull();
});

it('统一浏览将窄屏提取交给现有筛选入口，打开的仍是共用提取窗口', async () => {
  render(<ContentLibraryPage section="items" onSectionChange={vi.fn()} rollOpen={false} onRollOpenChange={vi.fn()} onExtractSave={vi.fn()}
    browse={(_slot, actions) => <button onClick={actions?.onExtract}>从筛选打开提取</button>} items={() => null} saved={() => null} roll={() => null} />);
  const toolbarEntry = screen.getByRole('button', { name: 'AI 提取分类' });
  expect(toolbarEntry.classList.contains('!hidden')).toBe(true);
  expect(toolbarEntry.classList.contains('md:!inline-flex')).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '从筛选打开提取' }));
  expect(await screen.findByRole('dialog', { name: 'AI 提取分类' })).toBeTruthy();
});
