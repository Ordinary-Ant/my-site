'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
import { settingDefinitions, type SettingField } from '@/config/settings'
import { MediaPicker } from './media-picker'
import Image from 'next/image'
import { safeContentUrl } from '@/lib/markdown'
const SETTING_FIELDS: Record<string, { label: string; fields: SettingField[] }> = settingDefinitions

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
  const [pickerField, setPickerField] = useState<string | null>(null)
  const mutation = useRef(false),
    dirtyRef = useRef(false),
    leaveAllowed = useRef(0)
  dirtyRef.current = loaded && JSON.stringify(values) !== JSON.stringify(initial)
  useEffect(() => {
    const canLeave = () => {
      if (mutation.current) {
        setMessage('正在保存，请等待完成。')
        return false
      }
      if (!dirtyRef.current || Date.now() < leaveAllowed.current) return true
      if (!confirm('设置尚未保存，确定放弃并离开？')) return false
      leaveAllowed.current = Date.now() + 500
      return true
    }
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (anchor && new URL(anchor.href).pathname !== location.pathname && !canLeave())
        event.preventDefault()
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || mutation.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const navigate = (event: Event) => {
      const next = (event as Event & { destination?: { url: string } }).destination
      if (
        event.cancelable &&
        next &&
        new URL(next.url).pathname !== location.pathname &&
        !canLeave()
      )
        event.preventDefault()
    }
    document.addEventListener('click', click, true)
    window.addEventListener('beforeunload', unload)
    navigation?.addEventListener('navigate', navigate)
    return () => {
      document.removeEventListener('click', click, true)
      window.removeEventListener('beforeunload', unload)
      navigation?.removeEventListener('navigate', navigate)
    }
  }, [])
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
            if (!writable || mutation.current) return
            mutation.current = true
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
              mutation.current = false
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
                  <p className="text-muted-foreground text-sm">{field.help}</p>
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
              <div key={field.key} className="block text-sm">
                <label htmlFor={field.key}>{field.label}</label>
                {field.kind === 'theme' ? (
                  <select
                    id={field.key}
                    aria-describedby={field.key + '-help'}
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
                    id={field.key}
                    aria-describedby={field.key + '-help'}
                    className={control}
                    rows={3}
                    maxLength={field.max}
                    value={value}
                    disabled={!writable || busy}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    id={field.key}
                    aria-describedby={field.key + '-help'}
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
                <p id={field.key + '-help'} className="text-muted-foreground mt-2 text-xs">
                  {field.help}
                </p>
                {field.kind === 'image' && (
                  <div className="mt-3 space-y-3">
                    {safeContentUrl(value) && (
                      <Image
                        unoptimized
                        src={value}
                        alt={field.label + '预览'}
                        width={300}
                        height={160}
                        className="bg-muted max-h-40 max-w-full rounded-lg border object-contain"
                      />
                    )}
                    {writable && (
                      <button
                        type="button"
                        className="rounded-lg border px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => setPickerField(field.key)}
                      >
                        从媒体库选择{field.label}
                      </button>
                    )}
                  </div>
                )}
              </div>
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
      <MediaPicker
        open={pickerField !== null}
        imagesOnly
        onClose={() => setPickerField(null)}
        onSelect={(item) => {
          if (pickerField) update(pickerField, item.url)
        }}
      />
    </div>
  )
}
