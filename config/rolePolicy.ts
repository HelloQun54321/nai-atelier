/**
 * 角色策略配置
 * 
 * 统一的角色策略定义，前后端应共用此语义。
 * 后端在 worker/index.ts 中有对应的 ROLE_POLICY 定义。
 */

import type { UserRole } from '../types';

export const ROLE_POLICY = {
  // 有效角色列表
  VALID_ROLES: ['user', 'vip', 'admin', 'guest'] as const,
  
  // 可管理画师的角色（admin + vip）
  CAN_MANAGE_ARTISTS: ['admin', 'vip'] as const,
  
  // 默认存储配额（字节）
  DEFAULT_QUOTA: {
    user: 314572800,    // 300MB
    vip: 524288000,     // 500MB
    admin: null,        // admin 无限制，使用 null 表示
    guest: 104857600,   // 100MB
  } as const,
  
  // 判断是否可管理画师
  canManageArtists: (role: string): boolean => ['admin', 'vip'].includes(role),
  
  // 判断是否不受存储配额限制
  isUnlimitedStorage: (role: string): boolean => role === 'admin',
  
  // 获取默认配额，admin 返回 null 表示无限制
  getDefaultQuota: (role: string): number | null => {
    if (role === 'admin') return null;
    return (ROLE_POLICY.DEFAULT_QUOTA as Record<string, number | null>)[role] ?? 314572800;
  },
  
  // 获取角色显示名称
  getRoleDisplayName: (role: UserRole): string => {
    const displayNames: Record<UserRole, string> = {
      admin: '管理员',
      vip: 'VIP',
      user: '普通用户',
      guest: '游客',
    };
    return displayNames[role] || role;
  },
  
  // 获取角色显示颜色类名
  getRoleBadgeClass: (role: UserRole): string => {
    const classes: Record<UserRole, string> = {
      admin: 'bg-red-100 text-red-600',
      vip: 'bg-yellow-100 text-yellow-700',
      user: 'bg-green-100 text-green-600',
      guest: 'bg-gray-100 text-gray-600',
    };
    return classes[role] || 'bg-gray-100 text-gray-600';
  },
} as const;

export type RolePolicy = typeof ROLE_POLICY;