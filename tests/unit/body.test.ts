import { expect, test } from 'vitest'
import { readJson } from '@/lib/api/body'
import { RevisionSchema } from '@/lib/validators/article'
test('无效JSON和超限正文返回明确错误，版本字段不得遗漏', async () => {
  const request = (body: string, size?: string) =>
    new Request('http://localhost/api', {
      method: 'POST',
      body,
      headers: size ? { 'content-length': size } : {},
    })
  await expect(readJson(request('{'))).rejects.toMatchObject({ status: 400, code: 'INVALID_JSON' })
  await expect(readJson(request('{}', '4200001'))).rejects.toMatchObject({ status: 413 })
  for (const body of [null, {}, { revision: 0 }, { revision: '1' }, { revision: 1, extra: true }])
    expect(RevisionSchema.safeParse(body).success).toBe(false)
  expect(RevisionSchema.parse(await readJson(request('{"revision":2}')))).toEqual({ revision: 2 })
})
