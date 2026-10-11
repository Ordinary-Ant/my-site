import { expect, test } from 'vitest'
import { profileDraft, profilePayload } from '@/lib/profile-draft'

test('个人资料只提取已知编辑字段，保留日期精度并明确清空可空值', () => {
  const draft = profileDraft({
    name: '姓名',
    headline: '定位',
    bio: '正文',
    email: 'hi@example.com',
    birthday: '1998-01-01T00:00:00.000Z',
    yearsOfExp: 5,
    revision: 7,
    unknown: '丢弃',
    advantages: [{ title: '交付', description: '可验证成果', icon: 'wrench' }],
  })
  expect(draft.birthday).toBe('1998-01-01')
  expect(draft.yearsOfExp).toBe('5')
  const result = profilePayload({ ...draft, email: '', yearsOfExp: '', birthday: '' }, 7)
  expect(result).toMatchObject({
    revision: 7,
    email: null,
    yearsOfExp: null,
    birthday: null,
    advantages: [{ title: '交付', description: '可验证成果', icon: 'wrench' }],
  })
  expect(result).not.toHaveProperty('unknown')
})

test('删除数组项后恢复的快照与草稿互不污染', () => {
  const original = {
    skills: [{ category: '前端', items: [{ name: 'React', level: 5, years: 5 }] }],
  }
  const draft = profileDraft(original)
  draft.skills[0].items[0].level = 2
  expect(original.skills[0].items[0].level).toBe(5)
})

test('本地草稿允许尚未完成的业务字段，但拒绝损坏结构', async () => {
  const { profileLocalDraftSchema } = await import('@/lib/profile-draft')
  const unfinished = {
    ...profileDraft(),
    advantages: [{ title: '', description: '待补标题也要保留', icon: 'wrench' }],
    socials: [{ platform: 'github', label: '', url: '尚未填完', icon: 'github' }],
  }
  expect(profileLocalDraftSchema.safeParse(unfinished).success).toBe(true)
  expect(
    profileLocalDraftSchema.safeParse({ ...unfinished, skills: [{ items: '损坏结构' }] }).success,
  ).toBe(false)
})
