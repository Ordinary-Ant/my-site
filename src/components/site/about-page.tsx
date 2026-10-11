import Image from 'next/image'
import Link from 'next/link'
import { getPublicProfile } from '@/lib/services/profile'
import { listVisibleModules } from '@/lib/services/public-site'
import { safeContentUrl } from '@/lib/markdown'
import { recentExperience, safeProfileLink } from '@/lib/profile-display'
import type { ProfileCard, ProfileSkill, ProfileSocial } from '@/lib/profile-draft'
import type { TimelineItem } from '@/lib/timeline-display'
import { Markdown } from './markdown'
import { TimelineCard } from './timeline-card'
import { ProfileContact } from './profile-contact'
import { ProfileIcon } from '@/components/admin/profile-icons'
import { JsonLd } from './json-ld'

type ProfileView = {
  name: string
  headline: string
  avatar?: string | null
  bio?: string
  jobTitle?: string | null
  company?: string | null
  location?: string | null
  yearsOfExp?: number | null
  resumeUrl?: string | null
  email?: string | null
  phone?: string | null
  advantages?: ProfileCard[]
  skills?: ProfileSkill[]
  services?: ProfileCard[]
  socials?: ProfileSocial[]
  experience?: TimelineItem[]
}
/** 单例资料与同源经历服务端渲染；关掉所有区块也保留Hero。 */
export async function AboutPage() {
  const [record, modules] = await Promise.all([getPublicProfile(), listVisibleModules()]),
    profile = record as unknown as ProfileView,
    timeline = modules.find((item) => item.key === 'timeline'),
    resume = safeContentUrl(profile.resumeUrl),
    avatar = safeContentUrl(profile.avatar),
    socials = (profile.socials ?? []).filter((item) => safeProfileLink(item.url))
  const cards = (title: string, label: string, items: ProfileCard[] | undefined) =>
    !!items?.length && (
      <section className="border-t py-12" aria-label={title}>
        <p className="text-brand text-xs tracking-widest">{label}</p>
        <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <article key={index} className="bg-card min-w-0 rounded-xl border p-6">
              <span className="bg-brand-soft text-brand inline-flex rounded-lg p-3">
                <ProfileIcon name={item.icon} />
              </span>
              <h3 className="mt-4 font-semibold break-words">{item.title}</h3>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    )
  return (
    <div className="container-page">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ProfilePage',
          mainEntity: {
            '@type': 'Person',
            name: profile.name,
            description: profile.headline,
            jobTitle: profile.jobTitle ?? undefined,
          },
        }}
      />
      <header className="mx-auto max-w-2xl py-16 text-center md:py-24">
        {avatar ? (
          <Image
            src={avatar}
            width={96}
            height={96}
            unoptimized
            alt={profile.name + '的头像'}
            className="mx-auto size-24 rounded-3xl object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="bg-brand text-primary-foreground mx-auto flex size-24 items-center justify-center rounded-3xl text-4xl font-bold"
          >
            {profile.name.slice(0, 1) || 'P'}
          </div>
        )}
        <h1 className="mt-6 text-4xl font-bold break-words">{profile.name}</h1>
        <p className="mt-4 text-lg break-words">{profile.headline}</p>
        <p className="text-muted-foreground mt-3 break-words">
          {[
            profile.jobTitle,
            profile.company,
            profile.location,
            profile.yearsOfExp != null ? profile.yearsOfExp + '年经验' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {resume && (
            <a
              href={resume}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
            >
              下载简历 ↗
            </a>
          )}
          {(profile.email || profile.phone || socials.length > 0) && (
            <a href="#profile-contact" className="rounded-lg border px-4 py-2">
              联系我
            </a>
          )}
        </div>
      </header>
      {profile.bio && (
        <section className="border-t py-12" aria-label="关于我">
          <div className="mx-auto max-w-2xl">
            <p className="text-brand text-xs tracking-widest">ABOUT</p>
            <h2 className="mt-2 mb-6 text-2xl font-semibold">关于我</h2>
            <Markdown source={profile.bio} idPrefix="about-bio-" />
          </div>
        </section>
      )}
      {cards('个人优势', 'STRENGTHS', profile.advantages)}
      {!!profile.skills?.length && (
        <section className="border-t py-12" aria-label="技能">
          <p className="text-brand text-xs tracking-widest">SKILLS</p>
          <h2 className="mt-2 text-2xl font-semibold">技能</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            等级为熟练程度自评，年限为实际使用经验。
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {profile.skills.map((group, index) => (
              <article key={index} className="bg-card min-w-0 rounded-xl border p-6">
                <h3 className="text-brand font-semibold break-words">{group.category}</h3>
                <div className="mt-5 space-y-5">
                  {group.items.map((item, i) => (
                    <div key={i}>
                      <div className="mb-2 flex justify-between gap-3 text-sm">
                        <span className="break-words">{item.name}</span>
                        <span className="shrink-0">
                          {item.level}/5 · {item.years}年
                        </span>
                      </div>
                      <div
                        role="meter"
                        aria-label={item.name + '熟练程度'}
                        aria-valuemin={1}
                        aria-valuemax={5}
                        aria-valuenow={item.level}
                        className="grid grid-cols-5 gap-1"
                      >
                        {[1, 2, 3, 4, 5].map((level) => (
                          <span
                            key={level}
                            className={
                              'h-2 rounded ' + (level <= item.level ? 'bg-brand' : 'bg-muted')
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {!!profile.experience?.length && timeline && (
        <section className="border-t py-12" aria-label="工作经历">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-brand text-xs tracking-widest">EXPERIENCE</p>
              <h2 className="mt-2 text-2xl font-semibold">工作经历</h2>
            </div>
            <Link href={timeline.route} className="text-brand text-sm">
              查看完整时间轴 →
            </Link>
          </div>
          <div className="mt-6 space-y-4">
            {recentExperience(profile.experience).map((item) => (
              <div key={item.id} data-about-experience={item.id}>
                <TimelineCard item={item} idPrefix="about-experience-" />
              </div>
            ))}
          </div>
        </section>
      )}
      {cards('我能提供', 'SERVICES', profile.services)}
      {(profile.email || profile.phone || socials.length > 0) && (
        <section id="profile-contact" className="border-t py-12" aria-label="联系我">
          <div className="mx-auto max-w-2xl">
            <p className="text-brand text-xs tracking-widest">CONTACT</p>
            <h2 className="mt-2 mb-6 text-2xl font-semibold">联系我</h2>
            <ProfileContact email={profile.email} phone={profile.phone} />
            <div className="mt-4 flex flex-wrap gap-3">
              {socials.map((item, index) => (
                <a
                  key={index}
                  href={safeProfileLink(item.url)}
                  target={item.url.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-2 text-sm"
                >
                  <ProfileIcon name={item.icon} />
                  <span className="min-w-0 break-words">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
