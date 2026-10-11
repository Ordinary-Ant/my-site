import { expect, test } from 'vitest'
import { LogCreateSchema, LogUpdateSchema } from '@/lib/validators/log'
const body = { title: '日志', content: '正文', logDate: '2024-02-29' }
test('日志日期严格且默认发布，禁止客户端作者统计字段', () => {
  expect(LogCreateSchema.parse(body).status).toBe('PUBLISHED')
  for (const logDate of ['2023-02-29', '2024-13-01', '2024-1-01', '2024-02-29T00:00:00Z'])
    expect(LogCreateSchema.safeParse({ ...body, logDate }).success).toBe(false)
  for (const extra of [
    { authorId: 'x' },
    { viewCount: 99 },
    { mood: 'invalid' },
    { weather: 'invalid' },
    { images: ['javascript:alert(1)'] },
  ])
    expect(LogCreateSchema.safeParse({ ...body, ...extra }).success).toBe(false)
})
test('日志更新要求revision、数组整体替换和null清除', () => {
  expect(LogUpdateSchema.safeParse({ title: '修改' }).success).toBe(false)
  expect(
    LogUpdateSchema.parse({ revision: 1, summary: null, mood: null, images: [], tagIds: [] }),
  ).toEqual({ revision: 1, summary: null, mood: null, images: [], tagIds: [] })
})
test('日志日期年份与日历范围一致，9998有效而9999拒绝', () => {
  expect(
    LogCreateSchema.safeParse({ title: '边界', content: '正文', logDate: '9998-12-31' }).success,
  ).toBe(true)
  expect(
    LogCreateSchema.safeParse({ title: '边界', content: '正文', logDate: '9999-12-31' }).success,
  ).toBe(false)
})
