import { notFound } from 'next/navigation'
import { SettingsEditor } from '@/components/admin/settings'
import { settingGroups } from '@/lib/validators/settings'
export default async function Page({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params
  if (group === 'motion' || !Object.hasOwn(settingGroups, group)) notFound()
  return <SettingsEditor group={group} />
}
