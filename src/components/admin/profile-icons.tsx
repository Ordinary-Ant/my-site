'use client'
import { useState } from 'react'
import { PROFILE_ICONS, ProfileIcon } from '@/components/shared/profile-icon'
export { ProfileIcon } from '@/components/shared/profile-icon'

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
