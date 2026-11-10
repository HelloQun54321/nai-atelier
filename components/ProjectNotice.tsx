import { t, useLanguage } from '../services/i18n';
import React from 'react';
import { Bug, Copy, ExternalLink, Heart, Mail, Scale } from 'lucide-react';
import { copyTagText } from '../services/externalImageTags';

/** 声明里的地址与邮箱是固定文案，测试与文档共用同一来源，不在多处手写。 */
export const PROJECT_REPOSITORY_URL = 'https://github.com/HelloQun54321/nai-atelier';
export const PROJECT_ISSUES_URL = `${PROJECT_REPOSITORY_URL}/issues`;
export const PROJECT_AUTHOR_EMAIL = 'helloqun54321@qq.com';

interface ProjectNoticeProps {
  notify?: (message: string, type?: 'success' | 'error') => void;
}

const NOTICE_ITEM = 'flex gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60';
const NOTICE_TITLE = 'text-xs font-bold text-gray-800 dark:text-gray-200';
const NOTICE_BODY = 'mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400';
const NOTICE_LINK = 'mobile-touch inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-indigo-600 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300';

/**
 * 软件内声明：开源免费与防贩子、创作内容免责、反馈渠道、支持作者。
 * 低频信息集中在设置里随维护分类展开，不做启动弹窗，避免打断创作心流。
 */
export const ProjectNotice: React.FC<ProjectNoticeProps> = ({ notify }) => {
  useLanguage();
  const copyEmail = async () => {
    try {
      await copyTagText(PROJECT_AUTHOR_EMAIL);
      notify?.(t('作者邮箱已复制'));
    } catch {
      notify?.(t('复制失败，请手动选择邮箱复制'), 'error');
    }
  };
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="font-semibold text-gray-900 dark:text-white">{t("关于 NAI Atelier")}</h4>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("个人维护版本 · v{0}", [__APP_VERSION__])}</p>
      </div>
      <a href={PROJECT_REPOSITORY_URL} target="_blank" rel="noreferrer" data-appearance="control" data-tone="primary" className="mobile-touch flex flex-none items-center gap-1.5 rounded-lg bg-indigo-700 dark:bg-gradient-to-r dark:from-indigo-600/90 dark:to-violet-700/90 dark:hover:from-indigo-500 dark:hover:to-violet-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-600"><ExternalLink className="h-3.5 w-3.5" />{t("打开 GitHub")}</a>
    </div>

    <div className="mt-4 space-y-2.5">
      <section className={NOTICE_ITEM}>
        <Heart className="mt-0.5 h-4 w-4 flex-none text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h5 className={NOTICE_TITLE}>{t("完全开源免费")}</h5>
          <p className={NOTICE_BODY}>{t("本项目完全开源、完全免费，没有付费版本、会员或广告，任何人都可以从开源地址免费获取。如果你是从贩子手里买来的，请立即申请退款，并向交易平台举报；软件本身不收取任何费用，不必花钱购买。")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={PROJECT_REPOSITORY_URL} target="_blank" rel="noreferrer" className={NOTICE_LINK}><ExternalLink className="h-3 w-3 flex-none" />{t("打开开源地址")}</a>
            <span className="min-w-0 break-all text-xs text-gray-400 dark:text-gray-500">{PROJECT_REPOSITORY_URL.replace(/^https:\/\//, '')}</span>
          </div>
        </div>
      </section>

      <section className={NOTICE_ITEM}>
        <Scale className="mt-0.5 h-4 w-4 flex-none text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h5 className={NOTICE_TITLE}>{t("内容创作与作者无关")}</h5>
          <p className={NOTICE_BODY}>{t("本工坊只是本地创作工具，生成的图片和内容完全由你自行决定、保存和使用。作者不参与、不审核、不认可任何具体创作，也不承担由此产生的任何责任。请自行遵守所在地法律法规和所用服务的规则。本项目仅用于无偿学习交流。")}</p>
        </div>
      </section>

      <section className={NOTICE_ITEM}>
        <Bug className="mt-0.5 h-4 w-4 flex-none text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h5 className={NOTICE_TITLE}>{t("问题反馈与贡献")}</h5>
          <p className={NOTICE_BODY}>{t("发现 bug 或有改进建议，可以在 GitHub 提 Issue，也欢迎直接提 PR，但不保证一定采用。较大的新功能请先沟通、酌情考虑，因为作者不再计划大规模更新。")}</p>
          <div className="mt-1.5">
            <a href={PROJECT_ISSUES_URL} target="_blank" rel="noreferrer" className={NOTICE_LINK}><ExternalLink className="h-3 w-3 flex-none" />{t("打开 Issues")}</a>
          </div>
        </div>
      </section>

      <section className={NOTICE_ITEM}>
        <Mail className="mt-0.5 h-4 w-4 flex-none text-indigo-500" />
        <div className="min-w-0 flex-1">
          <h5 className={NOTICE_TITLE}>{t("支持作者")}</h5>
          <p className={NOTICE_BODY}>{t("如果你愿意支持作者，欢迎把好看的风格串发到作者邮箱，也可以给 GitHub 仓库点个 Star。")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex min-w-0 items-center gap-1">
              <a href={`mailto:${PROJECT_AUTHOR_EMAIL}`} className={`${NOTICE_LINK} break-all`}><Mail className="h-3 w-3 flex-none" />{PROJECT_AUTHOR_EMAIL}</a>
              <button type="button" onClick={() => void copyEmail()} aria-label={t("复制作者邮箱")} title={t("复制作者邮箱")} className="mobile-touch flex flex-none items-center justify-center rounded-lg p-1 text-gray-400 transition hover:bg-gray-200/70 hover:text-indigo-600 dark:hover:bg-gray-700 dark:hover:text-indigo-300"><Copy className="h-3.5 w-3.5" /></button>
            </span>
            <a href={PROJECT_REPOSITORY_URL} target="_blank" rel="noreferrer" className={NOTICE_LINK}><ExternalLink className="h-3 w-3 flex-none" />{t("去 GitHub 点 Star")}</a>
          </div>
        </div>
      </section>
    </div>
  </div>;
};
