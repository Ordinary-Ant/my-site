import 'server-only'
import { isValidElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { bundledLanguages, codeToHtml, type BundledLanguage } from 'shiki'
import {
  parseContentBlocks,
  createHeadingAllocator,
  headingText,
  safeContentUrl,
  type MarkdownNode,
} from '@/lib/markdown'
import { CopyCode } from './copy-code'

async function CodeBlock({ code, language }: { code: string; language: string }) {
  const lang = language in bundledLanguages ? (language as BundledLanguage) : 'text'
  // 高亮器负责转义代码，原始HTML与脚本不会直接进入DOM。
  const html = await codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
  })
  return (
    <div className="relative my-5 overflow-hidden rounded-xl border pt-8">
      <CopyCode />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function preserveHtml() {
  return (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode, parent = '') => {
      if (node.type === 'html') {
        node.type = [
          'paragraph',
          'heading',
          'emphasis',
          'strong',
          'link',
          'linkReference',
          'delete',
          'tableCell',
        ].includes(parent)
          ? 'inlineCode'
          : 'code'
        node.data = undefined
      }
      node.children?.forEach((child) => walk(child, node.type))
    }
    walk(tree)
  }
}

/** Markdown及自定义块服务端渲染，HTML按源码展示，链接与媒体拒绝脚本协议。 */
export function Markdown({ source }: { source: string }) {
  const allocate = createHeadingAllocator()
  const headings = () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        node.data = { hProperties: { id: allocate(headingText(node)) } }
      }
      node.children?.forEach(walk)
    }
    walk(tree)
  }
  const regular = (content: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, preserveHtml, headings]}
      components={{
        pre: ({ children }) => {
          const props = isValidElement<{ className?: string; children?: React.ReactNode }>(children)
            ? children.props
            : undefined
          return (
            <CodeBlock
              language={props?.className?.replace('language-', '') ?? 'text'}
              code={String(props?.children ?? children).replace(/\n$/, '')}
            />
          )
        },
        code: ({ className, children }) => <code className={className}>{children}</code>,
        a: ({ href, children }) =>
          safeContentUrl(href) ? (
            <a
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
        img: ({ src, alt }) =>
          safeContentUrl(typeof src === 'string' ? src : undefined) ? (
            <img src={String(src)} alt={alt ?? ''} loading="lazy" />
          ) : (
            <span>图片地址不可用</span>
          ),
        table: ({ children }) => (
          <div className="overflow-x-auto">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
  return (
    <div className="prose prose-zinc dark:prose-invert prose-headings:scroll-mt-24 prose-img:rounded-xl prose-pre:overflow-x-auto max-w-none break-words">
      {parseContentBlocks(source).map((block, index) => {
        if (block.type === 'markdown') return <div key={index}>{regular(block.content)}</div>
        if (block.type === 'source')
          return (
            <pre key={index} className="whitespace-pre-wrap">
              <code>{block.content}</code>
            </pre>
          )
        if (block.type === 'details')
          return (
            <details key={index} className="my-5 rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">{block.title}</summary>
              {regular(block.content)}
            </details>
          )
        if (block.type === 'video')
          return (
            <figure key={index}>
              <video controls preload="metadata" src={block.url} className="w-full rounded-xl" />
              <figcaption>{block.title}</figcaption>
              {regular(block.content)}
            </figure>
          )
        if (block.type === 'card')
          return (
            <aside key={index} className="rounded-xl border p-4">
              <a href={block.url} rel="noopener noreferrer" target="_blank">
                {block.title} ↗
              </a>
              {regular(block.content)}
            </aside>
          )
        return (
          <aside
            key={index}
            className={`my-5 rounded-xl border-l-4 p-4 ${block.type === 'warning' ? 'border-amber-600 bg-amber-500/10' : 'border-brand bg-brand-soft/40'}`}
          >
            <strong>{block.title}</strong>
            {regular(block.content)}
          </aside>
        )
      })}
    </div>
  )
}
