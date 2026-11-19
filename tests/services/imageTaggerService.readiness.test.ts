import { describe, expect, it } from 'vitest';
import { taggerReadinessIssue } from '../../services/imageTaggerService';
import type { ImageTaggerModelStatus, ImageTaggerStatus } from '../../services/imageTaggerService';

const model = (patch: Partial<ImageTaggerModelStatus> = {}): ImageTaggerModelStatus => ({
  id: 'wd-vit', label: 'WD ViT V3', description: '', threshold: 0.35, characterThreshold: 0.85,
  downloaded: true, totalBytes: 2, receivedBytes: 2, stage: 'ready', error: '', ...patch,
});
const status = (models?: ImageTaggerModelStatus[], patch: Partial<ImageTaggerStatus> = {}): ImageTaggerStatus => ({
  model: 'wd-vit', downloaded: true, models: models ?? [model()], busy: false, downloadingModel: null, ...patch,
});

describe('助手反推前的模型就绪检查', () => {
  it('模型已就绪时不拦截', () => {
    expect(taggerReadinessIssue(status())).toBeNull();
    expect(taggerReadinessIssue(status(), 'wd-vit')).toBeNull();
  });

  it('模型未下载时说明去哪下载，并明确不会自动下载或切换', () => {
    const issue = taggerReadinessIssue(status([model({ downloaded: false, stage: 'missing' })], { downloaded: false }));
    expect(issue).toContain('WD ViT V3');
    expect(issue).toContain('反推模型');
    expect(issue).toContain('不会自动下载');
  });

  it('下载中与下载暂停给出不同的恢复动作', () => {
    expect(taggerReadinessIssue(status([model({ downloaded: false, stage: 'downloading' })], { downloaded: false }))).toContain('下载完成后再试');
    expect(taggerReadinessIssue(status([model({ downloaded: false, stage: 'paused' })], { downloaded: false }))).toContain('继续下载');
  });

  it('指定别的模型时直接说明助手不能切换，而不是让服务端回 409', () => {
    const issue = taggerReadinessIssue(status(), 'other-model');
    expect(issue).toContain('不能切换');
    expect(issue).toContain('WD ViT V3');
  });

  it('读不到当前模型状态时要求重新选择模型', () => {
    expect(taggerReadinessIssue(status([]))).toContain('重新选择模型');
  });
});
