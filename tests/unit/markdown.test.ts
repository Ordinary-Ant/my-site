import { expect, test } from 'vitest'
import { parseContentBlocks, markdownRequiresSource, safeContentUrl } from '@/lib/markdown'
import { getToc } from '@/lib/markdown-toc'

test('长围栏内的短围栏不能执行扩展块，目录与实际标题语义一致', () => {
  const code = '````markdown\n```\n:::tip[代码示例]\n不应作为提示\n:::\n## 不应入目录\n````'
  expect(parseContentBlocks(code)).toEqual([{ type: 'markdown', content: code }])
  expect(getToc(code)).toEqual([])
  expect(getToc('## A\n\n## A\n\n## A-1').map((item) => item.id)).toEqual(['a', 'a-1', 'a-1-1'])
  expect(getToc('## A &amp; B\n\n## [Link][ref]\n\n[ref]: https://example.com')).toEqual([
    { depth: 2, text: 'A & B', id: 'a-b' },
    { depth: 2, text: 'Link', id: 'link' },
  ])
})

test('自定义块保留未知结构源码，代码围栏内伪块不被执行', () => {
  expect(parseContentBlocks(':::tip[提示]\n**内容**\n:::')).toEqual([
    { type: 'tip', title: '提示', content: '**内容**' },
  ])
  expect(parseContentBlocks(':::mystery\n原文\n:::')).toEqual([
    { type: 'source', content: ':::mystery\n原文\n:::' },
  ])
  expect(parseContentBlocks('```md\n:::tip\n不能变成提示\n:::\n```')).toEqual([
    { type: 'markdown', content: '```md\n:::tip\n不能变成提示\n:::\n```' },
  ])
  expect(markdownRequiresSource(':::tip\n保留\n:::')).toBe(true)
  expect(markdownRequiresSource('## 正文\n\n**加粗**')).toBe(false)
  expect(markdownRequiresSource('<custom>未知HTML</custom>')).toBe(true)
  expect(markdownRequiresSource('<!-- 未知编辑扩展元数据 -->')).toBe(true)
  expect(markdownRequiresSource('# 已存一级标题')).toBe(true)
  expect(markdownRequiresSource('##### 五级标题')).toBe(true)
})

test('视频/图片/外链仅接受安全协议和站内绝对路径', () => {
  expect(safeContentUrl('https://example.com/a.mp4')).toBe('https://example.com/a.mp4')
  expect(safeContentUrl('/uploads/a.png')).toBe('/uploads/a.png')
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//evil.test/x',
    '/uploads/../a',
    '/uploads/%2e./a',
    '/uploads/%2f%2fevil',
  ])
    expect(safeContentUrl(url)).toBeUndefined()
})
