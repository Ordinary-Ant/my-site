import { expect, test } from 'vitest'
import { xmlText, jsonLdText, rssXml, sitemapXml, absolutePublicUrl } from '@/lib/seo'

test('XML与JSON-LD不能闭合文档或脚本，链接固定站点Origin', () => {
  expect(xmlText('<script>&"')).toBe('&lt;script&gt;&amp;&quot;')
  expect(jsonLdText({ text: '</script>\u2028&' })).not.toContain('<')
  expect(jsonLdText({ text: '</script>\u2028&' })).not.toContain('\u2028')
  expect(absolutePublicUrl('/writing/a?x=1')).toMatch(/\/writing\/a\?x=1$/)
  expect(() => absolutePublicUrl('//evil.example/path')).toThrow()
  expect(() => absolutePublicUrl('https://evil.example')).toThrow()
})

test('RSS空订阅有效且GUID稳定；站点地图转义XML，不输出私有字段', () => {
  expect(rssXml({ name: '网站', description: '说明' }, [])).toContain('<channel>')
  const xml = rssXml({ name: 'A&B', description: '<标题>' }, [
    {
      resource: 'article',
      id: 'stable-id',
      title: '</title>',
      summary: '正文 <em>',
      path: '/writing/new',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
    },
  ])
  expect(xml).toContain('article:stable-id')
  expect(xml).toContain('&lt;/title&gt;')
  expect(xml).not.toContain('<em>')
  expect(sitemapXml([{ path: '/writing/a?x=1&y=2', updatedAt: new Date('2026-01-01') }])).toContain(
    'x=1&amp;y=2',
  )
})
