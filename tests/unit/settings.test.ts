import { test, expect } from 'vitest'
import { settingGroups } from '@/lib/validators/settings'
test('设置URL拒绝协议相对反斜杠和编码控制字符', () => {
  for (const value of [
    '//evil.example/path',
    '/\\evil.example',
    '/%0d%0aevil',
    'javascript:alert(1)',
    'https://example.com/%00x',
  ])
    expect(settingGroups.general.safeParse({ 'site.logo': value }).success).toBe(false)
  for (const value of ['', null, '/logo.svg', 'https://example.com/logo.svg'])
    expect(settingGroups.general.safeParse({ 'site.logo': value }).success).toBe(true)
})
