import JSZip from 'jszip';
import type { CanvasProject } from './canvasTypes';
import { createUuid } from './id';

export interface CanvasProjectSummary { id: string; name: string; updatedAt: number; thumbnail?: string }
const base = '/api/canvas-projects';

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    let message = `画布工程操作失败 (${response.status})`;
    try { const data = await response.json() as { error?: string }; if (data.error) message = data.error; } catch { /* 保留状态码 */ }
    throw new Error(message);
  }
  return response.json();
}

function readProject(value: unknown): CanvasProject {
  const project = value as CanvasProject;
  if (!project || project.version !== 1 || typeof project.id !== 'string' || !project.id ||
    typeof project.name !== 'string' || !Number.isFinite(project.updatedAt) ||
    !Number.isFinite(project.width) || project.width <= 0 || !Number.isFinite(project.height) || project.height <= 0 ||
    !project.background || !Array.isArray(project.layers)) throw new Error('画布工程文件无效或版本不支持');
  return project;
}

export async function listCanvasProjects(): Promise<CanvasProjectSummary[]> {
  const data = await readResponse(await fetch(base)) as { projects: CanvasProjectSummary[] };
  return data.projects;
}
export async function loadCanvasProject(id: string): Promise<CanvasProject> {
  return readProject(await readResponse(await fetch(`${base}/${encodeURIComponent(id)}`)));
}
export async function saveCanvasProject(project: CanvasProject): Promise<void> {
  await readResponse(await fetch(`${base}/${encodeURIComponent(project.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
  }));
}
export async function deleteCanvasProject(id: string): Promise<void> {
  await readResponse(await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
export async function exportCanvasProject(project: CanvasProject): Promise<Blob> {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
export async function importCanvasProject(file: Blob): Promise<CanvasProject> {
  let project: CanvasProject;
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('project.json');
    if (!entry) throw Error();
    project = readProject(JSON.parse(await entry.async('string')));
  } catch { throw new Error('画布工程文件无效或版本不支持'); }
  const existing = new Set((await listCanvasProjects()).map(item => item.id));
  existing.add(project.id);
  let id: string;
  do { id = createUuid(); } while (existing.has(id));
  return { ...project, id, updatedAt: Date.now() };
}
