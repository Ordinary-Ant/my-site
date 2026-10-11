'use client'
import { useState } from 'react'
import {
  Briefcase,
  Wrench,
  Code,
  Heart,
  Github,
  Mail,
  Phone,
  MapPin,
  BookOpen,
  MessageCircle,
  Handshake,
  Zap,
  Star,
  Award,
  Globe,
  User,
} from 'lucide-react'
export const PROFILE_ICONS = {
  briefcase: Briefcase,
  wrench: Wrench,
  code: Code,
  heart: Heart,
  github: Github,
  mail: Mail,
  phone: Phone,
  'map-pin': MapPin,
  'book-open': BookOpen,
  'message-circle': MessageCircle,
  handshake: Handshake,
  zap: Zap,
  star: Star,
  award: Award,
  globe: Globe,
  user: User,
}
/** 存储图标名称，避免把HTML或任意组件代码写进内容。 */
export function ProfileIcon({ name }: { name: string }) {
  const Icon = Object.hasOwn(PROFILE_ICONS, name)
    ? PROFILE_ICONS[name as keyof typeof PROFILE_ICONS]
    : User
  return <Icon aria-hidden="true" className="size-5 shrink-0" />
}
export function ProfileIconPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  label: string
}) {
  const [query, setQuery] = useState('')
  return (
    <details className="rounded-lg border p-2">
      <summary className="flex cursor-pointer items-center gap-2">
        <ProfileIcon name={value} />
        {label}：{value || '默认'}
      </summary>
      <label className="mt-3 block text-xs">
        搜索图标
        <input
          disabled={disabled}
          aria-label={'搜索' + label}
          className="mt-1 w-full rounded border bg-transparent p-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {Object.keys(PROFILE_ICONS)
          .filter((name) => name.includes(query.toLowerCase()))
          .map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              aria-label={label + ' ' + name}
              aria-pressed={value === name}
              onClick={() => onChange(name)}
              className="flex flex-col items-center gap-1 rounded border p-2 text-xs"
            >
              <ProfileIcon name={name} />
              {name}
            </button>
          ))}
      </div>
    </details>
  )
}
