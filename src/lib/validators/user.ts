import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
const fields = {
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
  avatar: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => !!safeContentUrl(value), '头像地址不安全')
    .nullable(),
}
const revision = z.number().int().min(1)
export const UserCreateSchema = z.object({ ...fields, avatar: fields.avatar.optional() }).strict()
export const UserUpdateSchema = z
  .object(fields)
  .partial()
  .extend({ revision, isActive: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'revision'), '至少修改一个字段')
export const UserRevisionSchema = z.object({ revision }).strict()
export const UserListSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    role: fields.role.optional(),
    active: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
