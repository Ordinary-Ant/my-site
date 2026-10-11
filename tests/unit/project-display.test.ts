import { expect, test } from 'vitest'
import { projectDate, projectLinks } from '@/lib/project-display'
test('作品链接只保留安全已知字段，主按钮优先demo', () => {
  expect(
    projectLinks({
      github: 'https://github.com/test',
      demo: '/demo',
      docs: 'javascript:alert(1)',
      unknown: 'https://evil.test',
    }),
  ).toEqual([
    { key: 'demo', label: '试玩 / 演示', url: '/demo' },
    { key: 'github', label: '查看代码', url: 'https://github.com/test' },
  ])
  expect(projectLinks(null)).toEqual([])
  expect(projectLinks(['https://example.com'])).toEqual([])
})
test('作品日期按北京时间展示，缺省与无效日期不生成虚构时间', () => {
  expect(projectDate('2025-01-31T16:00:00Z')).toBe('2025年2月')
  expect(projectDate(null)).toBe('')
  expect(projectDate('invalid')).toBe('')
})
