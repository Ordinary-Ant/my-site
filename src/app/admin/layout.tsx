import type { Metadata } from 'next'
import { AdminShell } from '@/components/admin/shell'
export const metadata: Metadata = { title: '管理后台', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'
/** 壳只输出公共结构，数据接口在service内做权威会话与权限检查。 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
