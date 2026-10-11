import { expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/site/markdown'

test('多条经历与响应布局副本中的相同Markdown标题具有唯一id，文章默认锚点保持', () => {
  const source = '## Result\n\n## Result'
  const html = ['mobile-one-', 'desktop-one-', 'mobile-two-']
    .map((idPrefix) => renderToStaticMarkup(createElement(Markdown, { source, idPrefix })))
    .join('')
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
  expect(new Set(ids).size).toBe(6)
  expect(ids).toContain('desktop-one-result-1')
  expect(renderToStaticMarkup(createElement(Markdown, { source }))).toContain('id="result"')
})

test('多条内容及自定义块的脚注标识与引用都唯一且正确往返', () => {
  const source = 'Fact[^1]\n\n[^1]: note\n\n:::tip\nMore[^1]\n\n[^1]: extra\n:::'
  const html = ['mobile-one-', 'desktop-one-', 'mobile-two-']
    .map((idPrefix) => renderToStaticMarkup(createElement(Markdown, { source, idPrefix })))
    .join('')
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  expect(new Set(ids).size).toBe(ids.length)
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])
  expect(targets.length).toBeGreaterThan(0)
  for (const target of targets) expect(ids).toContain(target)
  const descriptions = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((match) => match[1])
  for (const target of descriptions) expect(ids).toContain(target)
})

test('名称与脚注默认标识相似的普通标题保留文章目录锚点', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      source: '## Footnote label\n\n## User content fn 1\n\nNote[^1]\n\n[^1]: footnote',
    }),
  )
  expect(html).toContain('id="footnote-label"')
  expect(html).toContain('id="user-content-fn-1"')
  expect(html).toContain('id="footnotes-0-footnote-label"')
})
