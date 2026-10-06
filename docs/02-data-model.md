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
>   prisma.log.findMany({ where: { status: 'PUBLISHED' }, take: 10, orderBy: { logDate: 'desc' } }),
>   prisma.article.findMany({ where: { status: 'PUBLISHED' }, take: 10, orderBy: { publishedAt: 'desc' } }),
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

**典型受益案例：动效配置。** 动效系统需要一份 ~40 个字段的嵌套配置（背景类型、配色、速度、模糊、悬停效果、入场动画、六级降级参数…），见 [08-motion-system.md](08-motion-system.md)。如果用固定列：

- 加一种背景动效类型 → 改表结构 + 发版 + 迁移
- 加一个参数（如 `noiseOverlay`）→ 又一次迁移
- 40 个 nullable 列，绝大多数时候是 NULL

用 KV 存一条 `{ key: 'motion.config', group: 'motion', value: MotionConfigJSON }`，**动效系统后续怎么加参数都不需要动数据库**。这正是 §2.3 开头说的"零迁移扩展"最有价值的兑现场景。

```jsonc
// settings 表里的一行
{
  "key": "motion.config",
  "group": "motion",
  "value": { "version": 1, "preset": "breath", "intensity": "standard", "background": { /* … */ } },
  "updatedAt": "2025-01-15T10:23:00.000Z",
  "updatedBy": "clx..."
}
```

> `Setting` 表已建 `@@index([group])`，后台设置页按 group 一次查出整组配置，无额外查询成本。

### 2.4 为什么用软删除（`deletedAt`）

内容型数据被误删是高频事故。`deletedAt` 有值时：

- 前台查询一律附加 `deletedAt: null`；
- 后台默认过滤，提供「回收站」视图，可恢复或彻底删除；
- 跨表引用（如文章引用的图片）不会因删除立即断链。

**全局 Prisma 中间件**自动注入过滤条件，避免每处手写：

```ts
prisma.$use(async (params, next) => {
  const softDeleteModels = ['Article', 'Log', 'Project']
  if (softDeleteModels.includes(params.model ?? '')) {
    if (params.action === 'findMany' || params.action === 'findFirst') {
      params.args.where = { ...params.args.where, deletedAt: null }
    }
    if (params.action === 'delete') {
      params.action = 'update'
      params.args.data = { deletedAt: new Date() }
    }
  }
  return next(params)
})
```

### 2.5 为什么内容存 Markdown 而不是富文本 JSON

Markdown 是**纯文本**：可 Git diff、可脚本批量处理、可随时换渲染器、AI 读写友好、数据库迁移零风险。Tiptap JSON 会把数据锁死在特定编辑器版本上。

方案：后台用 Tiptap 编辑（所见即所得），保存时序列化为 Markdown 存储（`tiptap-markdown` 扩展）；前台用 `react-markdown` 渲染。**存储格式与编辑器解耦。**

---

## 3. 完整 Prisma Schema

> 文件位置：`prisma/schema.prisma`
> 目标数据库：**PostgreSQL**（含 `enum` 与 `String[]`）。SQLite 降级改造见 §7。

```prisma
// ============================================================
//  Personal Site · Prisma Schema
//  Target: PostgreSQL 16
//  ============================================================

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
  ADMIN   // 全部权限，含模块开关与用户管理
  EDITOR  // 内容增删改与发布，不可改站点配置
  VIEWER  // 只读，可看仪表盘与审计日志
}

/// 内容发布状态（Article / Log / Project 共用）
enum ContentStatus {
  DRAFT      // 草稿，仅后台可见
  PUBLISHED  // 已发布，前台可见
  ARCHIVED   // 已归档，前台隐藏但保留（不占用 404）
}

/// 日志类型
enum LogType {
  DAILY    // 每日随笔
  EVENT    // 大事件
  SUMMARY  // 阶段总结
}

/// 作品类型
enum ProjectType {
  GAME     // 游戏
  REPO     // 代码库
  SKILL    // Skills / 技术能力展示
  OTHER    // 个人制作的其他东西
}

/// 时间戳条目类型
enum TimelineType {
  WORK       // 工作经历
  EDUCATION  // 教育经历
  PROJECT    // 项目经历
  AWARD      // 荣誉奖项
  MILESTONE  // 个人里程碑
}

/// 媒体类型
enum MediaKind {
  IMAGE
  VIDEO
  DOCUMENT
  OTHER
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
  id           String    @id @default(cuid())
  userId       String
  refreshHash  String    @unique          // 只存哈希，明文永不落库
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  rotatedFrom  String?                    // 轮转来源，用于重放检测
  createdAt    DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([expiresAt])
  @@map("sessions")
}

/// 后台操作审计日志
model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  action     String   // create | update | delete | restore | publish | unpublish | login | logout | toggle | upload
  resource   String   // article | log | project | timeline | module | setting | media | user
  resourceId String?
  before     Json?    // 变更前快照（仅存差异字段）
  after      Json?    // 变更后快照
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
  key       String   @id            // 如 "site.name" / "seo.defaultTitle"
  value     Json
  group     String   @default("general")  // general | theme | seo | social | footer | motion | integration | feature
  label     String?                 // 后台显示名
  updatedAt DateTime @updatedAt
  updatedBy String?

  @@index([group])
  @@map("settings")
}

/// 功能模块注册表 —— 决定前台哪些栏目存在
model Module {
  key         String   @id            // home | log | portfolio | timeline | article | about
  name        String                  // 中文名，可在后台改（"日志" → "随笔"）
  description String?
  enabled     Boolean  @default(true) // 总开关
  navVisible  Boolean  @default(true) // 是否出现在导航
  navLabel    String?                 // 导航文案，空则用 name
  navOrder    Int      @default(0)    // 导航排序
  icon        String?                 // lucide 图标名
  route       String                  // /logs（可在后台改）
  config      Json?                   // 模块级配置，结构见 01-architecture §7
  isBuiltin   Boolean  @default(true) // 内置模块不可删除
  updatedAt   DateTime @updatedAt

  @@index([enabled, navOrder])
  @@map("modules")
}

// ============================================================
//  分类与标签
// ============================================================

/// 文章分类（支持树形）
model Category {
  id          String     @id @default(cuid())
  name        String
  slug        String     @unique
  description String?
  icon        String?
  color       String?
  parentId    String?
  order       Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

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
  summary        String?       // 摘要，用于卡片与 SEO description
  content        String        @db.Text  // Markdown 正文
  coverImage     String?
  status         ContentStatus @default(DRAFT)
  publishedAt    DateTime?
  isTop          Boolean       @default(false)  // 置顶
  allowComment   Boolean       @default(true)   // 一期不实现评论，预留
  readingTime    Int           @default(0)      // 预计阅读分钟数
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
  id         String        @id @default(cuid())
  title      String
  summary    String?
  content    String        @db.Text          // Markdown
  type       LogType       @default(DAILY)
  logDate    DateTime      @db.Date          // 记录的是哪一天
  mood       String?                         // happy | calm | tired | excited | down
  weather    String?                         // sunny | cloudy | rain | snow
  location   String?
  coverImage String?
  images     String[]      @default([])      // 图集
  status     ContentStatus @default(PUBLISHED) // 日志默认直接发布
  isPinned   Boolean       @default(false)
  viewCount  Int           @default(0)
  authorId   String?
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  deletedAt  DateTime?

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
  description String        @db.Text          // 卡片简介
  content     String?       @db.Text          // 详情页 Markdown（可选）
  coverImage  String?
  gallery     String[]      @default([])
  type        ProjectType   @default(REPO)
  techStack   String[]      @default([])
  role        String?                         // 担任角色
  highlights  String[]      @default([])      // 亮点 bullets
  links       Json?                           // { github, demo, video, docs, article }
  startDate   DateTime?
  endDate     DateTime?
  status      ContentStatus @default(PUBLISHED)
  featured    Boolean       @default(false)   // 首页精选
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
  id           String       @id @default(cuid())
  title        String                          // 如 "高级前端工程师 @ 某公司"
  subtitle     String?                         // 如 "核心业务组"
  description  String?      @db.Text           // Markdown
  type         TimelineType
  organization String?
  location     String?
  startDate    DateTime
  endDate      DateTime?                       // null = 至今
  isCurrent    Boolean      @default(false)
  logo         String?
  tags         String[]     @default([])
  highlights   String[]     @default([])       // 关键成果 bullets
  order        Int          @default(0)
  visible      Boolean      @default(true)     // 是否在「时间戳」页显示
  showOnAbout  Boolean      @default(true)     // 是否在「关于我」页显示
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([type, startDate(sort: Desc)])
  @@index([visible, startDate(sort: Desc)])
  @@map("timeline_items")
}

// ============================================================
//  个人档案（单例）
// ============================================================

/// 关于我（全表仅一行，id 固定为 "default"）
model Profile {
  id             String   @id @default("default")
  name           String
  headline       String                        // 一句话定位，如 "5 年经验前端工程师"
  avatar         String?
  bio            String   @db.Text             // Markdown 自我介绍
  email          String?
  phone          String?
  location       String?
  birthday       DateTime?
  jobTitle       String?
  company        String?
  yearsOfExp     Int?
  /// [{ platform, label, url, icon }]
  socials        Json     @default("[]")
  /// [{ title, description, icon }]  个人优势
  advantages     Json     @default("[]")
  /// [{ category, items: [{ name, level(1-5), years }] }]  技能矩阵
  skills         Json     @default("[]")
  /// [{ title, description, icon }]  我能提供什么
  services       Json     @default("[]")
  resumeUrl      String?
  contactVisible Boolean  @default(true)       // 是否公开联系方式
  updatedAt      DateTime @updatedAt

  @@map("profiles")
}

// ============================================================
//  媒体库
// ============================================================

model Media {
  id           String    @id @default(cuid())
  filename     String                          // 存储名（随机）
  originalName String                          // 原始文件名
  url          String
  key          String    @unique               // 存储驱动中的路径
  kind         MediaKind @default(IMAGE)
  mimeType     String
  size         Int                             // 字节
  width        Int?
  height       Int?
  alt          String?
  folder       String    @default("/")         // 逻辑目录
  hash         String?   @unique               // sha256，用于秒传与去重
  uploadedBy   String?
  createdAt    DateTime  @default(now())

  @@index([folder, createdAt(sort: Desc)])
  @@index([kind, createdAt(sort: Desc)])
  @@map("media")
}

// ============================================================
//  统计（可选，二期）
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
| `isCurrent` | Boolean | 为 true 时前台显示脉动圆点 |
| `highlights` | String[] | 关键成果，前台渲染为 bullet 列表 |
| `visible` | Boolean | 是否在「时间戳」页出现 |
| `showOnAbout` | Boolean | 是否在「关于我」页出现 |

**排序规则**：`startDate DESC`，同 startDate 时按 `order ASC`，再按 `createdAt DESC`。`isCurrent=true` 的条目始终最前。

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
3. 插入默认 Setting（site.name、seo.*、theme.*、footer.*、**motion.config** —— 动效默认用 `breath` 预设，见 [08-motion-system.md](08-motion-system.md)）
4. 插入 Profile 单例行（占位文案）
5. 插入示例 Category（技术 / 生活 / 随笔）
6. 插入 2 条示例 Article + 3 条示例 Log + 2 条 Project + 3 条 TimelineItem
   → 目的：让前台第一次跑起来就有内容可看，不是空白
```

```bash
npx prisma db seed
```

---

## 7. SQLite 降级方案

你在选型时选了 **SQLite（开发）/ Postgres（生产）**。必须知道：**SQLite 不支持 `enum` 和标量数组 `String[]`**，直接套用上面的 schema 会失败。

两条路线：

### 路线 A（推荐）· 开发也用 Postgres

一个 `docker-compose.yml` 解决，schema 完全一致，无分叉风险：

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: personal_site
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```
```bash
docker compose up -d db
# DATABASE_URL="postgresql://dev:dev@localhost:5432/personal_site?schema=public"
```

**这是唯一能保证"本地跑通 = 线上跑通"的方案。** 强烈建议采纳。

### 路线 B · 坚持 SQLite

需要以下改造，代价是类型安全下降 + 未来切换要做数据迁移：

| 原设计 | SQLite 改造 |
|---|---|
| `enum Role` | 改为 `String`，Zod 层校验取值：`z.enum(['ADMIN','EDITOR','VIEWER'])` |
| `String[]`（如 `images`、`tags`、`techStack`、`highlights`） | 改为 `String @default("[]")`，存 JSON 字符串，读写用 helper 转换 |
| `Json` 字段 | Prisma 对 SQLite 支持 `Json`，但底层是 TEXT，注意不要存超长嵌套 |
| `@db.Date` | 改为 `DateTime`，日期语义靠应用层保证 |
| `@db.Text` | 移除（SQLite 无长度限制） |
| `case-insensitive` 查询 | SQLite 的 `mode: 'insensitive'` 不支持，需用 `LIKE` + `lower()` 或存小写冗余列 |
| 并发写入 | SQLite 单写锁，后台批量操作可能 `SQLITE_BUSY`，需设置 `busy_timeout` |

**双表兼容写法（Prisma 不支持 datasource 条件切换）**：实际做法是维护 `prisma/schema.prisma`（PG）与 `prisma/schema.sqlite.prisma`（SQLite），用 `--schema` 参数切换：

```bash
# 开发
npx prisma migrate dev --schema prisma/schema.sqlite.prisma
# 生产
npx prisma migrate deploy --schema prisma/schema.prisma
```

**代价**：每次改字段要改两份，两份会漂移，漂移会在上线时爆炸。**因此不推荐。选路线 A。**

---

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
# 每日定时（Vercel Cron 或服务器 crontab）
pg_dump "$DATABASE_URL" --format=custom --file="backup-$(date +%F).dump"
# 上传到对象存储，保留 30 天
```

**恢复演练**：每季度至少做一次"从备份恢复到临时库并验证条数"的演练，否则备份等于没有。

---

## 9. 相关文档

- 接口如何暴露这些数据 → [03-api-spec.md](03-api-spec.md)
- 后台如何管理这些数据 → [04-admin-console.md](04-admin-console.md)
- 前台如何呈现这些数据 → [05-frontend-ia.md](05-frontend-ia.md)、[06-modules.md](06-modules.md)
