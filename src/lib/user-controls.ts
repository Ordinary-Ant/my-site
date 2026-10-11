export type UserRole = 'ADMIN' | 'EDITOR' | 'VIEWER'
export type AdminUser = {
  id: string
  name: string
  email: string
  avatar: string | null
  role: UserRole
  isActive: boolean
  revision: number
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}
export type UserDraft = Pick<AdminUser, 'name' | 'email' | 'role' | 'isActive'> & { avatar: string }
export type UserPatch = Partial<Omit<UserDraft, 'avatar'>> & {
  avatar?: string | null
  revision: number
}
export type UserQuery = {
  q: string
  role: UserRole | ''
  active: '' | 'true' | 'false'
  page: number
  pageSize: number
}
export function readUserQuery(params: URLSearchParams): UserQuery {
  const role = params.get('role') ?? '',
    active = params.get('active') ?? '',
    page = Number(params.get('page') ?? 1),
    pageSize = Number(params.get('pageSize') ?? 20)
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    role: ['ADMIN', 'EDITOR', 'VIEWER'].includes(role) ? (role as UserRole) : '',
    active: active === 'true' || active === 'false' ? active : '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50].includes(pageSize) ? pageSize : 20,
  }
}
export function userQueryString(query: UserQuery): string {
  const params = new URLSearchParams()
  if (query.q.trim()) params.set('q', query.q.trim())
  if (query.role) params.set('role', query.role)
  if (query.active) params.set('active', query.active)
  if (query.page > 1) params.set('page', String(query.page))
  if (query.pageSize !== 20) params.set('pageSize', String(query.pageSize))
  return params.toString()
}
export function userDraft(user?: AdminUser): UserDraft {
  return user
    ? {
        name: user.name,
        email: user.email,
        avatar: user.avatar ?? '',
        role: user.role,
        isActive: user.isActive,
      }
    : { name: '', email: '', avatar: '', role: 'EDITOR', isActive: true }
}
/** 编辑快照的revision不能被列表刷新替换，避免旧表单覆盖新权限。 */
export function userPatch(draft: UserDraft, source: AdminUser): UserPatch | null {
  const patch: Record<string, unknown> = { revision: source.revision }
  if (draft.name.trim() !== source.name) patch.name = draft.name.trim()
  if (draft.email.trim().toLowerCase() !== source.email.toLowerCase())
    patch.email = draft.email.trim().toLowerCase()
  if ((draft.avatar.trim() || null) !== source.avatar) patch.avatar = draft.avatar.trim() || null
  if (draft.role !== source.role) patch.role = draft.role
  if (draft.isActive !== source.isActive) patch.isActive = draft.isActive
  return Object.keys(patch).length === 1 ? null : (patch as UserPatch)
}
export function userChangeRevokesSessions(draft: UserDraft, source: AdminUser): boolean {
  return (
    draft.role !== source.role ||
    draft.email.trim().toLowerCase() !== source.email.toLowerCase() ||
    (source.isActive && !draft.isActive)
  )
}
