import { expect, test } from 'vitest'
import { inspectMedia, safeStorageKey } from '@/lib/storage/validation'

test('不信任扩展名或声明MIME，拒绝主动内容与路径穿越', async () => {
  await expect(
    inspectMedia(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png'),
  ).rejects.toMatchObject({ status: 415 })
  expect(() => safeStorageKey('../../evil.html')).toThrow()
  expect(() => safeStorageKey('tmp/a.png')).toThrow()
})
test('真实PNG校验尺寸与sha256，并拒绝超限', async () => {
  const sharp = (await import('sharp')).default
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } })
    .png()
    .toBuffer()
  const result = await inspectMedia(png, 'image/png')
  expect(result).toMatchObject({
    mimeType: 'image/png',
    width: 2,
    height: 3,
    kind: 'IMAGE',
    size: png.length,
  })
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/)
  await expect(inspectMedia(png, 'application/pdf')).rejects.toMatchObject({ status: 415 })
  await expect(inspectMedia(png.subarray(0, 24), 'image/png')).rejects.toMatchObject({
    status: 415,
  })
  await expect(inspectMedia(Buffer.alloc(50 * 1024 * 1024 + 1), 'video/mp4')).rejects.toMatchObject(
    { status: 413 },
  )
})
test('GIF每帧必须完整解码，拒绝损坏的后续帧', async () => {
  const gif = Buffer.from(
    '474946383961020001008000004c6971ff000021f90405000000002c00000000020001000002024c0a0021f90405000000002c0000000002000100804c69710000ff02024c0a003b',
    'hex',
  )
  expect(await inspectMedia(gif, 'image/gif')).toMatchObject({ width: 2, height: 1 })
  gif[68] = 255
  await expect(inspectMedia(gif, 'image/gif')).rejects.toMatchObject({ status: 415 })
})
