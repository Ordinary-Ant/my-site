import { z } from 'zod'

export const searchTypes = ['all', 'article', 'log', 'project'] as const
const integer = (max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
const schema = z.object({
  q: z.string().trim().max(200),
  type: z.enum(searchTypes),
  page: integer(10000),
  pageSize: integer(50),
})
export function parseSearchParams(params: URLSearchParams) {
  return schema.parse({
    q: params.get('q') ?? '',
    type: params.get('type') ?? 'all',
    page: params.get('page') ?? '1',
    pageSize: params.get('pageSize') ?? '20',
  })
}
