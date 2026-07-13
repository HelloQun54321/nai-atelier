// 分页配置接口定义
export interface PaginationConfig {
  /** 每页显示的记录数 */
  PAGE_SIZE: number;
  /** 最大缓存页数（用于内存管理） */
  MAX_CACHED_PAGES: number;
  /** 清理功能默认值 */
  CLEANUP: {
    /** 默认清理天数 */
    DEFAULT_DAYS: number;
    /** 默认保留数量 */
    DEFAULT_COUNT: number;
  };
}

// 分页配置常量
export const PAGINATION_CONFIG: PaginationConfig = {
  // 每页显示的记录数
  PAGE_SIZE: 20,

  // 最大缓存页数（用于内存管理）
  MAX_CACHED_PAGES: 3,

  // 清理功能默认值
  CLEANUP: {
    DEFAULT_DAYS: 7,
    DEFAULT_COUNT: 100
  }
} as const;
