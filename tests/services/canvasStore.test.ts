import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { deleteCanvasProject, exportCanvasProject, importCanvasProject, listCanvasProjects, loadCanvasProject, saveCanvasProject } from '../../services/canvasStore';
import type { CanvasProject } from '../../services/canvasTypes';

const project: CanvasProject = { version: 1, id: 'original', name: '素材齐全', width: 1024, height: 768, updatedAt: 1,
  background: { kind: 'color', color: '#ffffff' }, layers: [{ id: 'one', name: '图层', source: 'data:image/png;base64,abcd', mask: 'data:image/png;base64,efgh', crops: [{ points: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 }] }], width: 3, height: 4, x: -5, y: 6, scaleX: -1, scaleY: 1, rotation: 30, opacity: 1, visible: true, locked: false }] };
afterEach(() => vi.unstubAllGlobals());
describe('画布工程服务', () => {
  it('工程包独立携带原图和蒙版，导入避开已有工程 ID', async () => {
    const file = await exportCanvasProject(project);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    expect(JSON.parse(await zip.file('project.json')!.async('string'))).toEqual(project);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ projects: [{ id: 'collision', name: '已存在', updatedAt: 1 }] })));
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('collision').mockReturnValueOnce('new-id') });
    const imported = await importCanvasProject(file);
    expect(imported.id).toBe('new-id');
    expect(imported.layers).toEqual(project.layers);
  });
  it('工坊接口发送完整工程并正确读取、暴露失败原因', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json({ projects: [{ id: project.id, name: project.name, updatedAt: 1 }] }))
      .mockResolvedValueOnce(Response.json({ error: '存储不可用' }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await saveCanvasProject(project);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(project);
    expect(await loadCanvasProject(project.id)).toEqual(project);
    expect(await listCanvasProjects()).toHaveLength(1);
    await expect(saveCanvasProject(project)).rejects.toThrow('存储不可用');
  });
  it('损坏的工程包不会生成半成品', async () => {
    await expect(importCanvasProject(new Blob(['invalid']))).rejects.toThrow('画布工程文件无效或版本不支持');
  });
  it('删除接口传入指定 ID，失败时抛出服务端原因', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ error: '画布工程不存在' }, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteCanvasProject('one');
    expect(fetchMock).toHaveBeenCalledWith('/api/canvas-projects/one', { method: 'DELETE' });
    await expect(deleteCanvasProject('missing')).rejects.toThrow('画布工程不存在');
  });
});
