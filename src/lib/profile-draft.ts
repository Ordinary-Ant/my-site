export type ProfileCard = { title: string; description: string; icon: string }
export type ProfileSocial = { platform: string; label: string; url: string; icon: string }
export type ProfileSkill = {
  category: string
  items: { name: string; level: number; years: number }[]
}
export type ProfileDraft = Record<
  | 'name'
  | 'headline'
  | 'avatar'
  | 'bio'
  | 'email'
  | 'phone'
  | 'location'
  | 'birthday'
  | 'jobTitle'
  | 'company'
  | 'yearsOfExp'
  | 'resumeUrl',
  string
> & {
  contactVisible: boolean
  advantages: ProfileCard[]
  services: ProfileCard[]
  socials: ProfileSocial[]
  skills: ProfileSkill[]
}
const strings = [
  'name',
  'headline',
  'avatar',
  'bio',
  'email',
  'phone',
  'location',
  'birthday',
  'jobTitle',
  'company',
  'yearsOfExp',
  'resumeUrl',
] as const
const localCard = z
  .object({ title: z.string(), description: z.string(), icon: z.string() })
  .strict()
/** 本地稿只校验形状；空标题和未完成链接必须能恢复，提交再验证业务规则。 */
export const profileLocalDraftSchema = z
  .object({
    ...Object.fromEntries(strings.map((key) => [key, z.string()])),
    contactVisible: z.boolean(),
    advantages: z.array(localCard).max(50),
    services: z.array(localCard).max(50),
    socials: z
      .array(
        z
          .object({ platform: z.string(), label: z.string(), url: z.string(), icon: z.string() })
          .strict(),
      )
      .max(50),
    skills: z
      .array(
        z
          .object({
            category: z.string(),
            items: z
              .array(
                z
                  .object({
                    name: z.string(),
                    level: z.number().finite(),
                    years: z.number().finite(),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
/** 编辑器复制已知字段；数组深拷贝，防止恢复快照与当前编辑互相污染。 */
export function profileDraft(record: Record<string, unknown> = {}): ProfileDraft {
  const result = Object.fromEntries(
    strings.map((key) => [key, record[key] == null ? '' : String(record[key])]),
  ) as unknown as ProfileDraft
  result.birthday = result.birthday.slice(0, 10)
  result.contactVisible = record.contactVisible !== false
  for (const key of ['advantages', 'services', 'socials', 'skills'] as const)
    result[key] = structuredClone(Array.isArray(record[key]) ? record[key] : []) as never
  return result
}
/** 明确空字符串清空可空字段；身份、修订与未知字段不能混入写入数据。 */
export function profilePayload(draft: ProfileDraft, revision: number) {
  const result: Record<string, unknown> = { revision, contactVisible: draft.contactVisible }
  for (const key of strings)
    result[key] = ['name', 'headline', 'bio'].includes(key) ? draft[key] : draft[key] || null
  result.yearsOfExp = draft.yearsOfExp ? Number(draft.yearsOfExp) : null
  for (const key of ['advantages', 'services', 'socials', 'skills'] as const)
    result[key] = structuredClone(draft[key])
  return result
}
import { z } from 'zod'
