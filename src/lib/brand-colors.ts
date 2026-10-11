const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
const hex = (values: number[]) =>
  '#' + values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')
const luminance = (color: string) =>
  rgb(color)
    .map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
export function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
/** 保留用户色相，按两套导航底色分别收敛亮度，正文与按钮均保持4.5:1。 */
export function accessibleBrand(input: string) {
  const source = rgb(/^#[\da-f]{6}$/i.test(input) ? input : '#6366f1')
  const adjust = (background: string, destination: number) => {
    const canvas = rgb(destination === 0 ? '#ffffff' : '#09090b')
    // 最大合法tint是文字承载面的最坏组合；兼顾导航固定淡底。
    const readable = (color: string) => {
      const tinted = hex(rgb(color).map((value, index) => value * 0.15 + canvas[index] * 0.85))
      return contrast(color, background) >= 4.55 && contrast(color, tinted) >= 4.55
    }
    let low = 0,
      high = 1
    for (let step = 0; step < 20; step++) {
      const ratio = (low + high) / 2
      const color = hex(source.map((value) => value + (destination - value) * ratio))
      if (readable(color)) high = ratio
      else low = ratio
    }
    return readable(hex(source))
      ? hex(source)
      : hex(source.map((value) => value + (destination - value) * high))
  }
  return { light: adjust('#eef2ff', 0), dark: adjust('#1e1b4b', 255) }
}
