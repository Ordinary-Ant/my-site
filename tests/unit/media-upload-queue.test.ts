import { expect, test } from 'vitest'
import { mediaFileError, runMediaUploadQueue } from '@/lib/media-upload-queue'

test('客户端初筛只拒绝已知超限和类型，真实类型仍由服务端核验', () => {
  expect(mediaFileError({ type: 'image/png', size: 10 * 1024 * 1024 })).toBe('')
  expect(mediaFileError({ type: 'image/png', size: 10 * 1024 * 1024 + 1 })).toContain('10MB')
  expect(mediaFileError({ type: 'image/svg+xml', size: 100 })).toContain('不支持')
  expect(mediaFileError({ type: 'constructor', size: 100 })).toContain('不支持')
  expect(mediaFileError({ type: 'application/pdf', size: 20 * 1024 * 1024 + 1 })).toContain('20MB')
})
test('上传并发最多三个，单项失败不丢成功结果，重试只操作失败文件', async () => {
  let active = 0,
    max = 0
  const results: string[] = [],
    failed: number[] = []
  const tasks = [0, 1, 2, 3, 4]
  await runMediaUploadQueue(
    tasks,
    async (item) => {
      active++
      max = Math.max(max, active)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        if (item === 1) throw new Error('单项失败')
        results.push('成功' + item)
      } finally {
        active--
      }
    },
    (item) => failed.push(item),
  )
  expect(max).toBe(3)
  expect(results.sort()).toEqual(['成功0', '成功2', '成功3', '成功4'])
  expect(failed).toEqual([1])
  await runMediaUploadQueue(
    failed,
    async (item) => {
      results.push('成功' + item)
    },
    () => {},
  )
  expect(results.filter((value) => value === '成功0')).toHaveLength(1)
  expect(results).toContain('成功1')
})
