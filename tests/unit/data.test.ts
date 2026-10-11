import { expect, test } from 'vitest'
import { DataBundleSchema, rejectDangerousKeys } from '@/lib/validators/data'
import { MODULE_KEYS, MODULE_REGISTRY } from '@/config/modules'
import { DEFAULT_MOTION } from '@/config/motion'
import { ProfileSchema } from '@/lib/validators/profile'
const iso = '2020-01-01T00:00:00.000Z'
const validBundle = () => ({
  version: '1.0',
  exportedAt: iso,
  data: {
    modules: MODULE_KEYS.map((key) => ({
      ...MODULE_REGISTRY[key],
      key,
      enabled: true,
      navLabel: null,
      isBuiltin: true,
      updatedAt: iso,
      config: MODULE_REGISTRY[key].defaultConfig,
    })).map(({ canDisable: _, defaultConfig: __, ...moduleRow }) => {
      void _
      void __
      return moduleRow
    }),
    routeAliases: [],
    settings: [
      {
        key: 'motion.config',
        group: 'motion',
        value: structuredClone(DEFAULT_MOTION) as Record<string, unknown>,
        label: null,
        updatedAt: iso,
        updatedBy: null,
      },
    ],
    profile: null,
    categories: [],
    tags: [],
    articles: [],
    logs: [],
    projects: [],
    timelineItems: [
      {
        id: 'c000000000000000000000001',
        title: '合法精度',
        subtitle: null,
        description: '  原文\n',
        type: 'WORK',
        organization: null,
        location: null,
        startDate: iso,
        endDate: null,
        isCurrent: true,
        startPrecision: 'YEAR',
        endPrecision: 'MONTH',
        revision: 1,
        logo: null,
        tags: [],
        highlights: [],
        order: 0,
        visible: true,
        showOnAbout: true,
        createdAt: iso,
        updatedAt: iso,
        deletedAt: null,
      },
    ],
  },
})
test('birthday backup rejects timezone shifts and non-midnight values while preserving valid calendar dates', () => {
  const withBirthday = (birthday: string | null) => {
    const bundle = validBundle()
    return {
      ...bundle,
      data: {
        ...bundle.data,
        profile: {
          ...ProfileSchema.parse({ name: '作者', headline: '简介', bio: '  # 原文\n' }),
          id: 'default',
          revision: 1,
          updatedAt: iso,
          birthday,
        },
      },
    }
  }
  for (const birthday of [
    '2020-01-01T00:00:00+08:00',
    '9998-12-31T23:00:00-02:00',
    '2020-01-01T12:00:00.000Z',
    '0000-01-01T00:00:00.000Z',
    '9999-01-01T00:00:00.000Z',
    '2023-02-29T00:00:00.000Z',
  ])
    expect(DataBundleSchema.safeParse(withBirthday(birthday)).success, birthday).toBe(false)
  for (const birthday of [
    null,
    '0001-01-01T00:00:00.000Z',
    '2024-02-29T00:00:00.000Z',
    '9998-12-31T00:00:00.000Z',
  ]) {
    const bundle = withBirthday(birthday)
    expect(DataBundleSchema.parse(bundle)).toEqual(bundle)
  }
})
test('timeline backup requires years 0001–9998 and exact precision normalized UTC midnight', () => {
  const valid = validBundle()
  expect(DataBundleSchema.safeParse(valid).success).toBe(true)
  const dates = [
    '0000-01-01T00:00:00.000Z',
    '9999-01-01T00:00:00.000Z',
    '2020-12-31T12:00:00.000Z',
    '2020-12-31T00:00:00.000Z',
    '2020-01-01T00:00:00+08:00',
  ]
  for (const startDate of dates) {
    const bundle = validBundle()
    bundle.data.timelineItems[0].startDate = startDate
    expect(DataBundleSchema.safeParse(bundle).success, startDate).toBe(false)
  }
  const end = validBundle()
  Object.assign(end.data.timelineItems[0], {
    isCurrent: false,
    endDate: '2021-03-02T00:00:00.000Z',
  })
  expect(DataBundleSchema.safeParse(end).success).toBe(false)
  for (const [startPrecision, startDate] of [
    ['YEAR', '0001-01-01T00:00:00.000Z'],
    ['MONTH', '2020-02-01T00:00:00.000Z'],
    ['DAY', '9998-12-31T00:00:00.000Z'],
  ]) {
    const bundle = validBundle()
    Object.assign(bundle.data.timelineItems[0], { startPrecision, startDate })
    expect(DataBundleSchema.parse(bundle)).toEqual(bundle)
  }
})
test('motion backup must include fields which editor motion schema normally defaults', () => {
  for (const key of ['intensity', 'mobileIntensity']) {
    const bundle = validBundle()
    delete bundle.data.settings[0].value[key]
    expect(DataBundleSchema.safeParse(bundle).success, key).toBe(false)
  }
  const valid = validBundle()
  expect(DataBundleSchema.parse(valid)).toEqual(valid)
})
test('rejects unknown keys, absent modules and invalid relations', () => {
  const empty = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    data: {
      modules: [],
      routeAliases: [],
      settings: [],
      profile: null,
      categories: [],
      tags: [],
      articles: [],
      logs: [],
      projects: [],
      timelineItems: [],
    },
  }
  expect(DataBundleSchema.safeParse(empty).success).toBe(false)
  expect(DataBundleSchema.safeParse({ ...empty, users: [] }).success).toBe(false)
})
test('bounds malicious depth, cycles and dangerous keys without recursive stack overflow', () => {
  let deep: unknown = {}
  for (let n = 0; n < 10000; n++) deep = { nested: deep }
  expect(rejectDangerousKeys(deep)).toBe(false)
  expect(rejectDangerousKeys(JSON.parse('{"__proto__":{}}'))).toBe(false)
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(rejectDangerousKeys(cycle)).toBe(false)
  expect(rejectDangerousKeys({ items: [1, '正常', null] })).toBe(true)
})
