import { safeContentUrl } from './markdown'
/** 联系链接只允许单一收件人或电话号码，不接受邮件头参数。 */
export function safeProfileLink(value: string | null | undefined) {
  if (!value || /[\u0000-\u001f\u007f]|%0[ad]/i.test(value)) return undefined
  return (
    safeContentUrl(value) ??
    (/^mailto:[A-Za-z0-9.!#$%&'*+/=_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ||
    /^tel:\+?[\d(). -]{3,30}$/.test(value)
      ? value
      : undefined)
  )
}
/** About固定展示近期经历；完整时间戳仍遵循自身方向配置。 */
export function recentExperience<
  T extends { id: string; isCurrent: boolean; startDate: Date | string; order: number },
>(items: T[]) {
  return [...items]
    .sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime() ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3)
}
