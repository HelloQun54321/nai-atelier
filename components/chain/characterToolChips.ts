/** 角色页工具：定位／构图是轻量开关，删除／添加保留按钮外壳，避免整行都是描边胶囊。 */
export const CHAR_TOOL_CHIP =
  'mobile-touch inline-flex h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition';

/** 次要工具（定位／构图）常态：无边框、无常态底色，只在悬停时露浅底。 */
export const CHAR_TOOL_NEUTRAL =
  'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/70 dark:hover:text-white';

/** 定位展开或构图开启：浅蓝底＋蓝字，不再额外描边。 */
export const CHAR_TOOL_ACTIVE =
  'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200';

/** 删除当前角色：保留危险按钮外壳。 */
export const CHAR_TOOL_DANGER =
  'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50';

/** 添加角色：保留主操作按钮外壳。 */
export const CHAR_TOOL_PRIMARY =
  'border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50';
