import { test, expect } from 'vitest'
import { scrubPublicContacts } from '@/lib/services/public-privacy'
test('长文章隐私处理不超栈且保留普通正文', () => {
  const content = '普通正文'.repeat(80000) + ' hi@example.com 结束'
  const result = scrubPublicContacts({ content }, ['hi@example.com']) as { content: string }
  expect(result.content).toContain('普通正文')
  expect(result.content).not.toContain('hi@example.com')
  expect(result.content).toContain('结束')
})
test('Unicode大小写扩展前缀不会错删联系方式后的文字', () => {
  const result = scrubPublicContacts({ content: 'İ 标题 hi@example.com 后文' }, [
    'hi@example.com',
  ]) as { content: string }
  expect(result.content).toBe('İ 标题  后文')
})

test('格式化电话的原文百分号实体表示使用同一联系方式匹配', () => {
  const blocked = ['+86 138 0013 8000']
  for (const phone of [
    '+86 138 0013 8000',
    '+8613800138000',
    '+86%20138%200013%208000',
    '+86&#32;138&#32;0013&#32;8000',
  ]) {
    const result = scrubPublicContacts({ content: `前文 ${phone} 后文` }, blocked) as {
      content: string
    }
    expect(result.content).toBe('前文  后文')
  }
})
test('CommonMark单反斜杠联系方式被清除，双反斜杠及代码文字语义不误解码', () => {
  const single = String.raw`前文 hi\@example.com 后文`
  expect(
    (scrubPublicContacts({ content: single }, ['hi@example.com']) as { content: string }).content,
  ).toBe('前文  后文')
  for (const content of [
    String.raw`前文 hi\\@example.com 后文`,
    String.raw`代码 ` + '`' + String.raw`hi\@example.com` + '`',
    '```text\n' + String.raw`hi\@example.com` + '\n```',
  ])
    expect(
      (scrubPublicContacts({ content }, ['hi@example.com']) as { content: string }).content,
    ).toBe(content)
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '@/components/site/markdown'
const renderedText = (source: string) =>
  renderToStaticMarkup(createElement(Markdown, { source })).replace(/<[^>]*>/g, '')
test('按实际行内语义移除strong emphasis与链接标签拆分的邮箱', () => {
  for (const fragment of [
    'hi@**example.com**',
    '**hi**@example.com',
    'h*i*@example.com',
    '[hi](https://safe.example)@**example.com**',
    'hi@[example](https://safe.example).com',
  ]) {
    const source = `前文 ${fragment} 后文`
    expect(renderedText(source)).toContain('hi@example.com')
    const cleaned = (
      scrubPublicContacts({ content: source }, ['hi@example.com']) as { content: string }
    ).content
    expect(renderedText(cleaned)).not.toContain('hi@example.com')
    expect(renderedText(cleaned)).toContain('前文')
    expect(renderedText(cleaned)).toContain('后文')
  }
})
test('电话单独归一常见连字符括号且不折叠邮箱普通标点', () => {
  for (const phone of [
    '+86-138-0013-8000',
    '(+86) 138 0013 8000',
    '+86 (138) 0013-8000',
    '+86‐138–0013—8000',
  ]) {
    const cleaned = (
      scrubPublicContacts({ content: `前文 ${phone} 后文` }, ['+86 138 0013 8000']) as {
        content: string
      }
    ).content
    expect(renderedText(cleaned)).not.toContain('138')
    expect(renderedText(cleaned)).toContain('前文')
    expect(renderedText(cleaned)).toContain('后文')
  }
  for (const content of [
    'hi@(example.com)',
    'hi@-example.com',
    'hi [unrelated](https://safe.example) @example.com',
    'hi@**not-example.com**',
    String.raw`hi\\@**example.com**`,
    '`hi@**example.com**`',
    '普通 [括号] **加粗** 文本',
  ])
    expect(
      (scrubPublicContacts({ content }, ['hi@example.com']) as { content: string }).content,
    ).toBe(content)
})

test('行内代码保留字面语义，同时不能拼出真实可见联系方式', () => {
  for (const content of ['前文 `hi`@example.com 后文', '前文 hi@`example.com` 后文']) {
    expect(renderedText(content)).toContain('hi@example.com')
    const cleaned = (scrubPublicContacts({ content }, ['hi@example.com']) as { content: string })
      .content
    expect(renderedText(cleaned)).not.toContain('hi@example.com')
    expect(renderedText(cleaned)).toContain('前文')
    expect(renderedText(cleaned)).toContain('后文')
  }
})
