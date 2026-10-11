import { expect, test } from 'vitest'
import { accessibleBrand, contrast } from '@/lib/brand-colors'
test('任意合法强调色在两套主题及导航底色满足正文对比度', () => {
  for (const color of [
    '#6366f1',
    '#ffffff',
    '#000000',
    '#00ff00',
    '#ff0000',
    '#ffff00',
    '#888888',
  ]) {
    const { light, dark } = accessibleBrand(color)
    for (const bg of ['#ffffff', '#eef2ff']) expect(contrast(light, bg)).toBeGreaterThanOrEqual(4.5)
    for (const bg of ['#09090b', '#1e1b4b']) expect(contrast(dark, bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark, '#0a0a0a')).toBeGreaterThanOrEqual(4.5)
  }
})

test('最大合法淡色装饰下品牌文字仍满足4.5', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const tint = (a: string, b: string) =>
    '#' +
    rgb(a)
      .map((v, i) =>
        Math.round(v * 0.15 + rgb(b)[i] * 0.85)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  for (const color of ['#ff0000', '#6366f1', '#ffffff', '#000000', '#00ff00']) {
    const { light, dark } = accessibleBrand(color)
    expect(contrast(light, tint(light, '#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark, tint(dark, '#09090b'))).toBeGreaterThanOrEqual(4.5)
  }
})
