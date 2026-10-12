import type { ReactNode } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { vi } from 'vitest'
// 服务端组件会异步读取nonce；单元给最小请求上下文，真实CSP由浏览器验证。
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'unit-nonce' }) }))
export async function renderServerMarkup(element: ReactNode) {
  const stream = await renderToReadableStream(element)
  await stream.allReady
  return new Response(stream).text()
}
