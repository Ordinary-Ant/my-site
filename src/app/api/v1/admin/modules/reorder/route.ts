import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { reorderModules } from '@/lib/services/module'
export const PATCH = apiHandler(async (req) => ok(await reorderModules(await readJson(req), req)))
