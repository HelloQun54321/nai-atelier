// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageTaggerAction, ImageTaggerPanel } from './ImageTaggerPanel';
import { imageTaggerService } from '../services/imageTaggerService';
import { IMPORT_SESSION_KEY } from '../services/metadataService';

vi.mock('../services/imageTaggerService', () => ({
  imageTaggerService: {
    getStatus: vi.fn(async () => ({ downloaded: true })),
    tagFile: vi.fn(async () => ({
      tags: [{ name: 'blue_hair', category: 'general', confidence: 0.9 }, { name: 'long_hair', category: 'general', confidence: 0.8 }],
      character: [], general: [], rating: null,
    })),
  },
}));
const originalUrl = URL;
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic'], { type: 'image/png' }) })));
  vi.stubGlobal('URL', class extends originalUrl {
    static createObjectURL = vi.fn(() => 'blob:synthetic');
    static revokeObjectURL = vi.fn();
  });
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('图片识别入口与当前图片衔接', () => {
  it('实验室默认面板保留原名称和追加语义', () => {
    render(<ImageTaggerPanel open onClose={vi.fn()} onInsert={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '图片反推 Tag' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '追加 0 个 Tag 到全局提示词' })).toBeTruthy();
  });

  it('从图片更多菜单打开，识别绑定图片并仅追加勾选结果', async () => {
    const onInsert = vi.fn();
    render(<div className="agent-stage"><ImageTaggerAction placement="more" imageUrl="/api/media/test-original.png" onInsert={onInsert} notify={vi.fn()} /></div>);
    expect(screen.queryByRole('button', { name: '识别图片 Tag' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: '识别图片 Tag' }));
    expect(screen.queryByRole('dialog', { name: '图片工具' })).toBeNull();
    const panel = screen.getByRole('dialog', { name: '识别图片 Tag' });
    expect(panel.closest('.agent-stage')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: '追加 2 个 Tag 到全局提示词' }).hasAttribute('disabled')).toBe(false));
    expect(fetch).toHaveBeenCalledWith('/api/media/test-original.png');
    expect(imageTaggerService.tagFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }), { threshold: 0.35, characterThreshold: 0.85 });
    fireEvent.click(screen.getByRole('button', { name: /long hair/ }));
    fireEvent.click(screen.getByRole('button', { name: '追加 1 个 Tag 到全局提示词' }));
    expect(onInsert).toHaveBeenCalledWith('blue hair');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('当前图片识别结果可以继续送入实验室，保持追加而非替换', async () => {
    render(<ImageTaggerAction text imageUrl="/api/media/current.png" notify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '识别图片 Tag' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '送往实验室' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '送往实验室' }));
    const payload = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
    expect(payload.mode).toBe('append-prompt');
    expect(payload.prompt).toBe('blue hair, long hair');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('从图片详情打开后位于大图上方，Escape 只关闭识别层', async () => {
    const closeDetail = vi.fn();
    window.addEventListener('keydown', closeDetail);
    try {
      render(<ImageTaggerAction text imageUrl="/api/media/current.png" notify={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: '识别图片 Tag' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '送往实验室' }).hasAttribute('disabled')).toBe(false));
      expect(screen.getByRole('dialog', { name: '识别图片 Tag' }).classList.contains('z-[2000]')).toBe(true);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(closeDetail).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', closeDetail); }
  });
});
