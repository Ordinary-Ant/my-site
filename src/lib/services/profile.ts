import 'server-only'
import { Prisma, type Profile } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import type { ModuleConfig } from '@/config/modules'
import { ProfileSchema, ProfileUpdateSchema, type ProfileEditable } from '@/lib/validators/profile'
import { mergeModuleConfig } from '@/lib/validators/module'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateContent, invalidateConfiguration } from './cache'
import { applyPublicPrivacy } from './public-site'
import { getPublicAboutExperience } from './timeline'
export type { ProfileEditable } from '@/lib/validators/profile'

const conflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', '内容已被其他窗口修改，请先比较最新版本')
const defaults = () => ProfileSchema.parse({ name: '待完善', headline: '个人网站', bio: '' })
function editable(profile: Profile | null): ProfileEditable {
  if (!profile) return defaults()
  const { id: _id, revision: _revision, updatedAt: _updated, birthday, ...fields } = profile
  return ProfileSchema.parse({ ...fields, birthday: birthday?.toISOString().slice(0, 10) ?? null })
}
const publicKeys = [
  'name',
  'headline',
  'avatar',
  'bio',
  'location',
  'jobTitle',
  'company',
  'yearsOfExp',
  'socials',
  'advantages',
  'skills',
  'services',
  'resumeUrl',
  'email',
  'phone',
  'experience',
] as const
type AboutExperience = Omit<
  Awaited<ReturnType<typeof getPublicAboutExperience>>[number],
  'revision' | 'createdAt' | 'updatedAt' | 'visible' | 'showOnAbout'
>
export type PublicProfile = Pick<
  ProfileEditable,
  'name' | 'headline' | 'avatar' | 'location' | 'jobTitle' | 'company' | 'yearsOfExp' | 'resumeUrl'
> &
  Partial<
    Pick<
      ProfileEditable,
      'bio' | 'advantages' | 'skills' | 'services' | 'email' | 'phone' | 'socials'
    >
  > & { experience?: AboutExperience[] }
/** 公开字段投影只能减少白名单，不可越过栏目、区块和联系方式边界。 */
export async function getPublicProfile(params = new URLSearchParams()): Promise<PublicProfile> {
  for (const key of params.keys())
    if (key !== 'fields') throw new ApiError(400, 'VALIDATION_ERROR', '查询参数无效')
  const fields = params.has('fields') ? params.get('fields')!.split(',') : null
  if (fields?.some((key) => !(publicKeys as readonly string[]).includes(key)))
    throw new ApiError(400, 'VALIDATION_ERROR', '公开字段无效')
  const about = await prisma.module.findUnique({ where: { key: 'about' } })
  if (!about?.enabled) throw new ApiError(404, 'MODULE_DISABLED', '栏目未开放')
  const config = mergeModuleConfig('about', about.config, {}) as ModuleConfig
  const p = editable(await prisma.profile.findUnique({ where: { id: 'default' } }))
  const result: PublicProfile = {
    name: p.name,
    headline: p.headline,
    avatar: p.avatar,
    location: p.location,
    jobTitle: p.jobTitle,
    company: p.company,
    yearsOfExp: p.yearsOfExp,
    resumeUrl: p.resumeUrl,
  }
  for (const key of ['bio', 'advantages', 'skills', 'services'] as const)
    if (config.sections?.[key] !== false) Object.assign(result, { [key]: p[key] })
  if (config.sections?.experience !== false)
    result.experience = (await getPublicAboutExperience()).map(
      ({
        revision: _revision,
        createdAt: _created,
        updatedAt: _updated,
        visible: _visible,
        showOnAbout: _show,
        ...item
      }) => item,
    )
  if (config.sections?.contact !== false) {
    result.socials = p.socials
    if (p.contactVisible) Object.assign(result, { email: p.email, phone: p.phone })
  }
  const safe = await applyPublicPrivacy(result)
  return fields
    ? (Object.fromEntries(
        fields
          .filter((key) => Object.hasOwn(safe, key))
          .map((key) => [key, safe[key as keyof PublicProfile]]),
      ) as PublicProfile)
    : safe
}
/** 经历来自Timeline，只读展示，不接受档案写入。 */
export async function getAdminProfile(request?: Request) {
  await requirePermission('content:read', request)
  const [profile, experience] = await Promise.all([
    prisma.profile.findUnique({ where: { id: 'default' } }),
    prisma.timelineItem.findMany({
      where: { type: 'WORK', deletedAt: null },
      orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }, { order: 'asc' }, { id: 'asc' }],
    }),
  ])
  return { ...editable(profile), revision: profile?.revision ?? 0, experience }
}
export async function updateProfile(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request)
  const { revision, ...patch } = ProfileUpdateSchema.parse(input)
  let profile: Profile
  try {
    profile = await prisma.$transaction(async (tx) => {
      const before = await tx.profile.findUnique({ where: { id: 'default' } })
      if ((before?.revision ?? 0) !== revision) throw conflict()
      // 白名单合并后完整重验；数组整体替换，null只清空可空字段。
      const merged = ProfileSchema.parse({ ...editable(before), ...patch })
      const data = {
        ...merged,
        birthday: merged.birthday ? new Date(merged.birthday + 'T00:00:00Z') : null,
      }
      let after: Profile
      if (!before)
        after = await tx.profile.create({ data: { id: 'default', ...data, revision: 1 } })
      else {
        const result = await tx.profile.updateMany({
          where: { id: 'default', revision },
          data: { ...data, revision: { increment: 1 } },
        })
        if (!result.count) throw conflict()
        after = await tx.profile.findUniqueOrThrow({ where: { id: 'default' } })
      }
      const changed = Object.keys(merged).filter(
        (key) =>
          JSON.stringify(editable(before)[key as keyof ProfileEditable]) !==
          JSON.stringify(merged[key as keyof ProfileEditable]),
      )
      await writeAudit(tx, {
        userId: user.id,
        action: before ? 'update' : 'create',
        resource: 'profile',
        resourceId: 'default',
        ...(before
          ? {
              before: Object.fromEntries(
                changed.map((key) => [key, editable(before)[key as keyof ProfileEditable]]),
              ),
            }
          : {}),
        after: before
          ? Object.fromEntries(changed.map((key) => [key, merged[key as keyof ProfileEditable]]))
          : merged,
      })
      return after
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw conflict()
    throw error
  }
  invalidateContent('profile')
  // 联系方式边界会改变全站公开派生数据。
  invalidateConfiguration()
  return { ...editable(profile), revision: profile.revision }
}
