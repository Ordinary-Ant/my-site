import { notFound } from 'next/navigation'
import { SettingsEditor } from '@/components/admin/settings'
import { settingGroups } from '@/lib/validators/settings'
import { MotionEditor } from '@/components/admin/motion-editor'
export default async function Page({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params
  if (group === 'motion') return <MotionEditor />
  if (!Object.hasOwn(settingGroups, group)) notFound()
  return <SettingsEditor group={group} />
}
