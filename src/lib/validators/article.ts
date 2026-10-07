import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'

const mediaUrl = z
  .string()
  .max(2000)
  .refine((value) => !!safeContentUrl(value), '请输入安全的HTTP(S)地址或站内路径')
export const slugSchema = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug只能包含小写字母、数字和连字符')

/** 创建/更新共用同一字段合同，拒绝统计值与作者等客户端越权字段。 */
export const ArticleCreateSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(200),
    slug: slugSchema.optional(),
    summary: z.string().max(500).nullable().optional(),
    content: z.string().min(1, '正文不能为空').max(1_000_000),
    coverImage: mediaUrl.nullable().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
    publishedAt: z.coerce.date().nullable().optional(),
    isTop: z.boolean().default(false),
    order: z.number().int().min(0).max(1_000_000).default(0),
    allowComment: z.boolean().default(true),
    categoryId: z.string().cuid().nullable().optional(),
    tagIds: z.array(z.string().cuid()).max(10).default([]),
    seoTitle: z.string().max(60).nullable().optional(),
    seoDescription: z.string().max(160).nullable().optional(),
    seoKeywords: z.string().max(200).nullable().optional(),
    ogImage: mediaUrl.nullable().optional(),
  })
  .strict()

export const ArticleUpdateSchema = ArticleCreateSchema.partial()
  .extend({ revision: z.number().int().min(1) })
  .strict()
export const RevisionSchema = z.object({ revision: z.number().int().min(1) }).strict()
