import Image from 'next/image'
import Link from 'next/link'
import { safeContentUrl } from '@/lib/markdown'
import { PROJECT_TYPES, projectDate, projectLinks } from '@/lib/project-display'

export type ProjectCardItem = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  type: keyof typeof PROJECT_TYPES
  coverImage: string | null
  techStack: string[]
  highlights: string[]
  links: unknown
  startDate: string | Date | null
  endDate: string | Date | null
  featured: boolean
}

/** 同一卡片供网格、列表与后台预览使用；次级按钮不被整卡链接覆盖。 */
export function ProjectCard({
  item,
  route,
  showTechStack = true,
  compact = false,
}: {
  item: ProjectCardItem
  route: string
  showTechStack?: boolean
  compact?: boolean
}) {
  const kind = PROJECT_TYPES[item.type],
    cover = item.coverImage ? safeContentUrl(item.coverImage) : null
  const primary = projectLinks(item.links)[0]
  return (
    <article
      className={
        'group bg-card relative overflow-hidden rounded-xl border ' +
        (compact ? 'sm:grid sm:grid-cols-[220px_1fr]' : '')
      }
    >
      {cover && item.type !== 'SKILL' ? (
        <Image
          src={cover}
          alt={item.title + '封面'}
          width={960}
          height={540}
          unoptimized
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div
          aria-label={kind.label + '作品封面'}
          className="bg-brand-soft text-brand flex aspect-video items-center justify-center text-6xl"
        >
          {kind.icon}
        </div>
      )}
      <div className="p-5">
        <p className="text-muted-foreground flex flex-wrap gap-3 text-xs">
          <span>
            {kind.icon} {kind.label}
          </span>
          {item.featured && <span>精选</span>}
          {item.startDate && (
            <span>
              {projectDate(item.startDate)} — {projectDate(item.endDate) || '进行中'}
            </span>
          )}
        </p>
        <h2 className="mt-3 text-xl font-semibold">
          <Link
            href={route + '/' + item.slug}
            className="hover:text-brand after:absolute after:inset-0 focus-visible:after:rounded-xl focus-visible:after:outline-2"
          >
            {item.title}
          </Link>
        </h2>
        {item.subtitle && <p className="text-brand mt-2 text-sm">{item.subtitle}</p>}
        <p className="text-muted-foreground mt-3 line-clamp-3 text-sm leading-relaxed">
          {item.description}
        </p>
        {item.type === 'SKILL' && item.highlights.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {item.highlights.slice(0, 3).map((text, index) => (
              <li key={index}>✓ {text}</li>
            ))}
          </ul>
        )}
        {showTechStack && (
          <div className="mt-4 flex flex-wrap gap-2">
            {item.techStack.map((tech) => (
              <Link
                key={tech}
                href={route + '?tech=' + encodeURIComponent(tech)}
                className="bg-muted relative z-10 rounded-full px-2 py-1 text-xs"
              >
                {tech}
              </Link>
            ))}
          </div>
        )}
        {primary && (
          <a
            href={primary.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand relative z-10 mt-5 inline-block text-sm font-medium"
          >
            {primary.label} ↗
          </a>
        )}
      </div>
    </article>
  )
}
