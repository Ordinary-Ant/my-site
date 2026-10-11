import { expect, test } from 'vitest'
import {
  emptyTimelineDraft,
  timelineDraftFromRecord,
  timelinePayload,
  changeTimelinePrecision,
} from '@/lib/timeline-draft'

test('稿件保留日期精度并显式清空可空字段和数组，网络正文不携带内部字段', () => {
  const draft = timelineDraftFromRecord({
    id: 'private',
    revision: 5,
    startDate: '2023-03-01T00:00:00.000Z',
    startPrecision: 'MONTH',
    endDate: null,
    title: '工作',
    tags: ['React'],
    highlights: ['成果'],
  })
  expect(draft.startDate).toBe('2023-03')
  const body = timelinePayload({ ...draft, tags: '', highlights: '', logo: '' })
  expect(body).toMatchObject({
    startDate: '2023-03',
    startPrecision: 'MONTH',
    endDate: null,
    logo: null,
    tags: [],
    highlights: [],
  })
  expect(body).not.toHaveProperty('id')
  expect(body).not.toHaveProperty('revision')
})
test('改精度选择明确默认日历值，而不是本机时区转换', () => {
  expect(changeTimelinePrecision('2023-03-12', 'YEAR')).toBe('2023')
  expect(changeTimelinePrecision('2023', 'MONTH')).toBe('2023-01')
  expect(changeTimelinePrecision('2023-03', 'DAY')).toBe('2023-03-01')
  expect(emptyTimelineDraft().startPrecision).toBe('MONTH')
})
