'use client'
import dynamic from 'next/dynamic'

// 客户端边界内建立异步分包；保留SSR，禁JS仍可阅读和使用原生链接。
export const ImageGallery = dynamic(() => import('./image-gallery'))
export const LogCalendar = dynamic(() =>
  import('./log-calendar').then((module) => module.LogCalendar),
)
export const ReadingActions = dynamic(() =>
  import('./reading-actions').then((module) => module.ReadingActions),
)
export const LogView = dynamic(() => import('./log-view').then((module) => module.LogView))
export const LogMore = dynamic(() => import('./log-more').then((module) => module.LogMore))
export const LogNavigation = dynamic(() =>
  import('./log-navigation').then((module) => module.LogNavigation),
)
export const ProfileContact = dynamic(() =>
  import('./profile-contact').then((module) => module.ProfileContact),
)
