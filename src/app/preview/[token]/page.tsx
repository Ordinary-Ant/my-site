import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPreviewArticle } from '@/lib/services/article'
import { ApiError } from '@/lib/api/errors'
import { Markdown } from '@/components/site/markdown'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = { title: '草稿预览', robots: { index: false, follow: false } }
/** 预览不复用公开缓存；凭据过期或删除立即返回404。 */
export default async function Preview({ params }: { params: Promise<{ token: string }> }) {
  let article
  try {
    article = await getPreviewArticle((await params).token)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
  return (
    <main className="container-prose py-12">
      <p className="mb-8 rounded-lg border border-amber-500 bg-amber-500/10 p-4 text-sm">
        草稿预览 · 链接有效期24小时，请勿公开分享
      </p>
      <h1 className="mb-8 text-4xl font-bold">{article.title}</h1>
      <Markdown source={article.content} />
    </main>
  )
}
