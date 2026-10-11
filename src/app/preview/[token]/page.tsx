import type { Metadata } from 'next'
import { createHash } from 'node:crypto'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getPreviewArticle } from '@/lib/services/article'
import { getPreviewLog } from '@/lib/services/log'
import { getPreviewProject } from '@/lib/services/project'
import { projectLinks } from '@/lib/project-display'
import { ApiError } from '@/lib/api/errors'
import { Markdown } from '@/components/site/markdown'
import ImageGallery from '@/components/site/image-gallery'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = { title: '草稿预览', robots: { index: false, follow: false } }
/** 只由凭据中的类型分发，预览不复用公开缓存或公开导航。 */
export default async function Preview({ params }: { params: Promise<{ token: string }> }) {
  let item,
    images: string[] = []
  let project: Awaited<ReturnType<typeof getPreviewProject>> | undefined
  try {
    const { token } = await params
    const preview = await prisma.previewToken.findUnique({
      where: { hash: createHash('sha256').update(token).digest('hex') },
    })
    if (!preview || preview.expiresAt <= new Date())
      throw new ApiError(404, 'NOT_FOUND', '预览不存在')
    if (preview.kind === 'article') item = await getPreviewArticle(token)
    else if (preview.kind === 'log') {
      item = await getPreviewLog(token)
      images = item.images
    } else if (preview.kind === 'project') {
      project = await getPreviewProject(token)
      item = project
      images = [
        ...new Set([...(project.coverImage ? [project.coverImage] : []), ...project.gallery]),
      ]
    } else throw new ApiError(404, 'NOT_FOUND', '预览不存在')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
  return (
    <main className="container-prose py-12">
      <p className="mb-8 rounded-lg border border-amber-500 bg-amber-500/10 p-4 text-sm">
        草稿预览 · 链接有效期24小时，请勿公开分享
      </p>
      <h1 className="mb-8 text-4xl font-bold">{item.title}</h1>
      {project && (
        <div className="mb-8 space-y-5">
          {project.subtitle && <p className="text-brand text-lg">{project.subtitle}</p>}
          <p>{project.description}</p>
          <ul className="space-y-2">
            {project.highlights.map((text, index) => (
              <li key={index}>✓ {text}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {projectLinks(project.links).map((link) => (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand rounded-lg border px-4 py-2 text-sm"
              >
                {link.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
      {item.content && <Markdown source={item.content} />}
      {images.length > 0 && <ImageGallery images={images} title={item.title} />}
    </main>
  )
}
