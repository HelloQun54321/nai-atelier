import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { inferPurposesFromDirectoryIds, loadPromptLibraryDirectories, PROMPT_LIBRARY_DIRECTORIES_CHANGED, resetPromptLibraryDirectories, resolveExplicitPurposesAfterDirectoryMove, savePromptLibraryDirectories, syncPurposesWithDirectories } from '../../services/promptLibraryDirectories';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
const dispatchEvent = vi.fn();
const empty = { revision: 0, nodes: [] };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('window', { dispatchEvent }); });
afterEach(() => vi.unstubAllGlobals());

it('读取实时目录，传递取消信号且不将损坏响应当作空目录', async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValueOnce(empty).mockResolvedValueOnce({ revision: 0 });
  expect(await loadPromptLibraryDirectories(signal)).toEqual(empty);
  expect(api.get).toHaveBeenCalledWith('/prompt-library/directories', { cache: 'no-store', signal });
  await expect(loadPromptLibraryDirectories()).rejects.toThrow('目录数据无效');
});

it('仅成功保存后广播真实服务端版本，显式空树不回填预设', async () => {
  vi.mocked(api.put).mockResolvedValue({ revision: 1, nodes: [] });
  expect(await savePromptLibraryDirectories(empty)).toEqual({ revision: 1, nodes: [] });
  expect(api.put).toHaveBeenCalledWith('/prompt-library/directories', empty);
  const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
  expect(event.type).toBe(PROMPT_LIBRARY_DIRECTORIES_CHANGED);
  expect(event.detail).toEqual({ revision: 1, nodes: [] });
});

it('版本冲突保留错误，不广播假成功；本地非法树不发起保存', async () => {
  vi.mocked(api.put).mockRejectedValue(new Error('其他窗口更新'));
  await expect(savePromptLibraryDirectories(empty)).rejects.toThrow('其他窗口更新');
  expect(dispatchEvent).not.toHaveBeenCalled();
  await expect(savePromptLibraryDirectories({ revision: -1, nodes: [] })).rejects.toThrow('目录数据无效');
  expect(api.put).toHaveBeenCalledTimes(1);
});

it('目录调整在默认状态自动联动用途，人工改过用途后保留自定义结果', () => {
  expect(inferPurposesFromDirectoryIds(['person-pose'])).toEqual(['pose']);
  expect(syncPurposesWithDirectories([], ['person-pose'], [])).toEqual(['pose']);
  expect(syncPurposesWithDirectories(['person-pose'], ['environment-scene'], ['pose'])).toEqual(['place']);
  expect(syncPurposesWithDirectories(['person-pose'], ['environment-scene'], ['pose', 'style'])).toEqual(['pose', 'style']);
  expect(syncPurposesWithDirectories(['person-pose'], [], ['pose'])).toEqual([]);
  const customTree = { revision: 1, nodes: [
    { id: 'p-root', parentId: null, name: '定制', purpose: 'clothing' as const },
    { id: 'p-sub', parentId: 'p-root', name: '旗袍' },
  ] };
  expect(inferPurposesFromDirectoryIds(['p-sub'], customTree)).toEqual(['clothing']);
  expect(resolveExplicitPurposesAfterDirectoryMove(['p-sub'], [], customTree)).toEqual([]);
  expect(resolveExplicitPurposesAfterDirectoryMove(['p-sub'], ['clothing'], customTree)).toEqual([]);
  expect(resolveExplicitPurposesAfterDirectoryMove(['p-sub'], ['clothing', 'style'], customTree)).toEqual(['clothing', 'style']);
});

it('重置目录树提交当前版本并广播目录树与项目资料刷新事件', async () => {
  vi.mocked(api.post).mockResolvedValue({ tree: { revision: 3, nodes: [] }, migratedCount: 2, unclassifiedCount: 1 });
  expect(await resetPromptLibraryDirectories(2)).toEqual({
    tree: { revision: 3, nodes: [] },
    migratedCount: 2,
    unclassifiedCount: 1,
  });
  expect(api.post).toHaveBeenCalledWith('/prompt-library/directories/reset', { revision: 2 });
  const events = dispatchEvent.mock.calls.map(call => (call[0] as CustomEvent).type);
  expect(events).toEqual([PROMPT_LIBRARY_DIRECTORIES_CHANGED, 'nai-project-data-changed']);
  expect((dispatchEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({ revision: 3, nodes: [] });
});
