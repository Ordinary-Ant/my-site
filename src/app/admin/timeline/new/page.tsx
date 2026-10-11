import { TimelineEditor } from '@/components/admin/timeline-editor'
export default async function Page({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const { copy } = await searchParams
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">新建经历</h1>
      <TimelineEditor key={copy ?? 'new'} copyId={copy} />
    </div>
  )
}
