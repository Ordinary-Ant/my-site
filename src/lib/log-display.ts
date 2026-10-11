export const LOG_TYPES = { DAILY: '每日随笔', EVENT: '大事件', SUMMARY: '总结' } as const
export const MOODS = {
  happy: '😊 开心',
  excited: '🤩 兴奋',
  calm: '😌 平静',
  tired: '😮‍💨 疲惫',
  down: '😔 低落',
  angry: '😤 生气',
} as const
export const WEATHER = {
  sunny: '☀️ 晴',
  cloudy: '☁️ 多云',
  overcast: '🌥️ 阴',
  rain: '🌧️ 雨',
  snow: '❄️ 雪',
  fog: '🌫️ 雾',
} as const
/** DATE字段用日期字符串展示，今天固定UTC+8，不受浏览器或部署机器时区影响。 */
export function chinaToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}
export function monthCells(year: number, month: number): Array<number | null> {
  // setUTCFullYear避免Date.UTC把0–99年自动解释为1900–1999。
  const start = new Date(0)
  start.setUTCFullYear(year, month - 1, 1)
  const first = start.getUTCDay()
  const end = new Date(start)
  end.setUTCMonth(month, 0)
  const days = end.getUTCDate()
  return [
    ...Array<null>(first).fill(null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ]
}
export function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1 + delta, 1)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}
