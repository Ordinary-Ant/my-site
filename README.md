# Personal Site · 个人网站 + 后台管理系统（设计方案）

> 面向 5 年经验前端工程师的个人品牌站。前台公开只读、三端自适应；后台私有可写，可对**全部功能模块**做开启/关闭/重命名/排序/配置。

- **状态**：设计阶段（Design Only，本仓库暂不含可运行代码）
- **方案**：Next.js 15 App Router 单体全栈 + Prisma + PostgreSQL + JWT
- **文档版本**：v1.0

---

## 一、产品目标

| 目标 | 说明 | 衡量指标 |
|---|---|---|
| 个人品牌 | 用一个站点完整表达"我是谁、我做过什么、我在想什么" | 访客 30 秒内能说出我的核心定位 |
| 内容沉淀 | 日志 / 文章长期积累，可被搜索引擎检索 | 收录页数、自然搜索流量 |
| 作品展示 | 游戏、代码库、Skills、个人制作项目统一陈列 | 作品详情页跳出率 |
| 可自运维 | 不改代码即可开关模块、改文案、换配置 | 日常内容更新 0 次发版 |
| 三端一致 | 移动 / 平板 / PC 均为一等公民 | 三端 Lighthouse ≥ 95 |

### 非目标（本期不做）

多用户注册、评论社交体系、付费内容、多语言 i18n（预留结构，M6 再做）、微服务拆分。

---

## 二、文档索引

按建议阅读顺序：

| # | 文档 | 内容 | 主要读者 |
|---|---|---|---|
| 1 | [01-architecture.md](docs/01-architecture.md) | 系统架构、技术选型、目录结构、渲染与缓存、鉴权流程、部署拓扑、环境变量 | 架构 / 自己 |
| 2 | [02-data-model.md](docs/02-data-model.md) | ER 图、**完整 Prisma Schema**、字段字典、索引设计、设计取舍、SQLite 降级方案 | 后端 / 全栈 |
| 3 | [03-api-spec.md](docs/03-api-spec.md) | REST 接口全清单、统一响应格式、分页/筛选/排序约定、错误码表、限流 | 前后端 |
| 4 | [04-admin-console.md](docs/04-admin-console.md) | 后台信息架构、**模块开关中心**、列表/表单规范、编辑器、媒体库、审计 | 前端 |
| 5 | [05-frontend-ia.md](docs/05-frontend-ia.md) | 前台信息架构、路由表、三端断点与布局、页面 ASCII 线框、组件树 | 前端 |
| 6 | [06-modules.md](docs/06-modules.md) | 五大模块（日志/作品集/时间戳/文章/关于我）逐一详细设计 | 前端 |
| 7 | [07-roadmap.md](docs/07-roadmap.md) | 里程碑拆解、工期估算、风险对策、上线检查清单 | 项目管理 |
| 8 | [08-motion-system.md](docs/08-motion-system.md) | **动效系统**：Anime.js 接入、双层策略、配置结构、两级预设、六级降级链、性能预算、后台配置界面 | 前端 / 全栈 |
| 📐 | [设计规范.md](docs/设计规范.md) | **设计规范（唯一权威）**：风格基准、色彩/排版/间距令牌、缓动与时长规范值、组件与布局规范、可访问性、性能预算、扩展指引 | 所有人 |
| 🎨 | [design/README.md](design/README.md) | **UI 设计稿**：45 张设计图 / 32 个页面，含「设计图 ↔ 文档章节」对应表与三端覆盖说明 | 前端 |
| 🖥 | [design/index.html](design/index.html) | 设计稿评审看板（用浏览器打开） | 所有人 |

---

## 三、关键决策速览（ADR）

评审时只看这一张表即可掌握全貌。

| # | 决策点 | 结论 | 理由 | 备选方案 |
|---|---|---|---|---|
| D1 | 应用形态 | **Next.js 15 单体全栈**（前台 + 后台 + API 同仓库） | 三端与 SEO 天然支持，个人站运维成本最低，无需维护两套部署 | NestJS 拆前后端、Astro + 独立 API |
| D2 | API 风格 | **REST `/api/v1` + Zod 校验** | 简单、可缓存、可被 curl/Postman 直接调试、后台与前台共用 | tRPC（类型好但生态窄）、GraphQL（本场景过度设计） |
| D3 | 数据读取路径 | **RSC/服务端直连 service 层读取；写操作走 API** | 避免客户端请求瀑布，首屏更快；写路径统一便于审计与校验 | 全部走 HTTP（多一跳） |
| D4 | 日志 vs 文章 | **分两张表** `Log` / `Article` | 字段差异大（日志有心情/天气/日期，文章有分类/SEO/阅读时长），后台菜单天然分离，表单不会出现大量空字段 | 单表 `Content` + type 枚举 |
| D5 | 经历数据 | **`TimelineItem` 单表统一承载**；「关于我」的"工作经历"复用 `type=WORK` 的数据 | 单一数据源，改一处两处生效，避免前台两份内容不同步 | 独立 `WorkExperience` 表（会双份维护） |
| D6 | 内容存储格式 | **Markdown 字符串** + Shiki 代码高亮 | 可移植、可 Git 备份、换渲染器零迁移成本、AI 友好 | Tiptap JSON（锁死编辑器）、MDX（有执行风险） |
| D7 | 模块开关 | **`Module` 表 + 缓存 tag 失效 + middleware 拦截** | 后台点一下即时生效，无需发版/重启；可排序、改名、改路由 | 环境变量（需重新部署） |
| D8 | 鉴权 | **自建 JWT**：access 15min（httpOnly Cookie）+ refresh 7d（入库、轮转、可撤销） | 无三方依赖、可主动踢下线、成本为零 | Auth.js、Clerk、Supabase Auth |
| D9 | 权限模型 | **RBAC 三角色**：ADMIN / EDITOR / VIEWER | 个人站够用且不过度设计；结构可平滑扩展到细粒度权限 | 位图权限、ABAC |
| D10 | 文件存储 | **`StorageDriver` 抽象**：本地磁盘（开发）/ S3 兼容 R2、OSS（生产） | 开发零配置，生产可无缝切换，不被供应商锁死 | 只用 S3（本地开发麻烦） |
| D11 | 数据库 | 生产 **PostgreSQL**；开发见 D12 | Prisma 一等公民，enum/数组/JSON 全支持，全文检索与索引能力强 | MySQL、MongoDB（关系型数据更合适） |
| D12 | 本地开发库 | **推荐 Docker Compose 起 Postgres**（已选 SQLite 的降级方案见 02 文档 §7） | SQLite 不支持 `enum` 与 `String[]`，会导致本地/生产 schema 分叉，是最容易踩的坑 | SQLite（需改造 schema） |
| D13 | 样式与组件 | Tailwind CSS v4 + shadcn/ui (Radix) + `next-themes` | 无运行时样式开销、组件源码可控、无障碍由 Radix 兜底、暗色模式开箱 | MUI、Ant Design、CSS Modules |
| D14 | 编辑器 | Tiptap（Markdown 进出） | React 原生、扩展性强、所见即所得同时不锁数据格式 | MDXEditor、milkdown、纯 textarea |
| D15 | 部署 | **Vercel + Neon Postgres + Cloudflare R2**（备选 Docker + VPS） | 个人站免费额度充足，CI/CD 零配置，全球 CDN | 自建 VPS + Nginx + Docker |
| D16 | 动效架构 | **CSS + Anime.js 双层**：首屏与悬停态用 CSS（0 KB），编排类动效用 Anime.js v4.5 | 首屏不依赖 JS（Hero 逐行揭示用 CSS，避免慢网络下动效事故）；Anime.js 的 `createTimeline`/`splitText`/`onScroll`/`createScope` 是"编排型"动效的成熟方案 | 全手写 JS（重复造轮子）、Framer Motion（React-only，体积更大） |
| D17 | 动效风格基准 | 参照 **[Clay Showreel 2023](https://showreel.design/videos/clay-showreel-2023/) / [clay.global](https://clay.global/)**，风格标注 **Minimal / Clean** | 从"炫技向"（极光/粒子/星空）转向"**编排向**"（逐行遮罩揭示、滚动叙事、克制交错）。粒子类降为默认关闭的可选项 | 保持原炫技向方案（与参考作品方向相反） |
| D18 | 动效可配范围 | 两级：**编排预设**（static / editorial / narrative / kinetic）+ **装饰预设**（可叠加，默认全关） | 主轴变成"页面怎么动"而非"背景有多花"，与 Minimal/Clean 一致 | 8 个平铺预设（背景与编排混在一起，无法表达"编排强度"） |
| D19 | 动效降级 | **六级降级链**，`prefers-reduced-motion` 优先级高于后台配置 | 用户系统偏好不可被站点覆盖（无障碍要求）；移动端/FPS/省电模式自动降档，访客无感 | 只做一个总开关（会伤低端设备与无障碍用户） |
| D20 | 动效体积 | 动效 JS **≤ 28 KB** gzip；首屏 JS ≤ **135 KB** | 实测：Anime.js 含 `splitText` 22.8 KB、完整能力 24.8 KB，加自研运行时约 27 KB。旧红线 25 KB 已不成立，如实放宽并说明理由 | 硬守 25 KB 而砍掉文字揭示（丢掉风格核心能力） |
| D21 | 设计规范 | 单独立一份 [设计规范.md](docs/设计规范.md) 作为**视觉与动效的唯一权威** | 设计图是"长什么样"、文档是"为什么"、规范是"**用什么值**"。避免三个月后没人知道为什么是 280ms | 把规范值散落在各文档里（必然漂移） |

---

## 四、五大功能模块一览

| 模块 | 路由 | 定位 | 内容形态 | 可开关 |
|---|---|---|---|---|
| 首页 | `/` | 聚合入口 | 各模块精选拼装 | ✅（各卡片位独立配置） |
| 日志 | `/logs` | 每日随笔、大事件、总结 | 短文 + 图集 + 心情/天气 | ✅ 整体 / 按类型 |
| 作品集 | `/portfolio` | 游戏、代码库、Skills、个人制作 | 卡片 + 详情页 + 外链 | ✅ 整体 / 按类型 |
| 时间戳 | `/timeline` | 学习与工作经历 | 竖向时间轴 | ✅ 整体 / 按类型 |
| 文章 | `/articles` | 正式对外发布的长文 | 长文 + 分类 + 标签 + TOC | ✅ 整体 / 按分类 |
| 关于我 | `/about` | 基本信息、优势、技能、经历 | 结构化档案 | ✅ 整体 / 按区块 |

**"替换 / 编辑 / 开启关闭"三件事的落地方式**：见 [04-admin-console.md §3 模块开关中心](docs/04-admin-console.md)。

---

## 五、技术栈清单

```
运行时      Node.js 20 LTS+（本机已验证 v24.19.0 可用）
框架        Next.js 15（App Router, RSC, Server Actions）
语言        TypeScript 5.x（strict）
样式        Tailwind CSS v4 + CSS Variables（主题令牌）
组件库      shadcn/ui（Radix UI 底座，源码内联可改）
图标        lucide-react
主题        next-themes（light / dark / system）
数据层      Prisma 6 + PostgreSQL 16
校验        Zod（前后端共用同一份 schema）
鉴权        jose(JWT) + argon2 或 bcrypt
编辑器      Tiptap 2 + Markdown 序列化
Markdown    react-markdown + remark-gfm + rehype-pretty-code(Shiki)
动画        Framer Motion（局部）+ CSS transition（优先）
表单         React Hook Form + Zod resolver
数据请求     TanStack Query（仅后台客户端表格）
表格         TanStack Table（后台列表）
虚拟列表     @tanstack/react-virtual（长列表）
上传         next-safe-action / Route Handler + StorageDriver
测试        Vitest + Testing Library + Playwright(E2E 冒烟)
代码质量     ESLint + Prettier + husky + lint-staged + commitlint
部署        Vercel + Neon + Cloudflare R2
```

> **包管理器**：本机未安装 pnpm。文档命令默认写 `npm`；若你偏好 pnpm，先 `npm i -g pnpm` 或 `corepack enable pnpm`，命令等价替换即可。

---

## 六、里程碑总览

| 阶段 | 目标 | 预估 | 交付 | 状态 |
|---|---|---|---|---|
| M0 | 项目初始化与骨架 | 2 人天 | 可跑的空白站 + CI | ✅ **已完成并验证** |
| M1 | 数据层与鉴权 | 4 人天 | Schema 落库 + 可登录后台 | ⬜ |
| M2 | 后台 CRUD 与开关中心 | 8 人天 | 五大模块内容可管理 | ⬜ |
| M3 | 前台五大模块 | 10 人天 | 三端可用的完整前台 | ⬜ |
| M4 | 媒体库 / 搜索 / SEO / 打磨 | 5 人天 | 可对外发布 | ⬜ |
| M4.5 | 动效系统（可后台配置） | 3.5 人天 | 8 预设 + 后台实时预览 | ⬜ |
| M5 | 上线与运维 | 2 人天 | 域名 + 监控 + 备份 | ⬜ |
| **合计** | | **约 34.5 人天**（业余每晚 3h ≈ 9~11 周） | | |

详见 [07-roadmap.md](docs/07-roadmap.md)。

---

## 七、快速开始

```bash
# 0. 确认 Node 版本 ≥ 20.12
node -v

# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env

# 3. 启动本地数据库（需要 Docker Desktop 已运行）
npm run db:up

# 4. 建表
npm run db:migrate        # 首次会提示输入迁移名，填 init 即可

# 5. 灌入种子数据（管理员 + 6 个模块 + 示例内容）
npm run db:seed

# 6. 起开发服务器
npm run dev
```

打开 http://localhost:3000 —— 你会看到 M0 烟雾测试首页（用来验证设计令牌、主题切换、路径别名是否生效）。

> **`node_modules` 已经装好了**（715 个包，Next 15.5.27 / React 19.3.0 / Tailwind 4.3.3 / Prisma 6.19.3）。
> 如果 `npm js.org` 不可达，用国内镜像：`npm install --registry=https://registry.npmmirror.com`

### 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建（先 `prisma generate` 再 `next build`） |
| `npm start` | 跑生产构建产物 |
| `npm run check` | typecheck + lint |
| **`npm run verify`** | **离线静态检查**（import 解析 / 依赖声明 / 设计令牌 / Prisma 关系 / 环境变量），可挂 CI |
| `npm run db:studio` | 可视化查看数据库 |
| `npm run db:up` / `db:down` | 启停本地 Postgres |
| `npm run db:reset` | 重置数据库并重跑迁移 + 种子 |
| `npm run format` | Prettier 格式化 |

### 已验证状态

M0 的以下环节**已实际跑通**：

```
✓ prisma validate          schema 有效（14 models / 6 enums）
✓ npm run build            Compiled successfully，4 个静态页生成，exit 0
✓ npm run check            tsc --noEmit + eslint 全绿
✓ npm run verify           5 项离线静态检查全部通过
✓ npm start + HTTP 冒烟    / 返回 200；/不存在 返回 404
✓ Tailwind 编译产物        22.6 KB，含 .container-page / .text-fg-subtle /
                           .shadow-card / .dark 变体 / tw-animate 动画
```

### 如果构建报错

| 现象 | 原因与处理 |
|---|---|
| `Environment variable not found: DATABASE_URL` | 本地缺 `.env`。`cp .env.example .env`。注意：**存在 `prisma.config.ts` 后 Prisma 不再自动加载 `.env`**，已在该文件里用 `process.loadEnvFile()` 手动补上 |
| `Failed to resolve @import "tw-animate-css"` | 该包只在 shadcn 组件（Dialog/Select）的进场动画里用到。删掉 `src/app/globals.css` 顶部那行 `@import 'tw-animate-css';` 即可，其余不受影响。已验证 `tw-animate-css@1.4.0` 正常 |
| `npm error code ERR_TLS_CERT_ALTNAME_INVALID` | npm 官方源不可达。加 `--registry=https://registry.npmmirror.com` |
| `npm warn allow-scripts ...` | npm 11 默认拦截 install script。Prisma 引擎与 esbuild 二进制依赖它。已批准并记录在 `package.json` 的 `allowScripts`；换机器后如再遇到，跑 `npm approve-scripts prisma @prisma/client @prisma/engines esbuild unrs-resolver` |
| `Cannot find module '@prisma/client'` | 执行 `npm run db:generate` |
| `JWT_SECRET 至少 32 位` | `.env` 里的占位值被改短了。重新生成长随机串 |
| 端口 5432 被占用 | 本机已有 Postgres。改 `docker-compose.yml` 的宿主端口并同步 `.env` |
| `Component ... cannot be a client component` | 把 `'use client'` 加到了含 `import { env } from '@/lib/env'` 的文件上。`env.ts` 带 `server-only`，只能服务端用 |

### 还没验证的部分

`npm run db:migrate` 与 `npm run db:seed` **未跑过** —— 需要 Docker 起 Postgres，构建环境里没有。SQL 层第一次真正执行是在你本地跑第 3–5 步的时候。

Prisma schema 本身已通过 `prisma validate`；`seed.ts` 已通过 `tsc` 类型检查（它在 `tsconfig.include` 范围内，`next build` 时会一起被检查）。

### 设计稿怎么看

```bash
# 用浏览器打开评审看板（45 张设计图）
design/index.html
```

详细说明见 [design/README.md](design/README.md)。

---

## 八、目录结构（M0 已就位）

```
personal-site/
├─ design/                      ← UI 设计稿（45 张图 + 32 个页面源稿 + 评审看板）
│  ├─ README.md                 ← 设计图 ↔ 文档章节对应表
│  ├─ index.html                ← 评审看板
│  ├─ shots/ · _assets/ · _tools/
│
├─ docs/                        ← 8 份设计文档
├─ prisma/
│  ├─ schema.prisma             ✅ 已就位（19 张表）
│  ├─ migrations/               ⬜ 等 npm run db:migrate 生成
│  └─ seed.ts                   ✅ 已就位
│
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx             ✅ 根布局（主题 Provider + 字体 + SEO）
│  │  ├─ globals.css            ✅ 设计令牌（Tailwind v4 @theme）
│  │  ├─ not-found.tsx          ✅ 404
│  │  ├─ error.tsx              ✅ 错误边界
│  │  ├─ (site)/                ✅ 前台路由组（layout + 占位首页）
│  │  │  ├─ layout.tsx             Header / Footer 骨架
│  │  │  └─ page.tsx               M0 烟雾测试页
│  │  ├─ (admin)/               ⬜ M1：/login 与 /admin
│  │  └─ api/v1/                ⬜ M1：REST 接口
│  │
│  ├─ config/
│  │  ├─ site.ts                ✅ 站点兜底配置
│  │  └─ modules.ts             ✅ 模块注册表（6 个模块 + config 规范结构）
│  │
│  ├─ lib/
│  │  ├─ env.ts                 ✅ 环境变量 Zod 校验（含 server-only 守卫）
│  │  ├─ prisma.ts              ✅ Prisma 单例
│  │  ├─ utils.ts               ✅ cn / 阅读时长 / slugify / 日期格式化
│  │  ├─ auth/ · api/ · validators/ · services/ · storage/ · motion/   ⬜ M1–M4.5
│  │
│  ├─ components/
│  │  ├─ ui/ · site/ · admin/ · shared/                                ⬜ M0 后段 / M2 / M3
│  │
│  ├─ styles/
│  │  └─ motion.css             ✅ 动效骨架 + 安全兜底（完整实现在 M4.5）
│  │
│  ├─ hooks/ · types/                                                  ⬜
│  └─ middleware.ts             ⬜ M1
│
├─ public/
├─ scripts/
│  └─ verify-scaffold.mjs       ✅ 离线静态检查器（npm run verify）
├─ docker-compose.yml           ✅ 本地 Postgres 16
├─ package.json                 ✅ 依赖与脚本（含 allowScripts 白名单）
├─ tsconfig.json                ✅ strict + 路径别名 @/*
├─ next.config.ts               ✅ 安全响应头 + 图片配置
├─ postcss.config.mjs           ✅ Tailwind v4
├─ prisma.config.ts             ✅ Prisma 配置（seed 命令 + 手动加载 .env）
├─ eslint.config.mjs            ✅ 含「middleware 禁止引入 Prisma」规则
├─ prettier 相关                 ✅ .prettierrc / .prettierignore
├─ husky + lint-staged + commitlint  ✅
├─ .env.example                 ✅ 环境变量模板（本地 cp 成 .env）
└─ .env                         ⛔ 本地私密文件，已 gitignore
```

> **注意**：本仓库使用 Tailwind CSS v4（CSS-first 配置），**没有 `tailwind.config.ts`**。断点、颜色、圆角等全部定义在 `src/app/globals.css` 的 `@theme` 里。若你更习惯 v3 的 JS 配置，见 [07-roadmap.md §2 风险表](docs/07-roadmap.md)。

---

## 九、待你确认的开放问题（已按推荐默认执行）

以下问题在原设计评审时列出，你回复「按你默认就行」后已按推荐值落地：

| # | 问题 | 已采用 |
|---|---|---|
| Q1 | 本地开发数据库 | ✅ **Docker Postgres**（`docker-compose.yml` 已就位） |
| Q2 | 是否需要评论区 | ✅ 一期不做，`Article.allowComment` 字段已预留 |
| Q3 | 访客留言 / 邮件订阅 | ✅ 二期做，`Profile` 与表单结构已预留 |
| Q4 | 部署目标 | ✅ Vercel（备选 Docker + VPS，见 [01 §12](docs/01-architecture.md)） |
| Q5 | 域名与站点名 | ✅ 先写死在 `Setting` 表，M4 阶段再定 |
| Q6 | 是否 i18n | ✅ 一期只做中文，结构预留 |

