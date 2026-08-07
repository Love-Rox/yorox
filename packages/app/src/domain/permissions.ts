/**
 * グループの権限フラグとプリセットロール(docs/DECISIONS.md「グループ」)。
 *
 * ロール = 権限フラグの束。プリセット(オーナー/共同主催/メンバー)を同梱し、
 * 主催はカスタムロールを自由に定義できる。
 * 制約: 全権限を持つメンバーがグループに最低1人。
 */

export const PERMISSIONS = [
  'event.create',
  'event.edit',
  'attendance.manage',
  'lottery.run',
  'member.manage',
  'group.settings',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

/** プリセットロール定義。グループ作成時に投入する */
export const PRESET_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: 'オーナー', permissions: ALL_PERMISSIONS },
  {
    name: '共同主催',
    permissions: ['event.create', 'event.edit', 'attendance.manage', 'lottery.run'],
  },
  { name: 'メンバー', permissions: [] },
];

export function hasPermission(rolePermissions: string[], permission: Permission): boolean {
  return rolePermissions.includes(permission);
}

/** 全権限を持つロールか(オーナー相当) */
export function hasAllPermissions(rolePermissions: string[]): boolean {
  return PERMISSIONS.every((p) => rolePermissions.includes(p));
}
