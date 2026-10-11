/** 按原图坐标计算16:9裁切，位置和缩放限制在图像边界内。 */
export function cropRectangle(
  w: number,
  h: number,
  zoom: number,
  horizontal: number,
  vertical: number,
) {
  if (![w, h, zoom, horizontal, vertical].every(Number.isFinite) || w <= 0 || h <= 0)
    throw new Error('图片尺寸无效')
  const ratio = 16 / 9
  const width = Math.min(w, h * ratio) / Math.max(1, Math.min(4, zoom))
  const height = width / ratio
  return {
    x: ((w - width) * Math.max(0, Math.min(100, horizontal))) / 100,
    y: ((h - height) * Math.max(0, Math.min(100, vertical))) / 100,
    width,
    height,
  }
}
