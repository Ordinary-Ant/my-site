import { expect, test } from 'vitest'
import { cropRectangle } from '@/lib/image-crop'

test('16:9裁切保持原图边界，缩放与位置不改变比例', () => {
  expect(cropRectangle(800, 800, 1, 50, 50)).toEqual({ x: 0, y: 175, width: 800, height: 450 })
  expect(cropRectangle(1600, 900, 2, 100, 0)).toEqual({ x: 800, y: 0, width: 800, height: 450 })
  const box = cropRectangle(900, 1600, 3, -10, 200)
  expect(box.x).toBe(0)
  expect(box.y + box.height).toBe(1600)
  expect(box.width / box.height).toBeCloseTo(16 / 9)
})

test('非法尺寸不能产生可上传的裁切图', () => {
  expect(() => cropRectangle(0, 100, 1, 50, 50)).toThrow()
  expect(() => cropRectangle(100, Infinity, 1, 50, 50)).toThrow()
})
