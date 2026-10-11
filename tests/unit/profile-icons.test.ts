import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ProfileIcon } from '@/components/admin/profile-icons'
test('未知及对象原型图标名回退默认图标，不执行原型成员', () => {
  for (const name of ['constructor', 'hasOwnProperty', '__proto__', 'toString', 'unknown'])
    expect(renderToStaticMarkup(createElement(ProfileIcon, { name }))).toContain('<svg')
})
