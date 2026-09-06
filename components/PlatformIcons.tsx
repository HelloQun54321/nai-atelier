import React from 'react';

export interface PlatformIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
  [key: `data-${string}`]: unknown;
}

/**
 * Danbooru 专有矢量字母标（现代几何大写 D，24x24，与 Lucide 线性图标风格统一）
 */
export const DanbooruIcon: React.FC<PlatformIconProps> = ({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M6 4.5h5a7.5 7.5 0 0 1 0 15H6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
  </svg>
);

/**
 * Pixiv 专有矢量字母标（现代几何大写 P，24x24，与 Lucide 线性图标风格统一）
 */
export const PixivIcon: React.FC<PlatformIconProps> = ({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M6 20V5a1 1 0 0 1 1-1h5a5.5 5.5 0 0 1 0 11H6" />
  </svg>
);
