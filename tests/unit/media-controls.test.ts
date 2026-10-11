import { expect, test } from 'vitest'
import { readMediaQuery, mediaQueryString } from '@/lib/media-controls'
test('媒体全部与根目录独立，筛选序列化保留分页及中文目录', () => {
  expect(readMediaQuery(new URLSearchParams()).folder).toBe('')
  const value = { q: '封面', folder: '/', kind: 'IMAGE' as const, page: 2 }
  expect(readMediaQuery(new URLSearchParams(mediaQueryString(value)))).toEqual(value)
  expect(readMediaQuery(new URLSearchParams('kind=script&page=Infinity')).page).toBe(1)
})
