import 'server-only'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import {
  parseContentBlocks,
  createHeadingAllocator,
  headingText,
  type MarkdownNode,
} from './markdown'
/** 从与正文相同的Markdown AST提取目录，代码和保留源码块不产生标题。 */
export function getToc(source: string) {
  const allocate = createHeadingAllocator()
  const result: { depth: number; text: string; id: string }[] = []
  const walk = (node: MarkdownNode) => {
    if (node.type === 'heading') {
      const text = headingText(node)
      const id = allocate(text)
      if (node.depth && node.depth >= 2 && node.depth <= 4)
        result.push({ depth: node.depth, text, id })
    }
    node.children?.forEach(walk)
  }
  for (const block of parseContentBlocks(source))
    if (block.type !== 'source')
      walk(unified().use(remarkParse).use(remarkGfm).parse(block.content))
  return result
}
