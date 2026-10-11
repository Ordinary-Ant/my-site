import { expect, test } from 'vitest'
import {
  readUserQuery,
  userQueryString,
  userDraft,
  userPatch,
  userChangeRevokesSessions,
  type AdminUser,
} from '@/lib/user-controls'
const user: AdminUser = {
  id: 'c000000000000000000000001',
  name: '管理员',
  email: 'admin@example.com',
  avatar: '/avatar.png',
  role: 'ADMIN',
  isActive: true,
  revision: 7,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  lastLoginAt: null,
}
test('用户筛选只接受已知值并保留分页往返', () => {
  const query = readUserQuery(
    new URLSearchParams('q=助手&role=EDITOR&active=false&page=2&pageSize=10&secret=x'),
  )
  expect(readUserQuery(new URLSearchParams(userQueryString(query)))).toEqual(query)
  expect(userQueryString(query)).not.toContain('secret')
  expect(readUserQuery(new URLSearchParams('role=OWNER&active=x&page=-1&pageSize=999'))).toEqual({
    q: '',
    role: '',
    active: '',
    page: 1,
    pageSize: 20,
  })
})
test('只发送实际变更、头像可清空且保留编辑开始的revision', () => {
  const draft = userDraft(user)
  expect(userPatch(draft, user)).toBeNull()
  expect(userPatch({ ...draft, name: ' 新名称 ', avatar: '' }, user)).toEqual({
    revision: 7,
    name: '新名称',
    avatar: null,
  })
  expect(userPatch({ ...draft, email: ' ADMIN@EXAMPLE.COM ' }, user)).toBeNull()
})
test('仅角色邮箱变更或停用提示撤销，重新启用及姓名头像不误报', () => {
  const draft = userDraft(user)
  expect(userChangeRevokesSessions({ ...draft, name: '改名' }, user)).toBe(false)
  expect(userChangeRevokesSessions({ ...draft, email: 'new@example.com' }, user)).toBe(true)
  expect(userChangeRevokesSessions({ ...draft, role: 'EDITOR' }, user)).toBe(true)
  expect(userChangeRevokesSessions({ ...draft, isActive: false }, user)).toBe(true)
  expect(userChangeRevokesSessions(draft, { ...user, isActive: false })).toBe(false)
})
