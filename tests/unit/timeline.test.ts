import { describe, expect, test } from 'vitest'
import { TimelineCreateSchema, TimelineUpdateSchema } from '@/lib/validators/timeline'
describe('时间线日历合同', () => {
  test.each([
    ['2024', 'YEAR', '2024-01-01'],
    ['2024-02', 'MONTH', '2024-02-01'],
    ['2024-02-29', 'DAY', '2024-02-29'],
    ['2024-02-29T23:00:00-08:00', 'DAY', '2024-02-29'],
  ])('日期精度推断和UTC归一 %s', (startDate, startPrecision, date) => {
    const result = TimelineCreateSchema.parse({ title: '经历', type: 'WORK', startDate })
    expect(result.startPrecision).toBe(startPrecision)
    expect(result.startDate.toISOString()).toBe(date + 'T00:00:00.000Z')
  })
  test.each(['2023-02-29', '2024-13', '0000', '9999', '2024-04-31', '2024-01-01Tinvalid'])(
    '拒绝不存在日期 %s',
    (startDate) =>
      expect(
        TimelineCreateSchema.safeParse({ title: '经历', type: 'WORK', startDate }).success,
      ).toBe(false),
  )
  test('显式精度归一且严格字段与当前结束约束', () => {
    expect(
      TimelineCreateSchema.parse({
        title: '经历',
        type: 'AWARD',
        startDate: '2024-09-18',
        startPrecision: 'YEAR',
      }).startDate.toISOString(),
    ).toBe('2024-01-01T00:00:00.000Z')
    for (const extra of [
      { status: 'PUBLISHED' },
      { isCurrent: true, endDate: '2025' },
      { endDate: '2023' },
      JSON.parse('{"constructor":{}}'),
    ])
      expect(
        TimelineCreateSchema.safeParse({ title: '经历', type: 'WORK', startDate: '2024', ...extra })
          .success,
      ).toBe(false)
    expect(TimelineUpdateSchema.parse({ revision: 1, description: null, tags: [] })).toEqual({
      revision: 1,
      description: null,
      tags: [],
    })
    expect(TimelineUpdateSchema.safeParse({ revision: 1, tags: [{ name: 'bad' }] }).success).toBe(
      false,
    )
  })
})
