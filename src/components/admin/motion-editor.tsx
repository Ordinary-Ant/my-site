'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MOTION, MOTION_PRESETS, motionSchema, type MotionConfig } from '@/config/motion'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
const Preview = dynamic(() => import('./motion-preview'), {
  ssr: false,
  loading: () => <p role="status">正在加载预览…</p>,
})
const labels = { static: '静态', editorial: '编辑式', narrative: '叙事式', kinetic: '鲜明式' }
const control = 'bg-background mt-2 w-full rounded-lg border px-3 py-2'
/** 编辑与预览只改本地草稿，明确保存后才写站点配置。 */
export function MotionEditor() {
  const writable = useAdminUser()?.permissions.includes('setting:write')
  const [value, setValue] = useState<MotionConfig>(DEFAULT_MOTION),
    [saved, setSaved] = useState<MotionConfig>(DEFAULT_MOTION)
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [message, setMessage] = useState('')
  const mutation = useRef(false),
    dirty = useRef(false)
  dirty.current = loaded && JSON.stringify(value) !== JSON.stringify(saved)
  useEffect(() => {
    let active = true
    void api<{ config: MotionConfig }>('/api/v1/admin/settings/motion')
      .then(({ data }) => {
        if (active) {
          const config = motionSchema.parse(data.config)
          setValue(config)
          setSaved(config)
          setLoaded(true)
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message)
      })
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current || mutation.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', unload)
    return () => {
      active = false
      window.removeEventListener('beforeunload', unload)
    }
  }, [])
  const save = async () => {
    if (!writable || mutation.current) return
    const parsed = motionSchema.safeParse(value)
    if (!parsed.success) {
      setMessage('请检查字段范围：时长150–800ms，间隔0–100ms，底色透明度0–0.15。')
      return
    }
    mutation.current = true
    setBusy(true)
    setMessage('')
    try {
      const { data } = await api<Record<string, unknown>>('/api/v1/admin/settings/motion', {
        method: 'PATCH',
        body: JSON.stringify({ 'motion.config': parsed.data }),
      })
      const result = motionSchema.parse(data['motion.config'])
      setValue(result)
      setSaved(result)
      setMessage('已保存，刷新前台页面即可看到更新。')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  const previewConfig = motionSchema.safeParse(value)
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-bold">动效设置</h1>
      <p className="text-muted-foreground mt-3">
        四种编排预设，默认编辑式且无装饰。系统减弱动态效果始终优先。
      </p>
      {message && (
        <p role="status" className="my-4 break-words">
          {message}
        </p>
      )}
      {!loaded ? (
        <p className="mt-6">加载配置中…</p>
      ) : (
        <div className={preview ? 'mt-8 grid items-start gap-8 xl:grid-cols-2' : ''}>
          <div>
            <fieldset disabled={!writable || busy} className="mt-8 grid gap-6 md:grid-cols-2">
              <label>
                编排预设
                <select
                  className={control}
                  aria-label="编排预设"
                  value={value.preset}
                  onChange={(event) =>
                    setValue(
                      structuredClone(MOTION_PRESETS[event.target.value as MotionConfig['preset']]),
                    )
                  }
                >
                  {Object.entries(labels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                桌面强度
                <select
                  className={control}
                  aria-label="桌面强度"
                  value={value.intensity}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      intensity: event.target.value as MotionConfig['intensity'],
                    })
                  }
                >
                  <option value="off">关闭</option>
                  <option value="subtle">轻量</option>
                  <option value="standard">标准</option>
                </select>
              </label>
              <label>
                移动强度
                <select
                  className={control}
                  aria-label="移动强度"
                  value={value.mobileIntensity}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      mobileIntensity: event.target.value as MotionConfig['mobileIntensity'],
                    })
                  }
                >
                  <option value="off">关闭</option>
                  <option value="subtle">轻量</option>
                </select>
              </label>
              <label>
                静态装饰
                <select
                  className={control}
                  aria-label="静态装饰"
                  value={value.decoration.type}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      decoration: {
                        ...value.decoration,
                        type: event.target.value as 'none' | 'tint',
                      },
                    })
                  }
                >
                  <option value="none">无装饰</option>
                  <option value="tint">淡色底</option>
                </select>
              </label>
              <label>
                底色透明度
                <input
                  className={control}
                  aria-label="底色透明度"
                  type="number"
                  min="0"
                  max="0.15"
                  step="0.01"
                  value={value.decoration.opacity}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      decoration: { ...value.decoration, opacity: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                入场时长（ms）
                <input
                  className={control}
                  aria-label="入场时长"
                  type="number"
                  min="150"
                  max="800"
                  value={value.reveal.duration}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      reveal: { ...value.reveal, duration: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                编排间隔（ms）
                <input
                  className={control}
                  aria-label="编排间隔"
                  type="number"
                  min="0"
                  max="100"
                  value={value.reveal.stagger}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      reveal: { ...value.reveal, stagger: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                卡片交互
                <select
                  className={control}
                  aria-label="卡片交互"
                  value={value.interaction.cardHover}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      interaction: {
                        ...value.interaction,
                        cardHover: event.target.value as 'none' | 'lift',
                      },
                    })
                  }
                >
                  <option value="none">无</option>
                  <option value="lift">轻抬升</option>
                </select>
              </label>
              <label>
                链接交互
                <select
                  className={control}
                  aria-label="链接交互"
                  value={value.interaction.linkHover}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      interaction: {
                        ...value.interaction,
                        linkHover: event.target.value as 'none' | 'underline',
                      },
                    })
                  }
                >
                  <option value="none">无</option>
                  <option value="underline">下划线</option>
                </select>
              </label>
              <div className="space-y-4 py-3">
                <label className="block">
                  <input
                    type="checkbox"
                    checked={value.reveal.enabled}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        reveal: { ...value.reveal, enabled: event.target.checked },
                      })
                    }
                  />{' '}
                  启用离屏入场
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={value.autoDegrade}
                    onChange={(event) => setValue({ ...value, autoDegrade: event.target.checked })}
                  />{' '}
                  能力不足或省流量时自动降档
                </label>
              </div>
            </fieldset>
            <div className="my-8 flex flex-wrap gap-3">
              {writable && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                    className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
                  >
                    {busy ? '保存中…' : '保存动效'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setValue(structuredClone(DEFAULT_MOTION))
                      setMessage('已恢复默认草稿，保存后生效。')
                    }}
                    className="rounded-lg border px-4 py-2"
                  >
                    恢复默认
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setValue(structuredClone(saved))
                      setMessage('已取消修改，恢复最近保存值。')
                    }}
                    className="rounded-lg border px-4 py-2"
                  >
                    取消修改
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setPreview(!preview)}
                className="rounded-lg border px-4 py-2"
              >
                {preview ? '关闭预览' : '打开动效预览'}
              </button>
            </div>
            <p className="text-muted-foreground mb-6 text-sm">
              预算：动效28KB、文章135KB、登录110KB
              gzip。实际网络和构建测量记录在验收文档，预设参数不代表性能实测。
            </p>
          </div>
          {preview &&
            (previewConfig.success ? (
              <Preview config={previewConfig.data} />
            ) : (
              <p role="alert">预览参数超出允许范围，请先修正。</p>
            ))}
        </div>
      )}
    </div>
  )
}
