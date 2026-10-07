# 02 · 数据模型

[← 上一篇：系统架构](01-architecture.md) · [返回 README](../README.md) · [下一篇：接口契约 →](03-api-spec.md)

---

## 1. ER 图

```
┌─────────────┐        ┌──────────────┐        ┌───────────────┐
│    User     │1      *│   Session    │        │    Setting    │  (KV, 站点配置)
│─────────────│────────│──────────────│        │───────────────│
│ id          │        │ refreshToken │        │ key           │
│ email       │        │ expiresAt    │        │ value  (Json) │
│ passwordHash│        │ revokedAt    │        │ group         │
│ role        │        └──────────────┘        └───────────────┘
│ isActive    │1
└──────┬──────┘*        ┌──────────────┐        ┌───────────────┐
       │                │  AuditLog    │        │    Module     │  (模块开关 ★)
       └────────────────│──────────────│        │───────────────│
                        │ action       │        │ key           │
                        │ resource     │        │ enabled       │
                        │ before/after │        │ navOrder      │
                        └──────────────┘        │ route         │
                                                │ config (Json) │
┌───────────────┐                               └───────────────┘
│   Category    │
│───────────────│        ┌─────────────────────────────────────────────┐
│ slug          │1      *│                 Article                     │
│ parentId ──┐  │────────│─────────────────────────────────────────────│
└────────────┼──┘        │ slug · title · summary · content(Markdown)  │
             └──tree     │ status · publishedAt · isTop · allowComment │
                         │ readingTime · viewCount · seo* · ogImage    │
                         │ categoryId · authorId · deletedAt           │
                         └──────────────┬──────────────────────────────┘
                                        │
┌───────────────┐                       │  ┌───────────────────────────┐
│     Tag       │*                     *│  │           Log             │
│───────────────│────────────────────────│───────────────────────────│
│ name · slug   │                        │  │ title · content · summary │
│ color         │                        │  │ type(DAILY/EVENT/SUMMARY) │
└───────┬───────┘                        │  │ logDate · mood · weather  │
        │*                               │  │ location · images[]       │
        │                                │  │ status · isPinned         │
        │        ┌───────────────────────┴──┴───────────────────────────┘
        │        │
        │*       │*  ┌──────────────────────────┐   ┌────────────────────┐
        └────────┼───│        Project           │   │   TimelineItem     │
                 │   │──────────────────────────│   │────────────────────│
                 │   │ slug · title · subtitle  │   │ title · subtitle   │
                 │   │ description · content    │   │ type(WORK/EDU/...) │
                 │   │ coverImage · gallery[]   │   │ organization       │
                 │   │ type(GAME/REPO/SKILL/..) │   │ startDate/endDate  │
                 │   │ techStack[] · links{}    │   │ isCurrent · logo   │
                 │   │ featured · order         │   │ highlights[]       │
                 └───│ status · deletedAt       │   │ visible · order    │
                     └──────────────────────────┘   └────────────────────┘

┌───────────────┐        ┌───────────────┐        ┌────────────────────┐
│   Profile     │        │     Media     │        │    DailyStat       │
│───────────────│        │───────────────│        │────────────────────│
│ (单例行)       │        │ url · kind    │        │ date · path        │
│ name/headline │        │ size · w/h    │        │ views · uniques    │
│ socials{}     │        │ hash(去重)     │        └────────────────────┘
│ advantages[]  │        │ folder        │
│ skills[]      │        └───────────────┘
└───────────────┘
```

**关系要点**

- `Article` / `Log` / `Project` → `Tag`：多对多（隐式连接表 `_ArticleTags` 等）。
- `Article` → `Category`：多对一，`Category` 自关联成树。
- `Article` / `Log` → `User`：多对一（作者），删除用户时 `SetNull`，不连带删内容。
- `TimelineItem` 不关联其他表，是独立实体，同时供「时间戳」页与「关于我」的工作经历区块使用。

---

## 2. 设计取舍说明

### 2.1 为什么日志和文章分表（`Log` / `Article`）

| 维度 | Log | Article |
|---|---|---|
| 核心时间语义 | `logDate`（记录的是**哪一天**） | `publishedAt`（**何时发布**） |
| 特有字段 | mood、weather、location、images[] | category、SEO 三件套、readingTime、isTop、allowComment |
| 典型长度 | 100–800 字 | 2000–10000 字 |
| 后台菜单 | 日志管理（日历视图） | 文章管理（分类树视图） |

若合表为 `Content(type)`，则 15+ 个字段在两类型下各有一半是 `NULL`，后台表单要按类型条件渲染，将来加字段会越来越脏。**分表的代价**是首页"最新动态"混合流需要查两次再内存合并 —— 由于只取前 10 条，性能可忽略。

> **合并查询范式**：
> ```ts
> const [logs, articles] = await Promise.all([
>   logService.listPublic({ limit: 10 }) // service检查模块/类型/PUBLISHED/publishedAt<=now/deletedAt,
>   articleService.listPublic({ limit: 10 }) // 同一公开边界,
> ])
> const feed = [...logs.map(toFeed('log')), ...articles.map(toFeed('article'))]
>   .sort((a, b) => +b.date - +a.date).slice(0, 10)
> ```

### 2.2 为什么「经历」只有一张表

「时间戳」页要展示完整时间轴；「关于我」页要展示工作经历列表。这两个需求的数据**几乎完全重合**。若各建一张表，你每次换工作都要改两处，且必然会不同步。

因此统一为 `TimelineItem`，用两个布尔字段控制露出位置：

- `visible` → 是否在「时间戳」页显示
- `showOnAbout` → 是否在「关于我」页显示

`type` 区分色彩与图标：`WORK` 工作、`EDUCATION` 教育、`PROJECT` 项目、`AWARD` 荣誉、`MILESTONE` 里程碑。

### 2.3 为什么配置用 KV 表（`Setting`）而不是固定列

站点配置是**长尾且持续增长**的（今天加备案号，明天加统计 ID，后天加备案链接）。用 `key + Json` 的 KV 表，新增配置项**零迁移**，后台设置页按 `group` 自动分组渲染。

代价：失去列级类型约束。对策是 `lib/validators/settings.ts` 里用 Zod 为每个已知 key 定义 schema，读写时校验，既有灵活性又有类型安全。

**动效配置**：Setting以motion.config存version2对象，默认editorial、decoration.none；只允许08的已知字段，JSON存储不等于接受任意扩展。API/默认值/升级需同步类型与校验。


### 2.4 为什么用软删除（`deletedAt`）

内容型数据被误删是高频事故。`deletedAt` 有值时：

- 前台查询一律附加 `deletedAt: null`；
- 后台默认过滤，提供「回收站」视图，可恢复或彻底删除；
- 跨表引用（如文章引用的图片）不会因删除立即断链。

Prisma6使用service统一显式过滤（或经验证的$extends），不使用已移除的$use。Article/Log/Project/TimelineItem均软删除；公开入口排除deletedAt，管理回收站显式includeDeleted；恢复和purge单独授权。关联、批量、嵌套读取不能假设扩展自动覆盖。

Article/Log/Project公开还必须PUBLISHED且publishedAt<=now；时间线按visible/showOnAbout分别过滤。所有内容（含Profile）有revision，条件更新冲突409。Article.order支持排序；Timeline保留start/end日期精度，不因默认月日伪装输入精度。


### 2.5 为什么内容存 Markdown 而不是富文本 JSON

Markdown 是**纯文本**：可 Git diff、可脚本批量处理、可随时换渲染器、AI 读写友好、数据库迁移零风险。Tiptap JSON 会把数据锁死在特定编辑器版本上。

方案：后台用 Tiptap 编辑（所见即所得），保存时序列化为 Markdown 存储（官方 `@tiptap/markdown` 扩展（Tiptap3））；前台用 `react-markdown` 渲染。**存储格式与编辑器解耦。**

---

## 3. 完整 Prisma Schema

> 文件位置：`prisma/schema.prisma`
> 目标数据库：开发、测试、生产均为**PostgreSQL**；真实迁移及并发测试是验收条件。

```prisma
// ============================================================
//  Personal Site · Prisma Schema
//  Target: PostgreSQL 16
//
//  设计说明见 docs/02-data-model.md
//  ⚠ 不要改用 SQLite：它不支持 enum 与标量数组，会导致 schema 分叉。
//     见 docs/02-data-model.md §7
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
//  枚举
// ============================================================

/// 后台用户角色
enum Role {
  ADMIN // 全部权限，含模块开关与用户管理
  EDITOR // 内容增删改与发布，不可改站点配置
  VIEWER // 只读，可看仪表盘与审计日志
}

/// 内容发布状态（Article / Log / Project 共用）
enum ContentStatus {
  DRAFT // 草稿，仅后台可见
  PUBLISHED // 已发布，前台可见
  ARCHIVED // 已归档，公开入口统一返回404
}

/// 日志类型
enum LogType {
  DAILY // 每日随笔
  EVENT // 大事件
  SUMMARY // 阶段总结
}

/// 作品类型
enum ProjectType {
  GAME // 游戏
  REPO // 代码库
  SKILL // Skills / 技术能力展示
  OTHER // 个人制作的其他东西
}

/// 时间戳条目类型
enum TimelineType {
  WORK // 工作经历
  EDUCATION // 教育经历
  PROJECT // 项目经历
  AWARD // 荣誉奖项
  MILESTONE // 个人里程碑
}

/// 媒体类型
enum MediaKind {
  IMAGE
  VIDEO
  DOCUMENT
  OTHER
}

/// 经历日期的展示精度，存储仍使用完整日期
enum DatePrecision {
  YEAR
  MONTH
  DAY
}

// ============================================================
//  认证与权限
// ============================================================

/// 后台用户
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  name         String
  avatar       String?
  role         Role      @default(EDITOR)
  isActive     Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  sessions  Session[]
  auditLogs AuditLog[]
  articles  Article[]  @relation("ArticleAuthor")
  logs      Log[]      @relation("LogAuthor")

  @@index([role, isActive])
  @@map("users")
}

/// 刷新令牌会话（可撤销）
model Session {
  id            String    @id @default(cuid())
  userId        String
  refreshHash   String    @unique // 只存哈希，明文永不落库
  userAgent     String?
  ip            String?
  expiresAt     DateTime
  revokedAt     DateTime?
  rotatedFrom   String? // 轮转来源，用于重放检测
  rotatedAt     DateTime?
  successorId   String?
  rotationReply String?   @db.Text // 加密后的后继令牌，仅供十秒并发宽限
  createdAt     DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([expiresAt])
  @@map("sessions")
}

/// 后台操作审计日志
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  action     String // create | update | delete | restore | publish | unpublish | login | logout | toggle | upload
  resource   String // article | log | project | timeline | module | setting | media | user
  resourceId String?
  before     Json? // 变更前快照（仅存差异字段）
  after      Json? // 变更后快照
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([resource, resourceId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([createdAt(sort: Desc)])
  @@map("audit_logs")
}

// ============================================================
//  站点配置与模块开关  ★ 后台"开启关闭所有功能"的核心
// ============================================================

/// 站点配置（KV，按 group 分组渲染后台设置页）
model Setting {
  key       String   @id // 如 "site.name" / "seo.defaultTitle" / "motion.config"
  value     Json
  group     String   @default("general") // general | theme | seo | social | footer | motion | integration | feature
  label     String? // 后台显示名
  updatedAt DateTime @updatedAt
  updatedBy String?

  @@index([group])
  @@map("settings")
}

/// 功能模块注册表 —— 决定前台哪些栏目存在
model Module {
  key         String       @id // home | log | portfolio | timeline | article | about
  name        String // 中文名，可在后台改
  description String?
  enabled     Boolean      @default(true) // 总开关
  navVisible  Boolean      @default(true) // 是否出现在导航
  navLabel    String? // 导航文案，空则用 name
  navOrder    Int          @default(0) // 导航排序
  icon        String? // lucide 图标名
  route       String       @unique // /logs（可在后台改）
  config      Json? // 模块级配置，结构见 docs/01-architecture.md §7
  isBuiltin   Boolean      @default(true) // 内置模块不可删除
  updatedAt   DateTime     @updatedAt
  aliases     RouteAlias[]

  @@index([enabled, navOrder])
  @@map("modules")
}

/// 历史地址永久保留，重定向时解析模块的最新地址
model RouteAlias {
  path      String   @id
  moduleKey String
  createdAt DateTime @default(now())
  module    Module   @relation(fields: [moduleKey], references: [key], onDelete: Cascade)

  @@map("route_aliases")
}

/// 所有进程共用的固定窗口限流计数
model RateLimit {
  key       String   @id
  count     Int      @default(1)
  expiresAt DateTime

  @@index([expiresAt])
  @@map("rate_limits")
}

/// 草稿预览只存令牌摘要，不能作为公开内容查询入口
model PreviewToken {
  hash      String   @id
  kind      String
  contentId String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
  @@map("preview_tokens")
}

// ============================================================
//  分类与标签
// ============================================================

/// 文章分类（支持树形）
model Category {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  icon        String?
  color       String?
  parentId    String?
  order       Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: SetNull)
  children Category[] @relation("CategoryTree")
  articles Article[]

  @@index([parentId, order])
  @@map("categories")
}

/// 标签（文章 / 日志 / 作品共用）
model Tag {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  color     String?
  createdAt DateTime @default(now())

  articles Article[] @relation("ArticleTags")
  logs     Log[]     @relation("LogTags")
  projects Project[] @relation("ProjectTags")

  @@index([name])
  @@map("tags")
}

// ============================================================
//  内容实体
// ============================================================

/// 文章（正式对外发布的长文）
model Article {
  id             String        @id @default(cuid())
  slug           String        @unique
  title          String
  summary        String? // 摘要，用于卡片与 SEO description
  content        String        @db.Text // Markdown 正文
  coverImage     String?
  status         ContentStatus @default(DRAFT)
  publishedAt    DateTime?
  isTop          Boolean       @default(false)
  order          Int           @default(0)
  revision       Int           @default(1) // 乐观锁，旧自动保存返回409
  allowComment   Boolean       @default(true) // 一期不实现评论，预留
  readingTime    Int           @default(0) // 预计阅读分钟数
  wordCount      Int           @default(0)
  viewCount      Int           @default(0)
  likeCount      Int           @default(0)
  // SEO
  seoTitle       String?
  seoDescription String?
  seoKeywords    String?
  ogImage        String?
  // 关系
  authorId       String?
  categoryId     String?
  // 时间戳
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?

  author   User?     @relation("ArticleAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  category Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  tags     Tag[]     @relation("ArticleTags")

  @@index([status, publishedAt(sort: Desc)])
  @@index([status, isTop, publishedAt(sort: Desc)])
  @@index([categoryId, status])
  @@index([deletedAt])
  @@map("articles")
}

/// 日志（每日随笔 / 大事件 / 总结）
model Log {
  id          String        @id @default(cuid())
  title       String
  summary     String?
  content     String        @db.Text // Markdown
  type        LogType       @default(DAILY)
  logDate     DateTime      @db.Date // 记录的是哪一天
  publishedAt DateTime?
  revision    Int           @default(1)
  mood        String? // happy | excited | calm | tired | down | angry
  weather     String? // sunny | cloudy | overcast | rain | snow | fog
  location    String?
  coverImage  String?
  images      String[]      @default([]) // 图集
  status      ContentStatus @default(PUBLISHED) // 日志默认直接发布
  isPinned    Boolean       @default(false)
  viewCount   Int           @default(0)
  authorId    String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  author User? @relation("LogAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  tags   Tag[] @relation("LogTags")

  @@index([status, logDate(sort: Desc)])
  @@index([type, status, logDate(sort: Desc)])
  @@index([deletedAt])
  @@map("logs")
}

/// 作品集（游戏 / 代码库 / Skills / 个人制作）
model Project {
  id          String        @id @default(cuid())
  slug        String        @unique
  title       String
  subtitle    String?
  description String        @db.Text // 卡片简介
  content     String?       @db.Text // 详情页 Markdown（可选）
  coverImage  String?
  gallery     String[]      @default([])
  type        ProjectType   @default(REPO)
  techStack   String[]      @default([])
  role        String? // 担任角色
  highlights  String[]      @default([]) // 亮点 bullets
  links       Json? // { github, demo, video, docs, article }
  startDate   DateTime?
  endDate     DateTime?
  status      ContentStatus @default(PUBLISHED)
  featured    Boolean       @default(false) // 首页精选
  publishedAt DateTime?
  revision    Int           @default(1)
  order       Int           @default(0)
  viewCount   Int           @default(0)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  tags Tag[] @relation("ProjectTags")

  @@index([status, order])
  @@index([type, status, order])
  @@index([featured, status])
  @@index([deletedAt])
  @@map("projects")
}

/// 时间戳 / 经历（同时供「时间戳」页与「关于我」页使用）
model TimelineItem {
  id             String        @id @default(cuid())
  title          String // 如 "高级前端工程师 @ 某公司"
  subtitle       String? // 如 "核心业务组"
  description    String?       @db.Text // Markdown
  type           TimelineType
  organization   String?
  location       String?
  startDate      DateTime
  endDate        DateTime? // null = 至今
  isCurrent      Boolean       @default(false)
  startPrecision DatePrecision @default(MONTH)
  endPrecision   DatePrecision @default(MONTH)
  revision       Int           @default(1)
  logo           String?
  tags           String[]      @default([])
  highlights     String[]      @default([]) // 关键成果 bullets
  order          Int           @default(0)
  visible        Boolean       @default(true) // 是否在「时间戳」页显示
  showOnAbout    Boolean       @default(true) // 是否在「关于我」页显示
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?

  @@index([type, startDate(sort: Desc)])
  @@index([visible, startDate(sort: Desc)])
  @@map("timeline_items")
}

// ============================================================
//  个人档案（单例）
// ============================================================

/// 关于我（全表仅一行，id 固定为 "default"）
model Profile {
  id             String    @id @default("default")
  name           String
  headline       String // 一句话定位，如 "5 年经验前端工程师"
  avatar         String?
  bio            String    @db.Text // Markdown 自我介绍
  email          String?
  phone          String?
  location       String?
  birthday       DateTime?
  jobTitle       String?
  company        String?
  yearsOfExp     Int?
  /// [{ platform, label, url, icon }]
  socials        Json      @default("[]")
  /// [{ title, description, icon }]  个人优势
  advantages     Json      @default("[]")
  /// [{ category, items: [{ name, level(1-5), years }] }]  技能矩阵
  skills         Json      @default("[]")
  /// [{ title, description, icon }]  我能提供什么
  services       Json      @default("[]")
  resumeUrl      String?
  contactVisible Boolean   @default(true) // 是否公开联系方式
  updatedAt      DateTime  @updatedAt
  revision       Int       @default(1)

  @@map("profiles")
}

// ============================================================
//  媒体库
// ============================================================

/// 私有直传票据及持久删除队列；key保留以便故障后清理重试。
model UploadIntent {
  id           String   @id @default(cuid())
  userId       String
  key          String   @unique
  originalName String
  mimeType     String
  size         Int
  hash         String
  alt          String?
  folder       String   @default("/")
  status       String   @default("PENDING") // PENDING → PROCESSING → CONFIRMED/FAILED；DELETE为删除队列，COMPENSATE为公开写入前持久补偿票据
  mediaId      String?
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId, expiresAt])
  @@map("upload_intents")
}

model Media {
  id           String    @id @default(cuid())
  filename     String // 存储名（随机）
  originalName String // 原始文件名
  url          String
  key          String    @unique // 存储驱动中的路径
  kind         MediaKind @default(IMAGE)
  mimeType     String
  size         Int // 字节
  width        Int?
  height       Int?
  alt          String?
  folder       String    @default("/") // 逻辑目录
  hash         String?   @unique // sha256，用于秒传与去重
  uploadedBy   String?
  createdAt    DateTime  @default(now())

  @@index([folder, createdAt(sort: Desc)])
  @@index([kind, createdAt(sort: Desc)])
  @@map("media")
}

// ============================================================
//  一期仪表盘与公开页面统计
// ============================================================

/// 页面访问按天聚合
model DailyStat {
  id      String   @id @default(cuid())
  date    DateTime @db.Date
  path    String
  views   Int      @default(0)
  uniques Int      @default(0)

  @@unique([date, path])
  @@index([date(sort: Desc)])
  @@map("daily_stats")
}

```

---

## 4. 字段字典（关键表）

### `Module` — 模块开关（最重要的一张表）

| 字段 | 类型 | 必填 | 说明 | 后台可编辑 |
|---|---|:--:|---|:--:|
| `key` | String @id | ✅ | 固定枚举：`home` `log` `portfolio` `timeline` `article` `about` | ❌ 只读 |
| `name` | String | ✅ | 模块中文名 | ✅ |
| `description` | String? | | 后台说明文案 | ✅ |
| `enabled` | Boolean | ✅ | 总开关，false 时前台 404 | ✅ |
| `navVisible` | Boolean | ✅ | 是否出现在导航栏 | ✅ |
| `navLabel` | String? | | 导航文案，为空回退到 `name` | ✅ |
| `navOrder` | Int | ✅ | 导航顺序，拖拽调整 | ✅ |
| `icon` | String? | | lucide 图标名 | ✅ |
| `route` | String | ✅ | 前台路径，如 `/logs` | ✅ |
| `config` | Json? | | 模块级配置（首页露出、分页大小、子类型开关…） | ✅ |
| `isBuiltin` | Boolean | ✅ | 内置模块不可删除 | ❌ |

**初始种子数据**：

| key | name | route | navOrder | config（节选） |
|---|---|---|---|---|
| `home` | 首页 | `/` | 0 | `{}` — 且该行 `navVisible = false`（首页不出现在导航，点 Logo 即可回首页） |
| `log` | 日志 | `/logs` | 1 | `{ "pageSize": 10, "intro": "记录每天发生的事", "home": { "enabled": true, "limit": 5, "order": 3 }, "defaultView": "list", "types": { "DAILY": true, "EVENT": true, "SUMMARY": true } }` |
| `portfolio` | 作品集 | `/portfolio` | 2 | `{ "pageSize": 12, "home": { "enabled": true, "limit": 4, "order": 2 }, "layout": "grid", "showTechStack": true, "types": { "GAME": true, "REPO": true, "SKILL": true, "OTHER": true } }` |
| `timeline` | 时间戳 | `/timeline` | 3 | `{ "home": { "enabled": false, "limit": 3, "order": 5 }, "groupByYear": true, "direction": "desc", "types": { "WORK": true, "EDUCATION": true, "PROJECT": true, "AWARD": true, "MILESTONE": true } }` |
| `article` | 文章 | `/articles` | 4 | `{ "pageSize": 10, "home": { "enabled": true, "limit": 5, "order": 4 }, "showToc": true, "showViewCount": true, "relatedCount": 3 }` |
| `about` | 关于我 | `/about` | 5 | `{ "sections": { "advantages": true, "skills": true, "experience": true, "contact": true } }` |

> **`config` 的键名以 [01-architecture.md §7](01-architecture.md) 的「config 规范结构」为唯一权威定义**，本节仅给出种子值。新增配置键时必须同步更新该处，否则前后端会各写各的。

### `TimelineItem` — 时间戳

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | String | 条目标题，如「高级前端工程师 · 字节跳动」 |
| `subtitle` | String? | 副标题，如「商业化中台组」 |
| `description` | String? | Markdown 详述 |
| `type` | TimelineType | 决定颜色与图标：WORK 蓝 / EDUCATION 绿 / PROJECT 紫 / AWARD 金 / MILESTONE 橙 |
| `organization` | String? | 公司 / 学校 / 主办方 |
| `location` | String? | 城市 |
| `startDate` / `endDate` | DateTime | `endDate` 为 null 表示"至今" |
| `isCurrent` | Boolean | 为true时前台显示静态高亮圆点，不作循环动画 |
| `highlights` | String[] | 关键成果，前台渲染为 bullet 列表 |
| `visible` | Boolean | 是否在「时间戳」页出现 |
| `showOnAbout` | Boolean | 是否在「关于我」页出现 |

**排序规则**：isCurrent DESC，startDate按direction，同startDate时order ASC，最后id ASC稳定兜底。日期精度startPrecision/endPrecision独立保存，公开过滤deletedAt。

### `Log` — 日志

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | LogType | `DAILY` 每日随笔 / `EVENT` 大事件 / `SUMMARY` 总结 |
| `logDate` | Date | 归属日期（不是创建时间），用于日历视图与按天归档 |
| `mood` | String? | 心情枚举，前台渲染为 emoji |
| `weather` | String? | 天气枚举 |
| `images` | String[] | 图集 URL |
| `isPinned` | Boolean | 置顶（"关于"类日志） |
| `status` | ContentStatus | **默认 `PUBLISHED`**（写日志不该有发布负担） |

### `Project` — 作品集

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | ProjectType | `GAME` 游戏 / `REPO` 代码库 / `SKILL` 技能展示 / `OTHER` 其他 |
| `techStack` | String[] | 技术栈标签，前台渲染为徽章 |
| `links` | Json | `{ github?, demo?, video?, docs?, article? }`，前台按存在与否渲染按钮 |
| `highlights` | String[] | 项目亮点 bullet |
| `featured` | Boolean | 首页精选 |
| `order` | Int | 手动排序权重 |
| `content` | String? | 可空 —— 有些作品只需外链，不需要详情页长文 |

---

## 5. 索引设计说明

| 索引 | 支撑的查询 |
|---|---|
| `Article @@index([status, publishedAt DESC])` | 前台文章列表（最高频） |
| `Article @@index([status, isTop, publishedAt DESC])` | 后台列表（置顶优先） |
| `Article @@index([categoryId, status])` | 按分类筛选 |
| `Log @@index([type, status, logDate DESC])` | 按类型 + 状态 + 日期筛选/归档 |
| `Project @@index([type, status, order])` | 作品集按类型分 Tab |
| `Project @@index([featured, status])` | 首页精选位 |
| `TimelineItem @@index([visible, startDate DESC])` | 时间轴首屏 |
| `Module @@index([enabled, navOrder])` | 每次页面渲染都要查（走缓存，但索引仍必要） |
| `AuditLog @@index([resource, resourceId, createdAt DESC])` | "某条内容的变更历史" |
| `Session @@index([expiresAt])` | 定时清理过期会话 |
| `Media @@index([folder, createdAt DESC])` | 媒体库按目录浏览 |
| `Media.hash @unique` | 秒传 / 去重 |

### 全文搜索（PostgreSQL）

一期用 `ILIKE`，数据量上来后升级为 GIN 索引：

```sql
-- 迁移中手动添加
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content,'')), 'C')
  ) STORED;

CREATE INDEX articles_search_idx ON articles USING GIN (search_vector);
```

> 中文分词说明：`simple` 配置对中文按字切分，短文本可用；若追求效果可引入 `pg_jieba` 扩展，或用 `zhparser`。**一期先用 `ILIKE` + 前端高亮，够用且零配置。**

---

## 6. 数据迁移与种子

### 迁移工作流

```bash
# 开发：改 schema 后生成迁移
npx prisma migrate dev --name add_project_gallery

# 查看迁移状态
npx prisma migrate status

# 生产：只应用，不生成
npx prisma migrate deploy

# 可视化数据
npx prisma studio
```

### 迁移铁律

1. **迁移脚本一律向后兼容**。加字段给默认值，删字段分两次发版（先停用写入，再删列）。
2. **禁止 `migrate reset` 于生产**。
3. 每次部署：`migrate deploy` → 成功后才切流量。

### 种子数据（`prisma/seed.ts`）

```
1. 创建管理员用户（邮箱/密码从环境变量读，首次登录强制改密码）
2. 插入 6 条 Module 记录（见 §4 表格）
3. 插入默认 Setting（site.name、seo.*、theme.*、footer.*、**motion.config** —— 动效默认version2 `editorial` + decoration.none，见 [08-motion-system.md](08-motion-system.md)）
4. 插入 Profile 单例行（占位文案）
5. 插入示例 Category（技术 / 生活 / 随笔）
6. 插入 2 条示例 Article + 3 条示例 Log + 2 条 Project + 3 条 TimelineItem
   → 目的：让前台第一次跑起来就有内容可看，不是空白
```

```bash
npx prisma db seed
```

---

## 7. 数据库环境
一期统一PostgreSQL16，不维护SQLite分叉。开发Docker Compose，测试独立数据库，生产托管PostgreSQL；测试reset不得指向生产。应用连接和迁移连接按托管池合同配置。实际迁移、seed、事务/唯一约束与并发测试必须记录真实数据库证据。

新增RouteAlias持久历史路径；RateLimit共享窗口；PreviewToken保存哈希/24h有效期；Session保存rotatedAt/successorId/加密rotationReply用于10秒轮转宽限。完整字段以上述Schema为准。


## 8. 数据导出与备份

### 全站导出（后台「导出」按钮）

`GET /api/v1/admin/export` 返回一个 JSON，包含所有内容表，用于迁移或本地留档：

```jsonc
{
  "version": "1.0",
  "exportedAt": "2025-01-01T00:00:00Z",
  "data": {
    "modules": [...],
    "settings": [...],
    "profile": {...},
    "categories": [...],
    "tags": [...],
    "articles": [...],
    "logs": [...],
    "projects": [...],
    "timelineItems": [...]
  }
}
```

对应 `POST /api/v1/admin/import`（`mode: 'merge' | 'replace'`），用于换库或恢复。

### 数据库备份

```bash
# 每日定时（独立任务环境或托管备份能力）
pg_dump "$DATABASE_URL" --format=custom --file="backup-$(date +%F).dump"
# 上传到对象存储，保留 30 天
```

**恢复演练**：每季度至少做一次"从备份恢复到临时库并验证条数"的演练，否则备份等于没有。

---

## 9. 相关文档

- 接口如何暴露这些数据 → [03-api-spec.md](03-api-spec.md)
- 后台如何管理这些数据 → [04-admin-console.md](04-admin-console.md)
- 前台如何呈现这些数据 → [05-frontend-ia.md](05-frontend-ia.md)、[06-modules.md](06-modules.md)

## 独立测试数据库与Node基线
Node>=24 / npm>=11（.node-version为24.19.0），不再支持旧Node20基线。测试显式独立URL：
```powershell
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:5432/personal_site_test?schema=public'
npm run test:db
npm run test
npm run test:integration
npm run test:e2e
```
test:db使用目标URL同一服务器的/postgres管理连接创建/迁移测试库，拒绝非_test后缀；禁止测试重置开发/生产库。集成测试显式读取TEST_DATABASE_URL。

本轮真实证据（执行者协调结果）：开发/测试两库migrate deploy通过；第二迁移20261007044400_publication_backfill仅回填已发布Log/Project的空publishedAt，不改草稿或已有时间；seed重复执行计数不增加，新增日志发布时间取logDate。5unit+3真实PGintegration通过，含seed幂等和publication回填。最终复跑与整阶段验收待台账确认。
