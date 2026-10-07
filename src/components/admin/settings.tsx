'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
type Field = {
  key: string
  label: string
  nullable?: boolean
  kind?: 'text' | 'area' | 'theme' | 'color' | 'links'
  max?: number
}
export const SETTING_FIELDS: Record<string, { label: string; fields: Field[] }> = {
  general: {
    label: '基础信息',
    fields: [
      { key: 'site.name', label: '站点名称', max: 40 },
      { key: 'site.description', label: '站点描述', kind: 'area', max: 200 },
      { key: 'site.logo', label: 'Logo地址', nullable: true },
      { key: 'site.favicon', label: '浏览器图标地址', nullable: true },
      { key: 'site.locale', label: '语言标记', max: 20 },
    ],
  },
  theme: {
    label: '外观',
    fields: [
      { key: 'theme.default', label: '默认主题', kind: 'theme' },
      { key: 'theme.accent', label: '强调色', kind: 'color' },
    ],
  },
  seo: {
    label: '搜索引擎',
    fields: [
      { key: 'seo.defaultTitle', label: '默认标题', max: 60 },
      { key: 'seo.defaultDescription', label: '默认描述', kind: 'area', max: 200 },
      { key: 'seo.keywords', label: '关键词', max: 500 },
      { key: 'seo.ogImage', label: '默认分享图地址', nullable: true },
    ],
  },
  footer: {
    label: '页脚',
    fields: [
      { key: 'footer.copyright', label: '版权文字', max: 200 },
      { key: 'footer.icp', label: '备案号', nullable: true },
      { key: 'footer.links', label: '附加链接', kind: 'links' },
    ],
  },
  social: {
    label: '社交链接',
    fields: [
      { key: 'social.github', label: 'GitHub', nullable: true },
      { key: 'social.email', label: '邮箱', nullable: true },
      { key: 'social.phone', label: '电话', nullable: true },
      { key: 'social.twitter', label: 'X / Twitter', nullable: true },
      { key: 'social.linkedin', label: 'LinkedIn', nullable: true },
      { key: 'social.weibo', label: '微博', nullable: true },
      { key: 'social.bilibili', label: '哔哩哔哩', nullable: true },
    ],
  },
  integration: {
    label: '集成',
    fields: [{ key: 'integration.analyticsId', label: '访问分析标识', max: 100 }],
  },
}
type ExtraLink = { label: string; url: string | null }
const control = 'bg-background mt-2 w-full rounded-lg border px-3 py-2'
/** 设置保存只发送当前组已知字段；清空可空字段明确发送null。 */
export function SettingsEditor({ group }: { group: string }) {
  const user = useAdminUser()
  const writable = user?.permissions.includes('setting:write')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [initial, setInitial] = useState<Record<string, unknown>>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const definition = SETTING_FIELDS[group]
  useEffect(() => {
    let active = true
    setLoaded(false)
    void api<Record<string, unknown>>('/api/v1/admin/settings/' + group)
      .then(({ data }) => {
        if (active) {
          setValues(data)
          setInitial(data)
          setLoaded(true)
          setMessage('')
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message)
      })
    return () => {
      active = false
    }
  }, [group])
  const update = (key: string, value: unknown) =>
    setValues((current) => ({ ...current, [key]: value }))
  return (
    <div>
      <h1 className="text-2xl font-bold">站点设置</h1>
      <p className="text-muted-foreground mt-3">修改后新请求自动生效，已打开页面可刷新查看。</p>
      <nav aria-label="设置分类" className="my-6 flex flex-wrap gap-2">
        {Object.entries(SETTING_FIELDS).map(([key, entry]) => (
          <Link
            key={key}
            href={'/admin/settings/' + key}
            aria-current={group === key ? 'page' : undefined}
            className={
              'rounded-lg border px-4 py-2 text-sm ' +
              (group === key ? 'bg-brand-soft text-brand' : '')
            }
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {!loaded && <p role="status">{message || '正在读取配置…'}</p>}
      {loaded && (
        <form
          className="max-w-2xl space-y-6 rounded-xl border p-6"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            try {
              const patch = Object.fromEntries(
                definition.fields
                  .filter((field) => Object.hasOwn(values, field.key))
                  .map((field) => [field.key, values[field.key]]),
              )
              const result = await api<Record<string, unknown>>('/api/v1/admin/settings/' + group, {
                method: 'PATCH',
                body: JSON.stringify(patch),
              })
              setValues(result.data)
              setInitial(result.data)
              setMessage('设置已保存')
            } catch (error) {
              setMessage((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <h2 className="font-semibold">{definition.label}</h2>
          {definition.fields.map((field) => {
            const value = typeof values[field.key] === 'string' ? (values[field.key] as string) : ''
            if (field.kind === 'links') {
              const links = Array.isArray(values[field.key])
                ? (values[field.key] as ExtraLink[])
                : []
              return (
                <fieldset key={field.key} className="space-y-3 rounded-lg border p-4">
                  <legend>{field.label}</legend>
                  {links.map((link, index) => (
                    <div key={index} className="grid gap-2 rounded-lg border p-3">
                      <label>
                        链接名称
                        <input
                          className={control}
                          aria-label={'附加链接名称' + (index + 1)}
                          value={link.label}
                          maxLength={80}
                          disabled={!writable || busy}
                          onChange={(event) =>
                            update(
                              field.key,
                              links.map((entry, i) =>
                                i === index ? { ...entry, label: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        链接地址
                        <input
                          className={control}
                          aria-label={'附加链接地址' + (index + 1)}
                          value={link.url ?? ''}
                          disabled={!writable || busy}
                          onChange={(event) =>
                            update(
                              field.key,
                              links.map((entry, i) =>
                                i === index ? { ...entry, url: event.target.value || null } : entry,
                              ),
                            )
                          }
                        />
                      </label>
                      {writable && (
                        <div className="flex gap-4">
                          <button
                            type="button"
                            disabled={busy || index === 0}
                            onClick={() => {
                              const next = [...links]
                              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                              update(field.key, next)
                            }}
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              update(
                                field.key,
                                links.filter((_, i) => i !== index),
                              )
                            }
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {writable && (
                    <button
                      type="button"
                      disabled={busy || links.length >= 20}
                      className="text-brand"
                      onClick={() => update(field.key, [...links, { label: '', url: '' }])}
                    >
                      添加链接 +
                    </button>
                  )}
                </fieldset>
              )
            }
            return (
              <label key={field.key} className="block text-sm">
                {field.label}
                {field.kind === 'theme' ? (
                  <select
                    className={control}
                    value={value || 'system'}
                    disabled={!writable || busy}
                    onChange={(event) => update(field.key, event.target.value)}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                ) : field.kind === 'area' ? (
                  <textarea
                    className={control}
                    rows={3}
                    maxLength={field.max}
                    value={value}
                    disabled={!writable || busy}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    className={control}
                    type={field.kind === 'color' ? 'color' : 'text'}
                    maxLength={field.max ?? 2000}
                    value={field.kind === 'color' ? value || '#6366f1' : value}
                    required={field.key === 'site.name'}
                    disabled={!writable || busy}
                    onChange={(event) =>
                      update(
                        field.key,
                        event.target.value === '' && field.nullable ? null : event.target.value,
                      )
                    }
                  />
                )}
              </label>
            )
          })}
          {group === 'social' && (
            <p className="text-muted-foreground text-sm">
              联系方式还受个人资料「公开联系方式」及关于我区块开关控制。关闭后公共页面不显示邮箱、电话和联系链接。
            </p>
          )}
          {group === 'integration' && (
            <p className="text-muted-foreground text-sm">
              仅保存公开分析标识；服务凭据通过本地环境配置。
            </p>
          )}
          <p role="status" className="text-sm">
            {message}
          </p>
          {writable && (
            <div className="flex gap-4">
              <button
                type="submit"
                disabled={busy}
                className="bg-primary text-primary-foreground rounded-lg px-5 py-2"
              >
                {busy ? '正在保存…' : '保存设置'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setValues(initial)
                  setMessage('已取消未保存修改')
                }}
              >
                取消修改
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  )
}
