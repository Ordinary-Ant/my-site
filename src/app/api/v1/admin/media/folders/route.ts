import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { createMediaFolder, listMediaFolders } from '@/lib/services/media'
export const runtime = 'nodejs'
export const GET = apiHandler(async (request) => ok(await listMediaFolders(request)))
export const POST = apiHandler(async (request) =>
  ok(await createMediaFolder(await readJson(request), request)),
)
