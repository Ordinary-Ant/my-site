import { ProjectEditor } from '@/components/admin/project-editor'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">编辑作品</h1>
      <ProjectEditor key={id} id={id} />
    </div>
  )
}
