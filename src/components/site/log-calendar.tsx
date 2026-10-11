'use client'
import Link from 'next/link'
import { monthCells, shiftMonth } from '@/lib/log-display'

export type LogCalendarData = {
  year: number
  months: { month: number; count: number; days: number[]; dayCounts?: Record<string, number> }[]
  total: number
}
/** 日历所有操作写回URL，禁用JS仍可通过链接切月和选日。 */
export function LogCalendar({
  data,
  month,
  path,
  query,
  selectedDate,
}: {
  data: LogCalendarData
  month: number
  path: string
  query: string
  selectedDate?: string
}) {
  const current = data.months.find((entry) => entry.month === month)
  const href = (year: number, nextMonth: number, day?: number) => {
    const params = new URLSearchParams(query)
    params.set('view', 'calendar')
    params.set('year', String(year))
    params.set('month', String(nextMonth))
    params.delete('page')
    if (day)
      params.set(
        'date',
        `${String(year).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      )
    else params.delete('date')
    return path + '?' + params
  }
  const previous = shiftMonth(data.year, month, -1),
    next = shiftMonth(data.year, month, 1)
  return (
    <section
      aria-label="日志日历"
      className="rounded-xl border p-4"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select'))
          return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          const target = event.key === 'ArrowLeft' ? previous : next
          if (target.year < 1 || target.year > 9998) return
          window.location.assign(href(target.year, target.month))
        }
      }}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        {previous.year >= 1 ? (
          <Link aria-label="上个月" href={href(previous.year, previous.month)}>
            ←
          </Link>
        ) : (
          <span aria-label="已到最早月份">←</span>
        )}
        <h2 className="font-semibold">
          {data.year}年{month}月
        </h2>
        {next.year <= 9998 ? (
          <Link aria-label="下个月" href={href(next.year, next.month)}>
            →
          </Link>
        ) : (
          <span aria-label="已到最晚月份">→</span>
        )}
      </header>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
          <span key={day} className="text-muted-foreground p-2">
            {day}
          </span>
        ))}
        {monthCells(data.year, month).map((day, index) => {
          if (!day) return <span key={'empty' + index} />
          const count = current?.dayCounts?.[String(day)] ?? (current?.days.includes(day) ? 1 : 0)
          const date = `${String(data.year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          return (
            <Link
              key={day}
              href={href(data.year, month, day)}
              aria-label={`${date}，${count}条日志`}
              aria-current={selectedDate === date ? 'date' : undefined}
              className={
                'flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border ' +
                (selectedDate === date
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'hover:bg-muted border-transparent')
              }
            >
              <span>{day}</span>
              {count > 0 && (
                <span className="text-brand text-[10px]">{count > 1 ? count + '条' : '●'}</span>
              )}
            </Link>
          )
        })}
      </div>
      <p className="text-muted-foreground mt-4 text-xs">
        本月{current?.count ?? 0}条记录；左右方向键切月，选日期查看当天日志。
      </p>
    </section>
  )
}
