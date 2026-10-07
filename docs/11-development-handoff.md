# 11 · 开发交接与恢复

更新：2026-10-07 18:39。A（66dca93）、B已完成，C–G待开始。52真实PG、16unit、check/verify/build和gzip通过；三端文章/角色/延迟保存/60秒任务均实际通过。所有规格和质量复审批准；B按本次提交保存，随后开始C。R2真实云验证及生产部署未完成；禁止自动push。详见 verification/phase-b.md。

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
B已验收并本地提交，下一步进入C模块开关/配置/路由/导航聚合/审计撤销。C–G尚未实现，不能称全站完成。

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
test:db使用目标URL同一服务器的/postgres管理连接创建/迁移测试库，拒绝非_test后缀；禁止测试重置开发/生产库。集成测试与E2E显式读取TEST_DATABASE_URL。E2E自动启动使用测试库的新服务，不复用可能连接开发库的已有3000服务；测试setup只在_test库seed并清理测试登录桶。

本轮真实证据（执行者协调结果）：开发/测试两库migrate deploy通过；第二迁移20261007044400_publication_backfill仅回填已发布Log/Project的空publishedAt，不改草稿或已有时间；seed重复执行计数不增加，新增日志发布时间取logDate。5unit+3真实PGintegration通过，含seed幂等和publication回填。最终复跑及A验收已通过，详见 verification/phase-a.md。

## B接续实测
52项PG（认证17、文章3、媒体27、发布2、基础3）和16unit通过。UploadIntent迁移20261007133500_media_upload_intents已部署开发与测试库。Local真实浏览器上传/引用保护/删除通过；R2仅本地对象协议＋真实PG，云凭据缺失，G须另验ACL/CORS/公网直传。

分钟runner真实两次成功调用间隔60秒；生产外部调度未配置。gzip登录107.59KB、文章109.86KB（KB=1000字节）。默认TRUST_PROXY=false，公网需可信代理覆盖转发头才开启，否则unknown桶共享限额。

Windows Prisma DLL在并发generate与PG测试时会被锁，构建/生成与数据库测试顺序运行。Playwright使用独立_test库和Chrome headless shell，禁止复用现有开发服务。暗色代码及三角色UI已验收。媒体百分号/Markdown转义/实体引用先复现错误删除，修复后52PG全绿；规格与质量复审批准。格式化引出的verify多行默认值误报已修复，verify通过。
