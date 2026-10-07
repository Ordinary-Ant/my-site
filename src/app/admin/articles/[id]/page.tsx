import { ArticleEditor } from '@/components/admin/article-editor'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ArticleEditor id={(await params).id} />
}
