// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES, setLanguage, t } from '../../services/i18n';
import { PROJECT_AUTHOR_EMAIL, PROJECT_ISSUES_URL, PROJECT_REPOSITORY_URL, ProjectNotice } from '../../components/ProjectNotice';

const NOTICE_TITLES = ['完全开源免费', '内容创作与作者无关', '问题反馈与贡献', '支持作者'];
const NOTICE_BODIES = [
  '本项目完全开源、完全免费，没有付费版本、会员或广告，任何人都可以从开源地址免费获取。如果你是从贩子手里买来的，请立即申请退款，并向交易平台举报；软件本身不收取任何费用，不必花钱购买。',
  '本工坊只是本地创作工具，不提供图片生成服务：图片由你自行获取并接入的 NovelAI（或其它兼容服务）生成，API Key、订阅与费用都由你本人向对应服务申请和承担。工坊不参与、不审核、不认可任何具体创作，也不承担由此产生的任何责任。请自行遵守所在地法律法规和所用服务的规则。本项目仅用于无偿学习交流。',
  '发现 bug 或有改进建议，可以在 GitHub 提 Issue，也欢迎直接提 PR，但不保证一定采用。较大的新功能请先沟通、酌情考虑，因为作者不再计划大规模更新。',
  '如果你愿意支持作者，欢迎把好看的风格串发到作者邮箱，也可以给 GitHub 仓库点个 Star。',
];

const renderNotice = (notify = vi.fn()) => render(React.createElement(ProjectNotice, { notify }));

describe('ProjectNotice', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '1.0.0');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    setLanguage('zh-CN');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it('展示四条声明、开源地址、Issues 与作者邮箱入口', () => {
    renderNotice();

    for (const title of NOTICE_TITLES) expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(/个人维护版本 · v1\.0\.0/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '打开 GitHub' }).getAttribute('href')).toBe(PROJECT_REPOSITORY_URL);
    expect(screen.getByRole('link', { name: '打开开源地址' }).getAttribute('href')).toBe(PROJECT_REPOSITORY_URL);
    expect(screen.getByText(PROJECT_REPOSITORY_URL.replace(/^https:\/\//, ''))).toBeTruthy();
    expect(screen.getByRole('link', { name: '打开 Issues' }).getAttribute('href')).toBe(PROJECT_ISSUES_URL);
    expect(screen.getByRole('link', { name: '去 GitHub 点 Star' }).getAttribute('href')).toBe(PROJECT_REPOSITORY_URL);
    expect(screen.getByRole('link', { name: PROJECT_AUTHOR_EMAIL }).getAttribute('href')).toBe(`mailto:${PROJECT_AUTHOR_EMAIL}`);
    // 声明里明确写出防贩子与免责边界，避免被误当成收费软件或作者背书。
    expect(screen.getByText(/立即申请退款/)).toBeTruthy();
    expect(screen.getByText(/本项目仅用于无偿学习交流/)).toBeTruthy();
    expect(screen.getByText(/不再计划大规模更新/)).toBeTruthy();
  });

  it('复制作者邮箱写入剪贴板并提示，复制失败提示手动复制', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const notify = vi.fn();
    renderNotice(notify);

    fireEvent.click(screen.getByRole('button', { name: '复制作者邮箱' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROJECT_AUTHOR_EMAIL));
    expect(notify).toHaveBeenCalledWith('作者邮箱已复制');

    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    fireEvent.click(screen.getByRole('button', { name: '复制作者邮箱' }));
    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('复制失败，请手动选择邮箱复制', 'error'));
  });

  it('五种界面语言都有完整声明文案与固定地址，切换语言不丢入口', () => {
    renderNotice();
    for (const language of LANGUAGES) {
      act(() => setLanguage(language.code));
      for (const title of NOTICE_TITLES) {
        expect(screen.getByText(t(title))).toBeTruthy();
        // 英文、日文、韩文必须命中字典，不能回退成中文；繁体里「支持作者」等字形本就相同。
        if (['en', 'ja', 'ko'].includes(language.code)) expect(t(title)).not.toBe(title);
      }
      for (const body of NOTICE_BODIES) {
        expect(screen.getByText(t(body))).toBeTruthy();
        if (['en', 'ja', 'ko'].includes(language.code)) expect(t(body)).not.toBe(body);
      }
      expect(screen.getByRole('link', { name: t('打开开源地址') }).getAttribute('href')).toBe(PROJECT_REPOSITORY_URL);
      expect(screen.getByRole('link', { name: t('打开 Issues') }).getAttribute('href')).toBe(PROJECT_ISSUES_URL);
      expect(screen.getByRole('link', { name: t('去 GitHub 点 Star') }).getAttribute('href')).toBe(PROJECT_REPOSITORY_URL);
      expect(screen.getByRole('link', { name: PROJECT_AUTHOR_EMAIL }).getAttribute('href')).toBe(`mailto:${PROJECT_AUTHOR_EMAIL}`);
    }
  });
});
