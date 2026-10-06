# 07 · 实施路线图

[← 上一篇：模块详解](06-modules.md) · [返回 README](../README.md)

---

## 1. 里程碑总览

| 阶段 | 目标 | 预估 | 状态 |
|---|---|---|---|
| **M0** | 项目初始化与骨架 | 2 人天 | ⬜ 未开始 |
| **M1** | 数据层与鉴权 | 4 人天 | ⬜ 未开始 |
| **M2** | 后台 CRUD 与模块开关中心 | 8 人天 | ⬜ 未开始 |
| **M3** | 前台五大模块 | 10 人天 | ⬜ 未开始 |
| **M4** | 媒体库 / 搜索 / SEO / 打磨 | 5 人天 | ⬜ 未开始 |
| **M5** | 上线与运维 | 2 人天 | ⬜ 未开始 |
| | **合计** | **约 31 人天** | |

**时间换算**：全职 ≈ 6–7 周；业余每晚 3 小时 + 周末 ≈ 8–10 周。

**关键路径**：`M0 → M1 → M2 → M3 → M4 → M5`，其中 **M2 的模块开关中心**是风险最高的环节（自定义交互多），建议预留 buffer。

---

## 2. M0 · 项目初始化与骨架（2 人天）

### 任务

- [ ] `npx create-next-app@latest` — TypeScript / App Router / Tailwind / ESLint / src 目录 / 别名 `@/*`
- [ ] 安装依赖：`prisma @prisma/client zod jose argon2 next-themes lucide-react`
- [ ] 安装后台依赖：`@tanstack/react-query @tanstack/react-table react-hook-form @hookform/resolvers sonner`
- [ ] 安装编辑器：`@tiptap/react @tiptap/starter-kit tiptap-markdown`
- [ ] 安装渲染：`react-markdown remark-gfm rehype-pretty-code shiki`
- [ ] （可选）`dnd-kit` 用于拖拽排序
- [ ] `npx shadcn@latest init` + 安装基础组件（button/card/input/select/dialog/sheet/table/switch/badge/tabs/dropdown-menu/accordion/tooltip/sonner）
- [ ] 配置 `tailwind.config.ts`：断点（`xs`/`md`/`lg` 定制）、`typography` 插件、颜色令牌
- [ ] 编写 `app/globals.css` 的 CSS 变量（亮/暗两套主题）— 参考 [05-frontend-ia.md §7](05-frontend-ia.md)
- [ ] 建立目录骨架（`components/ui|site|admin|shared`、`lib/*`、`config/*`）
- [ ] 配置 `lib/env.ts`（Zod 校验环境变量，fail fast）
- [ ] 配置 eslint / prettier / husky / lint-staged / commitlint
- [ ] 创建 `.env.example` 与 `.env.local`
- [ ] `docker-compose.yml` 起 Postgres
- [ ] `app/layout.tsx` 根布局 + `next/font` 字体 + 主题 Provider
- [ ] 写一个占位首页与 404 页，确认 `npm run dev` 能跑

### 产出
一个能跑起来的空白站点 + 完整的工程化配置。

### 验收
- [ ] `npm run dev` 无报错，首页可见
- [ ] `npm run build` 成功
- [ ] 亮/暗主题切换无闪烁
- [ ] `npx prisma -v` 与 `docker compose ps` 正常
- [ ] commit 时 lint 自动运行

### 风险
| 风险 | 对策 |
|---|---|
| Tailwind v4 与 shadcn 的兼容性 | 若遇问题，回退 Tailwind v3（配置差异小，不影响架构） |
| Node 24 与某些依赖不兼容 | 本机已是 v24.19.0；如遇问题用 `nvm` 切到 Node 20 LTS |

---

## 3. M1 · 数据层与鉴权（4 人天）

### 任务

**数据层**
- [ ] 编写完整 `prisma/schema.prisma`（[02-data-model.md §3](02-data-model.md) 全文）
- [ ] `npx prisma migrate dev --name init`
- [ ] 实现 `lib/prisma.ts`（单例 + 软删除中间件）
- [ ] 编写 `prisma/seed.ts`：管理员用户 + 6 条 Module + 默认 Setting + Profile + 示例内容
- [ ] `npx prisma db seed` 验证
- [ ] 编写 `lib/validators/*.ts`：Article / Log / Project / Timeline / Profile / Module / Setting 的 Zod schema（**前后端共用**）
- [ ] 实现 `lib/api/response.ts`：`ok()` / `fail()` / `parsePagination()` / `parseSort()`
- [ ] 实现 `lib/api/errors.ts`：领域错误类（`NotFoundError` / `ConflictError` / `ForbiddenError` / `ModuleDisabledError`）+ 统一错误码映射

**鉴权**
- [ ] `lib/auth/password.ts` — argon2 哈希与校验
- [ ] `lib/auth/jwt.ts` — 签发/验证 access token（`jose`，**需可在 Edge 运行**）
- [ ] `lib/auth/session.ts` — refresh token 生成、哈希入库、轮转、撤销、重放检测
- [ ] `lib/auth/rbac.ts` — 角色 → 权限映射 + `requirePermission()`
- [ ] `lib/auth/current-user.ts` — 服务端读取当前用户（Node Runtime）
- [ ] 实现 `/api/v1/auth/login|refresh|logout|logout-all|me|change-password`
- [ ] 实现限流中间件（内存 Map 版本）
- [ ] 编写 `middleware.ts`：**仅做轻量 JWT 校验与重定向**（不查库）
- [ ] 实现 `/login` 登录页
- [ ] 实现 `(admin)/admin/layout.tsx` 的二次校验（查库确认用户有效）

**Service 层骨架**
- [ ] `lib/services/moduleService.ts` + 缓存（`unstable_cache` + tag）
- [ ] 其余 service 建立文件与接口签名（先留 TODO）

### 产出
数据库就绪，能登录进空白后台。

### 验收
- [ ] `prisma studio` 能看到所有表与种子数据
- [ ] 登录成功后 Cookie 中有 `at` 与 `rt`，均为 `httpOnly`
- [ ] 访问 `/admin` 未登录时跳转 `/login`
- [ ] 用 VIEWER 角色登录后，ADMIN 专属接口返回 `403 FORBIDDEN`
- [ ] 连续 6 次错误登录后返回 `429`，响应带 `Retry-After`
- [ ] 手动篡改 `at` 后请求被拒绝
- [ ] refresh 轮转后旧 `rt` 复用返回 `401 TOKEN_REUSED` 且全部会话被撤销
- [ ] `middleware.ts` 中**没有** Prisma 引用（关键检查）

### 风险
| 风险 | 对策 |
|---|---|
| **middleware 里误用 Prisma** | 在 ESLint 加规则禁止 `middleware.ts` import `lib/prisma`；M1 验收项已含此项 |
| SQLite 与 Postgres schema 分叉 | 已选 Docker Postgres（[02 §7 路线 A](02-data-model.md)） |
| argon2 在某些环境需编译 | 若安装失败改用 `bcryptjs`（纯 JS，性能略低但无编译） |

---

## 4. M2 · 后台 CRUD 与模块开关中心（8 人天）

**这是整个项目最大的一块，也是最有价值的一块。**

### 4.1 通用基础组件（2.5 人天）

- [ ] `admin/layout.tsx` — 后台 shell：侧边栏 + 顶部栏 + 面包屑
- [ ] 侧边栏导航（按权限过滤菜单项）
- [ ] 配好 TanStack Query Provider 与 `lib/api/client.ts`（fetch 封装 + 401 自动刷新 + 并发刷新去重）
- [ ] `DataTable` 泛型组件（列定义、排序、选择、分页、骨架、空态、列设置）
- [ ] `FilterBar`（与 URL query 双向同步）
- [ ] `FormField`（label + 控件 + 错误 + 帮助文本）
- [ ] `ConfirmDialog`（支持「影响清单」模式）
- [ ] `PageHeader`、`StatusBadge`、`EmptyState`
- [ ] `MarkdownEditor`（Tiptap + 图片上传 + Markdown 进出）
- [ ] `MediaPicker`（含上传）
- [ ] `ArrayFieldEditor`（拖拽 + 图标选择）
- [ ] `SortableList`（dnd-kit 封装）
- [ ] 统一 toast（sonner）+ 错误码 → 中文提示映射表

### 4.2 五个内容模块的 CRUD（4 人天）

每个模块都要做：列表页 + 表单页 + 批量操作 + 回收站 + 对应的 service 与 API。

- [ ] **文章**（最复杂：分类、标签、SEO、字数统计、自动保存）
- [ ] **日志**（含日历视图 + 快速记录抽屉）
- [ ] **作品集**（含图集排序 + 外链管理）
- [ ] **时间戳**（列表即排序界面）
- [ ] **关于我**（单例 + 数组字段编辑器）
- [ ] 分类管理（树形）
- [ ] 标签管理（含合并）
- [ ] 每个模块的 service 层完整实现 + `revalidateTag` 调用 + AuditLog 写入

### 4.3 模块开关中心（1.5 人天）★

- [ ] `GET/PATCH /api/v1/admin/modules/:key` + `/reorder`
- [ ] 模块列表页：拖拽排序、行内改名、路由编辑、双开关
- [ ] 开关的**乐观更新** + 失败回滚
- [ ] 关闭确认弹窗（影响清单版）
- [ ] 撤销 toast（5 秒内可恢复）
- [ ] 模块配置抽屉（按模块渲染不同配置项）
- [ ] 内置约束校验（home 不可关、route 唯一且在保留路径之外）
- [ ] 内容量统计徽章
- [ ] 下方内嵌近期审计日志

### 4.4 仪表盘与审计（1 人天）

- [ ] `/api/v1/admin/stats` 聚合接口
- [ ] 仪表盘页面（统计卡 + 快捷操作 + 热门/最近 + 系统状态）
- [ ] 审计日志页面（筛选 + before/after diff 对照）

### 产出
一个功能完整的后台，能管理全站内容并开关模块。

### 验收
- [ ] 五个模块都能完成"新建 → 编辑 → 发布 → 下架 → 删除 → 恢复"全流程
- [ ] 文章表单能粘贴图片自动上传并插入
- [ ] `Cmd/Ctrl + S` 能保存，`Cmd/Ctrl + Enter` 能保存并发布
- [ ] 时间戳拖拽排序后刷新页面顺序保持
- [ ] **模块开关切换后 5 秒内前台生效**（关键验收）
- [ ] 关闭模块后「撤销」能恢复
- [ ] 关闭「日志」后首页日志区块消失、`/logs` 404、后台仍能管理日志
- [ ] 所有写操作在审计日志中可查
- [ ] 移动端后台能完成"改标题 + 保存"的应急操作
- [ ] 表格在 1000 条数据下滚动流畅

### 风险
| 风险 | 对策 |
|---|---|
| 五个模块表单重复度高，容易写散 | **先完成「文章」全过程**，抽出通用组件后再做其余四个 |
| Tiptap Markdown 序列化有损（表格、嵌套列表） | M2 早期做序列化往返测试：`md → tiptap → md` 应保持不变；有损的语法记入白名单 |
| 拖拽库在触屏上体验差 | 移动端提供上下箭头按钮作为兜底 |
| 乐观更新失败回滚不干净 | 统一用 TanStack Query 的 `onMutate`/`onError` 模式，不手写状态 |

---

## 5. M3 · 前台五大模块（10 人天）

### 5.1 前台骨架（2 人天）

- [ ] `(site)/layout.tsx` + Header（动态导航）+ Footer
- [ ] `MobileTabBar`（移动端底部导航）
- [ ] `MobileDrawer`（抽屉导航）
- [ ] 主题切换（`next-themes`，无闪烁）
- [ ] `MarkdownRenderer` + `Prose` 排版容器
- [ ] `CodeBlock`（Shiki 服务端高亮 + 复制按钮）
- [ ] 自定义 Markdown 块（`:::tip` / `:::warning` / `:::details` / `:::video`）
- [ ] `CoverImage`（next/image 封装 + 模糊占位）
- [ ] `Pagination`、`EmptyState`、`Skeleton*`
- [ ] 各模块 `layout.tsx` 中的模块开关校验（`notFound()`）

### 5.2 五大模块页面（8 人天）

- [ ] **首页**（1.5 人天）— Hero + 四个动态区块 + 顺序/条数配置
- [ ] **日志**（1.5 人天）— 列表（按月分组）+ 详情 + 日历视图
- [ ] **作品集**（2 人天）— 列表（网格/列表切换）+ 详情（图集 Lightbox）+ Skills 特殊卡片
- [ ] **文章**（2 人天）— 列表 + 详情（TOC + 进度条 + 相关文章 + 上下篇）+ 分类/标签归档
- [ ] **时间戳**（1 人天）— 时间轴（PC 中轴对称 / 移动单列）+ 年份锚点
- [ ] **关于我**（1.5 人天）— Hero + 六个可开关区块 + 技能条动画
- [ ] **搜索页**（0.5 人天）
- [ ] 所有页面的加载/空/错误三态
- [ ] 所有页面的三端响应式走查

### 产出
一个三端可用的完整前台。

### 验收
- [ ] 五个模块在三端（375px / 768px / 1440px）下均无横向滚动条
- [ ] 移动端触控目标 ≥ 44×44px
- [ ] 所有页面的加载/空/错误状态都有设计过的样子
- [ ] 关闭任一模块后，导航、首页、sitemap、RSS 全部同步
- [ ] 前台组件中不出现 `prisma` 或 Node API 的导入
- [ ] 屏幕阅读器能正确读出页面结构（抽查文章详情页）
- [ ] 键盘能完成"进入文章 → 用 TOC 跳转 → 复制代码"全流程

### 风险
| 风险 | 对策 |
|---|---|
| 移动端中轴对称时间轴可读性差 | 已定方案：移动端改单列右对齐（不要照搬 PC） |
| 三端回归测试耗时 | 用 Playwright 写 5 个冒烟用例（每端各跑一次关键路径），而不是手工走查 |
| Markdown 渲染引入大体积依赖 | 确认 `react-markdown` 在 RSC 中渲染（零客户端 JS），Shiki 走服务端 |

---

## 6. M4 · 媒体库 / 搜索 / SEO / 打磨（5 人天）

- [ ] 媒体库页面（目录树 + 网格 + 上传 + 引用追踪 + 批量操作）（1.5 人天）
- [ ] `StorageDriver` 抽象 + `LocalDriver` + `S3Driver`（1 人天）
- [ ] 上传优化：`sharp` 转 WebP + 生成缩略图 + sha256 秒传（1 人天）
- [ ] 站内搜索（`ILIKE` 跨表 + 高亮 + 类型筛选）（0.5 人天）
- [ ] SEO 基建（1 人天）
  - [ ] `sitemap.ts`（只含已发布 + 模块启用）
  - [ ] `robots.ts`
  - [ ] `rss.xml/route.ts`
  - [ ] JSON-LD 结构化数据（`Person` / `BlogPosting` / `CreativeWork` / `BreadcrumbList`）
  - [ ] `next/og` 动态 OG 图
  - [ ] `canonical` 标签
  - [ ] 各页面 `generateMetadata`

### 验收
- [ ] `sitemap.xml` 在模块关闭后不含对应 URL
- [ ] RSS 可被阅读器正常订阅
- [ ] Google 富媒体测试工具校验 JSON-LD 无错误
- [ ] OG 图在社交平台预览正常
- [ ] 媒体上传后能在编辑器中插入并正确显示
- [ ] 上传大文件超限时给出明确错误提示
- [ ] 搜索能跨文章/日志/作品返回结果且命中词高亮

---

## 7. M5 · 上线与运维（2 人天）

- [ ] 购买域名 + 配置 DNS
- [ ] 部署到 Vercel，配置所有环境变量（`JWT_SECRET` 用 `openssl rand -base64 48` 生成）
- [ ] NEON / Supabase 创建 Postgres，跑 `prisma migrate deploy` + seed
- [ ] Cloudflare R2 建桶，切 `STORAGE_DRIVER=s3`
- [ ] 修改管理员默认密码
- [ ] 配置 Sentry 错误上报
- [ ] 配置 Vercel Analytics 或 Umami
- [ ] 配置每日 `pg_dump` 备份（Vercel Cron）
- [ ] 安全响应头下发（`next.config.ts` 的 `headers()`）
- [ ] Lighthouse 跑分并优化到目标
- [ ] 提交搜索引擎（Google Search Console / Bing）
- [ ] 写一份「运维手册」（如何备份、如何恢复、如何加新模块）

### 上线检查清单

**功能**
- [ ] 五个模块前台全部可访问且内容正确
- [ ] 后台所有 CRUD 正常
- [ ] 模块开关生效且可撤销
- [ ] 登录/登出/改密/令牌刷新正常
- [ ] 媒体上传与显示正常

**安全**
- [ ] `JWT_SECRET` 已换成强随机值（不是默认值）
- [ ] 管理员密码已从初始密码修改
- [ ] `.env` 未提交到 Git（检查 `git log --all -- .env`）
- [ ] `/admin` 返回 `X-Robots-Tag: noindex`
- [ ] 登录限流生效（手动试 6 次）
- [ ] 上传接口拒绝非法文件类型（手动试 `.exe` 改名成 `.jpg`）
- [ ] 安全响应头齐全（用 securityheaders.com 检查）
- [ ] `npm audit` 无 high/critical 漏洞

**性能**
- [ ] 移动端 Lighthouse Performance ≥ 90
- [ ] PC 端 Lighthouse Performance ≥ 95
- [ ] Accessibility ≥ 95
- [ ] Best Practices ≥ 95
- [ ] SEO ≥ 95
- [ ] 文章详情页首屏 JS ≤ 110KB（gzip）
- [ ] 图片均走 `next/image`，无原始大图直出

**SEO**
- [ ] `sitemap.xml` 可访问且内容正确
- [ ] `robots.txt` 正确排除 `/admin` `/api` `/search`
- [ ] RSS 可订阅
- [ ] 每页有唯一的 `title` 与 `description`
- [ ] OG 图正常

**运维**
- [ ] 备份任务已配置且成功执行过一次
- [ ] **做过一次恢复演练**（从备份恢复到临时库并验证条数）
- [ ] 错误上报已接入且能收到测试错误
- [ ] `/api/health` 返回正常
- [ ] 域名 HTTPS 证书有效且自动续期

**内容**
- [ ] 至少 3 篇文章、10 条日志、4 个作品、5 条时间戳（否则首页显得空）
- [ ] 「关于我」所有字段填写完整
- [ ] 所有图片有 `alt`
- [ ] 没有占位文案（"Lorem ipsum"、"待填写"）残留

---

## 8. 风险登记册

| # | 风险 | 概率 | 影响 | 对策 |
|---|---|:--:|:--:|---|
| R1 | middleware 误用 Prisma 导致构建失败 | 中 | 高 | ESLint 规则禁止；M1 验收项 |
| R2 | SQLite / Postgres schema 分叉 | 中 | 高 | 统一用 Docker Postgres |
| R3 | Tiptap ↔ Markdown 序列化有损 | 中 | 中 | M2 早期做往返测试；有损语法记入白名单文档 |
| R4 | 模块开关的缓存失效不彻底 | 中 | 高 | 所有失效集中在 service 层；写集成测试验证开关后前台响应 |
| R5 | 三端回归测试遗漏 | 高 | 中 | Playwright 三视口冒烟用例纳入 CI |
| R6 | 个人项目时间被工作挤占 | 高 | 中 | 里程碑切小，每个 M 都是可交付的独立成果，随时可停 |
| R7 | 范围蔓延（想加评论、i18n、PWA…） | 高 | 中 | 明确非目标清单；全部记入 M6 backlog，一期不碰 |
| R8 | Vercel 免费额度不够 | 低 | 低 | 有 Docker 自建方案作为 Plan B（[01 §12](01-architecture.md)） |
| R9 | refresh token 实现有安全漏洞 | 低 | 高 | 严格按 [01 §6.2](01-architecture.md) 时序实现；M1 验收含重放检测 |
| R10 | 内容写不出来（最真实的风险） | 中 | 高 | 先发 3 篇"存量内容"（把已有笔记整理成文章），不要等灵感 |

---

## 9. M6 · 后续迭代 Backlog（一期不做）

| 优先级 | 功能 | 说明 |
|:--:|---|---|
| P1 | 评论区 | `allowComment` 字段已预留；建议接 Giscus（基于 GitHub Discussions，零后端） |
| P1 | 访客留言板 | `Message` 表 + 后台审核 |
| P1 | 邮件订阅 | `Subscriber` 表 + Resend 发信 + 新文章通知 |
| P2 | 全文检索升级 | Postgres `tsvector` + GIN 索引，或 Meilisearch |
| P2 | 文章系列 | `seriesId` + `seriesOrder`，支持"第 1/5 篇" |
| P2 | i18n 中英双语 | 路由 `/[locale]/`，内容表加 `locale` 字段 |
| P2 | PWA + 离线 | `manifest` + Service Worker（只缓存静态资源） |
| P3 | 足迹地图 | 日志 `location` + 经纬度可视化 |
| P3 | 数据看板增强 | 访问趋势、热门内容、来源分析 |
| P3 | 自动化内容 | 从 Git 提交记录生成日志草稿 |
| P3 | RAG 站内问答 | 用文章内容做知识库，接 LLM 回答访客问题（很酷，但成本与维护不低） |

---

## 10. 开发工作流约定

### 分支策略

```
main        → 生产，受保护，只能通过 PR 合并
feat/xxx    → 功能分支
fix/xxx     → 修复分支
```

### 提交规范（commitlint）

```
feat(article): 支持定时发布
fix(module): 修复关闭模块后 sitemap 未更新
docs(readme): 补充部署说明
chore(deps): 升级 prisma 到 6.x
```

### 每个 PR 的检查点

- [ ] `npm run lint` 通过
- [ ] `npm run typecheck` 通过
- [ ] 相关测试通过
- [ ] 涉及 schema 的变更附带迁移文件
- [ ] UI 变更附带三端截图或录屏

### 质量门禁

| 命令 | 作用 |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest 单测 |
| `npm run test:e2e` | Playwright 冒烟（三视口） |
| `npm run build` | 构建必须成功 |

---

## 11. 下一步行动

设计评审通过后，建议按这个顺序动手：

1. **回答 [README §8 的开放问题](../README.md)**（尤其 Q1：本地用 Docker Postgres 而不是 SQLite）
2. **先做 M0**，把工程化基础打牢 —— 这 2 人天会在后面省下 10 人天
3. **M1 完成后立刻做一次登录链路的手动安全测试**（改 Cookie、重放 refresh）
4. **M2 先只做「文章」一个模块的完整 CRUD**，把它打磨成模板，再复制给其余四个
5. **模块开关中心在 M2 后期做**，但要在 M3 开始时立刻验证前台生效链路

> **如果只能做一件事**：把 M1 的鉴权和 M2 的模块开关中心做扎实。其余部分都是可替换的实现细节，这两个是架构骨架。

---

## 相关文档

- 架构与环境变量 → [01-architecture.md](01-architecture.md)
- 表结构与迁移 → [02-data-model.md](02-data-model.md)
- 接口实现依据 → [03-api-spec.md](03-api-spec.md)
- 后台实现依据 → [04-admin-console.md](04-admin-console.md)
- 前台实现依据 → [05-frontend-ia.md](05-frontend-ia.md)
- 模块字段与验收 → [06-modules.md](06-modules.md)
