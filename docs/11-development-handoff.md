# 11 · 开发交接与恢复

更新：2026-10-07。A已完成，B–G待开始；业务页面/API/鉴权/动效运行时尚未实现，不能以设计稿或构建替代功能状态。当前本地PostgreSQL已healthy且首migration完成；真实_test迁移和seed幂等已通过，check/verify/build、5unit+3PGintegration及三视口首页冒烟通过，最终复跑已通过，详见 verification/phase-a.md。远端可连但为空，不自动推送。

## 恢复顺序
1. 在C:/Users/ordinaryPuly/Desktop/personal-site执行git status --short、git log -5 --oneline，确认HEAD和未提交文件归属。
2. 读AGENTS.md、README、10台账、12批准计划及当前阶段规范。09为历史评估快照。
3. 检查Node/npm、Docker Desktop与数据库容器；复用既有环境，避免重复迁移/reset生产库。
4. 按台账依赖继续；运行检查后填证据/退出码/限制。阶段验收后本地提交，禁止自动push，公开生产发布最终确认。

## 环境启动
```powershell
node -v
npm -v
npm install
Copy-Item .env.example .env  # 仅当.env不存在；已有私密值不可覆盖
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```
Docker可执行文件如未在PATH，通过Docker Desktop安装位置调用；不要把本机缺PATH误写成没有Docker。迁移首次已执行，继续前查status。测试用独立PostgreSQL测试库；test脚本以当前package.json为准。常规门禁npm run check、npm run verify、npm run build，真实PG集成和E2E按阶段补全。

.env不得提交/输出；生产密码/RT/rotationReply不得日志输出。Windows下删除、移动必须先验证绝对目标位于指定工作区，使用LiteralPath。

## 当前接续工作
A已完成规范、设计图、工程/数据与测试基线；下一步进入B，先做会话权限。动效默认值详见src/config/motion.ts与08；Schema文档随迁移同步。下阶段B完成文章纵向闭环（含会话权限/编辑器/媒体/预览/发布/阅读/软删），随后C模块闭环，不先堆全站静态外观。

## 阶段交接必填
实际命令/退出码、功能证据、Git提交hash、数据库迁移名、未完成/受阻项及下一可执行步骤。构建成功只说明构建，不声明登录/发布/缓存/媒体/部署成功。

## 依赖审查交接
本轮Tiptap3.31.4，官方@tiptap/markdown替代tiptap-markdown；tailwind-merge3，lint-staged17.6；overrides为postcss8.5.29、deepmerge-ts8.0.2、selector-parser7.1.6。npm audit --omit=dev 已实际通过：0漏洞。已知剩余braces<=3.0.3→micromatch→fast-glob→eslint-config-next传递链5条high，暂无上游修复；拒绝force降级Next14。只用受信任固定glob、生产不带devDependencies，发布前复核公告；不能称所有audit为零。

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

本轮真实证据（执行者协调结果）：开发/测试两库migrate deploy通过；第二迁移20261007044400_publication_backfill仅回填已发布Log/Project的空publishedAt，不改草稿或已有时间；seed重复执行计数不增加，新增日志发布时间取logDate。5unit+3真实PGintegration通过，含seed幂等和publication回填。最终复跑及A验收已通过，详见 verification/phase-a.md。
