import { expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/site/markdown'
test('行内HTML保留源码但不生成段落内块元素，目录锚点保持唯一', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { source: 'Hello <b>world</b>.\n\n## A\n\n## A\n\n## A-1' }),
  )
  expect(html).toContain('<code>&lt;b&gt;</code>world<code>&lt;/b&gt;</code>')
  expect(html).not.toContain('<p>Hello <div')
  const reference = renderToStaticMarkup(
    createElement(Markdown, { source: '[<b>hello</b>][x]\n\n[x]: https://example.com' }),
  )
  expect(reference).toContain('<code>&lt;b&gt;</code>hello<code>&lt;/b&gt;</code>')
  expect(reference).not.toContain('<div><code>')
  for (const id of ['a', 'a-1', 'a-1-1'])
    expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1)
})
