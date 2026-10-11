import { expect, test } from 'vitest'
import { chinaToday, monthCells, shiftMonth } from '@/lib/log-display'

test('日志今天按UTC+8取日期，跨UTC日界不偏移', () => {
  expect(chinaToday(new Date('2026-01-01T16:01:00Z'))).toBe('2026-01-02')
  expect(chinaToday(new Date('2026-01-01T15:59:00Z'))).toBe('2026-01-01')
})
test('日历处理闰月、月首留白和跨年切换', () => {
  const leap = monthCells(2024, 2)
  expect(leap.filter(Boolean)).toHaveLength(29)
  expect(leap.indexOf(1)).toBe(4)
  expect(monthCells(2025, 2).filter(Boolean)).toHaveLength(28)
  expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
  expect(monthCells(1, 1).indexOf(1)).toBe(1)
  expect(shiftMonth(1, 1, 1)).toEqual({ year: 1, month: 2 })
})
