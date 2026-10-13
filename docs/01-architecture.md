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
                        │      CDN / Edge (EdgeOne)      │
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
  │ Neon/自建  │            │ Supabase / 本地│         │  Resend      │
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
| **Prisma** | 类型安全、迁移工具成熟、`Json`/`enum`/数组支持好；开发生产统一PostgreSQL | 复杂查询（全文检索、聚合）会退化到 `$queryRaw` |
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
| `/` 首页 | ISR | 300s + `revalidateTag('content')` | 事件失效保证保存后5秒内新请求更新；300s TTL仅兜底，不放宽SLA |
| `/logs` `/logs/[id]` | ISR | 600s + `revalidateTag('log')` | 日志更新频率低 |
| `/articles` | ISR | 600s + `revalidateTag('article')` | |
| `/articles/[slug]` | ISR + `generateStaticParams` | 发布会 `revalidateTag('article')` | 已发布文章预渲染 |
| `/portfolio` `/portfolio/[slug]` | ISR | 3600s + `revalidateTag('project')` | 极少变动 |
| `/timeline` | ISR | 3600s + `revalidateTag('timeline')` | |
| `/about` | ISR | 3600s + `revalidateTag('profile')` | |
| `/search` | Dynamic（`?q=`） | 不缓存 | 依赖查询参数 |
| `/admin/**` | Dynamic + `no-store` | — | 必须实时，且不可被 CDN 缓存 |
| `/api/v1/**`（公开） | `no-store`（一期公开接口） | tag 失效 | 不叠加CDN缓存，保证开关合同 |
| `/api/v1/admin/**` | `no-store` | — | |
| `sitemap.xml` / `rss.xml` | Dynamic + no-store | 每次请求读取公共边界 | |

### 缓存失效链路

```
后台保存内容
  → service 层写库成功
  → revalidateTag('article')        // 前台 ISR 缓存失效
  → 写 AuditLog
  → 返回新数据
客户端 TanStack Query invalidateQueries(['admin','articles'])
```

service写库事务返回失效事件，由Next适配层执行revalidateTag；脚本通过受鉴权重验证入口处理，不能假设处于Next请求上下文。保存后5秒仅指新请求，已打开/预取页面需主动刷新。模块/设置公开读取no-store，避免CDN再叠加失效窗口；时间线同时失效profile/content，Profile失效content，分类/标签失效article/content，发布失效RSS/sitemap。

RSC在同一请求内通过React cache复用getPublicSite读取；不跨请求保留配置，普通服务/API调用也不引入进程缓存。客户端导航只接收key/route/navLabel/name/navVisible，避免完整栏目配置重复进入RSC载荷。

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
  → EdgeOne转发动态请求（当前force-dynamic/no-store，不缓存私有内容）
  → Node Runtime 执行 RSC
      → articleService.getBySlug(slug)
          → 校验模块开关（Module.enabled），关闭则 notFound()
          → prisma.article.findFirst({ where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() }, deletedAt: null } })
          → 组装 DTO（含 tags / category / 上下篇 / 相关文章）
      → 渲染 HTML + RSC Payload → no-store响应
  → 浏览器逐步注水（Hydration），仅交互岛需要 JS
```

**收益**：文章详情页首屏 JS 体积可控制在 ≤135KB（gzip，需实测），无客户端数据请求。

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

### 6.1 Token与会话
AT为HS256 JWT，15分钟，载荷包含sub/sid/role/name/iat/exp。httpOnly at Cookie，Secure（生产）、SameSite=Lax、Path=/。RT随机32字节、哈希入Session、7天；httpOnly rt，SameSite=Strict、Path=/api/v1/auth。
登录与刷新同时设置非敏感 `session_hint=1`（HttpOnly、Secure沿上述逻辑、SameSite=Lax、Path=/、7天），所有清凭证出口同步清除。它仅供middleware判断可能仍可刷新，任何客户端可伪造且不代表认证；AT过期而RT仍在时不提前挡住管理壳。API不使用此标记或Cookie存在门禁，service仍验证真实AT sid会话及用户权限。

AT并非仅靠短过期撤销：每次管理数据访问在service校验sid对应会话未撤销/过期且用户存在、isActive=true；权限从当前用户读取。Session具有rotatedAt/successorId/rotationReply（加密后继凭证）支持轮转。

### 6.2 登录与原子刷新
登录按IP/email双维度共享PostgreSQL限流，失败统一信息。刷新在事务中锁定/条件更新旧Session并建立后继；首次轮转写rotatedAt和successorId，10秒内重复旧RT返回同一加密保存的后继凭证，避免多标签误判。超过宽限旧RT重放撤销该用户全部会话并审计。加密回复只保留宽限所需时间且不得日志输出。登出/停用/改密码按会话撤销合同执行。

### 6.3 Edge兼容middleware + Node路由服务与权威授权
Next.js15.5使用middleware默认Edge运行时（不设置页面专用runtime字段）；每请求CSP与轻量登录判断用Web API，历史路径由同源Node路由查询服务读取PostgreSQL后交给middleware返回301。固定首页不查询别名；任何权威数据授权仍在service执行。详18-edgeone-runtime-adaptation.md。ADMIN、EDITOR、VIEWER均可进入其授权后台，不能入口统一拒绝VIEWER。每个RSC/REST/Server Action/脚本数据入口复用service权限检查。AT过期页面保留安全站内next，进入静默刷新恢复流程；API401由客户端刷新后最多重试一次，草稿不丢失。所有写请求验证Origin。



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
  route      String   @unique   // 当前栏目路径（可改）
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
    "bio": true, "advantages": true, "skills": true, "experience": true, "services": true, "contact": true
  }
}
```

> **配置PATCH**：已知嵌套键按层合并，数组整体替换，可空字段null清空；严格拒绝未知键及危险对象键，合并后重新校验完整配置。见03 §5.3。

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
| 顶部导航 / 移动 Tab Bar | 显示「日志」 | 消失（`enabled=false自动过滤，无需改navVisible） |
| 首页日志卡片区 | 显示最新 5 条 | 整块移除，相邻区块上移 |
| `/logs` 及 `/logs/[id]` | 200 | 404 |
| `/api/v1/logs` | 200 + 数据 | 200 + 空数组（避免前端报错） |
| `sitemap.xml` | 含日志 URL | 移除 |
| `rss.xml` | 含日志条目 | 移除 |
| 后台菜单 | 显示「日志管理」 | 置灰 + 标「已关闭」，**仍可进入管理已存内容** |
| 数据库 | — | **数据保留，不删除**（可随时重新开启） |

> **设计原则：开关是「隐藏」而非「删除」。** 关闭模块绝不级联删除内容，这样误操作可以一键恢复。

---

## 8. 文件存储与上传
本地LocalDriver仅开发部署（包含localhost的next start验收），文件落地私有`.storage/media`，经`GET /api/v1/media/:id`按已登记Media读取；公网生产拒绝Local写入，绝不写应用public目录。生产目标为Supabase Storage（现有R2Driver待S3适配），公开桶S3_BUCKET与临时私有桶S3_PRIVATE_BUCKET必须不同，开发/预览/生产各自隔离桶与密钥。私有桶禁止公网访问，公开桶只存校验通过的media前缀；前缀命名本身不提供私有权限。开发POST /api/v1/admin/media/upload接收multipart；生产POST /api/v1/admin/media/upload-intent申请10分钟临时票据和限时直传凭证，浏览器直传私有桶，POST /api/v1/admin/media/confirm确认。

confirm必须核验用户归属、对象magic/真实MIME、实际大小、sha256和对象key，并原子消费票据；SVG/HTML等主动类型明确拒绝，避免脚本和外链执行。允许PNG/JPEG/WebP/GIF/AVIF、MP4/WebM、PDF，图片完整解码所有帧，动画最多500帧且全帧合计≤4000万像素；校验后的字节另写公开随机key，防止临时对象被覆盖的竞态。公开写入前独立提交COMPENSATE补偿票据，登记Media成功时在同一事务移除；DB回滚/进程中断/存储删除失败也保留公开key供清理。失败清理临时对象；清理失败保留UploadIntent供POST /api/v1/admin/media/cleanup重试并记录审计。图片10MB、视频50MB、文档20MB；生产文件不经过浏览器到托管函数的大请求体。删除前扫描所有正文、封面、图集、Profile与Setting引用，含软删内容，引用中拒绝删除。DB删除和持久清理队列原子提交；存储删除失败返回cleanupPending=true，保留key重试。


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
| 敏感信息泄露 | 环境变量只走 `.env`（`.env` 入 `.gitignore`）；客户端代码禁止 import `lib/env.ts`（server-only强制边界） |
| 后台被爬 | `/admin` 加 `X-Robots-Tag: noindex`；`robots.txt` Disallow |
| 数据丢失 | 托管数据库备份或独立任务运行pg_dump，另备份媒体并演练恢复；JSON不是完整备份 |

### 安全响应头

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-每请求随机值' 'strict-dynamic'; object-src 'none'; frame-ancestors 'none';
```
CSP由Edge兼容middleware生成每请求nonce并同时透传请求/响应，启动、主题和JSON-LD脚本带nonce；CSS保留inline以支持变量与编辑器。预览同样受保护。完整策略与本地/云端边界见13-local-release-readiness.md。

---

## 10. 性能预算

| 指标 | 移动端目标 | PC 目标 |
|---|---|---|
| LCP | ≤ 2.0s（4G） | ≤ 1.2s |
| INP | ≤ 150ms | ≤ 100ms |
| CLS | ≤ 0.05 | ≤ 0.05 |
| 首屏 JS（文章详情） | ≤ 135KB gzip | 同 |
| 首屏 JS（后台登录页） | ≤ 110KB gzip | 同 |
| **动效相关 JS** | **≤ 28KB gzip**，static关闭时不下载库 | 同 |
| 单页图片总重 | ≤ 800KB | ≤ 1.5MB |
| Lighthouse Performance | ≥ 85 | ≥ 95 |
| Lighthouse A11y / Best Practices / SEO | ≥ 95 | ≥ 100 |

> **动效预算单列一行**，因为它最容易失控：一个"顺手引入 Framer Motion 全家桶"就能吃掉全部预算。约束方式见 [08-motion-system.md §6](08-motion-system.md) —— 首屏CSS，离屏编排按需加载，移动降档，关闭时不下载库。CI 中构建后校验 chunk 体积，超过 28KB 直接失败。

落地手段：`next/image` 自动 AVIF/WebP + 响应式 `sizes`；`next/font` 自托管子集化字体（`display: swap`）；路由级 `dynamic(() => ..., { ssr: false })` 隔离重组件（编辑器、图表）；`(site)` 与 `(admin)` 各自独立 layout，后台代码不进前台 bundle。

---

## 11. 环境变量清单

```bash
# ---- 运行时 ----
NODE_ENV=development
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# ---- 数据库 ----
DATABASE_URL="postgresql://user:pass@localhost:5432/personal_site?schema=public"
# 测试独立URL，库名必须_test后缀
TEST_DATABASE_URL="postgresql://dev:dev@localhost:5432/personal_site_test?schema=public"

# ---- 鉴权（生产必须替换，用 openssl rand -base64 48 生成）----
JWT_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# ---- 存储 ----
STORAGE_DRIVER=local                 # local | s3
S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
S3_REGION=ap-southeast-1
S3_BUCKET=personal-site
S3_PRIVATE_BUCKET=personal-site-private
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

### 方案 A · EdgeOne国际站CLI托管（已部署并通过云功能验收）

my-site为直接上传Upload项目，CLI1.6.41、production dp2ry69pr5hy已上线。正式Linux构建后清洗环境并适配每请求平台fetch；Edge兼容middleware处理nonce/301，Node服务执行数据库查询及权威授权。构建Node24.18.0，实际函数Node20.19与Prisma RHEL/OpenSSL1.1引擎；真实登录、媒体、三角色、发布和多次改路径已通过，不能以API Token或构建成功代替这些验收。

当前资源为Supabase新加坡PG17.11（事务池运行、独立迁移连接）、公开媒体/私有临时Storage两桶、Cron+pg_net+Vault分钟发布、每日维护及五分钟健康检查。8迁移、运行最小权限和独立本机备份恢复已验证；自动独立备份及外部告警尚未配置，不承诺免费额度服务保障。发布目录隔离.env，不上传初始化/迁移/CLI凭据，详15。

### 方案 B · Node24源站 + EdgeOne加速（备选）

若未来Pages不能保持现有路由/数据库合同，应用运行在Node24服务器或容器，EdgeOne接入源站加速与防护；PostgreSQL与对象存储保持独立的接口边界，备份、监控及分钟调度需实际配置。现有项目未设置standalone产物，不能将此备选描述为已可一键部署。

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
| 性能 | Lighthouse实测；后续Web Vitals采集方案待配置，不能把未接入服务当作运行能力 |
| 业务指标 | `AuditLog` 表 + 仪表盘聚合（发布数、访问量、模块开关历史） |
| 健康检查 | `GET /api/health` → 应用版本与DB up/down，无缓存；故障503，不返回数据库版本/连接/原始异常 |

---

## 14. 相关文档

- 数据结构与字段定义 → [02-data-model.md](02-data-model.md)
- 接口契约 → [03-api-spec.md](03-api-spec.md)
- 后台交互设计 → [04-admin-console.md](04-admin-console.md)
- 前台页面与响应式 → [05-frontend-ia.md](05-frontend-ia.md)

## 一期动态路由与公开边界
公开查询统一检查模块及子类型开关、status=PUBLISHED、publishedAt<=now、deletedAt=null；所有首页/feed/详情/搜索/RSS/sitemap使用相同公开过滤器。

Module.route数据库唯一。Edge兼容middleware调用Node路由服务解析历史路径；RouteAlias永久保留历史路径，301直达当前路径，保留详情后缀/query；拒绝保留路径和子路径、模块路径嵌套、别名抢占/循环。关闭模块的历史地址也不可绕过开关。分钟调度触发到期发布和关联缓存失效。
