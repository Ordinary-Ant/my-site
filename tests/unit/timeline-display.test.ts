import { expect, test } from 'vitest'
import { timelineDate, timelineInputDate } from '@/lib/timeline-display'

test('日期精度决定输入和展示，不补出用户没有记录的月日', () => {
  const date = '2023-03-12T00:00:00.000Z'
  expect(timelineDate(date, 'YEAR')).toBe('2023 年')
  expect(timelineDate(date, 'MONTH')).toBe('2023.03')
  expect(timelineDate(date, 'DAY')).toBe('2023.03.12')
  expect(timelineInputDate(date, 'YEAR')).toBe('2023')
  expect(timelineInputDate(date, 'MONTH')).toBe('2023-03')
  expect(timelineInputDate(null, 'DAY')).toBe('')
})
