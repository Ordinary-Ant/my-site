import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
const text = (max = 500) => z.string().max(max)
const link = z
  .string()
  .max(2000)
  .refine(
    (value) =>
      value === '' || (!!safeContentUrl(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)),
    '链接格式无效',
  )
  .nullable()
export type SettingField = {
  key: string
  label: string
  help: string
  kind: 'text' | 'area' | 'theme' | 'color' | 'links' | 'image'
  nullable: boolean
  max?: number
  schema: z.ZodTypeAny
}
const field = (
  key: string,
  label: string,
  help: string,
  schema: z.ZodTypeAny,
  kind: SettingField['kind'] = 'text',
  nullable = false,
  max?: number,
): SettingField => ({ key, label, help, schema, kind, nullable, max })
/** 一份字段合同同时生成表单与服务端严格校验；公开DTO仍由服务层白名单控制。 */
export const settingDefinitions = {
  general: {
    label: '基础信息',
    fields: [
      field(
        'site.name',
        '站点名称',
        '用于站点标识与默认页面标题，最多40字。',
        text(40).min(1),
        'text',
        false,
        40,
      ),
      field(
        'site.description',
        '站点描述',
        '一句话介绍站点，最多200字，可留空。',
        text(200),
        'area',
        false,
        200,
      ),
      field(
        'site.logo',
        'Logo地址',
        '可从媒体库选择图片；留空清除自定义Logo。',
        link,
        'image',
        true,
      ),
      field(
        'site.favicon',
        '浏览器图标地址',
        '建议选择正方形PNG；留空恢复默认图标。',
        link,
        'image',
        true,
      ),
      field(
        'site.locale',
        '语言标记',
        '使用标准语言标记，例如zh-CN；不启用多语言功能。',
        text(20),
        'text',
        false,
        20,
      ),
    ],
  },
  theme: {
    label: '外观',
    fields: [
      field(
        'theme.default',
        '默认主题',
        '首次访问使用此主题，访客自己的选择优先。',
        z.enum(['system', 'light', 'dark']),
        'theme',
      ),
      field(
        'theme.accent',
        '强调色',
        '采用六位十六进制颜色，选择后请核对文字对比度。',
        z.string().regex(/^#[a-f0-9]{6}$/i),
        'color',
      ),
    ],
  },
  seo: {
    label: '搜索引擎',
    fields: [
      field(
        'seo.defaultTitle',
        '默认标题',
        '页面没有独立标题时使用，建议60字以内。',
        text(60),
        'text',
        false,
        60,
      ),
      field(
        'seo.defaultDescription',
        '默认描述',
        '页面没有独立摘要时使用，最多200字。',
        text(200),
        'area',
        false,
        200,
      ),
      field(
        'seo.keywords',
        '关键词',
        '使用逗号分隔相关关键词，避免堆砌重复文字。',
        text(500),
        'text',
        false,
        500,
      ),
      field(
        'seo.ogImage',
        '默认分享图地址',
        '建议1200×630图片；页面分享图会优先于此项。',
        link,
        'image',
        true,
      ),
    ],
  },
  footer: {
    label: '页脚',
    fields: [
      field(
        'footer.copyright',
        '版权文字',
        '显示在公共页脚的版权说明，最多200字。',
        text(200),
        'text',
        false,
        200,
      ),
      field(
        'footer.icp',
        '备案号',
        '填写真实备案信息；留空清除页脚备案文字。',
        text().nullable(),
        'text',
        true,
        500,
      ),
      field(
        'footer.links',
        '附加链接',
        '最多20项，数组整体保存；上下调整展示顺序。',
        z.array(z.object({ label: text(80), url: link }).strict()).max(20),
        'links',
      ),
    ],
  },
  social: {
    label: '社交链接',
    fields: [
      field(
        'social.github',
        'GitHub',
        '填写完整HTTP(S)链接，留空清除此社交入口。',
        link,
        'text',
        true,
      ),
      field(
        'social.email',
        '邮箱',
        '填写公开联系邮箱，仍受联系方式可见开关控制。',
        z.string().email().or(z.literal('')).nullable(),
        'text',
        true,
      ),
      field(
        'social.phone',
        '电话',
        '填写公开联系电话，仍受联系方式可见开关控制。',
        text(40).nullable(),
        'text',
        true,
        40,
      ),
      field(
        'social.twitter',
        'X / Twitter',
        '填写完整HTTP(S)主页地址，留空清除此入口。',
        link,
        'text',
        true,
      ),
      field(
        'social.linkedin',
        'LinkedIn',
        '填写完整HTTP(S)主页地址，留空清除此入口。',
        link,
        'text',
        true,
      ),
      field(
        'social.weibo',
        '微博',
        '填写完整HTTP(S)主页地址，留空清除此入口。',
        link,
        'text',
        true,
      ),
      field(
        'social.bilibili',
        '哔哩哔哩',
        '填写完整HTTP(S)主页地址，留空清除此入口。',
        link,
        'text',
        true,
      ),
    ],
  },
  integration: {
    label: '集成',
    fields: [
      field(
        'integration.analyticsId',
        '访问分析标识',
        '仅填写可公开标识；密钥必须通过环境变量配置。',
        text(100),
        'text',
        false,
        100,
      ),
    ],
  },
} satisfies Record<string, { label: string; fields: SettingField[] }>
type OrdinaryGroup = keyof typeof settingDefinitions
const groupSchema = (group: OrdinaryGroup) =>
  z
    .object(
      Object.fromEntries(
        settingDefinitions[group].fields.map((entry) => [entry.key, entry.schema]),
      ),
    )
    .strict()
    .partial()
export const settingGroups = {
  general: groupSchema('general'),
  theme: groupSchema('theme'),
  seo: groupSchema('seo'),
  footer: groupSchema('footer'),
  social: groupSchema('social'),
  integration: groupSchema('integration'),
  motion: z
    .object({ 'motion.config': z.record(z.unknown()) })
    .strict()
    .partial(),
}
export type SettingGroup = keyof typeof settingGroups
