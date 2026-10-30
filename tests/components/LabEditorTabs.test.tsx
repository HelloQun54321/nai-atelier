// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabEditorTabs } from '../../components/LabEditorTabs';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const threeOptions = [['global', '全局'], ['character', '角色'], ['params', '参数']] as const;
const fourOptions = [...threeOptions, ['references', '参考'] as const] as const;
const Harness = ({ options = threeOptions }: { options?: readonly (readonly [string, string])[] }) => {
  const [value, setValue] = useState('global');
  return <>
    <LabEditorTabs value={value} options={options} onChange={setValue} />
    <div className="chain-editor-body">
      <div className="chain-editor-main">
        <textarea aria-label="全局草稿" hidden={value !== 'global'} defaultValue="保留的提示词" />
        <div hidden={value !== 'character'}>角色编辑</div>
        <div hidden={value !== 'params'}>参数编辑</div>
        <div hidden={value !== 'references'}>参考编辑</div>
      </div>
      <div data-testid="preview">当前作品</div>
    </div>
  </>;
};

it.each([3, 4])('%s个分区等宽收紧居中，宽窄切换仍保留两排连接弧度并紧贴顶栏', count => {
  let modeLeft = 110, modeWidth = 560;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = this.classList.contains('generation-mode-nav') ? { left: modeLeft, right: modeLeft + modeWidth, width: modeWidth, bottom: 52 }
      : this.dataset.mode === 'first' ? { left: modeLeft + 4 }
      : this.dataset.mode === 'last' ? { right: modeLeft + modeWidth - 4 }
      : this.classList.contains('chain-editor-body') ? { left: 80 }
      : this.classList.contains('workspace-chrome') ? { bottom: 64 }
      : this.classList.contains('chain-editor-header') ? { left: 80, width: 1000, height: 58, bottom: 58 }
      : this.classList.contains('workspace-mode-tabs') ? { height: 36 } : {};
    return { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON: () => ({}), ...rect };
  });
  const { container } = render(<div className="chain-editor-workspace">
    <div className="workspace-chrome"><header className="chain-editor-header"><nav className="generation-mode-nav">
      <button data-mode="first">文生图</button><button>图生图</button><button>局部重绘</button><button data-mode="last">扩图</button>
    </nav></header></div>
    <LabEditorTabs value="global" options={count === 4 ? fourOptions : threeOptions} onChange={() => {}} />
    <div className="chain-editor-body" />
  </div>);
  const tabs = screen.getByRole('tablist');
  expect(tabs.style.gridTemplateColumns).toBe(`repeat(${count}, minmax(0, 1fr))`);
  expect(tabs.classList.contains('appearance-segmented')).toBe(true);
  expect(tabs.classList.contains('appearance-group')).toBe(false);
  expect(tabs.style.getPropertyValue('--lab-tabs-width')).toBe('480px');
  expect(tabs.style.getPropertyValue('--lab-tabs-left')).toBe('70px');
  const header = container.querySelector<HTMLElement>('.chain-editor-header')!;
  expect(header.dataset.labNavigation).toBe('joined');
  const outline = header.style.getPropertyValue('--lab-navigation-outline');
  expect(outline).toContain('H 990 Q 1000 0 1000 10');
  expect(outline).toContain('H 562 Q 554 58 554 66');
  expect(outline).toContain('Q 554 94 544 94 H 76 Q 66 94 66 84');
  expect(outline).toContain('V 66 Q 66 58 58 58');
  expect(container.querySelector<HTMLElement>('.chain-editor-workspace')?.style.getPropertyValue('--lab-tabs-chrome-gap')).toBe('6px');
  modeLeft = 100; modeWidth = 500;
  fireEvent(window, new Event('resize'));
  expect(tabs.style.getPropertyValue('--lab-tabs-width')).toBe('480px');
  expect(tabs.style.getPropertyValue('--lab-tabs-left')).toBe('30px');
  expect(header.style.getPropertyValue('--lab-navigation-outline')).toContain('Q 514 94 504 94 H 36 Q 26 94 26 84');
  modeWidth = 300;
  fireEvent(window, new Event('resize'));
  expect(tabs.style.getPropertyValue('--lab-tabs-width')).toBe('292px');
  expect(tabs.style.getPropertyValue('--lab-tabs-left')).toBe('24px');
  expect(header.style.getPropertyValue('--lab-navigation-outline')).toContain('Q 320 94 310 94 H 30 Q 20 94 20 84');
  cleanup();
  expect(header.dataset.labNavigation).toBeUndefined();
  expect(header.style.getPropertyValue('--lab-navigation-outline')).toBe('');
});

it.each([3, 4])('跨端%s个分区独立恢复滚动，切换不卸载输入或右侧预览', count => {
  const { container } = render(<Harness options={count === 4 ? fourOptions : threeOptions} />);
  const destination = count === 4 ? '参考' : '参数';
  const nav = screen.getByRole('tablist', { name: '编辑分区' });
  expect(nav.className).not.toContain('lg:hidden');
  const body = container.querySelector<HTMLElement>('.chain-editor-body')!;
  const main = container.querySelector<HTMLElement>('.chain-editor-main')!;
  const draft = screen.getByLabelText('全局草稿') as HTMLTextAreaElement;
  const preview = screen.getByTestId('preview');
  fireEvent.change(draft, { target: { value: '新的提示词' } });
  main.scrollTop = 600; body.scrollTop = 300;
  fireEvent.click(screen.getByRole('tab', { name: destination }));
  expect(main.scrollTop).toBe(0); expect(body.scrollTop).toBe(0);
  expect(draft.hidden).toBe(true);
  main.scrollTop = 120; body.scrollTop = 80;
  fireEvent.click(screen.getByRole('tab', { name: '全局' }));
  expect(main.scrollTop).toBe(600); expect(body.scrollTop).toBe(300);
  expect(draft.hidden).toBe(false); expect(draft.value).toBe('新的提示词');
  expect(screen.getByLabelText('全局草稿')).toBe(draft);
  expect(screen.getByTestId('preview')).toBe(preview);
  fireEvent.click(screen.getByRole('tab', { name: destination }));
  expect(main.scrollTop).toBe(120); expect(body.scrollTop).toBe(80);
});

it.each([3, 4])('%s个分区左右键与首尾键切换并同步选中和键盘焦点', count => {
  render(<Harness options={count === 4 ? fourOptions : threeOptions} />);
  const global = screen.getByRole('tab', { name: '全局' });
  const character = screen.getByRole('tab', { name: '角色' });
  const last = screen.getByRole('tab', { name: count === 4 ? '参考' : '参数' });
  fireEvent.keyDown(global, { key: 'ArrowRight' });
  expect(character.getAttribute('aria-selected')).toBe('true');
  expect(character.tabIndex).toBe(0); expect(global.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(character);
  fireEvent.keyDown(character, { key: 'End' });
  expect(document.activeElement).toBe(last);
  expect(last.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(last, { key: 'Home' });
  expect(document.activeElement).toBe(global);
  fireEvent.keyDown(global, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(global);
});

it('参考页隐藏后从四页恢复三页等宽，保留有效页的选中与焦点并按新顺序循环', () => {
  const onChange = vi.fn();
  const view = render(<LabEditorTabs value="params" options={fourOptions} onChange={onChange} />);
  const params = screen.getByRole('tab', { name: '参数' });
  params.focus();
  view.rerender(<LabEditorTabs value="params" options={threeOptions} onChange={onChange} />);
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.queryByRole('tab', { name: '参考' })).toBeNull();
  expect(screen.getByRole('tablist').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  expect(params.getAttribute('aria-selected')).toBe('true'); expect(params.tabIndex).toBe(0);
  expect(document.activeElement).toBe(params); expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(params, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenCalledWith('global');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '全局' }));
});
