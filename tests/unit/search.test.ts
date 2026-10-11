import { expect, test } from 'vitest'
import { parseSearchParams } from '@/lib/validators/search'
import { highlightedExcerpt, plainSearchText, searchHighlightParts } from '@/lib/search-display'

test('搜索trim和严格参数边界', () => {
  expect(parseSearchParams(new URLSearchParams('q=++hi++'))).toEqual({
    q: 'hi',
    type: 'all',
    page: 1,
    pageSize: 20,
  })
  for (const query of [
    'q=' + 'a'.repeat(201),
    'type=bad',
    'page=0',
    'page=10001',
    'page=1.5',
    'pageSize=51',
    'pageSize=',
    'page=abc',
  ]) {
    expect(() => parseSearchParams(new URLSearchParams(query))).toThrow()
  }
})
test('摘要纯文字与固定em高亮不接受HTML', () => {
  expect(plainSearchText('## Title\n[hello](https://example.com) **world**')).toBe(
    'Title hello world',
  )
  expect(highlightedExcerpt('<script>alert(1)</script> literal <em>test</em> & TEST', 'test')).toBe(
    'alert(1) literal <em>test</em> &amp; <em>TEST</em>',
  )
  expect(searchHighlightParts('x &lt;img&gt; <em>&lt;script&gt;</em>')).toEqual([
    { text: 'x <img> ', highlight: false },
    { text: '<script>', highlight: true },
  ])
})
