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

> **排序白名单**：每个资源只接受白名单内的排序字段。后台日志明确拒绝非法字段并返回400，最多4个字段，允许logDate/updatedAt/title/viewCount（支持标准字段或`-字段`，兼容`字段:asc/desc`）；其他资源按各自合同处理。公开日志固定置顶、记录日期降序、稳定ID顺序，不使用sort参数。禁止将任意用户字段直接传入数据库排序。

### 1.5 限流

| 范围 | 限制 | 超出响应 |
|---|---|---|
| `POST /auth/login` | 5 次 / 15 分钟 / (IP + email) | 429 + `Retry-After` |
| `POST /auth/refresh` | 30 次 / 15 分钟 / IP | 429 |
| 公开 GET 与 POST /views | 300 次 / 15 分钟 / IP，共享公开桶 | 429 |
| POST /views | 另加60次 / 30分钟 / 签名匿名身份 | 429 |
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
| PATCH ★ | `/api/v1/admin/settings/motion` | 保存动效配置（严格Zod + 交叉规则） |
| GET | `/api/v1/admin/media` | 媒体列表 |
| GET/POST | `/api/v1/admin/media/folders` | 全部目录汇总/新建持久空目录 |
| POST | `/api/v1/admin/media/deduplicate` | 按hash/size/mimeType复用已验证媒体 |
| POST | `/api/v1/admin/media/upload` | 上传 |
| PATCH | `/api/v1/admin/media/:id` | 改 alt / folder |
| DELETE | `/api/v1/admin/media/:id` | 删除（含存储文件） |
| — | `/api/v1/admin/categories` | 分类 CRUD（含 `/reorder`） |
| — | `/api/v1/admin/tags` | 标签 CRUD（含合并 `/merge`） |
| GET | `/api/v1/admin/audit-logs` | 审计日志 |
| GET/POST | `/api/v1/admin/users` ★ | 用户列表/创建；生命周期由停用/启用管理 |
| GET/PATCH | `/api/v1/admin/users/:id` ★ | 用户详情/资料角色状态修改（revision） |
| POST | `/api/v1/admin/users/:id/reset-password` ★ | 随机重置密码并撤销全部会话 |
| POST | `/api/v1/admin/users/:id/revoke-sessions` ★ | 撤销指定用户全部会话 |
| GET | `/api/v1/admin/export` ★ | 全站导出 JSON |
| POST | `/api/v1/admin/import` ★ | 导入 |
| POST | `/api/v1/admin/import/preview` ★ | 校验、冲突映射和影响预览 |

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

**查询参数**：通用参数 + `type`（`DAILY|EVENT|SUMMARY`）+ `year`（1–9998）+ `month`（1-12）+ `mood` + `date`（有效YYYY-MM-DD，年份1–9998，精确日期）。只传month时按北京时间当前年筛选；仅date可直接查询历史日期。创建/修改的logDate采用相同日期范围，9999年日期拒绝400，避免年度范围终点溢出。

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

供移动端日历视图与 PC 端侧边日历。可复用type/mood/tag/q/date筛选；不传year时取date的年份，无date则取北京时间当前年。月份另外返回dayCounts（日期号→条数），供同一天多篇徽章。后台`GET /api/v1/admin/logs/calendar`需content:read，与后台列表共用状态/回收站筛选，不泄露到公共接口。

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

作品补充合同：未传sort或原生表单`sort=`均使用默认`order ASC,startDate DESC NULLS LAST,id ASC`；`sort=latest`使用`startDate DESC NULLS LAST,order ASC,id ASC`。其他排序只接受order/startDate/updatedAt/title/viewCount的安全字段及明确方向，非法400。tech按数组中的技术栈名精确匹配。from/to作用于startDate：YYYY-MM-DD按北京时间当日00:00至23:59:59.999的闭区间，带时区ISO按实际时刻；无效/倒置400。meta.typeCounts返回GAME/REPO/SKILL/OTHER计数，忽略当前type但保留其余条件及公开过滤，关闭类型为0。fields使用已知DTO顶层白名单，公开列表禁止content/deletedAt等内部字段，隐私处理后投影，meta保留。

后台作品补充入口：GET /admin/projects/options 返回tags及历史techStack；GET /admin/projects/slug-available?slug=...&excludeId=...检查slug；PATCH /admin/projects/reorder 接受`{items:[{id,order,revision}]}`，全事务版本校验，任一409全体回滚。POST /admin/projects/:id/preview-token为content:read授权、同源POST及共享写限流120次/15分钟；kind=project/hash24h，不缓存不索引，模块关闭/删除/到期404。预览可以读取草稿/归档/未来及已关闭子类型，与日志私有预览一致，不进入公开查询。

创建作品时coverImage未传才使用gallery首张；PATCH coverImage:null明确清空，修改gallery但未传coverImage保持旧封面。links只接收github/demo/video/docs/article安全URL已知键，nullable清空，拒绝未知键。媒体和标签数组整体替换，关系写入与审计同一事务。

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

时间线日期为日历日期：接受YYYY、YYYY-MM、YYYY-MM-DD（兼容合法ISO输入中的日历日期部分）；规范化UTC零时并保存YEAR/MONTH/DAY精度。YEAR归一为01-01，MONTH归一为当月01日，DAY保存完整日期；不存在日期/结束早于开始返回400。修改日期未传精度时按输入推断，单独修改精度时归一化现有日期；合并后重验起止。空endDate可清空，isCurrent=true须endDate为空；允许多个当前项，后台提示。公开列表只返回未删除且visible=true的条目，按模块/类型开关过滤；timeline无发布状态，以visible管理公开性。About经历仅WORK/showOnAbout=true，独立于visible，但同时受timeline.enabled、WORK类型和about.sections.experience约束。所有公开DTO过滤联系方式。

后台同构入口GET/POST /admin/timeline、GET/PATCH/DELETE /admin/timeline/:id、POST :id/restore、DELETE :id/purge（仅ADMIN）；写入带revision并CAS，审计及缓存失效。PATCH /admin/timeline/reorder接受`{items:[{id,order,revision}]}`，全事务版本校验，排序只影响同isCurrent/同startDate内的顺序，跨日期不能覆盖日期优先级。支持type/q、回收站includeDeleted/deleted筛选。公开不设详情页，Markdown详情通过原生折叠展开。

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
      "publishedAt": "2025-01-15T08:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 7, "query": "next" }
}
```
实现：参数化SQL UNION ALL三个公开资源的轻量ID、类型与发布时间后，按publishedAt DESC/type ASC/id ASC全局分页；完整总数和typeCounts不受分页影响，typeCounts不受当前type筛选影响。只读取当前页最多50个正文。q先trim，少于2字符返回空，超过200字符400；type仅all/article/log/project，page为1–10000，pageSize默认20、最大50，非法参数400。ILIKE关键词中的百分号、下划线和反斜杠按字面转义；不输出不存在的相关性score。摘要先执行公开隐私清洗，再纯文本截取、HTML实体转义并用固定em高亮；前端用安全文本节点渲染。只读RepeatableRead保证计数与页数据一致。

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
  "revisions": { "clx1": 2, "clx2": 1, "clx3": 4 }, // 每个ID必须携带读取时的修订版本
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
// PATCH /api/v1/admin/settings/general
{ "site.name": "新的站点名" }
// PATCH /api/v1/admin/settings/footer（独立请求）
{ "footer.icp": "京ICP备12345678号" }
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

阶段 B 的 `GET /api/v1/admin/dashboard` 需要 dashboard:read，返回当前真实基础计数 `{articles,drafts,logs,projects,media,recent}`；recent 为最近更新的五篇未删除文章（id/title/status/updatedAt）。此入口不提供尚未建立的访问统计或备份状态。阶段E的完整stats供仪表盘读取，必须使用真实统计；备份来源留G，未验证时为null。

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
      "lastBackupAt": null
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
GET /api/v1/admin/settings/motion返回08的完整config、presets对象（static/editorial/narrative/kinetic四完整模板）及performance估算标记、预算和是否需要库；不返回伪造体积。PATCH沿用键对象{ "motion.config": 部分配置 }，返回完整该组键对象；respectReducedMotion=false为422，其余非法字段400。PATCH仅ADMIN，已知嵌套键合并，严格拒绝未知键；默认editorial+none。无background/text/micro/performance旧字段，无custom。公开GET /api/v1/site的motion只返回渲染配置。完整合法值/默认值/升级见[08](08-motion-system.md)。预算文章135KB、动效28KB、登录110KB gzip。respectReducedMotion固定true，decoration仅none/tint，无连续背景。

### 5.9 草稿预览与slug检查
POST /api/v1/admin/articles/:id/preview-token需content:write；POST /api/v1/admin/logs/:id/preview-token需content:read（ADMIN/EDITOR/VIEWER均可），两者POST均检查Origin、启用账号与AT对应会话。创建24h随机token，PreviewToken只保存哈希与内容类型；GET /preview/:token按凭据类型分发文章/日志，日志提供Markdown及图集。预览允许草稿、归档、未来内容及已关闭子类型，属于凭据授权的私有读取，与公开过滤不同；整个模块关闭或内容软删除时预览404，过期/缺失/未知类型凭据也404。页面no-store及noindex，不含公开导航或上下篇，不进RSS/sitemap/搜索。GET /api/v1/admin/articles/slug-available?slug=&excludeId=需content:read，仅给后台校验；最终写入仍由数据库唯一约束兜底。

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

### D04 实施合同补齐（2026-10-09）

About的sections统一含bio、advantages、skills、experience、services、contact，六项默认true；新增键通过默认合并兼容既有四键配置，不覆盖自定义值。Hero始终显示。公开GET /api/v1/profile在about关闭时404；只返回页面所需字段，不公开birthday、revision及管理时间戳，关闭的区块不进入DTO。experience复用TimelineItem，后台仅只读并链接时间戳；前台选当前项优先、开始日期降序、order/id稳定排序的最近3条，完整列表遵循时间轴direction。联系区块关闭、about关闭或contactVisible=false均执行全站既有脱敏规则。

后台GET /api/v1/admin/profile需content:read，PATCH需content:write、Origin及共享adminwrite限流；已停用/撤销会话立即拒绝。PATCH只接受已知字段，未传保持、数组整体替换、nullable字段null清空，合并后校验全部数据。name/headline必填，bio可空字符串；skills等级1–5，years非负；链接采用安全HTTP(S)/规范站内路径，social另支持合法mailto/tel并由公开脱敏控制。保存必须带revision，旧号409，事务内更新及审计、成功后失效全部依赖。空表GET返回待完善占位对象revision=0；首次PATCH仅revision=0允许原子创建revision=1，并发创建返回409。

## 用户管理实施合同（D07，2026-10-10）

用户管理仅ADMIN/user:manage。GET列表/详情使用当前启用用户及sid权威授权，不要求GET Origin；POST/PATCH需Origin与共享adminwrite额度。列表支持q（姓名/邮箱）、role、active、page/pageSize，返回安全DTO（id/name/email/avatar/role/isActive/lastLoginAt/createdAt/updatedAt/revision）和分页meta、activeAdmins；任何读接口均不返回passwordHash/会话凭证。业务生命周期使用停用/启用，不提供物理删除用户入口，保留作者和审计关联。

POST /admin/users接{name,email,role,avatar?}，姓名1–200字符、邮箱归一小写且大小写不敏感唯一，role为三角色，avatar可空且安全URL；始终创建启用用户。服务端生成密码（至少大小写与数字，随机部分不少于128位）并bcrypt12，只在创建响应{user,temporaryPassword}返回一次；不写审计/日志/前端持久存储，响应no-store。后台提示首次登录后在个人设置修改。

PATCH /admin/users/:id接{revision,name?,email?,avatar?,role?,isActive?}，严格拒绝未知字段，null仅avatar清空，禁止空修改；User新增revision默认1，业务修改与密码变更递增，旧revision返回409。不能停用/降级自己，不能令启用ADMIN数量为0；并发相互降级也须保持至少一位启用管理员。角色/邮箱变更或停用须同事务撤销目标全部Session并清空rotationReply，已签发AT下一请求即失效。普通姓名/头像修改不撤销会话。

POST :id/reset-password接{revision}，仅其他用户，生成新随机密码，返回{user,temporaryPassword}一次，递增revision并撤销目标全部会话；自己的密码沿用/account旧密码核验流程。POST :id/revoke-sessions接{revision}，仅其他用户，撤销全部会话并递增revision，返回{user,revoked}；当前用户沿用个人设置的登出其他设备/全部设备。自操作保护422、最后管理员保护422、邮箱冲突409、版本冲突409、缺失404、越权403；未知/格式400。

写事务固定用户管理advisory锁、按ID顺序锁actor/target，重验当前ADMIN/启用/sid，再做CAS、管理员数量保护、会话撤销及审计，防止等待期间权限改变或并发绕过保护。锁顺序与认证的用户→会话一致，序列化/死锁冲突409整次回滚。审计只记业务字段差异或操作名，不存临时密码/hash/token。登录更新lastLoginAt不递增业务revision；个人改密码须递增revision。真实PG验证三角色/停用AT/角色和邮箱撤销/随机密码登录/重复邮箱/旧版本/并发管理员保护/审计脱敏，浏览器验证完整用户生命周期及三端。

## 数据管理实施合同（D06，2026-10-10）

GET /api/v1/admin/export需data:export（ADMIN），校验当前启用用户及sid，显式消费PG管理额度；GET不要求Origin。返回标准data包裹的version=1.0、exportedAt、data快照，结构见02，附下载文件名/no-store。所有内容含软删及未发布，关系明确tagIds；不导出身份凭据、媒体二进制或审计。单包JSON上限4,000,000字节，实体合计最多5000项；超出需使用数据库/媒体备份，不截断。

POST /api/v1/admin/import/preview接{mode:'merge'|'replace',bundle}，POST /import接同样字段并加token、replace时confirmation='替换全部内容'。两者data:import/ADMIN、Origin、共享PG限流；现有JSON请求上限4,200,000字节仍有效。严格拒绝未知/危险键、缺关系、重复ID/slug、非法日期和业务字段、两层树及配置/路线冲突。preview不修改业务数据，返回{mode,token,expiresAt,created,skipped,mapped,warnings,replaces}；计数键为categories/tags/articles/logs/projects/timelineItems/modules/settings/profile/routeAliases，mapped为来源ID到目标ID的映射说明。凭证签名绑定user/sid、mode、文件摘要及业务数据库快照，10分钟有效；执行前重验，文件/权限/库内容变化或过期返回409要求重新预览。

merge/replace精确定义见02；replace历史路径不可丢失，已有同IDrevision递增并撤销受影响草稿预览令牌。配置复用已有严格module/settings/profile/motion合同，任何不合法项整次拒绝。导入在Serializable事务内锁定关联内容/词表及配置，映射、关系、配置、审计原子提交，冲突409全量回滚，完成后失效所有派生缓存。审计仅记录模式、摘要和数量，不保存全文、联系方式或预览凭证。返回实际created/skipped/mapped/warnings计数，不能以文件上传或预览成功代替导入验收。

## 分类与标签实施合同（D05，2026-10-09）

POST /api/v1/admin/tags/merge/preview保持content:read及Origin校验，在锁事务前显式消费与写操作共用的PostgreSQL adminwrite额度（120次/15分钟）；超限429并返回Retry-After。

Category支持最多两层；parentId=null为根，子分类只能挂根，禁止自指/环/把带子项的根移入另一根。删除有子分类的分类返回422；删除叶分类只把全部关联文章（包括草稿/软删）改为未分类，不删除正文。分类slug可编辑但无历史别名，后台提醒旧分类链接失效；栏目路径历史301合同不因此扩展。

Tag在Article/Log/Project共用，创建后slug不可修改；改显示名不改slug，替换slug应新建再合并。删除标签仅解除全部内容关联，不删除正文；合并来源标签到目标标签时全事务转移关联、去重、保留目标名称/slug并删除来源。包括草稿/未来/归档/软删内容，防止恢复后断关系。受影响内容revision递增，避免旧编辑快照重新覆盖关系。Category/Tag新增revision默认1，管理修改/删除/排序/合并均带CAS，冲突409整次操作回滚。

公开GET /api/v1/categories只返回有公开文章的分类及必要祖先，parent计数汇总子孙公开文章。GET /api/v1/tags仅返回公开使用数>0的标签，分article/log/project及total计数；严格复用模块/类型/PUBLISHED/到期/未删除过滤，关闭模块不能通过词表名称和计数泄露草稿。全部公开DTO复用联系方式清洗。管理列表返回全记录及全部内容使用数（含软删）方便清理。

管理接口统一content:read读、content:write写（ADMIN/EDITOR写，VIEWER只读），权威会话/Origin/PostgreSQL限流。GET/POST /admin/categories、GET/PATCH/DELETE /admin/categories/:id，PATCH /admin/categories/reorder接items[{id,order,revision}]（不借排序改父级），GET/POST /admin/tags、GET/PATCH/DELETE /admin/tags/:id，POST /admin/tags/bulk接items[{id,revision}]原子批删，POST /admin/tags/merge/preview与/merge接{target:{id,revision},sources:[{id,revision}]}。预览返回去重后的影响数与来源/目标，确认合并前显示不可撤销提示；确认时重新计算并返回实际影响数。source不能包含target或重复；关联变化与审计事务同提交，所有派生缓存失效。未知键400、缺失404、slug冲突409。管理tag列表q/sort（usage/name/newest）/page/pageSize；category返回完整有序树，name/slug搜索由页面筛选树且保留祖先。新建/改名字段为name必填，slug小写英文数字连字符；description/icon/color可空（color仅#RRGGBB）；数组及字符串按大小上限限制。无引用的安全删除同样带确认。


### D08 媒体管理补充合同

GET /admin/media 的q按文件名originalName或替代文本alt不区分大小写匹配，trim后最长200；省略folder查询全部，folder=/只根目录，历史末尾斜杠目录按原值精确匹配。GET /admin/media/folders需content:read，返回{folders:[{path,count,size}],total,totalSize}，统计全部媒体而非当前筛选，根目录永有，按path稳定排序。

POST /admin/media/folders需media:write、Origin及PG adminwrite额度，严格{path}，沿用安全逻辑目录字符集、最长200，新增路径去末尾斜杠（根除外）。空目录持久在Setting media.folders/group internal数组，不增模型；固定事务锁保证并发幂等，最多200个登记目录，超限409 DIRECTORY_LIMIT。列表合并登记目录与有文件的目录。此内部管理数据不公开、不进入普通设置和内容JSON导出，独立数据库备份保留。

POST /admin/media/deduplicate需media:write、Origin及PG adminwrite额度，严格{hash:64位小写sha256,size:正安全整数,mimeType:允许类型}，匹配已登记验证过的完整Media且hash/size/真实mime均相同，返回{media:安全DTO|null,deduplicated:boolean}。命中仅复用原ID/url/alt/folder并记录审计，不按客户端声明创建/更改对象，不返回存储key/hash/uploadedBy；等同选择已有共享媒体。Local/R2均先在浏览器算hash再查询，命中避免传输；未命中完整沿用上传magic/大小/hash/归属验证。查询只扣adminwrite，未命中后真实上传仍扣20次/小时，避免双扣上传额度。

媒体批量操作每批最多50个ID快照，界面逐项调用既有PATCH {folder}、PATCH {alt:string|null}或DELETE；各项独立鉴权、引用保护、事务及审计，部分成功不回滚，结果逐项列出，失败项保留选择供重试。禁止绕过共享额度或强删引用文件。清理继续使用原POST /media/cleanup及{cleaned,failed,pending}，需确认并展示真实结果。

### E 阅读统计与索引补充

POST /views严格接收{resource:article|log|project,id}，Origin校验、共享PG公开额度和匿名身份额度；匿名访客cookie site_visitor为HttpOnly/SameSite=Lax/Path=/，固定30天，生产HTTPS secure。签名与登录凭证用途隔离，数据库仅存随机身份哈希，不保存IP。无有效cookie由服务端建立身份；已持相同cookie并发只计一次。DNT=1、Sec-GPC=1和常见bot不统计且不建立cookie。正常返回{counted,viewCount}，跳过返回{counted:false,viewCount:null}；草稿/未来/软删/模块或类型关闭404。客户端sessionStorage只优化成功计数的30分钟内重复请求，不作为权威授权或去重。

ViewReceipt/每日统计/内容阅读量原子提交；锁后使用数据库时间，北京日历日，同日超窗只增PV，跨日窗口内仍不增PV/UV。UV是当日成功计数的独立匿名身份；无cookie首次并发或清除cookie可能建立不同身份，不宣称真实人数。计数不更新revision或内容updatedAt，改路径不分裂身份；DailyStat.path最后接受计数时更新，统计链接从当前资源ID解析。

GET /admin/stats需dashboard:read，三个角色当前有效会话均可读。内容total为未删除数，published为到期PUBLISHED，draft为DRAFT，archived为ARCHIVED，scheduled为未到期或无发布时间的PUBLISHED。traffic返回北京时间今天及前6天的真实views/resourceUniques，后者是各资源匿名UV之和，不能视为站点人数；无记录日为0。newContentLast7Days计三模型未删除新建记录，topArticles仅当前公开文章按viewCount/id取5条，返回当前url；recent.articles为最近编辑五篇未删除文章。lastBackupAt在G前null。

RSS合并最近50条公开文章/日志，GUID为稳定resource:id，文本摘要XML转义；全部关闭仍是有效空feed。sitemap投影公开列表/详情与有公开文章的分类标签归档，只输出当前路径，不含搜索/预览/旧别名，单文档超过协议50000项明确503 SITEMAP_LIMIT，需后续拆分索引。/api/v1/og位于既有保留命名空间，不新增栏目保留路径，resource省略时站点卡片，article/project的id参数为公开slug、log为ID；只从公开详情取标题，不允许远程图片参数。响应PNG/no-store；关闭/未公开内容404，参数无效400。

robots仍禁止普通/api抓取，但明确Allow: /api/v1/og，允许分享图读取。图片端点复用既有/api保留空间，D阶段合法的/og栏目和历史别名不受抢占。
# G本地运维接口（2026-10-11）

GET /api/health公开、no-store：正常200 `{status:'ok',version:'0.1.0',database:'up'}`，故障503 `{status:'degraded',version:'0.1.0',database:'down'}`。version为应用版本；不返回SQL/数据库版本/连接信息。数据库探针限制statement timeout及事务等待。

GET /api/v1/jobs/maintenance仅独立REVALIDATE_SECRET Bearer机器凭据可调用，不接受Cookie；未配置503，错误401。no-store，标准success.data返回skipped及各类清理计数，不返回记录或密钥。PG事务锁串行，删除已过期Session/PreviewToken/RateLimit与updatedAt超30天ViewReceipt；未过期旧RT摘要保留，rotationReply仅超过10000ms后清空（毫秒精度、严格小于），恰好10000ms宽限不受影响。建议外部每日调度；不能替代既有媒体对象失败清理或分钟发布。

HTML CSP由Edge兼容middleware生成随机nonce，覆盖客户端x-nonce/CSP，Next/主题/JSON-LD用同一nonce；预览也受保护。策略及云端未验证边界见13/14，不把HTML响应头接口等同生产已发布。


## EdgeOne公开路由查询

GET /api/v1/route-redirect?path=<pathname>为公开只读Node入口，仅返回{target:null|string}（有意不使用业务DTO包装），Cache-Control:no-store。仅本地绝对pathname，长度≤2048，拒绝协议相对、反斜杠、query/hash、控制字符、无效编码和点段；输入400，数据库故障503。只暴露原本公开的重定向目标，不返回记录或凭据；middleware负责301和query保留，故障不伪装200。
