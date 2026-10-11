import { expect, test } from 'vitest'
import {
  inspectDataFile,
  dataReportWithoutToken,
  DATA_KINDS,
  type DataCounts,
} from '@/lib/data-file'
const bundle = {
  version: '1.0',
  exportedAt: '2026-10-10T00:00:00.000Z',
  data: {
    modules: [],
    routeAliases: [],
    settings: [],
    profile: null,
    categories: [],
    tags: [],
    articles: [{ id: 'draft', status: 'DRAFT' }],
    logs: [],
    projects: [],
    timelineItems: [],
  },
}
test('导入文件初筛展示真实数量，完整业务字段留给服务端验证', () => {
  expect(inspectDataFile(JSON.stringify(bundle)).counts.articles).toBe(1)
  expect(inspectDataFile(JSON.stringify(bundle)).counts.profile).toBe(0)
  expect(() => inspectDataFile('{')).toThrow('JSON')
  expect(() => inspectDataFile(JSON.stringify({ ...bundle, version: '0' }))).toThrow('版本')
  expect(() =>
    inspectDataFile(JSON.stringify({ ...bundle, data: { ...bundle.data, tags: {} } })),
  ).toThrow('结构')
})
test('限制实际UTF8字节，拒绝超大文件和过多实体', () => {
  expect(() => inspectDataFile('中'.repeat(1_333_334))).toThrow('4MB')
  expect(() =>
    inspectDataFile(
      JSON.stringify({
        ...bundle,
        data: { ...bundle.data, tags: Array.from({ length: 5001 }, () => ({ id: 'x' })) },
      }),
    ),
  ).toThrow('5000')
})
test('可下载影响报告白名单去掉token，不能把凭证写入文件', () => {
  const counts = Object.fromEntries(DATA_KINDS.map((kind) => [kind, 0])) as DataCounts
  const safe = dataReportWithoutToken({
    mode: 'merge',
    token: 'secret',
    expiresAt: 'future',
    created: { ...counts, articles: 1 },
    skipped: counts,
    replaces: counts,
    mapped: {},
    warnings: ['保留配置'],
  })
  expect(JSON.stringify(safe)).not.toContain('secret')
  expect(safe.created.articles).toBe(1)
})
