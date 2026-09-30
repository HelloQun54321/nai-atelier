// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewPortal } from './ImagePreviewPortal';

afterEach(cleanup);

describe('图片弹层的页面层级', () => {
  it('挂到应用根节点，保留安全模式及名称遮挡，父级捕获事件仍有效', () => {
    const onCapture = vi.fn();
    const view = render(React.createElement('div', {
      className: 'agent-stage safe-mode safe-mode-hide-titles', onClickCapture: onCapture,
    }, React.createElement('main', { className: 'isolate overflow-hidden' },
      React.createElement(ImagePreviewPortal, null,
        React.createElement('div', { role: 'dialog' },
          React.createElement('button', { 'data-safe-mode-title': 'true' }, '作品名称'),
        ),
      ),
    )));
    const stage = view.container.firstElementChild;
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(stage);
    expect(stage?.querySelector('main [role="dialog"]')).toBeNull();
    expect(dialog.closest('.safe-mode.safe-mode-hide-titles')).toBe(stage);
    fireEvent.click(screen.getByRole('button', { name: '作品名称' }));
    expect(onCapture).toHaveBeenCalledOnce();
    view.rerender(React.createElement('div', { className: 'agent-stage' },
      React.createElement('main', { className: 'isolate overflow-hidden' },
        React.createElement(ImagePreviewPortal, null, React.createElement('div', { role: 'dialog' })),
      ),
    ));
    expect(screen.getByRole('dialog').closest('.safe-mode')).toBeNull();
  });
  it('脱离 isolate / 裁切工作区，翻页保留弹层，关闭卸载内容', () => {
    const onAction = vi.fn();
    const Harness = () => {
      const [open, setOpen] = useState(true);
      const [index, setIndex] = useState(0);
      return React.createElement('main', { className: 'isolate overflow-hidden' },
        open && React.createElement(ImagePreviewPortal, null,
          React.createElement('div', { role: 'dialog', className: 'fixed inset-0 z-[1500]', onClick: () => setOpen(false) },
            React.createElement('img', { alt: '当前图片', src: `/${index}.png`, onClick: event => event.stopPropagation() }),
            React.createElement('button', { onClick: event => { event.stopPropagation(); onAction(); } }, '下载'),
            React.createElement('button', { onClick: event => { event.stopPropagation(); setIndex(index + 1); } }, '下一张'),
            React.createElement('button', null, '关闭'),
          ),
        ),
      );
    };
    const view = render(React.createElement(Harness));
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(onAction).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByAltText('当前图片').getAttribute('src')).toBe('/1.png');
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(screen.getByAltText('当前图片'));
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
