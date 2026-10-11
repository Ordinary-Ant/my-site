import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { ProjectRevisionSchema } from '@/lib/validators/project'
import { getAdminProject, updateProject, deleteProject } from '@/lib/services/project'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminProject(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateProject(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await deleteProject(id, ProjectRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
