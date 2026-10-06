# 01 · 系统架构

[← 返回 README](../README.md) · [下一篇：数据模型 →](02-data-model.md)

---

## 1. 系统上下文

```
                        ┌──────────────────────────────┐
                        │   访客（移动 / 平板 / PC）    │
                        │      匿名 · 只读 · SEO       │
                        └──────────────┬───────────────┘
                                       │ HTTPS
                        ┌──────────────▼───────────────┐
                        │      CDN / Edge (Vercel)      │
                        │  静态资源 · ISR 缓存 · 图片加速 │
                        └──────────────┬───────────────┘
                                       │
        ┌──────────────────────────────▼──────────────────────────────┐
        │              Next.js 15 单体应用（同一仓库 / 同一部署）        │
        │                                                              │
        │  ┌────────────┐   ┌────────────┐   ┌─────────────────────┐  │
        │  │  前台 (site)│   │ 后台 (admin)│   │   REST API /api/v1  │  │
        │  │  RSC + ISR │   │  CSR 仪表盘 │   │  Route Handlers     │  │
        │  └─────┬──────┘   └─────┬──────┘   └──────────┬──────────┘  │
        │        └────────────────┼─────────────────────┘             │
        │                         ▼                                    │
        │              ┌──────────────────────┐                        │
        │              │  Service 层（业务逻辑）│  ← 唯一真源，双入口共用  │
        │              └──────────┬───────────┘                        │
        │                         ▼                                    │
        │              ┌──────────────────────┐                        │
        │              │   Prisma Client      │                        │
        │              └──────────┬───────────┘                        │
        └─────────────────────────┼────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
  ┌───────────┐            ┌─────────────┐          ┌──────────────┐
  │ PostgreSQL│            │  对象存储    │          │  邮件服务(可选)│
  │ Neon/自建  │            │ R2 / OSS / 本地│         │  Resend      │
  └───────────┘            └─────────────┘          └──────────────┘
```

**一个应用、两种身份、三层数据出口。** 前台和后台共用同一个 `service` 层，差异只在于「谁能调用」和「调用后怎么渲染」。

---

## 2. 分层架构

```
┌───────────────────────────────────────────────────────────────────┐
│ L5 表现层 Presentation                                             │
│  前台 (site)/**  → Server Components 优先，少量 Client 交互岛        │
│  后台 (admin)/** → 以 Client Components 为主（表格/表单/拖拽）        │
├───────────────────────────────────────────────────────────────────┤
│ L4 接口层 Interface                                                │
│  • Route Handlers  /api/v1/**   ← 对外契约，Zod 校验入参            │
│  • Server Actions               ← 后台表单直提交（可选，见 §5.3）    │
│  • RSC 直接调用 service         ← 前台读，跳过 HTTP 层              │
├───────────────────────────────────────────────────────────────────┤
│ L3 服务层 Service   ★ 唯一业务真源                                  │
│  articleService / logService / projectService / timelineService     │
│  profileService / moduleService / mediaService / authService        │
│  职责：业务规则、权限断言、缓存失效、审计写入、DTO 组装               │
├───────────────────────────────────────────────────────────────────┤
│ L2 数据访问层 Data Access                                          │
│  Prisma Client（单例） + 软删除中间件 + 查询构造器                    │
├───────────────────────────────────────────────────────────────────┤
│ L1 基础设施层 Infrastructure                                        │
│  PostgreSQL · StorageDriver · Mailer · Logger · Cache(tag) · RateLimit│
└───────────────────────────────────────────────────────────────────┘
```

### 铁律

1. **路由层不写业务逻辑**，只做「解析参数 → 调 service → 包装响应」。
2. **service 层不感知 HTTP**，不接收 `Request`、不返回 `Response`，只收发 POJO + 抛领域错误。
3. **前台与后台调用同一个 service**，保证开关、权限、审计逻辑不会两处实现。
4. **Zod schema 只定义一次**（`lib/validators/*`），前端表单与后端校验共用。

---

## 3. 技术选型说明（为什么是它们）

| 选型 | 关键理由 | 需要接受的代价 |
|---|---|---|
| **Next.js 15 App Router** | 前台要 SEO（RSC/SSR/ISR），后台要复杂交互（CSR），同一框架两种模式零成本混用；Route Handlers 直接充当 API 层，省掉一个后端服务与一套部署 | 心智负担：必须分清 Server / Client Component 边界 |
| **RSC 直连 service 读数据** | 首屏零客户端请求瀑布，数据在服务端拿到就渲染；SEO 友好 | 不能用浏览器 API，调试链路稍长 |
| **Prisma** | 类型安全、迁移工具成熟、`Json`/`enum`/数组支持好、单 schema 同时适配 SQLite/Postgres | 复杂查询（全文检索、聚合）会退化到 `$queryRaw` |
| **PostgreSQL** | `enum`、`String[]`、`JsonB`、GIN 索引、`tsvector` 全文检索，一条 `to_tsvector` 搞定站内搜索 | 比 SQLite 多一个进程（Docker 一行解决） |
| **JWT（自建）** | 无三方依赖、可主动撤销（refresh 存库）、Cookie 方案天然防 XSS 读取 | 需要自己写轮转与撤销逻辑（设计已给出） |
| **Tailwind v4 + shadcn/ui** | 三端响应式靠断点前缀天然表达；组件源码内联，可随意改；无运行时 CSS-in-JS 开销 | 类名较长，需团队约定抽取粒度 |
| **Markdown 存储** | 数据可移植、可 Git 备份、渲染器可换、AI 可读可写 | 富交互组件（如可播放 demo）需要自定义语法扩展 |

### 为什么不拆前后端？

个人站的流量与复杂度不支持微服务。拆分会带来：两套部署、两套环境变量、CORS、鉴权双写、类型需手动同步。**唯一值得拆出的东西是后台（若未来给他人用），届时把 `(admin)` 路由组与 `/api/v1/admin` 整体迁到独立应用即可，因为 service 层是干净可搬迁的。**

---

## 4. 渲染与缓存策略

这是全站性能的核心，逐路由明确。

| 路由 | 模式 | revalidate / 失效方式 | 说明 |
|---|---|---|---|
| `/` 首页 | ISR | 300s + `revalidateTag('content')` | 聚合页，允许最长 5 分钟延迟 |
| `/logs` `/logs/[id]` | ISR | 600s + `revalidateTag('log')` | 日志更新频率低 |
| `/articles` | ISR | 600s + `revalidateTag('article')` | |
| `/articles/[slug]` | ISR + `generateStaticParams` | 发布会 `revalidateTag('article')` | 已发布文章预渲染 |
| `/portfolio` `/portfolio/[slug]` | ISR | 3600s + `revalidateTag('project')` | 极少变动 |
| `/timeline` | ISR | 3600s + `revalidateTag('timeline')` | |
| `/about` | ISR | 3600s + `revalidateTag('profile')` | |
| `/search` | Dynamic（`?q=`） | 不缓存 | 依赖查询参数 |
| `/admin/**` | Dynamic + `no-store` | — | 必须实时，且不可被 CDN 缓存 |
| `/api/v1/**`（公开） | `s-maxage=60, stale-while-revalidate=300` | tag 失效 | GET 可 CDN 缓存 |
| `/api/v1/admin/**` | `no-store` | — | |
| `sitemap.xml` / `rss.xml` | Dynamic（revalidate 3600） | tag 失效 | |

### 缓存失效链路

```
后台保存内容
  → service 层写库成功
  → revalidateTag('article')        // 前台 ISR 缓存失效
  → 写 AuditLog
  → 返回新数据
客户端 TanStack Query invalidateQueries(['admin','articles'])
```

**统一在 service 层调用 `revalidateTag`**，而不是散落在各个路由里 —— 这样无论从 API、Server Action 还是脚本触发，缓存都一定失效。

### 缓存 tag 命名表

| Tag | 覆盖内容 | 何时失效 |
|---|---|---|
| `content` | 首页聚合 | 任意模块内容变更 |
| `article` | 文章列表/详情 | 文章增删改、发布/下架 |
| `log` | 日志 | 同上 |
| `project` | 作品集 | 同上 |
| `timeline` | 时间线 | 同上 |
| `profile` | 关于我 | Profile 更新 |
| `module` | 模块开关与导航 | `Module` 表任意变更 |
| `setting` | 站点配置 | `Setting` 表任意变更 |

---

## 5. 数据流设计

### 5.1 前台读取（RSC 直连，零 HTTP 往返）

```
浏览器 GET /articles/xxx
  → Vercel Edge：命中 ISR 缓存？命中则直接返回（~30ms TTFB）
  → 未命中：Node Runtime 执行 RSC
      → articleService.getBySlug(slug)
          → 校验模块开关（Module.enabled），关闭则 notFound()
          → prisma.article.findFirst({ where: { slug, status: 'PUBLISHED' } })
          → 组装 DTO（含 tags / category / 上下篇 / 相关文章）
      → 渲染 HTML + RSC Payload → 写入 ISR 缓存
  → 浏览器逐步注水（Hydration），仅交互岛需要 JS
```

**收益**：文章详情页首屏 JS 体积可控制在 ~90KB（gzip），无客户端数据请求。

### 5.2 后台写入（客户端 → API）

```
后台表单提交（React Hook Form + Zod）
  → useMutation → fetch POST /api/v1/admin/articles
      → Route Handler：
          1. requireRole('EDITOR')        // 鉴权 + RBAC
          2. parseBody(ArticleCreateSchema) // Zod 校验
          3. articleService.create(dto, ctx)
               ├─ 唯一性校验（slug 冲突 → ConflictError）
               ├─ 计算 readingTime
               ├─ 写 AuditLog（before/after）
               └─ revalidateTag('article'); revalidateTag('content')
          4. ok(data, 201)
  → 成功：invalidateQueries + toast
  → 失败：映射错误码到表单字段或全局 toast
```

### 5.3 Server Actions 用在哪里

**默认走 REST API。** 仅在下列场景用 Server Action，因为它牺牲了接口可复用性：

- 后台「开关模块」这类单字段原子操作（`toggleModule(key)`），无需对外契约；
- 登出、改密码这类纯服务端副作用。

**判断标准**：若这个能力将来可能被移动端 App / 第三方调用 → 建 REST 接口；若纯属后台 UI 内部动作 → Server Action。

---

## 6. 鉴权与会话

### 6.1 Token 策略

| | Access Token | Refresh Token |
|---|---|---|
| 格式 | JWT (HS256) | 随机 32 字节，**哈希后**入库 |
| 有效期 | 15 分钟 | 7 天（滑动续期） |
| 存储 | httpOnly Cookie `at`，`Secure`，`SameSite=Lax`，`Path=/` | httpOnly Cookie `rt`，`Secure`，`SameSite=Strict`，`Path=/api/v1/auth` |
| 载荷 | `{ sub, role, name, iat, exp }`（**不含敏感信息**） | 仅作查库索引 |
| 撤销 | 无法单独撤销（靠短过期） | `Session.revokedAt` 置位即失效 |
| 轮转 | — | 每次刷新签发新 RT 并作废旧的（检测重放） |

### 6.2 登录 / 刷新时序

```
POST /api/v1/auth/login  { email, password }
  → 限流检查（IP + email，5 次 / 15 分钟）
  → 查 User，argon2.verify(passwordHash)
  → 失败：统一返回 "邮箱或密码错误"（不泄露账号是否存在），并记 AuditLog
  → 成功：
      签发 AT（15m）
      创建 Session（RT hash, UA, IP, expiresAt=+7d）
      Set-Cookie: at=...; rt=...
      更新 User.lastLoginAt，写 AuditLog(action='login')
  → 200 { user: { id, name, role } }

POST /api/v1/auth/refresh   （Cookie 自动携带 rt）
  → 查 Session by hash，校验未过期且未撤销
  → 命中已撤销的 RT → 判定为令牌重放 → 撤销该用户全部会话 + 告警
  → 轮转：旧 Session.revokedAt=now，创建新 Session
  → Set-Cookie: 新 at + 新 rt
```

### 6.3 路由保护（⚠️ 易踩的坑）

Next.js `middleware.ts` 运行在 **Edge Runtime**，**不能使用 Prisma**。因此**绝不能**在 middleware 里查库校验会话。

正确做法分两层：

**第一层 · middleware（Edge，只做廉价判断）**
```ts
// 伪代码
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/admin')) {
    const at = req.cookies.get('at')?.value
    if (!at) return redirect('/login?next=' + pathname)
    try {
      const payload = await verifyJwt(at, secret)   // jose 可在 Edge 运行
      if (payload.role !== 'ADMIN' && payload.role !== 'EDITOR') return redirect('/403')
    } catch {
      return redirect('/login?next=' + pathname)     // 过期 → 前端用 rt 静默刷新
    }
  }
  if (pathname.startsWith('/api/v1/admin')) {
    // 同理校验 AT，失败返回 401 JSON（让客户端去 refresh 后重试）
  }
}
```
> Edge 只验证签名与过期，**不做数据库查询**。

**第二层 · 服务端二次校验（Node Runtime，权威）**
- `app/(admin)/admin/layout.tsx` 中调用 `getCurrentUser()`，查库确认用户仍存在且 `isActive`；
- **每个 `/api/v1/admin/*` Route Handler 内部**再 `requireRole()` 一次。

> **安全原则**：middleware 只是 UX 优化的重定向，**真正的授权必须在数据入口处**。任何只依赖 middleware 的保护都视为不存在。

### 6.4 RBAC 权限矩阵

| 能力 | ADMIN | EDITOR | VIEWER |
|---|:--:|:--:|:--:|
| 查看后台仪表盘 | ✅ | ✅ | ✅ |
| 内容增删改（文章/日志/作品/时间线） | ✅ | ✅ | ❌ |
| 发布 / 下架内容 | ✅ | ✅ | ❌ |
| 模块开关 / 排序 / 改名 | ✅ | ❌ | ❌ |
| 站点设置 | ✅ | ❌ | ❌ |
| 媒体上传 / 删除 | ✅ | ✅ | ❌ |
| 用户管理 | ✅ | ❌ | ❌ |
| 查看审计日志 | ✅ | ❌ | ✅ |
| 数据导出 / 导入 | ✅ | ❌ | ❌ |

实现：`lib/auth/rbac.ts` 导出 `PERMISSIONS: Record<Role, Set<Permission>>` 与 `can(role, permission)`，`requirePermission()` 在 service 层断言（**不在 UI 层隐藏按钮了事**，UI 隐藏只是体验优化）。

---

## 7. 模块开关机制（核心需求）

「后台可开启关闭所有功能」需要三层控制，缺一不可：

### 第 1 层 · 数据层：`Module` 表

```prisma
model Module {
  key        String   @id      // home | log | portfolio | timeline | article | about
  name       String             // 显示名，可改（"日志" → "随笔"）
  enabled    Boolean  @default(true)
  navVisible Boolean  @default(true)
  navLabel   String?            // 导航文案，为空则用 name
  navOrder   Int      @default(0)
  icon       String?
  route      String             // /logs（可改）
  config     Json?              // 模块级配置，见下表
  updatedAt  DateTime @updatedAt
}
```

`config` 的**规范结构**（本文档全站唯一权威定义，其他文档一律引用此处命名，各模块按需取用）：

```jsonc
{
  // ---- 通用键（所有模块都可能用到）----
  "pageSize": 10,                       // 列表分页大小
  "intro": "记录每天发生的事",            // 栏目页顶部导语
  "emptyText": "还没有内容",              // 空态文案
  "home": {                             // 首页露出配置
    "enabled": true,                    //   是否在首页显示该区块
    "limit": 5,                         //   首页显示条数
    "order": 2                          //   首页区块位置（越小越靠前）
  },
  "types": { "DAILY": true, "EVENT": true, "SUMMARY": false },  // 子类型级开关，键为该模块的枚举值

  // ---- 模块专属键 ----
  "defaultView": "list",                // log：list | calendar
  "layout": "grid",                     // portfolio：grid | list
  "showTechStack": true,                // portfolio：卡片是否显示技术栈徽章
  "showToc": true,                      // article：详情页是否显示目录
  "showViewCount": true,                // article：是否显示阅读量
  "relatedCount": 3,                    // article：相关文章条数，0 表示不显示
  "groupByYear": true,                  // timeline：是否按年份分组
  "direction": "desc",                  // timeline：desc 最新在上 | asc 最早在上
  "sections": {                         // about：区块级开关
    "advantages": true, "skills": true, "experience": true, "contact": true
  }
}
```

> **`config` 的更新语义是浅合并**（`{...old, ...new}`），不是整体替换 —— 否则前台改一个 `pageSize` 会把 `types` 里的子类型开关全冲掉。见 [03-api-spec.md §5.3](03-api-spec.md)。

### 第 2 层 · 路由层：关闭即不可达

三种响应策略，按语义选择：

| 策略 | 行为 | 适用 |
|---|---|---|
| `notFound()` | 返回 404 页面 | 模块整体关闭（对外表现为"从未存在"） |
| `redirect('/')` | 跳首页 | 你希望访客仍能回到站内 |
| `410 Gone` 页面 | 显示"该栏目已下线" | 曾公开过、希望 SEO 明确告知的 |

默认用 `notFound()`。每个 `(site)` 模块的 `layout.tsx` 统一调用：

```ts
// app/(site)/logs/layout.tsx
const mod = await moduleService.getByKey('log')
if (!mod.enabled) notFound()
```

**同时在 service 层兜底**：`logService.list()` 内部若模块关闭，直接返回空结果 —— 防止有人绕过 layout 直接调 API。

### 第 3 层 · 导航层：动态生成

`app/(site)/layout.tsx` 从 `moduleService.listVisible()` 拿数据渲染 Header / TabBar / Sitemap：

```
后台改动 Module 表
  → moduleService.update() → revalidateTag('module') + revalidateTag('content')
  → 前台 Header / 底部 Tab / 首页卡片 / sitemap.xml / RSS 全部同步更新
  → 无需发版、无需重启
```

### 关闭一个模块的连锁效果（以「日志」为例）

| 位置 | 关闭前 | 关闭后 |
|---|---|---|
| 顶部导航 / 移动 Tab Bar | 显示「日志」 | 消失（`navVisible` 也需为 false） |
| 首页日志卡片区 | 显示最新 5 条 | 整块移除，相邻区块上移 |
| `/logs` 及 `/logs/[id]` | 200 | 404 |
| `/api/v1/logs` | 200 + 数据 | 200 + 空数组（避免前端报错） |
| `sitemap.xml` | 含日志 URL | 移除 |
| `rss.xml` | 含日志条目 | 移除 |
| 后台菜单 | 显示「日志管理」 | 置灰 + 标「已关闭」，**仍可进入管理已存内容** |
| 数据库 | — | **数据保留，不删除**（可随时重新开启） |

> **设计原则：开关是「隐藏」而非「删除」。** 关闭模块绝不级联删除内容，这样误操作可以一键恢复。

---

## 8. 文件存储抽象

```ts
// lib/storage/types.ts
export interface StorageDriver {
  put(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<{ url: string; key: string }>
  delete(key: string): Promise<void>
  url(key: string): string
}
```

| 实现 | 触发条件 | 说明 |
|---|---|---|
| `LocalDriver` | `STORAGE_DRIVER=local`（默认，开发） | 写入 `public/uploads/`，直接由 Next 静态服务 |
| `S3Driver` | `STORAGE_DRIVER=s3`（生产） | 兼容 Cloudflare R2 / 阿里云 OSS / AWS S3，`forcePathStyle` 适配 |

上传流程：`客户端选择文件 → POST /api/v1/admin/media/upload (multipart) → 校验类型与大小 → 计算 sha256 去重 → driver.put() → 写 Media 表 → 返回 url`。

限制：单文件 ≤ 10MB（图片）/ 50MB（视频）；允许 `image/*`、`video/mp4`、`application/pdf`。

---

## 9. 安全清单

| 风险 | 对策 |
|---|---|
| XSS（Markdown 注入） | `react-markdown` **默认不渲染原始 HTML**；如需 HTML，必须过 `rehype-sanitize` + 白名单 |
| CSRF | `SameSite=Lax`（at）/ `Strict`（rt）；所有非 GET 请求校验 `Origin` 头；不使用 `SameSite=None` |
| XSS 读取 Token | Token 全部 `httpOnly`，JS 无法读取 |
| 暴力破解 | 登录限流 5 次 / 15 分钟（IP + email 双维度）；失败信息统一不区分 |
| 权限绕过 | service 层强制 `requirePermission()`；middleware 仅作 UX |
| SQL 注入 | 全部走 Prisma 参数化查询；`$queryRaw` 必须用模板字面量占位 |
| 上传攻击 | 校验 MIME + 魔数（file-type）；文件名重命名为随机值；不落到可执行目录 |
| 依赖漏洞 | `npm audit` + Dependabot；锁定 lockfile |
| 敏感信息泄露 | 环境变量只走 `.env`（`.env` 入 `.gitignore`）；客户端代码禁止 import `lib/env.server.ts` |
| 后台被爬 | `/admin` 加 `X-Robots-Tag: noindex`；`robots.txt` Disallow |
| 数据丢失 | 每日 `pg_dump` 到对象存储，保留 30 天；导出 JSON 兜底 |

### 安全响应头

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline';
```
（CSP 在 `next.config.ts` 的 `headers()` 中下发；`'unsafe-inline'` 为 Next.js 内联脚本必需，后续可用 nonce 收紧。）

---

## 10. 性能预算

| 指标 | 移动端目标 | PC 目标 |
|---|---|---|
| LCP | ≤ 2.0s（4G） | ≤ 1.2s |
| INP | ≤ 150ms | ≤ 100ms |
| CLS | ≤ 0.05 | ≤ 0.05 |
| 首屏 JS（文章详情） | ≤ 110KB gzip | 同 |
| 首屏 JS（后台登录页） | ≤ 80KB gzip | 同 |
| 单页图片总重 | ≤ 800KB | ≤ 1.5MB |
| Lighthouse Performance | ≥ 90 | ≥ 95 |
| Lighthouse A11y / Best Practices / SEO | ≥ 95 | ≥ 100 |

落地手段：`next/image` 自动 AVIF/WebP + 响应式 `sizes`；`next/font` 自托管子集化字体（`display: swap`）；路由级 `dynamic(() => ..., { ssr: false })` 隔离重组件（编辑器、图表）；`(site)` 与 `(admin)` 各自独立 layout，后台代码不进前台 bundle。

---

## 11. 环境变量清单

```bash
# ---- 运行时 ----
NODE_ENV=development
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ---- 数据库 ----
DATABASE_URL="postgresql://user:pass@localhost:5432/personal_site?schema=public"
# SQLite 降级：file:./dev.db

# ---- 鉴权（生产必须替换，用 openssl rand -base64 48 生成）----
JWT_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# ---- 存储 ----
STORAGE_DRIVER=local                 # local | s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=personal-site
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=https://cdn.example.com

# ---- 邮件（可选，二期）----
RESEND_API_KEY=
MAIL_FROM=hi@example.com

# ---- 可选集成 ----
NEXT_PUBLIC_ANALYTICS_ID=            # 如 Umami / Vercel Analytics
REVALIDATE_SECRET=                   # 用于外部触发 /api/revalidate
```

**规则**：只有 `NEXT_PUBLIC_` 前缀的变量能进客户端。服务端变量集中在 `lib/env.ts` 用 Zod 校验，启动即失败（fail fast），避免运行时才发现缺变量。

---

## 12. 部署拓扑

### 方案 A（推荐）· Vercel

```
GitHub  main 分支 push
   → Vercel 自动构建（Node 20）
   → Preview 部署（PR）/ Production 部署（main）
   → Edge CDN 全球分发
数据库   Neon Postgres（Serverless，免费额度 0.5GB 存储）
存储     Cloudflare R2（免费 10GB + 零出口费）
定时任务 Vercel Cron → /api/cron/backup（每日 pg_dump）
域名     Vercel Domains + 自动 Let's Encrypt
```
**优点**：零运维、自动 HTTPS/CDN/预览环境。**代价**：绑定平台，Serverless 冷启动。

### 方案 B · 自建 VPS（备选）

```
Nginx（TLS 终止 + 反向代理 + gzip/brotli）
  → Next.js standalone 容器（Docker, node:20-alpine）
  → Postgres 容器（挂载卷）
  → MinIO 或本地磁盘存文件
Certbot 自动续期 · docker compose 一键起停
```
**优点**：完全可控、成本固定。**代价**：需要自己管备份、监控、安全更新。

### CI/CD 检查点（两方案通用）

```
lint → typecheck → unit test → build → e2e smoke → migrate deploy → deploy
```
`prisma migrate deploy` 必须在部署后、切换流量前执行；迁移脚本一律向后兼容（先加列、后删列，分两次发版）。

---

## 13. 可观测性

| 维度 | 方案 |
|---|---|
| 错误追踪 | Sentry（免费额度足够），捕获 RSC 与 Route Handler 异常 |
| 结构化日志 | `pino` 输出 JSON：`{ level, time, requestId, userId, route, durationMs }` |
| 请求 ID | middleware 注入 `x-request-id`，贯穿日志与错误上报 |
| 性能 | Vercel Analytics + `useReportWebVitals` 打点 |
| 业务指标 | `AuditLog` 表 + 仪表盘聚合（发布数、访问量、模块开关历史） |
| 健康检查 | `GET /api/health` → 检查 DB 连通性与版本 |

---

## 14. 相关文档

- 数据结构与字段定义 → [02-data-model.md](02-data-model.md)
- 接口契约 → [03-api-spec.md](03-api-spec.md)
- 后台交互设计 → [04-admin-console.md](04-admin-console.md)
- 前台页面与响应式 → [05-frontend-ia.md](05-frontend-ia.md)
