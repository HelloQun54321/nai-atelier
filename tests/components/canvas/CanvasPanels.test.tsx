// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasTools } from '../../../components/canvas/CanvasTools';
import { CanvasLayerPanel } from '../../../components/canvas/CanvasLayerPanel';
import { CanvasProjectPanel } from '../../../components/canvas/CanvasProjectPanel';
import type { CanvasImageLayer, CanvasProject } from '../../../services/canvasTypes';

afterEach(cleanup);
const layer: CanvasImageLayer = { id: 'a', name: '人物', source: 'data:image/png;base64,AA==', width: 100, height: 50, x: 0, y: 0, scaleX: -2, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false, crops: [] };
const project: CanvasProject = { version: 1, id: 'p', name: '作品', width: 1024, height: 768, background: { kind: 'transparent', color: '#ffffff' }, layers: [layer, { ...layer, id: 'b', name: '前景' }], updatedAt: 0 };
const noop = () => {};

it('选区操作根据选区和当前可编辑图层分别启用', () => {
  const copyMerged = vi.fn();
  const { getByRole, rerender } = render(<CanvasTools tool="move" onToolChange={noop} brushSize={20} onBrushSizeChange={noop} onImport={noop} onUndo={noop} onRedo={noop} canUndo={false} canRedo={false} hasSelection={true} hasLayer={false} onCopy={noop} onCopyMerged={copyMerged} onCut={noop} onDeleteSelection={noop} onCropLayer={noop} onCropCanvas={noop} onClearSelection={noop} />);
  expect((getByRole('button', { name: '复制选区' }) as HTMLButtonElement).disabled).toBe(true);
  expect((getByRole('button', { name: '复制合并内容' }) as HTMLButtonElement).disabled).toBe(false);
  expect(getByRole('button', { name: '移动' }).getAttribute('data-active')).toBe('true');
  expect(getByRole('button', { name: '矩形选区' }).getAttribute('data-appearance')).toBe('control');
  fireEvent.click(getByRole('button', { name: '复制合并内容' }));
  expect(copyMerged).toHaveBeenCalledOnce();
  rerender(<CanvasTools tool="move" onToolChange={noop} brushSize={20} onBrushSizeChange={noop} onImport={noop} onUndo={noop} onRedo={noop} canUndo={false} canRedo={false} hasSelection={false} hasLayer={true} onCopy={noop} onCopyMerged={copyMerged} onCut={noop} onDeleteSelection={noop} onCropLayer={noop} onCropCanvas={noop} onClearSelection={noop} />);
  expect((getByRole('button', { name: '剪裁画布' }) as HTMLButtonElement).disabled).toBe(true);
});

it('图层按绘制顺序反向排列，修改显示宽度保留镜像符号', () => {
  const patch = vi.fn();
  const { getAllByRole, getByLabelText, getByRole } = render(<CanvasLayerPanel project={project} selectedLayerId="a" onSelect={noop} onPatch={patch} onMove={noop} onDuplicate={noop} onDelete={noop} onResetCrop={noop} onAddEmpty={noop} onCenter={noop} />);
  expect(getAllByRole('button').filter(button => button.getAttribute('aria-label')?.startsWith('选择图层')).map(button => button.getAttribute('aria-label'))).toEqual(['选择图层 前景', '选择图层 人物']);
  const width = getByLabelText('显示宽度');
  fireEvent.change(width, { target: { value: '300' } });
  fireEvent.blur(width);
  expect(patch).toHaveBeenCalledWith('a', { scaleX: -3 });
  fireEvent.click(getByRole('button', { name: '上移图层' }));
});

it.each([
  { axis: '水平镜像', rotation: 0, scaleX: 2, scaleY: 1 },
  { axis: '垂直镜像', rotation: 0, scaleX: 2, scaleY: -1 },
  { axis: '水平镜像', rotation: 37, scaleX: -2, scaleY: 1.5 },
  { axis: '垂直镜像', rotation: 37, scaleX: -2, scaleY: -1.5 },
])('$axis 保持图层中心，旋转 $rotation°、缩放 $scaleX / $scaleY', ({ axis, rotation, scaleX, scaleY }) => {
  const before = { ...layer, x: 120, y: -30, rotation, scaleX, scaleY };
  const patch = vi.fn();
  const testProject = { ...project, layers: [before] };
  const panel = (p: CanvasProject) => <CanvasLayerPanel project={p} selectedLayerId="a" onSelect={noop} onPatch={patch} onMove={noop} onDuplicate={noop} onDelete={noop} onResetCrop={noop} onAddEmpty={noop} onCenter={noop} />;
  const { getByRole, rerender } = render(panel(testProject));
  const center = (item: CanvasImageLayer) => {
    const angle = item.rotation * Math.PI / 180;
    const dx = item.width * item.scaleX / 2;
    const dy = item.height * item.scaleY / 2;
    return { x: item.x + Math.cos(angle) * dx - Math.sin(angle) * dy, y: item.y + Math.sin(angle) * dx + Math.cos(angle) * dy };
  };
  fireEvent.click(getByRole('button', { name: axis }));
  const after = { ...before, ...patch.mock.calls[0][1] };
  expect(center(after).x).toBeCloseTo(center(before).x, 10);
  expect(center(after).y).toBeCloseTo(center(before).y, 10);
  expect(after.scaleX).toBe(axis === '水平镜像' ? -scaleX : scaleX);
  expect(after.scaleY).toBe(axis === '垂直镜像' ? -scaleY : scaleY);
  rerender(panel({ ...testProject, layers: [after] }));
  fireEvent.click(getByRole('button', { name: axis }));
  const restored = { ...after, ...patch.mock.calls[1][1] };
  expect(restored.x).toBeCloseTo(before.x, 10);
  expect(restored.y).toBeCloseTo(before.y, 10);
  expect(restored.scaleX).toBe(before.scaleX);
  expect(restored.scaleY).toBe(before.scaleY);
});

it('锁定图层不能镜像', () => {
  const patch = vi.fn();
  const { getByRole } = render(<CanvasLayerPanel project={{ ...project, layers: [{ ...layer, locked: true }] }} selectedLayerId="a" onSelect={noop} onPatch={patch} onMove={noop} onDuplicate={noop} onDelete={noop} onResetCrop={noop} onAddEmpty={noop} onCenter={noop} />);
  for (const name of ['水平镜像', '垂直镜像']) {
    const button = getByRole('button', { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(patch).not.toHaveBeenCalled();
});

it('画布尺寸输入支持大整数，拒绝非正值并保留另一维', () => {
  const resize = vi.fn();
  const rename = vi.fn();
  const { getByLabelText } = render(<CanvasProjectPanel project={project} savingState="saved" onRename={rename} onNew={noop} onOpen={noop} onImportProject={noop} onExportProject={noop} onExportPng={noop} onExportJpeg={noop} onSendToLab={noop} onResize={resize} onBackground={noop} />);
  const width = getByLabelText('画布宽度');
  fireEvent.change(width, { target: { value: '100000' } });
  fireEvent.blur(width);
  expect(resize).toHaveBeenCalledWith(100000, 768);
  fireEvent.change(width, { target: { value: '0' } });
  fireEvent.blur(width);
  expect(resize).toHaveBeenCalledTimes(1);
  const name = getByLabelText('工程名称');
  fireEvent.change(name, { target: { value: '新' } });
  fireEvent.change(name, { target: { value: '新作品' } });
  expect(rename).not.toHaveBeenCalled();
  fireEvent.blur(name);
  expect(rename).toHaveBeenCalledOnce();
  expect(rename).toHaveBeenCalledWith('新作品');
});

it('保存失败时可主动重试', () => {
  const retry = vi.fn();
  const { getByRole } = render(<CanvasProjectPanel project={project} savingState="error" onRetry={retry} onRename={noop} onNew={noop} onOpen={noop} onImportProject={noop} onExportProject={noop} onExportPng={noop} onExportJpeg={noop} onSendToLab={noop} onResize={noop} onBackground={noop} />);
  expect(getByRole('status').textContent).toBe('保存失败');
  expect(getByRole('button', { name: '重试保存' }).className).toContain('hover:!bg-gray-200');
  expect(getByRole('button', { name: '送往实验室' }).getAttribute('data-tone')).toBe('primary');
  fireEvent.click(getByRole('button', { name: '重试保存' }));
  expect(retry).toHaveBeenCalledOnce();
});
