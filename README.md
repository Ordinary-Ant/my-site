# Personal Site · 个人网站与私有后台

当前为**一期A–F已完成，G已公开交付并保留明确待办**。2026-10-13已公开交付：https://my-site-tgqonxxy.edgeone.dev，EdgeOne国际站my-site，当前部署dp2ry69pr5hy。实际云API、真实浏览器登录/CSP/CORS上传、三端首页、文章与开关/连续301闭环26项、三角色15项全部通过；临时探针已清理。Supabase PG17.11/8迁移与公开/私有Storage两桶已接入。分钟发布实际3次200，维护稳定版本连续5次200；每日维护及五分钟健康调度已配置，外部告警和自动独立备份尚未配置。 2026-10-13用户明确决定“先交付，保留性能待办”：移动首页Lighthouse Performance99，LCP三次中位2020.673ms，超过2000ms目标约21ms；仅暂缓该项，不修改目标、不标达标。文章/搜索移动LCP中位1874.945/1655.676ms；正确桌面配置三页Performance100。 规范与证据见[一期计划](docs/12-phase-one-plan.md)、[发布记录](docs/15-edgeone-deployment.md)。

Next.js15.5 App Router / Edge兼容middleware + Node路由服务 / TypeScript / Tailwind4 / Prisma6 / PostgreSQL16；开发与测试使用真实PostgreSQL，部署目标为EdgeOne国际站my-site，Supabase数据库迁移/独立运行角色已验证，Storage两桶与S3适配已有实测，完整云业务已实测通过，运行时适配与实际交付状态见[部署准备](docs/15-edgeone-deployment.md)，用户已授权公开生产发布。CSS首屏与Anime.js按需编排，动效version2四预设默认editorial无装饰，仅none/tint，不做连续背景。预算文章135KB/动效28KB/登录110KB gzip，需真实测量。

## 文档与优先级
用户明确决策 > 修订一期权威规范 > 其他docs > 设计稿。视觉规范负责令牌，08负责动效合同，12负责一期范围；冲突修原文，不保留错误合同作为实施要求。

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 协作、恢复、授权与提交规则 |
| [01架构](docs/01-architecture.md) | 服务层、鉴权、动态路径、公开边界、缓存 |
| [02数据模型](docs/02-data-model.md) | Schema、迁移、日期精度、软删、revision |
| [03接口](docs/03-api-spec.md) | REST/权限/配置/媒体/预览合同 |
| [04后台](docs/04-admin-console.md) | 管理CRUD、编辑器、配置中心 |
| [05前台](docs/05-frontend-ia.md) | 页面、路由、响应式 |
| [06模块](docs/06-modules.md) | 五大模块与首页 |
| [07路线图](docs/07-roadmap.md) | A–G验收与45–65人日 |
| [08动效](docs/08-motion-system.md) | version2唯一合同 |
| [设计规范](docs/设计规范.md) | 视觉令牌与验收 |
| [09可行性报告](docs/09-feasibility-report.md) | 修订前历史审查快照，不是当前进度 |
| [10功能台账](docs/10-development-tracker.md) | 细功能状态、依赖、证据、提交 |
| [11交接](docs/11-development-handoff.md) | 环境启动、恢复与下一步 |
| [12批准计划](docs/12-phase-one-plan.md) | 一期决策与范围 |
| [13本地发布合同](docs/13-local-release-readiness.md) / [14操作手册](docs/14-release-runbook.md) | G本地安全、恢复与后续生产接入 |
| [设计稿](design/README.md) / [评审看板](design/index.html) | 33源稿、45截图，静态意图，非实现证据 |

## 开发启动
```powershell
npm install
# 仅当.env不存在时复制，禁止覆盖已有密钥
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 当前Windows保留端口范围包含5432，容器与连接使用同一显式端口
$env:POSTGRES_PORT = '15432'
$env:DATABASE_URL = 'postgresql://dev:dev@localhost:15432/personal_site?schema=public'
$env:NEXT_PUBLIC_SITE_URL = 'http://localhost:3100'
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev -- --port 3100
```
本地PG已healthy、首迁移完成，后续先查迁移状态；执行结果记入台账，不能据此声明业务完成。已有骨架历史check/verify/build通过不代表本轮验收。npm run check、npm run verify、npm run build为基础门禁，真实PG集成与Playwright按阶段执行，脚本以package.json实际定义为准。

## 实施顺序
A基础治理 → B文章闭环（含auth/权限/编辑器/媒体/预览/发布/阅读/软删）→ C模块闭环（开关/导航/首页/配置/动态改路由/审计/撤销）→ D完整内容系统 → E搜索SEO与定时 → F动效 → G发布准备。评论、注册、订阅、i18n、PWA为二期。

新会话先读Git状态和最近提交、台账与交接。每阶段验收后本地提交；**仅明确授权后push；本次已授权推送origin的main，不强推或擅自合并master；用户已授权公开生产发布**。证据必须区分静态检查、真实PG、浏览器功能与视觉截图。

## 独立测试数据库与Node基线
Node>=24 / npm>=11（.node-version为24.19.0），不再支持旧Node20基线。测试显式独立URL：
```powershell
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:15432/personal_site_test?schema=public'
$env:E2E_BASE_URL = 'http://localhost:3100'
# E2E生产包与测试服务须使用相同站点Origin；不覆盖.env
$env:NEXT_PUBLIC_SITE_URL = $env:E2E_BASE_URL
npm run build
npm run test:db
npm run test
npm run test:integration
npm run test:e2e
```
test:db使用目标URL同一服务器的/postgres管理连接创建/迁移测试库，拒绝非_test后缀；禁止测试重置开发/生产库。集成测试显式读取TEST_DATABASE_URL。

本轮真实证据（执行者协调结果）：开发/测试两库migrate deploy通过；第二迁移20261007044400_publication_backfill仅回填已发布Log/Project的空publishedAt，不改草稿或已有时间；seed重复执行计数不增加，新增日志发布时间取logDate。5unit+3真实PGintegration通过，含seed幂等和publication回填。最终复跑及A验收已通过，详见 verification/phase-a.md。
