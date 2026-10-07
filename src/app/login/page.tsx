import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginForm } from '@/components/admin/login-form'
export const metadata: Metadata = { title: '登录管理后台', robots: { index: false, follow: false } }
export default function LoginPage() {
  return (
    <Suspense fallback={<p>加载登录表单…</p>}>
      <LoginForm />
    </Suspense>
  )
}
