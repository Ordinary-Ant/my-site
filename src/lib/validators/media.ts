import { z } from 'zod'
export const mediaFolderPathSchema = z
  .string()
  .max(200)
  .regex(/^\/(?:[\p{L}\p{N}_ -]+\/?)*$/u)
  .transform((path) => (path === '/' ? path : path.replace(/\/$/, '')))
export const mediaFolderSchema = z.object({ path: mediaFolderPathSchema }).strict()
export const mediaQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  folder: mediaFolderPathSchema.innerType().optional(),
})
export const mediaDeduplicateSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().safe(),
    mimeType: z.string(),
  })
  .strict()
