import { expect, test } from 'vitest'
import { ProfileSchema, ProfileUpdateSchema } from '@/lib/validators/profile'
import { mergeModuleConfig } from '@/lib/validators/module'
import type { ModuleConfig } from '@/config/modules'
const body = { name: '小林', headline: '开发者', bio: '' }
test('档案严格校验完整字段、日期、数组和安全链接', () => {
  expect(ProfileSchema.parse(body).services).toEqual([])
  for (const extra of [
    { name: '' },
    { headline: '' },
    { birthday: '2023-02-29' },
    { birthday: '0000-01-01' },
    { birthday: '9999-01-01' },
    { yearsOfExp: -1 },
    { yearsOfExp: 101 },
    { avatar: 'mailto:a@example.com' },
    { resumeUrl: '//evil.test' },
    { socials: [{ platform: 'x', label: 'x', icon: 'mail', url: 'javascript:x' }] },
    { skills: [{ category: '前端', items: [{ name: 'React', level: 6, years: 1 }] }] },
    { experience: [] },
    { constructor: {} },
  ])
    expect(ProfileSchema.safeParse({ ...body, ...extra }).success).toBe(false)
  for (const birthday of ['0001-01-01', '2024-02-29', '9998-12-31'])
    expect(ProfileSchema.safeParse({ ...body, birthday }).success).toBe(true)
  for (const url of ['https://example.com', '/about', 'mailto:a@example.com', 'tel:+8613800138000'])
    expect(
      ProfileSchema.safeParse({
        ...body,
        socials: [{ platform: 'x', label: 'x', icon: 'mail', url }],
      }).success,
    ).toBe(true)
})
test('更新需要revision，nullable清空且数组替换不默认填回', () => {
  expect(
    ProfileUpdateSchema.parse({ revision: 0, avatar: null, birthday: null, services: [] }),
  ).toEqual({ revision: 0, avatar: null, birthday: null, services: [] })
  expect(ProfileUpdateSchema.safeParse({ bio: '' }).success).toBe(false)
  expect(ProfileUpdateSchema.safeParse({ revision: 1, bio: null }).success).toBe(false)
})
test('社交mailto拒绝编码换行及邮件头注入', () => {
  for (const url of [
    'mailto:hi%0aCc:evil@example.com',
    'mailto:hi%0d%0a@example.com',
    'mailto:hi@example.com?subject=hello',
    'mailto:hi@example.com%3fsubject=hello',
  ])
    expect(
      ProfileSchema.safeParse({
        ...body,
        socials: [{ platform: 'email', label: '邮箱', icon: 'mail', url }],
      }).success,
    ).toBe(false)
})
test('旧四键About配置补齐bio/services且保留自定义开关', () => {
  expect(
    (
      mergeModuleConfig(
        'about',
        { sections: { advantages: false, skills: true, experience: false, contact: false } },
        {},
      ) as ModuleConfig
    ).sections,
  ).toEqual({
    bio: true,
    advantages: false,
    skills: true,
    experience: false,
    services: true,
    contact: false,
  })
})
