import { createElement } from 'react'
import { expect, test } from 'vitest'
import { renderServerMarkup } from '../render-server-markup'
import { ArticleArchive } from '@/components/site/article-archive'
test('归档分页保持pageSize，避免跳过未读条目', async () => {
  const html = await renderServerMarkup(
    createElement(ArticleArchive, {
      data: {
        title: '归档',
        description: null,
        items: [],
        currentRoute: '/writing',
        url: '/writing/tag/example',
        pagination: {
          page: 1,
          pageSize: 1,
          total: 21,
          totalPages: 21,
          hasNext: true,
          hasPrev: false,
        },
      },
    }),
  )
  expect(html).toContain('page=2&amp;pageSize=1')
})
