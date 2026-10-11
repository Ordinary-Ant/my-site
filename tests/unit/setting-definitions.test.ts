import { expect, test } from 'vitest'
import { settingDefinitions, settingGroups } from '@/config/settings'
test('六组22字段由同一配置生成界面和严格校验，帮助与图片字段齐全', () => {
  expect(Object.keys(settingDefinitions)).toHaveLength(6)
  let total = 0
  for (const [group, definition] of Object.entries(settingDefinitions)) {
    expect(Object.keys(settingGroups[group as keyof typeof settingGroups].shape).sort()).toEqual(
      definition.fields.map((field) => field.key).sort(),
    )
    for (const field of definition.fields) {
      total++
      expect(field.help.length).toBeGreaterThan(8)
    }
  }
  expect(total).toBe(22)
  expect(settingDefinitions.general.fields.find((field) => field.key === 'site.logo')?.kind).toBe(
    'image',
  )
  expect(settingDefinitions.seo.fields.find((field) => field.key === 'seo.ogImage')?.kind).toBe(
    'image',
  )
  expect(settingGroups.general.safeParse({ 'footer.icp': '越组' }).success).toBe(false)
  expect(settingGroups.social.safeParse({ 'social.email': null }).success).toBe(true)
})
