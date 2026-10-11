'use client'
import { useEffect, useRef, useState } from 'react'
import { api, ClientError } from '@/lib/api/client'
import {
  DATA_KINDS,
  DATA_LABELS,
  inspectDataFile,
  dataReportWithoutToken,
  type DataBundle,
  type DataCounts,
  type DataPreview,
  type DataReport,
} from '@/lib/data-file'
import { useAdminUser } from './shell'
const control = 'mt-2 w-full rounded-lg border bg-background px-3 py-2'
const button = 'rounded-lg border px-4 py-2 disabled:opacity-40'
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: 'application/json;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function CountTable({ counts }: { counts: DataCounts }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {DATA_KINDS.map((kind) => (
        <div key={kind} className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">{DATA_LABELS[kind]}</dt>
          <dd className="mt-2 text-lg font-semibold">{counts[kind]}</dd>
        </div>
      ))}
    </dl>
  )
}
function Report({ value, final = false }: { value: DataReport; final?: boolean }) {
  return (
    <section
      className="mt-6 space-y-5 rounded-xl border p-4 md:p-6"
      aria-label={final ? '导入实际结果' : '导入影响预览'}
    >
      <h2 className="text-lg font-semibold">
        {final ? '导入实际结果' : '导入影响预览'} · {value.mode === 'merge' ? '合并' : '替换'}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-3">类型</th>
              <th className="p-3">{final ? '已写入' : '预计写入'}</th>
              <th className="p-3">跳过/保留</th>
              <th className="p-3">替换前记录</th>
            </tr>
          </thead>
          <tbody>
            {DATA_KINDS.map((kind) => (
              <tr key={kind} className="border-t">
                <th className="p-3 font-normal">{DATA_LABELS[kind]}</th>
                <td className="p-3">{value.created[kind]}</td>
                <td className="p-3">{value.skipped[kind]}</td>
                <td className="p-3">{value.replaces[kind]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {value.warnings.length > 0 && (
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">处理说明</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {value.warnings.map((warning, index) => (
              <li key={index} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
      {DATA_KINDS.filter((kind) => value.mapped[kind]?.length).map((kind) => (
        <details key={kind} className="rounded-lg border p-4">
          <summary className="cursor-pointer">
            {DATA_LABELS[kind]}映射（{value.mapped[kind]!.length}项）
          </summary>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto text-sm">
            {value.mapped[kind]!.slice(0, 100).map((item, index) => (
              <div key={index} className="rounded border p-3">
                <p className="break-all">
                  {item.from} → {item.to}
                </p>
                <p className="text-muted-foreground mt-2 break-words">{item.reason}</p>
              </div>
            ))}
            {value.mapped[kind]!.length > 100 && <p>此处展示前100项，完整映射可下载影响报告。</p>}
          </div>
        </details>
      ))}
      <button
        type="button"
        className={button}
        onClick={() => download(dataReportWithoutToken(value), 'personal-site-import-report.json')}
      >
        下载影响报告
      </button>
    </section>
  )
}
/** 导入先预览再提交，凭证只保存在内存，文件或模式变化立即作废旧预览。 */
export function DataManager() {
  const user = useAdminUser()
  const allowed =
    !!user?.permissions.includes('data:import') && user.permissions.includes('data:export')
  const [selection, setSelection] = useState<{
    name: string
    bundle: DataBundle
    counts: DataCounts
    bytes: number
  } | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [preview, setPreview] = useState<DataPreview | null>(null)
  const [result, setResult] = useState<DataReport | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<'file' | 'export' | 'preview' | 'import' | null>(null)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([])
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const mutation = useRef(false),
    mounted = useRef(true),
    generation = useRef(0),
    importing = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!preview) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [preview])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (importing.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const click = (event: MouseEvent) => {
      if (importing.current && (event.target as HTMLElement).closest?.('a[href]')) {
        event.preventDefault()
        setError('正在导入，请等待结果后离开。')
      }
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const traverse = (event: Event) => {
      if (importing.current && event.cancelable) event.preventDefault()
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    navigation?.addEventListener('navigate', traverse)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
      navigation?.removeEventListener('navigate', traverse)
    }
  }, [])
  const invalidate = () => {
    generation.current++
    setPreview(null)
    setResult(null)
    setConfirmation('')
    setMessage('')
    setError('')
    setIssues([])
  }
  const run = async (
    action: NonNullable<typeof busy>,
    task: (sequence: number) => Promise<void>,
  ) => {
    if (!allowed || mutation.current) return
    mutation.current = true
    importing.current = action === 'import'
    const sequence = generation.current
    setBusy(action)
    setError('')
    setIssues([])
    setMessage('')
    try {
      await task(sequence)
    } catch (failure) {
      if (!mounted.current || sequence !== generation.current) return
      setError((failure as Error).message)
      if (failure instanceof ClientError) {
        if (failure.details) setIssues(failure.details)
        if (failure.status === 409) {
          setPreview(null)
          setConfirmation('')
          setError('预览已失效或发生版本冲突，请重新预览。文件仍保留。' + failure.message)
        }
      }
    } finally {
      mutation.current = false
      importing.current = false
      if (mounted.current) setBusy(null)
    }
  }
  const chooseFile = (file: File | undefined) => {
    if (!file || mutation.current || !allowed) return
    invalidate()
    setSelection(null)
    void run('file', async (sequence) => {
      if (file.size > 4_000_000) throw new Error('JSON文件超过4MB，请使用数据库和媒体备份。')
      const inspected = inspectDataFile(await file.text())
      if (!mounted.current || sequence !== generation.current) return
      setSelection({ name: file.name, ...inspected })
      setMessage('文件已读取，尚未修改数据库。请选择模式并进行服务端预览。')
    })
  }
  const exportFile = () =>
    void run('export', async (sequence) => {
      const response = await api<DataBundle>('/api/v1/admin/export')
      if (!mounted.current || sequence !== generation.current) return
      download(response.data, 'personal-site-' + new Date().toISOString().slice(0, 10) + '.json')
      setMessage('JSON已导出；媒体二进制和身份凭据需要独立备份。')
    })
  const calculate = () => {
    if (!selection) return
    setPreview(null)
    setConfirmation('')
    setResult(null)
    void run('preview', async (sequence) => {
      const response = await api<DataPreview>('/api/v1/admin/import/preview', {
        method: 'POST',
        body: JSON.stringify({ mode, bundle: selection.bundle }),
      })
      if (!mounted.current || sequence !== generation.current) return
      setPreview(response.data)
      setNow(Date.now())
      setMessage('预览成功，数据库尚未修改。请检查实际影响后执行。')
    })
  }
  const expires = preview ? Date.parse(preview.expiresAt) : 0
  const expired = !preview || !Number.isFinite(expires) || now >= expires
  const execute = () => {
    if (
      !selection ||
      !preview ||
      expired ||
      (mode === 'replace' && confirmation !== '替换全部内容')
    )
      return
    void run('import', async (sequence) => {
      const response = await api<DataReport>('/api/v1/admin/import', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          bundle: selection.bundle,
          token: preview.token,
          ...(mode === 'replace' ? { confirmation } : {}),
        }),
      })
      if (!mounted.current || sequence !== generation.current) return
      setResult(response.data)
      setPreview(null)
      setConfirmation('')
      setMessage('导入事务已完成，以下是实际结果；请刷新内容页面核对。')
    })
  }
  if (!allowed)
    return (
      <section>
        <h1 className="text-2xl font-bold">数据管理</h1>
        <p className="mt-5">仅管理员可以导入或导出站点数据。</p>
      </section>
    )
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-bold">数据管理</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        迁移全部内容、草稿、回收站及配置。JSON不包含媒体文件、用户口令和会话，不能代替数据库与媒体的独立备份。单文件最多4MB、5000项。
      </p>
      {error && (
        <p role="alert" className="text-destructive mt-5 break-words whitespace-pre-wrap">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <ul
          className="text-destructive mt-3 list-disc space-y-2 pl-5 text-sm"
          aria-label="文件校验问题"
        >
          {issues.slice(0, 50).map((issue, index) => (
            <li key={index} className="break-words">
              {issue.path}：{issue.message}
            </li>
          ))}
          {issues.length > 50 && <li>还有{issues.length - 50}项，请修正文件后重新预览。</li>}
        </ul>
      )}
      <p role="status" className="mt-5 text-sm">
        {message}
      </p>
      <fieldset disabled={!!busy} className="mt-6 space-y-6">
        <section className="rounded-xl border p-4 md:p-6">
          <h2 className="mb-3 text-lg font-semibold">导出当前数据</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            含所有发布状态及软删除内容；文件包含私有草稿与联系方式，请妥善保存。
          </p>
          <button type="button" onClick={exportFile} className={button}>
            {busy === 'export' ? '正在导出…' : '下载全站JSON'}
          </button>
        </section>
        <section className="rounded-xl border p-4 md:p-6">
          <h2 className="text-lg font-semibold">导入数据</h2>
          <label className="mt-5 block text-sm">
            选择JSON导出文件
            <input
              aria-label="选择JSON导出文件"
              type="file"
              accept=".json,application/json"
              className={control}
              onChange={(event) => {
                chooseFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          {selection && (
            <section className="mt-5 space-y-4" aria-label="待导入文件">
              <p className="text-sm break-all">
                {selection.name} · {(selection.bytes / 1000).toFixed(1)}KB · 来源时间
                {new Date(selection.bundle.exportedAt).toLocaleString('zh-CN')}
              </p>
              <CountTable counts={selection.counts} />
            </section>
          )}
          <label className="mt-5 block text-sm">
            导入模式
            <select
              aria-label="导入模式"
              className={control}
              value={mode}
              onChange={(event) => {
                invalidate()
                setMode(event.target.value as 'merge' | 'replace')
              }}
            >
              <option value="merge">合并：跳过已有内容，保留配置</option>
              <option value="replace">替换：原子恢复内容与配置</option>
            </select>
          </label>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {mode === 'merge'
              ? '分类标签按slug复用并映射关系；文章/作品同slug、日志/经历同ID跳过。现有栏目、设置和个人资料保留。'
              : '替换全部内容、分类标签及配置，保留用户、媒体和历史栏目路径；已有记录修订号递增。请先导出当前数据。'}
          </p>
          <button
            type="button"
            disabled={!selection}
            onClick={calculate}
            className={button + ' mt-5'}
          >
            {busy === 'preview' ? '正在校验…' : '校验并预览影响'}
          </button>
        </section>
      </fieldset>
      {preview && (
        <>
          <Report value={preview} />
          <fieldset disabled={!!busy} className="mt-5 space-y-4 rounded-xl border p-4 md:p-6">
            <p className="text-sm" role="status">
              {expired
                ? '预览已过期，请重新计算。'
                : '预览剩余' +
                  Math.max(0, Math.ceil((expires - now) / 1000)) +
                  '秒；数据库变化会要求重新预览。'}
            </p>
            {mode === 'replace' && (
              <label className="block text-sm">
                输入“替换全部内容”确认
                <input
                  aria-label="替换确认文字"
                  className={control}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <button
              type="button"
              disabled={expired || (mode === 'replace' && confirmation !== '替换全部内容')}
              onClick={execute}
              className={button + ' bg-primary text-primary-foreground'}
            >
              {busy === 'import' ? '正在执行事务…' : '执行导入'}
            </button>
          </fieldset>
        </>
      )}
      {result && <Report value={result} final />}
    </div>
  )
}
