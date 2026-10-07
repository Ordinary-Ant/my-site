/* eslint-disable @next/next/no-html-link-for-pages -- 登录返回与错误恢复使用完整导航，避免依赖失败的客户端路由。 */

/**
 * 404
 * 设计稿：design/site-404.html（`13a`）
 * 说明：模块被后台关闭时也走这个页面，但文案不同。
 *       这里不暴露"后台被关闭"这类技术细节。见 docs/05-frontend-ia.md §4.11
 */
export default function NotFound() {
  return (
    <div className="container-page grid min-h-[70vh] place-items-center py-20 text-center">
      <div>
        <div className="from-brand bg-gradient-to-br to-[#a855f7] bg-clip-text text-[68px] leading-none font-extrabold tracking-tighter text-transparent md:text-[96px]">
          404
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          这个页面不存在，或者已被我藏起来了
        </h1>
        <p className="text-muted-foreground mt-2.5 text-sm">检查一下地址，或者从下面走。</p>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          <a
            href="/"
            className="bg-primary text-primary-foreground hover:bg-brand-hover rounded-[10px] px-5 py-2.5 text-sm font-medium transition-colors"
          >
            回首页
          </a>
          <a
            href="/articles"
            className="border-border-strong hover:bg-muted rounded-[10px] border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            看看文章
          </a>
        </div>
      </div>
    </div>
  )
}
