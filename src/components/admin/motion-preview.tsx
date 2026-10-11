'use client'
import type { MotionConfig } from '@/config/motion'
import { MotionSurface } from '@/components/site/motion-surface'
/** 预览直接复用站点边界，编辑值不会写入数据库。 */
export default function MotionPreview({ config }: { config: MotionConfig }) {
  return (
    <div className="overflow-hidden rounded-xl border" aria-label="动效预览">
      <MotionSurface config={config} preview>
        <section data-motion="hero" className="p-8">
          <p className="text-brand text-sm">MOTION PREVIEW</p>
          <h2 className="mt-4 text-3xl font-bold">让内容自然呈现</h2>
          <p className="text-muted-foreground mt-4">
            首屏由 CSS 呈现。向下滚动查看有限编排，键盘焦点立即可见。
          </p>
          <a href="#preview-story" className="text-brand mt-6 inline-block">
            查看叙事区块 ↓
          </a>
        </section>
        <div className="min-h-[70vh]" aria-hidden="true" />
        <section id="preview-story" data-motion="section" className="space-y-6 p-8">
          {['记录与思考', '作品与实践', '经历与成长'].map((title) => (
            <article key={title} data-motion="card" className="bg-card rounded-xl border p-6">
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="text-muted-foreground my-4">
                内容始终可读，关闭动效后不会留下隐藏区块。
              </p>
              <a href="#preview-story" className="text-brand">
                阅读更多
              </a>
            </article>
          ))}
        </section>
      </MotionSurface>
    </div>
  )
}
