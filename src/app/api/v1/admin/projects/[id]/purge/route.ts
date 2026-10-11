import { readJson } from '@/lib/api/body'
import { apiHandler } from '@/lib/api/http'
import { ProjectRevisionSchema } from '@/lib/validators/project'
import { purgeProject } from '@/lib/services/project'
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await purgeProject(id, ProjectRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
