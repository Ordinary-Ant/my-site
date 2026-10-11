import { expect, test } from 'vitest'
import { recentExperience, safeProfileLink } from '@/lib/profile-display'
test('About最近三条独立于时间轴正序，当前项优先，同日人工顺序稳定', () => {
  const result = recentExperience([
    { id: 'old', isCurrent: true, startDate: '2000-01-01', order: 0 },
    { id: 'a', isCurrent: false, startDate: '2024-01-01', order: 2 },
    { id: 'b', isCurrent: false, startDate: '2024-01-01', order: 1 },
    { id: 'earlier', isCurrent: false, startDate: '2020-01-01', order: 0 },
  ])
  expect(result.map((item) => item.id)).toEqual(['old', 'b', 'a'])
})
test('社交仅允许安全链接，拒绝脚本、换行与邮件头注入', () => {
  expect(safeProfileLink('mailto:hi@example.com')).toBe('mailto:hi@example.com')
  expect(safeProfileLink('tel:+8613800000000')).toBe('tel:+8613800000000')
  for (const value of [
    'javascript:alert(1)',
    'mailto:hi@example.com?bcc=leak@example.com',
    'mailto:hi@example.com%0aCc:leak@example.com',
    '//evil.test',
  ])
    expect(safeProfileLink(value)).toBeUndefined()
})

test('电话展示兼容已验证的点号分隔号码', () => {
  expect(safeProfileLink('tel:+1.234.567.8900')).toBe('tel:+1.234.567.8900')
})
