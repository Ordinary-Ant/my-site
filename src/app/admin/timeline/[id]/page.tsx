import { TimelineEditor } from '@/components/admin/timeline-editor'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">编辑经历</h1>
      <TimelineEditor key={id} id={id} />
    </div>
  )
}
