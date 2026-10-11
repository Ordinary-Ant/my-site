import { z } from 'zod'
import { slugSchema } from './article'
const name = z.string().trim().min(1).max(100)
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()
const id = z.string().min(1).max(100)
const revision = z.number().int().min(1)
const order = z.number().int().min(0).max(1000000)
export const TaxonomyRevisionSchema = z.object({ revision }).strict()
export const CategoryCreateSchema = z
  .object({
    name,
    slug: slugSchema,
    description: z.string().max(2000).nullable().default(null),
    icon: z.string().max(100).nullable().default(null),
    color: color.default(null),
    parentId: id.nullable().default(null),
    order: order.default(0),
  })
  .strict()
export const CategoryUpdateSchema = CategoryCreateSchema.partial().extend({ revision }).strict()
export const TagCreateSchema = z
  .object({ name, slug: slugSchema, color: color.default(null) })
  .strict()
export const TagUpdateSchema = z
  .object({ name: name.optional(), color: color.optional(), revision })
  .strict()
const versioned = z.object({ id, revision }).strict()
export const TaxonomyBulkSchema = z
  .object({ items: z.array(versioned).min(1).max(100) })
  .strict()
  .refine((x) => new Set(x.items.map((i) => i.id)).size === x.items.length, '不能重复')
export const CategoryReorderSchema = z
  .object({ items: z.array(versioned.extend({ order }).strict()).min(1).max(100) })
  .strict()
  .refine((x) => new Set(x.items.map((i) => i.id)).size === x.items.length, '不能重复')
export const TaxonomyMergeSchema = z
  .object({ target: versioned, sources: z.array(versioned).min(1).max(100) })
  .strict()
  .refine(
    (x) =>
      !x.sources.some((s) => s.id === x.target.id) &&
      new Set(x.sources.map((s) => s.id)).size === x.sources.length,
    '来源不能重复或包含目标',
  )
