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
