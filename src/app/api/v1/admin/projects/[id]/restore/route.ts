import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { ProjectRevisionSchema } from '@/lib/validators/project'
import { restoreProject } from '@/lib/services/project'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    return ok(
      await restoreProject(id, ProjectRevisionSchema.parse(await readJson(req)).revision, req),
    )
  })(request)
}
