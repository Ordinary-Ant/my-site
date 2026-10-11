import { expect, test } from 'vitest'
import {
  UserCreateSchema,
  UserUpdateSchema,
  UserListSchema,
  UserRevisionSchema,
} from '@/lib/validators/user'
test('用户字段严格校验、邮箱归一及头像可空', () => {
  expect(
    UserCreateSchema.parse({ name: ' 用户 ', email: ' A@Example.com ', role: 'EDITOR' }),
  ).toMatchObject({ name: '用户', email: 'a@example.com' })
  for (const extra of [
    { isActive: false },
    { password: 'secret' },
    { avatar: 'javascript:alert(1)' },
    { name: '' },
    { role: 'OWNER' },
  ])
    expect(
      UserCreateSchema.safeParse({ name: '用户', email: 'a@example.com', role: 'EDITOR', ...extra })
        .success,
    ).toBe(false)
  expect(UserUpdateSchema.parse({ revision: 1, avatar: null })).toEqual({
    revision: 1,
    avatar: null,
  })
  for (const value of [
    { revision: 1 },
    { revision: 0, name: 'x' },
    { revision: 1, name: null },
    { revision: 1, passwordHash: 'x' },
  ])
    expect(UserUpdateSchema.safeParse(value).success).toBe(false)
  expect(UserRevisionSchema.safeParse({ revision: 1, password: 'x' }).success).toBe(false)
})
test('用户列表参数不将字符串false强转true', () => {
  expect(UserListSchema.parse({ active: 'false', page: '2' })).toMatchObject({
    active: false,
    page: 2,
    pageSize: 20,
  })
  expect(UserListSchema.safeParse({ active: 'bad' }).success).toBe(false)
  expect(UserListSchema.safeParse({ pageSize: '101' }).success).toBe(false)
})
