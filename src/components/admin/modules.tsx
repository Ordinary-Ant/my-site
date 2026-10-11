'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { api } from '@/lib/api/client'
import { type ModuleConfig, type ModuleKey } from '@/config/modules'
import { mergeModuleConfig, validateModuleRoute } from '@/lib/validators/module'
import { AdminDialog } from './dialog'
import { useAdminUser } from './shell'

export type ModuleItem = {
  key: ModuleKey
  name: string
  description: string | null
  enabled: boolean
  navVisible: boolean
  navLabel: string | null
  navOrder: number
  route: string
  updatedAt: string
  config: ModuleConfig
  aliases: { path: string }[]
  stats: { totalItems: number; publishedItems: number; draftItems: number }
}
type Undo = { auditId: string; expiresAt: string; key: ModuleKey; name: string }
type Change = { module: ModuleItem; undo?: { auditId: string; expiresAt: string } }
type Audit = {
  id: string
  action: string
  resourceId: string
  createdAt: string
  user: { name: string } | null
}
const control = 'bg-background mt-2 w-full rounded-lg border px-3 py-2'
const contentRoutes: Record<ModuleKey, string> = {
  home: '/admin',
  log: '/admin/logs',
  portfolio: '/admin/projects',
  article: '/admin/articles',
  timeline: '/admin/timeline',
  about: '/admin/profile',
}
const configLabels: Record<string, string> = {
  DAILY: '每日随笔',
  EVENT: '大事件',
  SUMMARY: '阶段总结',
  GAME: '游戏',
  REPO: '代码库',
  SKILL: 'Skills',
  OTHER: '其他',
  CRAFT: '个人制作',
  WORK: '工作',
  EDUCATION: '教育',
  PROJECT: '项目',
  AWARD: '奖项',
  MILESTONE: '里程碑',
  advantages: '个人优势',
  bio: '自我介绍',
  services: '我能提供什么',
  skills: '技能',
  experience: '经历',
  contact: '联系区块',
}
function SortableRow({
  item,
  children,
  disabled,
}: {
  item: ModuleItem
  children: React.ReactNode
  disabled: boolean
}) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: item.key,
    disabled: disabled || item.key === 'home',
  })
  return (
    <section
      ref={setNodeRef}
      data-testid={'module-' + item.key}
      className="bg-card rounded-xl border p-4"
      style={{
        transform: transform
          ? 'translate3d(' + transform.x + 'px,' + transform.y + 'px,0)'
          : undefined,
        transition,
      }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled || item.key === 'home'}
          aria-label={'拖动排序' + item.name}
          className="touch-none rounded border px-2 py-1 disabled:opacity-40"
        >
          ⋮⋮
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  )
}
/** 模块更新带乐观版本，关闭有影响清单；撤销只使用服务端颁发的短时凭据。 */
export function ModuleCenter() {
  const user = useAdminUser()
  const writable = user?.permissions.includes('module:write')
  const [items, setItems] = useState<ModuleItem[]>([])
  const [audits, setAudits] = useState<Audit[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState<ModuleItem | null>(null)
  const [editing, setEditing] = useState<ModuleItem | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [now, setNow] = useState(Date.now())
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const load = async () => {
    const result = await api<ModuleItem[]>('/api/v1/admin/modules')
    setItems(result.data)
    window.dispatchEvent(new Event('site-modules-updated'))
    if (user?.permissions.includes('audit:read')) {
      const recent = await api<Audit[]>('/api/v1/admin/audit-logs?resource=module&pageSize=8')
      setAudits(recent.data)
    }
  }
  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!undo) return
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [undo])
  const change = async (item: ModuleItem, patch: unknown, toggle = false) => {
    if (busy) return
    setBusy(true)
    const previous = items
    const navPatch = patch as { navVisible?: boolean }
    const optimistic = toggle || typeof navPatch.navVisible === 'boolean'
    if (optimistic)
      setItems(
        items.map((entry) =>
          entry.key === item.key
            ? {
                ...entry,
                ...(toggle ? { enabled: !entry.enabled } : {}),
                ...(typeof navPatch.navVisible === 'boolean'
                  ? { navVisible: navPatch.navVisible }
                  : {}),
              }
            : entry,
        ),
      )
    try {
      const result = await api<Change>('/api/v1/admin/modules/' + item.key, {
        method: 'PATCH',
        body: JSON.stringify({ ...(patch as object), expectedUpdatedAt: item.updatedAt }),
      })
      setItems((current) =>
        current.map((entry) => (entry.key === item.key ? result.data.module : entry)),
      )
      if (result.data.undo) {
        setNow(Date.now())
        setUndo({ ...result.data.undo, key: item.key, name: item.name })
      }
      setMessage(item.name + '已保存')
      setClosing(null)
      setEditing(null)
      await load()
    } catch (error) {
      if (optimistic) setItems(previous)
      setMessage((error as Error).message)
      // 配置冲突保留抽屉输入，重新加载列表以显示服务器真实状态。
      if (!editing) await load().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const move = async (from: number, to: number) => {
    if (!writable || busy || from <= 0 || to <= 0 || to >= items.length) return
    const previous = items
    const next = [...items]
    next.splice(to, 0, next.splice(from, 1)[0])
    setItems(next)
    setBusy(true)
    try {
      await api('/api/v1/admin/modules/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          items: next.map((item, index) => ({
            key: item.key,
            navOrder: index,
            expectedUpdatedAt: item.updatedAt,
          })),
        }),
      })
      await load()
      setMessage('导航顺序已保存')
    } catch (error) {
      setItems(previous)
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <h1 className="text-2xl font-bold">模块开关</h1>
      <p className="text-muted-foreground mt-3">
        关闭只隐藏公共入口，内容始终保留。保存后新请求自动生效。
      </p>
      <p role="status" className="my-4 text-sm">
        {message}
        {undo && now < Date.parse(undo.expiresAt) && (
          <button
            disabled={busy}
            className="text-brand ml-3 underline"
            aria-label={'撤销关闭' + undo.name}
            onClick={async () => {
              setBusy(true)
              try {
                await api('/api/v1/admin/modules/' + undo.key + '/undo', {
                  method: 'POST',
                  body: JSON.stringify({ auditId: undo.auditId }),
                })
                setUndo(null)
                await load()
                setMessage('已撤销开关操作')
              } catch (error) {
                setMessage((error as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            撤销 · {Math.ceil((Date.parse(undo.expiresAt) - now) / 1000)}秒
          </button>
        )}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (over && active.id !== over.id)
            void move(
              items.findIndex((item) => item.key === active.id),
              items.findIndex((item) => item.key === over.id),
            )
        }}
      >
        <SortableContext
          items={items.map((item) => item.key)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {items.map((item, index) => (
              <SortableRow key={item.key} item={item} disabled={!writable || busy}>
                <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <input
                      aria-label={item.name + '名称'}
                      defaultValue={item.name}
                      key={item.name}
                      disabled={!writable || busy}
                      className="focus:border-brand w-full rounded border border-transparent px-1 py-1 font-semibold"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') event.currentTarget.value = item.name
                        if (event.key === 'Escape' || event.key === 'Enter')
                          event.currentTarget.blur()
                      }}
                      onBlur={(event) => {
                        if (event.target.value !== item.name)
                          void change(item, { name: event.target.value })
                      }}
                    />
                    <input
                      aria-label={item.name + '前台路径'}
                      defaultValue={item.route}
                      key={item.route}
                      disabled={!writable || busy || item.key === 'home'}
                      className="text-muted-foreground mt-1 w-full rounded border px-2 py-1 font-mono text-xs"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') event.currentTarget.value = item.route
                        if (event.key === 'Escape' || event.key === 'Enter')
                          event.currentTarget.blur()
                      }}
                      onBlur={(event) => {
                        if (event.target.value === item.route) return
                        try {
                          validateModuleRoute(
                            item.key,
                            event.target.value,
                            items,
                            items.flatMap((m) =>
                              (m.aliases ?? []).map((alias) => ({ ...alias, moduleKey: m.key })),
                            ),
                          )
                          void change(item, { route: event.target.value })
                        } catch (error) {
                          setMessage((error as Error).message)
                          event.target.value = item.route
                        }
                      }}
                    />
                    <Link
                      href={contentRoutes[item.key]}
                      className="text-brand mt-2 inline-block text-xs"
                    >
                      {item.stats.totalItems}条内容 · 后台管理 →
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      role="switch"
                      aria-label={item.name + '显示'}
                      aria-checked={item.enabled}
                      disabled={!writable || busy || item.key === 'home'}
                      className={
                        'rounded-full border px-3 py-1 text-sm ' +
                        (item.enabled
                          ? 'bg-brand-soft text-brand'
                          : 'bg-muted text-muted-foreground')
                      }
                      onClick={() =>
                        item.enabled ? setClosing(item) : void change(item, { enabled: true }, true)
                      }
                    >
                      {item.enabled ? '已开启' : '已关闭'}
                      {item.key === 'home' && ' · 固定'}
                    </button>
                    <button
                      role="switch"
                      aria-label={item.name + '导航'}
                      aria-checked={item.navVisible}
                      disabled={!writable || busy || item.key === 'home'}
                      className="rounded border px-3 py-1 text-sm"
                      onClick={() => void change(item, { navVisible: !item.navVisible })}
                    >
                      导航{item.navVisible ? '显示' : '隐藏'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={!writable || busy || index <= 1}
                      onClick={() => void move(index, index - 1)}
                      aria-label={item.name + '上移'}
                    >
                      ↑
                    </button>
                    <button
                      disabled={!writable || busy || index === 0 || index === items.length - 1}
                      onClick={() => void move(index, index + 1)}
                      aria-label={item.name + '下移'}
                    >
                      ↓
                    </button>
                    <button
                      className="rounded border px-3 py-2 text-sm"
                      onClick={() => setEditing(item)}
                      aria-label={'配置' + item.name}
                    >
                      配置
                    </button>
                  </div>
                </div>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <p className="text-muted-foreground mt-4 text-xs">
        拖动手柄调整导航顺序；键盘可使用上移、下移按钮。首页保持首位。
      </p>
      <section className="mt-8 rounded-xl border p-5">
        <h2 className="font-semibold">近期模块操作</h2>
        {audits.map((event) => (
          <p key={event.id} className="mt-3 text-sm">
            {event.user?.name ?? '系统'} · {event.resourceId} · {event.action} ·{' '}
            {new Date(event.createdAt).toLocaleString('zh-CN')}
          </p>
        ))}
        {!audits.length && <p className="text-muted-foreground mt-3 text-sm">暂无可显示的记录</p>}
      </section>
      <AdminDialog
        open={!!closing}
        title={'关闭' + (closing?.name ?? '') + '模块'}
        onClose={() => setClosing(null)}
        busy={busy}
      >
        <p>
          关闭后，顶部导航、移动导航和首页露出会隐藏，{closing?.route}
          及详情返回404，搜索与订阅出口同步隐藏。
        </p>
        {closing?.key === 'timeline' && <p className="mt-4">关于我页面引用的工作经历也会隐藏。</p>}
        {closing?.key === 'about' && (
          <p className="mt-4">全站公开联系方式入口也会隐藏，包括邮箱、电话和联系链接。</p>
        )}
        <p className="mt-4">
          已有{closing?.stats.totalItems ?? 0}条内容完整保留，后台仍可管理；可以随时重新开启。
        </p>
        <p role="status" className="text-destructive mt-4 text-sm">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-4">
          <button onClick={() => setClosing(null)} disabled={busy}>
            取消
          </button>
          <button
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
            disabled={busy}
            onClick={() => closing && void change(closing, { enabled: false }, true)}
          >
            确认关闭
          </button>
        </div>
      </AdminDialog>
      <AdminDialog
        open={!!editing}
        title={(editing?.name ?? '') + '模块配置'}
        onClose={() => setEditing(null)}
        drawer
        busy={busy}
      >
        {editing && (
          <ModuleConfigEditor
            key={editing.key}
            item={editing}
            writable={!!writable}
            busy={busy}
            message={message}
            save={(patch) => void change(editing, patch)}
          />
        )}
      </AdminDialog>
    </div>
  )
}

function ModuleConfigEditor({
  item,
  writable,
  busy,
  message,
  save,
}: {
  item: ModuleItem
  writable: boolean
  busy: boolean
  message: string
  save: (patch: unknown) => void
}) {
  const [config, setConfig] = useState<ModuleConfig>(
    () => mergeModuleConfig(item.key, item.config, {}) as ModuleConfig,
  )
  const [label, setLabel] = useState(item.navLabel ?? '')
  const update = (key: keyof ModuleConfig, value: unknown) =>
    setConfig((current) => ({ ...current, [key]: value }))
  const number = (
    title: string,
    value: number,
    onChange: (value: number) => void,
    max = 100,
    min = 0,
  ) => (
    <label className="block">
      {title}
      <input
        type="number"
        min={min}
        max={max}
        required
        className={control}
        value={value}
        disabled={!writable || busy}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
  const check = (title: string, value: boolean, onChange: (value: boolean) => void) => (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={value}
        disabled={!writable || busy}
        onChange={(event) => onChange(event.target.checked)}
      />
      {title}
    </label>
  )
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        save({ navLabel: label || null, config })
      }}
    >
      <label className="block">
        导航显示名
        <input
          className={control}
          value={label}
          maxLength={40}
          disabled={!writable || busy}
          placeholder={item.name}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="block">
        栏目导语
        <textarea
          className={control}
          rows={3}
          value={config.intro ?? ''}
          disabled={!writable || busy}
          maxLength={1000}
          onChange={(event) => update('intro', event.target.value || null)}
        />
      </label>
      <label className="block">
        空态文案
        <input
          className={control}
          value={config.emptyText ?? ''}
          disabled={!writable || busy}
          maxLength={500}
          onChange={(event) => update('emptyText', event.target.value || null)}
        />
      </label>
      {config.pageSize !== undefined &&
        number('列表每页条数', config.pageSize, (value) => update('pageSize', value), 100, 1)}
      {config.home && (
        <fieldset className="space-y-4 rounded-lg border p-4">
          <legend>首页露出</legend>
          {check('在首页显示', config.home.enabled, (enabled) =>
            update('home', { ...config.home, enabled }),
          )}
          {number(
            '首页露出条数',
            config.home.limit,
            (limit) => update('home', { ...config.home, limit }),
            20,
          )}
          {number('首页区块位置', config.home.order, (order) =>
            update('home', { ...config.home, order }),
          )}
        </fieldset>
      )}
      {(['types', 'sections'] as const).map(
        (group) =>
          config[group] && (
            <fieldset key={group} className="space-y-3 rounded-lg border p-4">
              <legend>{group === 'types' ? '内容类型' : '关于我区块'}</legend>
              {Object.entries(config[group]!).map(([key, enabled]) => (
                <div key={key}>
                  {check(configLabels[key] ?? key, enabled, (value) =>
                    update(group, { ...config[group], [key]: value }),
                  )}
                </div>
              ))}
            </fieldset>
          ),
      )}
      {config.defaultView && (
        <label className="block">
          默认视图
          <select
            className={control}
            value={config.defaultView}
            disabled={!writable || busy}
            onChange={(event) => update('defaultView', event.target.value)}
          >
            <option value="list">列表</option>
            <option value="calendar">日历</option>
          </select>
        </label>
      )}
      {config.layout && (
        <label className="block">
          卡片布局
          <select
            className={control}
            value={config.layout}
            disabled={!writable || busy}
            onChange={(event) => update('layout', event.target.value)}
          >
            <option value="grid">网格</option>
            <option value="list">列表</option>
          </select>
        </label>
      )}
      {config.direction && (
        <label className="block">
          时间排序
          <select
            className={control}
            value={config.direction}
            disabled={!writable || busy}
            onChange={(event) => update('direction', event.target.value)}
          >
            <option value="desc">最近在前</option>
            <option value="asc">最早在前</option>
          </select>
        </label>
      )}
      {(['showTechStack', 'showToc', 'showViewCount', 'groupByYear'] as const).map(
        (key) =>
          config[key] !== undefined && (
            <div key={key}>
              {check(
                {
                  showTechStack: '显示技术栈',
                  showToc: '显示文章目录',
                  showViewCount: '显示阅读量',
                  groupByYear: '按年份分组',
                }[key],
                !!config[key],
                (value) => update(key, value),
              )}
            </div>
          ),
      )}
      {config.relatedCount !== undefined &&
        number('相关文章条数', config.relatedCount, (value) => update('relatedCount', value), 10)}
      {item.key === 'about' && (
        <p className="text-muted-foreground text-sm">
          邮箱和电话的全站公开开关在「关于我」个人资料中管理。
        </p>
      )}
      {item.key === 'home' && (
        <p className="text-muted-foreground text-sm">
          首页区块由各栏目首页露出配置控制；Hero文案来自个人资料。
        </p>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {writable && (
        <button
          type="submit"
          className="bg-primary text-primary-foreground w-full rounded-lg px-4 py-2"
          disabled={busy}
        >
          {busy ? '正在保存…' : '保存配置'}
        </button>
      )}
    </form>
  )
}
