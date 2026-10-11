import { LogEditor } from '@/components/admin/log-editor'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">编辑日志</h1>
      <LogEditor key={id} id={id} />
    </div>
  )
}
