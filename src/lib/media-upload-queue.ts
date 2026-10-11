const limits: Record<string, number> = {
  'image/png': 10,
  'image/jpeg': 10,
  'image/webp': 10,
  'image/gif': 10,
  'image/avif': 10,
  'video/mp4': 50,
  'video/webm': 50,
  'application/pdf': 20,
}
export const mediaAccept = Object.keys(limits).join(',')
/** 客户端只做快速反馈，不替代服务端magic、大小和归属检查。 */
export function mediaFileError(file: Pick<File, 'type' | 'size'>): string {
  const max = Object.hasOwn(limits, file.type) ? limits[file.type] : undefined
  if (!max) return '不支持此文件类型；仅支持常用图片、MP4/WebM与PDF，拒绝SVG/HTML。'
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return '文件不能为空。'
  return file.size > max * 1024 * 1024 ? '文件超过' + max + 'MB限制。' : ''
}
/** 固定三路并发，逐项失败独立报告，调用方仅重试失败快照。 */
export async function runMediaUploadQueue<T>(
  tasks: readonly T[],
  run: (task: T) => Promise<void>,
  failed: (task: T, error: unknown) => void,
) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++]
        try {
          await run(task)
        } catch (error) {
          failed(task, error)
        }
      }
    }),
  )
}
