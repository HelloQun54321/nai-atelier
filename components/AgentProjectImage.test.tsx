// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { promptAgentService } from '../services/promptAgent';
import { AgentProjectImage } from './AgentProjectImage';

const image = { kind: 'history', id: 'a', title: '作品', path: '/api/local-history/a/image' };
beforeEach(() => { vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:synthetic'), revokeObjectURL: vi.fn() })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
it('通过项目认证接口显示原图，可展开；卸载释放图片地址', async () => {
  const read = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  const ready = vi.fn(); const result = render(<AgentProjectImage image={image} onReady={ready} />);
  await screen.findByRole('img', { name: '作品' });
  fireEvent.load(screen.getByRole('img', { name: '作品' })); expect(ready).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('/local-history/a/image');
  fireEvent.click(screen.getByRole('button', { name: '查看图片：作品' }));
  expect(screen.getByRole('img').getAttribute('data-safe-mode-ignore')).toBe('true');
  result.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
});
it('失败显示实际原因，卸载后迟到结果不创建图片地址', async () => {
  vi.spyOn(api, 'getBlob').mockRejectedValueOnce(new Error('原文件已删除'));
  const failed = render(<AgentProjectImage image={image} />);
  expect((await screen.findByRole('alert')).textContent).toBe('原文件已删除'); failed.unmount();
  let complete!: (blob: Blob) => void;
  vi.mocked(api.getBlob).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const late = render(<AgentProjectImage image={image} />); late.unmount();
  complete(new Blob(['image'], { type: 'image/png' })); await Promise.resolve();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('本地图片走会话与 Key 认证接口，安全模式跟随主界面', async () => {
  const root = document.createElement('div'); root.className = 'agent-stage safe-mode'; document.body.append(root);
  const read = vi.spyOn(promptAgentService, 'getLocalImage').mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  const result = render(<AgentProjectImage image={{ ...image, path: '/api/prompt-agent/local-image?sessionId=s&id=' + 'a'.repeat(32) }} />);
  await screen.findByRole('img'); expect(read).toHaveBeenCalled(); expect(result.container.querySelector('figure')?.classList.contains('safe-mode')).toBe(true);
  root.classList.remove('safe-mode'); await waitFor(() => expect(result.container.querySelector('figure')?.classList.contains('safe-mode')).toBe(false));
});
