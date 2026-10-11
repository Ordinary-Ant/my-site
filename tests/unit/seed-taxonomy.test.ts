import { expect, test } from 'vitest'
import { SEED_TAGS } from '@/config/seed-taxonomy'
import { TagCreateSchema } from '@/lib/validators/taxonomy'
test('默认标签均满足后台及数据恢复的同一slug合同', () => {
  for (const tag of SEED_TAGS) expect(TagCreateSchema.safeParse(tag).success).toBe(true)
  expect(SEED_TAGS.find((tag) => tag.name === '性能')?.slug).toBe('performance')
})
