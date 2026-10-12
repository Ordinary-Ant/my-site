import { expect, test } from 'vitest'
import vm from 'node:vm'
import { bindMiddlewareFetch } from '../../scripts/prepare-edgeone-artifact.mjs'

const fixture = `// Next.js Middleware compiled for EdgeOne Pages Edge Function
async function executeMiddleware({request}) { return fetch(request); }
      function recreateRequest() {}
function usercode(context, hookCtx) {
  const { fetch } = hookCtx;
  const runMiddleware = typeof executeMiddleware !== 'undefined' ? executeMiddleware : async function() { return null; };
  return runMiddleware(context);
}`

test('中间件使用每请求平台fetch，原生fetch失败也不影响并发请求的独立绑定', async () => {
  const nativeFetch = async () => 'native-502'
  const original = vm.runInNewContext(fixture + ';usercode', { fetch: nativeFetch })
  expect(await original({ request: '/a' }, { fetch: async () => 'hook-a' })).toBe('native-502')
  const run = vm.runInNewContext(bindMiddlewareFetch(fixture) + ';usercode', { fetch: nativeFetch })
  expect(
    await Promise.all([
      run(
        { request: '/a' },
        {
          fetch: async () => {
            await new Promise((r) => setTimeout(r, 10))
            return 'hook-a'
          },
        },
      ),
      run({ request: '/b' }, { fetch: async () => 'hook-b' }),
    ]),
  ).toEqual(['hook-a', 'hook-b'])
})

test('CLI模板变化或重复适配时拒绝静默生成错误发布包', () => {
  expect(() => bindMiddlewareFetch('different template')).toThrow()
  expect(() => bindMiddlewareFetch(bindMiddlewareFetch(fixture))).toThrow()
})
