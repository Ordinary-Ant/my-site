# 11 · 开发交接与恢复

更新：2026-10-07 23:50。A（66dca93）、B（c5fe0c6）、C（本次本地提交）已验收；D–G待开始。当前分支codex/full-site，保留master，origin已配置，禁止自动push。全站一期尚未完成。

## 恢复顺序

1. 在C:/Users/ordinaryPuly/Desktop/personal-site读AGENTS.md，核对git status --short与git log -5 --oneline，确认未提交变化归属。
2. 读10台账、12批准计划及本交接，查当前阶段verification证据；09仅是修订前历史快照。
3. 检查Docker PostgreSQL健康，已有.env不可输出/覆盖/提交；迁移先查状态，不reset开发/生产库。
4. 开始功能前登记，实际验收后填证据，阶段通过后本地提交。公开生产发布最终确认。

## 环境与启动

Node24.19/npm11.17，PostgreSQL16容器personal-site-db。首次迁移和seed已经完成，不重复初始化。Node>=24/npm>=11为工程基线。

```powershell
npm install
npm run db:up
npm run db:deploy
npm run dev
```

Docker如缺PATH，使用Docker Desktop安装路径；不要据此认定Docker不存在。.env仅当不存在时从example复制。Windows文件操作使用LiteralPath，删除/移动前核对目标位于工作区。

独立测试库：

```powershell
$env:TEST_DATABASE_URL = 'postgresql://dev:dev@localhost:5432/personal_site_test?schema=public'
npm run test:db
npm test
npm run test:integration
npm run test:e2e
```

测试只允许_test后缀，禁止重置开发/生产库。E2E自动启动测试库新服务，不复用已有开发服务器；Chrome headless shell已可用。Windows Prisma DLL在数据库测试期间可能被锁：PG与prisma generate/build顺序执行，不并发。

## 已验收与证据

- A：规范/设计统一、依赖/CI/测试环境、基础迁移/seed。见verification/phase-a.md。
- B：认证/会话原子轮转与重放/角色、文章编辑预览发布阅读回收、Local媒体与R2隔离协议、真实分钟runner。52PG、16unit及三端/角色浏览器已通过；见verification/phase-b.md。
- C：模块关闭恢复/5秒撤销、嵌套配置/null/严格键、历史301动态路由、首页真实聚合/导航/设置/审计、全站既有出口隐私边界。见verification/phase-c.md和phase-c-backend.md。
- 最终C代码：43unit（14files）、68真实PG（12files）、check/verify/build退出0；Playwright article/foundation/modules/roles 9passed/6skipped，三端文章和首页实际通过。只有既有Markdown外链图片lint警告。
- gzip登录107.65KB<=110、文章117.60KB<=135（decimal KB）。动效预算与Lighthouse待F/G。
- home_default_order迁移20261007185500已部署开发/测试库，仅完整等于旧seed默认的配置回填；幂等/自定义保留真实PG通过。此前3个迁移foundation/publication_backfill/media_upload_intents已部署。
- 最新隐私修复含格式化电话、percent/entity/CommonMark转义、强调/link/inlineCode可见文字拆分、长文/Unicode位置；TOC从脱敏后正文生成。规格和质量复审均批准，实际HTTP夹具无本人邮箱/电话/mailto/tel。feed兼容路由共用首页过滤且关闭模块数组为空。

## 下一步

进入D，按台账登记日志、作品、时间线、About、分类标签、用户与数据管理；保留中文关键注释、revision409、公开过滤、媒体引用和权限规则。C新增的配置必须被后续模块页面实际消费。D阶段功能验收后本地提交；不要把现有栏目导航链接或静态稿当作D实现。

## 未验证及环境边界

R2云ACL/CORS/公网直传、生产托管/域名/数据库和备份凭据未提供，G须记录实际阻塞并验证；B仅本地对象协议与真实PG，不是R2云验收。实际分钟runner60秒证据在B；生产外部调度尚未配置。默认TRUST_PROXY=false，可信代理正确覆盖头后才开启。

主题自定义强调色的暗色/文字对比度、完整三端/无JS/reduce、搜索/RSS/sitemap、动效、生产CSP/备份恢复均留D–G实际验收，不宣称已通过。生产npm audit --omit=dev已0漏洞；开发链braces→micromatch→fast-glob→eslint-config-next仍5high，无上游修复，禁止force降级Next14，G复核。密钥/RT/rotationReply不得日志输出。
