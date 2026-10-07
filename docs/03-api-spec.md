# 03 · 接口契约（API Spec）

[← 上一篇：数据模型](02-data-model.md) · [返回 README](../README.md) · [下一篇：后台设计 →](04-admin-console.md)

**Base URL**：`/api/v1`
**Content-Type**：`application/json; charset=utf-8`（上传接口为 `multipart/form-data`）
**认证**：httpOnly Cookie 自动携带；也支持 `Authorization: Bearer <accessToken>` 供脚本/Postman 调试

---

## 1. 通用约定

### 1.1 成功响应

```jsonc
// 单条
{
  "success": true,
  "data": { "id": "...", "title": "..." }
}

// 列表（自动带 meta）
{
  "success": true,
  "data": [ { "id": "..." }, { "id": "..." } ],
  "meta": {
    "page": 1,
    "pageSize": 10,
    "total": 137,
    "totalPages": 14,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### 1.2 失败响应

```jsonc
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [
      { "path": "title", "message": "标题不能为空" },
      { "path": "slug",  "message": "slug 只能包含小写字母、数字和连字符" }
    ],
    "requestId": "req_01HQZX..."
  }
}
```

> `message` 面向开发者；后台 UI 应优先按 `error.code` 映射到中文提示，`details` 用于定位表单字段。

### 1.3 错误码表

| HTTP | code | 含义 | 前端处理建议 |
|:--:|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod 校验失败 | 按 `details[].path` 标红字段 |
| 400 | `BAD_REQUEST` | 参数语义错误（如日期区间颠倒） | 全局 toast |
| 401 | `UNAUTHORIZED` | 未登录 / Access Token 过期 | 调 `/auth/refresh` 重试一次，仍失败则跳登录 |
| 401 | `INVALID_CREDENTIALS` | 邮箱或密码错误 | 表单级错误，不区分是哪个错 |
| 401 | `TOKEN_REUSED` | Refresh Token 重放，全部会话已撤销 | 强制跳登录并提示"账号安全异常" |
| 403 | `FORBIDDEN` | 已登录但权限不足 | toast「无权限执行此操作」 |
| 403 | `ACCOUNT_DISABLED` | 账号被停用 | 跳登录并提示联系管理员 |
| 404 | `NOT_FOUND` | 资源不存在 | 404 页面 |
| 404 | `MODULE_DISABLED` | 所属模块已被后台关闭 | 前台按 404 处理 |
| 409 | `CONFLICT` | 唯一约束冲突（slug / email 重复） | 字段级错误，提示换一个 |
| 410 | `GONE` | 内容已彻底删除 | 提示"内容已不存在" |
| 413 | `PAYLOAD_TOO_LARGE` | 上传文件超限 | 提示最大体积 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 文件类型不允许 | 提示允许的格式 |
| 422 | `BUSINESS_RULE_VIOLATION` | 业务规则不满足（如删除有子分类的分类） | 展示 `message` |
| 429 | `RATE_LIMITED` | 触发限流 | 展示 `Retry-After` 秒数倒计时 |
| 500 | `INTERNAL_ERROR` | 服务端异常 | 通用错误页 + requestId 便于排查 |
| 503 | `SERVICE_UNAVAILABLE` | 维护中 / DB 不可用 | 维护页 |

### 1.4 列表通用查询参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码，从 1 开始 |
| `pageSize` | int | 10 | 每页条数，**上限 100**，超出则截断 |
| `q` | string | — | 关键词搜索（标题 + 摘要 + 正文） |
| `sort` | string | 按资源默认 | 如 `-publishedAt`（`-` 前缀降序），多字段逗号分隔 |
| `status` | enum | — | `DRAFT` / `PUBLISHED` / `ARCHIVED`，多个用逗号分隔 |
| `tag` | string | — | 标签 slug，多个用逗号分隔（AND 语义） |
| `from` / `to` | ISO date | — | 时间范围（`logDate` / `publishedAt` / `createdAt`，按资源而定） |
| `fields` | string | — | 稀疏字段集，如 `fields=id,title,slug`（列表页减包体） |

> **排序白名单**：每个资源只接受白名单内的排序字段，其余一律回退默认。杜绝 `sort=passwordHash` 这类探测。

### 1.5 限流

| 范围 | 限制 | 超出响应 |
|---|---|---|
| `POST /auth/login` | 5 次 / 15 分钟 / (IP + email) | 429 + `Retry-After` |
| `POST /auth/refresh` | 30 次 / 15 分钟 / IP | 429 |
| 公开 GET 接口 | 300 次 / 15 分钟 / IP | 429 |
| 后台写接口 | 120 次 / 15 分钟 / 用户 | 429 |
| 上传接口 | 20 次 / 小时 / 用户 | 429 |

实现：一期使用共享PostgreSQL RateLimit窗口记录与原子计数；所有实例共用，不以进程Map承担生产限流。

### 1.6 缓存头

```
公开 GET：  Cache-Control: no-store（一期公开接口，不叠加CDN缓存）
后台接口：  Cache-Control: no-store, no-cache, must-revalidate
登录接口：  Cache-Control: no-store
```

---

## 2. 接口清单总览

### 公开接口（无需认证）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/site` | 站点配置 + 模块开关（前台 bootstrap，一次拿全） |
| GET | `/api/v1/modules` | 模块列表（仅返回启用项） |
| GET | `/api/v1/search` | 全局搜索（跨文章/日志/作品） |
| GET | `/api/v1/tags` | 标签列表（含使用计数） |
| GET | `/api/v1/categories` | 文章分类树 |
| GET | `/api/v1/articles` | 文章列表 |
| GET | `/api/v1/articles/:slug` | 文章详情 |
| GET | `/api/v1/logs` | 日志列表 |
| GET | `/api/v1/logs/:id` | 日志详情 |
| GET | `/api/v1/logs/calendar` | 日志日历（按年月聚合，供日历视图） |
| GET | `/api/v1/projects` | 作品集列表 |
| GET | `/api/v1/projects/:slug` | 作品详情 |
| GET | `/api/v1/timeline` | 时间线条目 |
| GET | `/api/v1/profile` | 关于我 |
| GET | `/api/v1/feed` | 首页聚合流（混合文章 + 日志 + 作品精选） |
| POST | `/api/v1/views` | 上报浏览（`{ resource, id }`） |
| GET | `/api/health` | 健康检查（不在 v1 下） |

### 认证接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/login` | 登录 |
| POST | `/api/v1/auth/refresh` | 刷新令牌 |
| POST | `/api/v1/auth/logout` | 登出（撤销当前会话） |
| POST | `/api/v1/auth/logout-all` | 登出全部设备 |
| GET | `/api/v1/auth/me` | 当前用户信息 |
| POST | `/api/v1/auth/change-password` | 修改密码 |

### 后台接口（按permission授权；VIEWER可读其授权仪表盘/内容/审计，写需EDITOR，标注 ★ 者需ADMIN）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/stats` | 仪表盘统计 |
| — | `/api/v1/admin/articles` | `GET` 列表 / `POST` 新建 |
| — | `/api/v1/admin/articles/:id` | `GET` 详情 / `PATCH` 更新 / `DELETE` 软删除 |
| POST | `/api/v1/admin/articles/:id/restore` | 从回收站恢复 |
| DELETE | `/api/v1/admin/articles/:id/purge` ★ | 彻底删除 |
| POST | `/api/v1/admin/articles/bulk` | 批量操作（发布/下架/删除/打标签） |
| PATCH | `/api/v1/admin/articles/reorder` | 批量调整置顶顺序 |
| — | `/api/v1/admin/logs`（同构） | 同上全套 |
| — | `/api/v1/admin/projects`（同构） | 同上全套 |
| — | `/api/v1/admin/timeline`（同构） | 同上全套 |
| — | `/api/v1/admin/timeline/reorder` | 拖拽排序（批量写 order） |
| GET/PATCH | `/api/v1/admin/profile` | 关于我（单例） |
| GET | `/api/v1/admin/modules` | 模块列表（含禁用项） |
| PATCH ★ | `/api/v1/admin/modules/:key` | **模块开关 / 改名 / 改路由 / 改配置** |
| PATCH ★ | `/api/v1/admin/modules/reorder` | 导航排序 |
| GET | `/api/v1/admin/settings` | 全部设置（按 group 分组） |
| PATCH ★ | `/api/v1/admin/settings/:group` | 批量更新某组设置 |
| GET ★ | `/api/v1/admin/settings/motion` | **动效配置**：返回 config + 4 个预设 + 性能预估（见 §5.8） |
| PATCH ★ | `/api/v1/admin/settings/motion` | 保存动效配置（Zod + 交叉规则，可能带 `warnings`） |
| GET | `/api/v1/admin/media` | 媒体列表 |
| POST | `/api/v1/admin/media/upload` | 上传 |
| PATCH | `/api/v1/admin/media/:id` | 改 alt / folder |
| DELETE | `/api/v1/admin/media/:id` | 删除（含存储文件） |
| — | `/api/v1/admin/categories` | 分类 CRUD（含 `/reorder`） |
| — | `/api/v1/admin/tags` | 标签 CRUD（含合并 `/merge`） |
| GET | `/api/v1/admin/audit-logs` | 审计日志 |
| — | `/api/v1/admin/users` ★ | 用户 CRUD |
| GET | `/api/v1/admin/export` ★ | 全站导出 JSON |
| POST | `/api/v1/admin/import` ★ | 导入 |

---

## 3. 公开接口详情

### 3.1 `GET /api/v1/site`

前台首屏引导接口。一次拿全站点配置与模块开关，避免多次往返。

**响应**
```jsonc
{
  "success": true,
  "data": {
    "site": {
      "name": "Puly 的站",
      "description": "前端工程师 · 写代码也写字",
      "logo": "/logo.svg",
      "favicon": "/favicon.ico",
      "defaultTheme": "system",
      "locale": "zh-CN",
      "footer": { "copyright": "© 2025 Puly", "icp": "京ICP备xxx号", "links": [] },
      "social": { "github": "https://github.com/...", "email": "hi@example.com" }
    },
    "modules": [
      { "key": "log", "name": "日志", "navLabel": "日志", "route": "/logs", "icon": "notebook-pen", "navOrder": 1, "config": { "pageSize": 10 } },
      { "key": "portfolio", "name": "作品集", "route": "/portfolio", "icon": "briefcase", "navOrder": 2, "config": { "pageSize": 12 } }
    ]
  }
}
```
**缓存**：`no-store`，tag `setting` + `module`。

---

### 3.2 `GET /api/v1/articles`

**查询参数**：通用参数 + `category`（分类 slug）+ `isTop`（boolean）+ `author`

**响应**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "slug": "why-i-choose-nextjs",
      "title": "我为什么选择 Next.js",
      "summary": "从渲染模型到工程化的一次梳理…",
      "coverImage": "https://cdn.example.com/covers/1.webp",
      "publishedAt": "2025-01-15T08:00:00.000Z",
      "readingTime": 8,
      "wordCount": 3200,
      "viewCount": 1024,
      "isTop": true,
      "category": { "id": "clx...", "name": "技术", "slug": "tech", "color": "#3b82f6" },
      "tags": [ { "id": "clx...", "name": "Next.js", "slug": "nextjs" } ]
    }
  ],
  "meta": { "page": 1, "pageSize": 10, "total": 42, "totalPages": 5, "hasNext": true, "hasPrev": false }
}
```
> 列表**不返回 `content`**（正文体积大）。正文只在详情接口返回。

---

### 3.3 `GET /api/v1/articles/:slug`

**响应（在列表项基础上增加）**
```jsonc
{
  "success": true,
  "data": {
    "content": "# Markdown 正文…",
    "html": "<h1>…</h1>",            // 服务端预渲染，免去客户端解析
    "toc": [ { "depth": 2, "text": "渲染模型", "id": "渲染模型" } ],
    "seo": { "title": "…", "description": "…", "keywords": "…", "ogImage": "…" },
    "author": { "id": "...", "name": "Puly", "avatar": "..." },
    "prev": { "slug": "…", "title": "…" },
    "next": { "slug": "…", "title": "…" },
    "related": [ { "slug": "…", "title": "…", "coverImage": "…" } ]
  }
}
```

**错误**：`404 NOT_FOUND`（不存在或未发布）、`404 MODULE_DISABLED`（文章模块被关闭）。

**上下篇算法**：同分类下按 `publishedAt` 排序取相邻。

---

### 3.4 `GET /api/v1/logs`

**查询参数**：通用参数 + `type`（`DAILY|EVENT|SUMMARY`）+ `year`（int）+ `month`（1-12）+ `mood`

**响应**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "title": "重构了首页的动画",
      "summary": "把 Framer Motion 换成了纯 CSS…",
      "type": "DAILY",
      "logDate": "2025-01-15",
      "mood": "happy",
      "weather": "sunny",
      "location": "杭州",
      "coverImage": null,
      "images": [],
      "isPinned": false,
      "tags": [{ "name": "重构", "slug": "refactor" }]
    }
  ],
  "meta": { "...": "..." }
}
```

### 3.5 `GET /api/v1/logs/calendar?year=2025`

供移动端日历视图与 PC 端侧边日历。

```jsonc
{
  "success": true,
  "data": {
    "year": 2025,
    "months": [
      { "month": 1, "count": 12, "days": [1, 3, 4, 7, 15, 16, 22] },
      { "month": 2, "count": 8,  "days": [2, 5, 9] }
    ],
    "total": 86
  }
}
```

---

### 3.6 `GET /api/v1/projects`

**查询参数**：通用参数 + `type`（`GAME|REPO|SKILL|OTHER`）+ `featured`（boolean）+ `tech`（技术栈名）

**响应**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "slug": "pixel-runner",
      "title": "Pixel Runner",
      "subtitle": "一个用 Canvas 写的横版跑酷",
      "description": "纯手写物理引擎，无游戏框架依赖…",
      "coverImage": "https://cdn.example.com/p/pixel-runner.webp",
      "type": "GAME",
      "techStack": ["TypeScript", "Canvas", "Vite"],
      "role": "独立开发",
      "highlights": ["60fps 稳定运行", "手写碰撞检测"],
      "links": { "github": "https://github.com/...", "demo": "https://..." },
      "startDate": "2024-09-01T00:00:00.000Z",
      "endDate": "2024-12-01T00:00:00.000Z",
      "featured": true,
      "viewCount": 320,
      "tags": []
    }
  ],
  "meta": { "...": "..." }
}
```
> 作品**必有卡片信息**，`content` 详情可选（为 null 时前台不渲染详情页正文区，只展示卡片 + 外链）。

### 3.7 `GET /api/v1/timeline`

**查询参数**：`type` / `from` / `to`

**响应**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "title": "高级前端工程师",
      "subtitle": "商业化中台组",
      "type": "WORK",
      "organization": "某科技有限公司",
      "location": "杭州",
      "startDate": "2023-03-01T00:00:00.000Z",
      "startPrecision": "MONTH", "endPrecision": "MONTH",
      "endDate": null,
      "isCurrent": true,
      "logo": "https://cdn.example.com/logos/x.webp",
      "description": "负责…",
      "tags": ["React", "Node.js"],
      "highlights": ["搭建了公司级组件库，覆盖 12 条业务线", "首屏性能优化 40%"]
    }
  ],
  "meta": { "total": 9 }
}
```
**服务端排序**：`isCurrent DESC, startDate按direction, 同日期order ASC, id ASC`。

---

### 3.8 `GET /api/v1/profile`

```jsonc
{
  "success": true,
  "data": {
    "name": "Puly",
    "headline": "5 年经验前端工程师",
    "avatar": "https://cdn.example.com/avatar.webp",
    "bio": "## 你好\n我是…",
    "jobTitle": "高级前端工程师",
    "company": "某公司",
    "location": "杭州",
    "yearsOfExp": 5,
    "email": "hi@example.com",          // 仅contactVisible=true；false省略整个email字段
    "phone": null,                     // 仅contactVisible=true；false省略整个phone字段
    "socials": [ { "platform": "github", "label": "GitHub", "url": "https://github.com/...", "icon": "github" } ],
    "advantages": [ { "title": "工程化落地能力", "description": "…", "icon": "wrench" } ],
    "skills": [ { "category": "前端框架", "items": [ { "name": "React", "level": 5, "years": 5 } ] } ],
    "services": [ { "title": "前端咨询", "description": "…", "icon": "message-circle" } ],
    "resumeUrl": "/resume.pdf",
    "experience": [ /* 复用 TimelineItem 中 type=WORK 且 showOnAbout=true 的条目 */ ]
  }
}
```
> **注意 `experience` 字段**：它来自 `TimelineItem` 表，不是 `Profile` 表 —— 实现 D5 决策「单一数据源」。

---

### 3.9 `GET /api/v1/feed`

首页聚合接口（RSC 也可直接调 service，此接口供客户端渲染或第三方用）。

```jsonc
{
  "success": true,
  "data": {
    "featuredProjects": [ /* Project[]，featured=true，取 4 条 */ ],
    "latestArticles":   [ /* Article[]，取 5 条 */ ],
    "latestLogs":       [ /* Log[]，取 5 条 */ ],
    "timelinePreview":  [ /* TimelineItem[]，取 3 条 */ ]
  }
}
```
**关键行为**：**被关闭或禁止首页露出的模块对应字段返回空数组**。各字段数量使用当前模块的home.limit，不固定为示例条数。该接口与首页RSC、`GET /api/v1/home`共用公开过滤与联系方式边界；`/home`另外返回profile、按home.order排序的sections及局部错误信息。

---

### 3.10 `GET /api/v1/search?q=&type=&page=`

```jsonc
{
  "success": true,
  "data": [
    {
      "type": "article",
      "id": "clx...",
      "title": "我为什么选择 Next.js",
      "excerpt": "…<em>Next.js</em> 的渲染模型…",   // 命中词已 <em> 包裹
      "url": "/articles/why-i-choose-nextjs",
      "publishedAt": "2025-01-15T08:00:00.000Z",
      "score": 0.87
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 7, "query": "next" }
}
```
实现：一期 `ILIKE '%q%'` + `Promise.all` 跨表查询后按时间合并；单次最多返回 50 条。`q` 长度 < 2 时直接返回空。

---

## 4. 认证接口详情

### 4.1 `POST /api/v1/auth/login`

```jsonc
// 请求
{ "email": "admin@example.com", "password": "********" }

// 200
{
  "success": true,
  "data": {
    "user": { "id": "clx...", "name": "Puly", "email": "admin@example.com", "role": "ADMIN", "avatar": null },
    "expiresIn": 900
  }
}
// Set-Cookie: at=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900
// Set-Cookie: rt=...; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800
// Set-Cookie: session_hint=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

**错误**
- `401 INVALID_CREDENTIALS` — 邮箱或密码错误（**不区分具体原因**）
- `403 ACCOUNT_DISABLED` — 账号被停用
- `429 RATE_LIMITED` — 触发限流，响应头带 `Retry-After: 900`

---

### 4.2 `POST /api/v1/auth/refresh`

无请求体，依赖 `rt` Cookie。

**成功**：PostgreSQL事务原子轮转并记录rotatedAt/successorId/加密rotationReply；10秒内相同旧RT并发请求返回同一后继AT/RT。

**错误** `401 TOKEN_REUSED`：超过10秒宽限的旧RT被再次使用 → **撤销该用户全部会话**、写 AuditLog、返回错误。这是标准的 refresh token 重放防护。

---

### 4.3 `GET /api/v1/auth/me`

```jsonc
{
  "success": true,
  "data": {
    "id": "clx...",
    "name": "Puly",
    "email": "admin@example.com",
    "role": "ADMIN",
    "avatar": null,
    "permissions": [
      "content:read", "content:write", "content:publish",
      "module:write", "setting:write", "media:write",
      "user:manage", "audit:read", "data:export"
    ]
  }
}
```
> 前端用 `permissions` 数组控制按钮显隐，**不要在前端硬编码角色名**，否则角色规则一变就得改前端。

---

### 4.4 `POST /api/v1/auth/change-password`

```jsonc
{ "currentPassword": "old", "newPassword": "new-strong-one" }
```
规则：长度 ≥ 8，含大小写字母与数字；新密码不能与旧密码相同。**成功后撤销除当前会话外的所有会话。**

---

## 5. 后台接口详情

### 5.1 通用 CRUD 范式（以 Article 为例）

| 操作 | 方法与路径 | 权限 | 请求体要点 |
|---|---|---|---|
| 列表 | `GET /admin/articles` | `content:read` | 通用参数 + `includeDeleted`（boolean，回收站） |
| 详情 | `GET /admin/articles/:id` | `content:read` | 返回完整字段（含 `content`、`deletedAt`） |
| 新建 | `POST /admin/articles` | `content:write` | `ArticleCreateSchema` |
| 更新 | `PATCH /admin/articles/:id` | `content:write` | 部分更新，未传字段不变 |
| 删除 | `DELETE /admin/articles/:id` | `content:write` | 软删除，返回 204 |
| 恢复 | `POST /admin/articles/:id/restore` | `content:write` | 清空 `deletedAt` |
| 彻底删 | `DELETE /admin/articles/:id/purge` | `content:write` + ADMIN | 物理删除，不可恢复 |
| 批量 | `POST /admin/articles/bulk` | `content:write` | 见 §5.2 |
| 排序 | `PATCH /admin/articles/reorder` | `content:write` | `{ items: [{ id, order }] }` |

**`ArticleCreateSchema`（Zod，前后端共用）**
```ts
export const ArticleCreateSchema = z.object({
  title:       z.string().min(1, '标题不能为空').max(200),
  slug:        z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能小写字母、数字、连字符')
                 .optional(),                        // 不传则从 title 自动生成
  summary:     z.string().max(500).optional(),
  content:     z.string().min(1, '正文不能为空'),
  coverImage:  z.string().url().or(z.string().startsWith('/')).optional(),
  status:      z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
  publishedAt: z.coerce.date().optional(),           // status=PUBLISHED 且未传则取 now
  isTop:       z.boolean().default(false),
  allowComment:z.boolean().default(true),
  categoryId:  z.string().cuid().nullable().optional(),
  tagIds:      z.array(z.string().cuid()).max(10).default([]),
  seoTitle:       z.string().max(60).optional(),
  seoDescription: z.string().max(160).optional(),
  seoKeywords:    z.string().max(200).optional(),
  ogImage:        z.string().optional(),
})
export const ArticleUpdateSchema = ArticleCreateSchema.partial().extend({
  revision: z.number().int().nonnegative(),
  summary: z.string().max(500).nullable().optional(),
  coverImage: z.string().nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  seoTitle: z.string().max(60).nullable().optional(),
  seoDescription: z.string().max(160).nullable().optional(),
  seoKeywords: z.string().max(200).nullable().optional(),
  ogImage: z.string().nullable().optional(),
}).strict()
```

**PATCH语义**：不传不变，仅nullable字段传null清空，必填字段不接受null；未知键拒绝。必须带revision，事务条件更新revision匹配并加1，否则409 REVISION_CONFLICT，不覆盖新内容。Log/Project/Timeline/Profile同样执行。

**副作用（service 层自动处理）**
- 计算 `wordCount`（中文按字符数、英文按单词数）与 `readingTime = ceil(中文字符数 / 300 + 英文单词数 / 200)`
- `status` 从非 PUBLISHED 变为 PUBLISHED 且 `publishedAt` 为空 → 自动填 `now()`
- `publishedAt`变动或到期发布 → 失效首页/列表/详情/RSS/sitemap；分钟调度负责到期事件
- 写 `AuditLog`（记录变更字段的 before/after 差异）
- `revalidateTag('article')` + `revalidateTag('content')`

---

### 5.2 批量操作

`POST /api/v1/admin/articles/bulk`

```jsonc
// 请求
{
  "ids": ["clx1", "clx2", "clx3"],
  "action": "publish",          // publish | unpublish | archive | delete | restore | addTags | removeTags
  "payload": { "tagIds": ["clx9"] }   // action 为 addTags/removeTags 时需要
}

// 200 —— 部分失败也返回 200，用 results 明示
{
  "success": true,
  "data": {
    "succeeded": ["clx1", "clx2"],
    "failed": [ { "id": "clx3", "code": "NOT_FOUND", "message": "内容不存在" } ]
  }
}
```
> **设计取舍**：批量操作不做全事务回滚。理由：部分成功比全失败对用户更友好（"3 条成功，1 条因 slug 冲突失败"），且 `results` 明确告知结果。所有成功项仍写独立 AuditLog。

---

### 5.3 模块开关（★ 核心接口）

**`GET /api/v1/admin/modules`**
```jsonc
{
  "success": true,
  "data": [
    {
      "key": "log", "name": "日志", "description": "每日随笔、大事件、阶段总结",
      "enabled": true, "navVisible": true, "navLabel": "日志", "navOrder": 1,
      "icon": "notebook-pen", "route": "/logs", "isBuiltin": true,
      "config": { "pageSize": 10, "intro": "记录每天发生的事", "defaultView": "list",
                  "home": { "enabled": true, "limit": 5, "order": 4 },
                  "types": { "DAILY": true, "EVENT": true, "SUMMARY": true } },
      "stats": { "totalItems": 86, "publishedItems": 80, "draftItems": 6 },
      "updatedAt": "2025-01-10T…"
    }
  ]
}
```
> `stats` 是聚合出来的只读信息，让后台在关闭模块前知道"这里有多少内容"，避免误关。

**`PATCH /api/v1/admin/modules/:key`** — 需 `module:write`（ADMIN）

```jsonc
// 请求（字段全部可选，只传要改的）
{
  "enabled": false,
  "navVisible": false,
  "navLabel": "随笔",
  "route": "/notes",
  "config": { "pageSize": 20, "home": { "enabled": false } }
}
```
> `config` PATCH：已知嵌套键按层合并，数组整体替换，可空字段null清空；严格拒绝未知键及危险对象键，合并后重新校验完整配置。

`intro=null`清除自定义导语，页面回退到模块description；`emptyText=null`清除自定义空态，回退到页面默认文案。`showToc=false`隐藏文章目录。页面与metadata使用过滤后的公共模块配置，不能重新读取原始字段绕过联系方式隐藏。

**响应**
```jsonc
{
  "success": true,
  "data": {
    "module": { "key": "log", "enabled": false, "...": "..." },
    "effects": {
      "routesDisabled": ["/logs", "/logs/[id]"],
      "navRemoved": true,
      "sitemapUpdated": true,
      "cacheInvalidated": ["module", "content"],
      "affectedItems": 86,
      "warning": "该模块有 86 条内容，关闭后前台将不可访问，但数据会完整保留。"
    }
  }
}
```

**约束**
- `key` 不可修改（`isBuiltin` 为 true 的模块也不可删除）
- `route` 必须唯一且以 `/` 开头，数据库唯一并校验保留路径/子路径、模块嵌套、历史别名占用和循环；内部模块路径不能仅靠先查重保护
- `home` 模块的 `enabled` 不可为 false（否则站点没有首页）
- 修改 `route` 时，旧路径自动保留 301 重定向（写入RouteAlias，永久保留全部历史路径，直接301到当前路径，保留详情后缀与query）

并发配置写入：PATCH 可携带 `expectedUpdatedAt`（上一响应的 ISO 时间）；传入时不匹配返回 409，后台编辑与撤销必须携带，避免覆盖其他管理员变更。模块改路由/排序/撤销统一持有数据库事务锁，保证当前路径与历史别名的跨表约束。

开关撤销：响应提供 `undo: {auditId,expiresAt}`，关闭成功后 5 秒内，ADMIN 可 `POST /api/v1/admin/modules/:key/undo {auditId}`。服务只接受该模块最近匹配的开关审计，当前状态/updatedAt 必须仍等于原操作结果；过期或期间有其他修改返回 409。撤销恢复开关前状态，另写审计，不删除历史记录或内容。已失效的撤销操作不能覆盖新配置。

**`PATCH /api/v1/admin/modules/reorder`**
```jsonc
{ "items": [ { "key": "article", "navOrder": 1 }, { "key": "log", "navOrder": 2 } ] }
```

---

### 5.4 站点设置

**`GET /api/v1/admin/settings`**
```jsonc
{
  "success": true,
  "data": {
    "general": { "site.name": "Puly 的站", "site.description": "…", "site.logo": "/logo.svg" },
    "seo":     { "seo.defaultTitle": "…", "seo.defaultDescription": "…", "seo.keywords": "…" },
    "theme":   { "theme.default": "system", "theme.accent": "#6366f1" },
    "footer":  { "footer.copyright": "© 2025 Puly", "footer.icp": "京ICP备…" },
    "integration": { "integration.analyticsId": "" }
  }
}
```

**`PATCH /api/v1/admin/settings/:group`** — 需 `setting:write`（ADMIN）
```jsonc
{ "site.name": "新的站点名", "footer.icp": "京ICP备12345678号" }
```
每个已知 key 有独立的 Zod 校验规则（`lib/validators/settings.ts`）；未知 key 返回 `400 VALIDATION_ERROR`。

---

### 5.5 媒体上传

`POST /api/v1/admin/media/upload`仅本地开发部署multipart（localhost next start允许）；生产使用POST /media/upload-intent → 独立R2私有桶直传 → POST /media/confirm。intent限定随机key/大小/类型/10分钟有效期，confirm原子消费票据并验证magic、实际大小、sha256、归属后将验证过的字节写入公开桶；失败不公开。开发/预览/生产bucket与密钥隔离，私有临时桶和公开桶必须不同，私有桶禁止公网访问，删除前检查全站引用（含软删内容）。

后台GET `/media`（page/pageSize/q/folder/kind）与GET `/media/:id`、GET `/media/:id/references`需要content:read；POST上传、PATCH `/media/:id`（仅alt可空、folder）、DELETE `/media/:id`及POST `/media/cleanup`需要media:write。GET `/media/config`仅返回driver。上传20次/小时/用户，PostgreSQL共享桶；所有变更记录审计，引用删除返回409 MEDIA_IN_USE及引用清单。删除返回`{id,cleanupPending}`，true表示持久清理队列待重试。公开Local GET `/api/v1/media/:id`只读取已登记对象，nosniff/sandbox，PDF下载处理。

intent JSON：`{originalName,mimeType,size,hash,alt?,folder?}`（hash为64位小写SHA256）；返回`{intentId,expiresAt,uploadUrl,method:"PUT",headers}`。浏览器计算hash并用返回headers直传；confirm JSON仅`{intentId}`，不接受客户端key。重复/并发/过期消费409；归属不符404。清理接口每批最多100项，删除过期1小时以上票据及对象，也重试DELETE/COMPENSATE队列；单项失败保留票据并移至队尾，继续后续项，以updatedAt/id稳定排序防止失败项饿死后续批次。返回`{cleaned,failed,pending}`（pending为仍满足清理条件的票据数），记录单项成功/失败与汇总审计；需定期调用并配置私有桶对象生命周期兜底。

| 字段 | 说明 |
|---|---|
| `file` | 文件本体（必填） |
| `folder` | 逻辑目录，默认 `/` |
| `alt` | 无障碍替代文本 |

**成功 201**
```jsonc
{
  "success": true,
  "data": {
    "id": "clx...", "url": "https://cdn.example.com/2025/01/abc123.webp",
    "filename": "abc123.webp", "originalName": "screenshot.png",
    "kind": "IMAGE", "mimeType": "image/webp", "size": 204800,
    "width": 1920, "height": 1080, "alt": "首页截图",
    "deduplicated": false
  }
}
```
> `deduplicated: true` 表示 sha256 命中已有文件，直接复用（秒传），不重复占用存储。

**限制**：图片 ≤ 10MB（`image/jpeg|png|webp|avif|gif`，所有帧完整解码、动画≤500帧且全帧合计≤4000万像素）、视频 ≤ 50MB（`video/mp4|webm`）、文档 ≤ 20MB（`application/pdf`）。拒绝SVG/HTML等可执行主动类型以防脚本/外链；校验 MIME **与文件魔数**双重确认，防止改扩展名绕过。文件名和key由服务端随机生成，原始名仅展示。

---

### 5.6 仪表盘统计

阶段 B 的 `GET /api/v1/admin/dashboard` 需要 dashboard:read，返回当前真实基础计数 `{articles,drafts,logs,projects,media,recent}`；recent 为最近更新的五篇未删除文章（id/title/status/updatedAt）。此入口不提供尚未建立的访问统计或备份状态。下述完整 `stats` 在阶段 D/E/G 接入相应统计和备份来源后实现，不能填模拟数字。

`GET /api/v1/admin/stats`

```jsonc
{
  "success": true,
  "data": {
    "counts": {
      "articles": { "total": 42, "published": 38, "draft": 4 },
      "logs":     { "total": 86, "published": 80, "draft": 6 },
      "projects": { "total": 15, "published": 15, "draft": 0 },
      "timeline": { "total": 9 },
      "media":    { "total": 214, "totalSizeBytes": 534773760 }
    },
    "recent": {
      "viewsLast7Days": 3204,
      "newContentLast7Days": 5,
      "topArticles": [ { "slug": "…", "title": "…", "viewCount": 1024 } ]
    },
    "system": {
      "modulesEnabled": 5,
      "modulesDisabled": 1,
      "dbStatus": "ok",
      "lastBackupAt": "2025-01-15T03:00:00.000Z"
    }
  }
}
```

---

### 5.7 审计日志

`GET /api/v1/admin/audit-logs`

**查询参数**：`resource` / `action` / `userId` / `from` / `to` / 通用分页

```jsonc
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "action": "update",
      "resource": "module",
      "resourceId": "log",
      "before": { "enabled": true },
      "after":  { "enabled": false },
      "user": { "id": "clx...", "name": "Puly" },
      "ip": "1.2.3.4",
      "createdAt": "2025-01-15T10:23:00.000Z"
    }
  ]
}
```
> 后台「模块开关」页下方直接内嵌这个接口的近期记录，形成"谁在什么时候关了哪个模块"的可追溯链路。

---

### 5.8 动效配置（version2）
GET /api/v1/admin/settings/motion返回08的完整config、static/editorial/narrative/kinetic四预设及标注估算的体积信息。PATCH仅ADMIN，已知嵌套键合并，严格拒绝未知键；默认editorial+none。无background/text/micro/performance旧字段，无custom。公开GET /api/v1/site的motion只返回渲染配置。完整合法值/默认值/升级见[08](08-motion-system.md)。预算文章135KB、动效28KB、登录110KB gzip。respectReducedMotion固定true，decoration仅none/tint，无连续背景。

### 5.9 草稿预览与slug检查
POST /api/v1/admin/articles/:id/preview-token需content:write，创建24h随机token（哈希入PreviewToken）；GET /preview/:token仅授权有效token读取对应草稿，no-store及noindex，不进RSS/sitemap/搜索。过期或撤销404。GET /api/v1/admin/articles/slug-available?slug=&excludeId=需content:read，仅给后台校验；最终写入仍由数据库唯一约束兜底。

### 5.10 发布与公共边界
`GET /api/v1/jobs/publication`为外部分钟调度入口，仅接受`Authorization: Bearer <REVALIDATE_SECRET>`独立机器密钥（至少32位），不接受后台Cookie替代；未配置503、错误凭据401。任务使用PostgreSQL事务级锁和`jobs.publication.cursor`内部Setting游标，扫描上次游标至本次时间的公开文章/日志/作品并失效依赖tag；失效失败不推进游标，支持重试。清理到期预览token。正常公开读取始终检查publishedAt，不依赖任务把草稿或未来内容提前公开。本地`npm run jobs:publication`每60秒调用一次；托管环境必须配置外部分钟调度，当前尚未验证生产调度。
模块关闭时公开列表API返回200及空数组/零总数；页面与详情API返回404 MODULE_DISABLED。首页聚合关闭模块字段返回空数组。
公开查询统一检查模块及子类型开关、status=PUBLISHED、publishedAt<=now、deletedAt=null；所有首页/feed/详情/搜索/RSS/sitemap使用相同公开过滤器。
时间线无PUBLISHED状态，用visible/showOnAbout分别控制页面，并过滤deletedAt；日期年/月/日精度独立保存。排序当前项DESC、日期按direction、同日期order ASC、id ASC。所有新请求5秒内反映保存结果，已有页面刷新；预览和管理接口no-store。

contactVisible=false所有公开DTO、首页、页脚、social、metadata及JSON-LD清除email/phone与mailto/tel。social仍可保留非联系方式链接。



## 6. 错误处理策略（前端约定）

| 场景 | 客户端行为 |
|---|---|
| `401 UNAUTHORIZED`（AT 过期） | 静默调 `/auth/refresh` 并重放原请求**一次**；再失败则跳 `/login?next=<当前路径>` |
| `403 FORBIDDEN` | 不改页面状态，toast「无权限」；若整页无权限则渲染 403 页 |
| `404 MODULE_DISABLED` | 前台当作 404 处理，不显示技术细节 |
| `409 CONFLICT` | 定位到冲突字段（`details[].path`），字段下方红字 |
| `422 BUSINESS_RULE_VIOLATION` | toast 展示 `message`，表单保持填写内容 |
| `429 RATE_LIMITED` | 按钮禁用 + 倒计时（读 `Retry-After`） |
| `500 / 503` | 错误页 + `requestId`，提供「复制错误编号」按钮 |
| 网络断开 | toast「网络异常，请检查连接」+ 自动重试一次 |

**并发刷新去重**：多个请求同时 401 时，只发一次 refresh，其余请求挂起等待结果（用 Promise 单例），避免刷新风暴导致本身触发限流。

---

## 7. 相关文档

- 这些接口背后读写的表 → [02-data-model.md](02-data-model.md)
- 后台如何使用这些接口 → [04-admin-console.md](04-admin-console.md)
- 前台如何消费这些接口 → [05-frontend-ia.md](05-frontend-ia.md)
