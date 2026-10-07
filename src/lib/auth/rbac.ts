import type { Role } from '@prisma/client'
export const ALL_PERMISSIONS = [
  'dashboard:read',
  'content:read',
  'content:write',
  'content:publish',
  'module:write',
  'setting:write',
  'media:write',
  'user:manage',
  'audit:read',
  'data:export',
  'data:import',
] as const
export type Permission = (typeof ALL_PERMISSIONS)[number]
export const PERMISSIONS: Record<Role, Set<Permission>> = {
  ADMIN: new Set(ALL_PERMISSIONS),
  EDITOR: new Set([
    'dashboard:read',
    'content:read',
    'content:write',
    'content:publish',
    'media:write',
  ]),
  VIEWER: new Set(['dashboard:read', 'content:read', 'audit:read']),
}
export const can = (role: Role, permission: Permission) => PERMISSIONS[role].has(permission)
