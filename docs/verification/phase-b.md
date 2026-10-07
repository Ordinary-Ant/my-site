# 阶段 B 验收记录

日期：2026-10-07；阶段 B 验收通过，全部规格/质量复审批准，按本次阶段提交保存。全部证据来自本地真实 PostgreSQL 与生产构建，未发布或推送。

## 已执行

- `npm run test:integration`：35 项通过，8 文件，退出 0。包含真实 PG 会话轮转、宽限与重放撤销、用户锁并发、Origin、三角色权限、共享限流、文章 revision/预览/发布/删除恢复、媒体直传确认/引用/补偿与失败队列公平重试、发布游标。
- `npm test`：16 项通过，8 文件，退出 0。覆盖配置、Markdown AST/围栏/锚点、真实 SSR inline HTML 逃逸、正文大小、URL 与媒体真实格式。
- `npm run check` / `npm run verify`：退出 0。Lint 有一条 Markdown 外部图片的 Next 图片优化提示，没有错误。
- `npm run build`：退出 0。Next 15.5.27 / Prisma 6.19.3。第一次与集成测试并行执行时 Windows 锁住 Prisma DLL，测试结束后顺序重跑成功；后续 generate/build 不与数据库测试并行。
- `npm run test:e2e`：8 项通过、4 项按视口跳过，退出 0。390/820/1440px 登录→草稿→24h预览→富文本/Markdown往返→真实图片上传→发布→前台阅读→删除恢复；引用中媒体禁止删除，文章清理后媒体可删除；旧 revision 本地草稿跨两次重载保持冲突保护；暗色、减弱动态、无 JS 阅读；保存请求返回前离开后新增输入仍保留且匹配成功 revision。
- 分钟任务真实启动 Node runner，两次 HTTP 成功调用间隔在 58–70 秒内；缺机器凭据返回 401。生产外部分钟调度尚未配置。
- `node scripts/measure-js.mjs`：登录 107592 bytes（107.59 KB）≤110 KB；文章 109861 bytes（109.86 KB）≤135 KB；退出 0。按生产 manifest 合并页面、父布局与错误边界 JS，逐文件 gzip 后去重累计，KB=1000 bytes；尚非最终全站预算。

## 审查与实际范围

认证、文章、媒体均已经过规格审查及代码质量复审。文章修复旧本地 revision 被覆盖、延迟保存清除新输入、HTML 引用链接逃逸与重复锚点；媒体修复事务外补偿留存、删除队列反馈、单项失败继续及批次饥饿。

LocalDriver 的浏览器上传/读取/引用保护/删除为真实验收。R2 使用真实 AWS SDK 对本地对象协议服务与真实 PostgreSQL 验证 ticket/确认/隔离/回滚/补偿；**没有真实 R2 凭据，未验证云桶 ACL、CORS、公网直传或生产删除**，阶段 G 保留该外部验证项，不将协议测试称为云服务验收。

UploadIntent 迁移 `20261007133500_media_upload_intents` 已应用到开发和独立测试库。测试仅操作 `_test`，不重置开发库。当前页面的其他模块和公开导航聚合仍在阶段 C/D 范围，不能称全站完成。

## 最后界面回归

`npm run test:e2e -- tests/e2e/article.spec.ts tests/e2e/roles.spec.ts`：5 项通过、4 项按视口跳过，退出 0。三端暗色代码块 computed-style 验证、文章完整流程和延迟保存再次通过；EDITOR 实际新建/修改，管理员入口隐藏，purge 返回 403；VIEWER 列表无新增/编辑/删除、正文 readonly、保存发布入口隐藏，直接访问新建页仍只读，POST/PATCH/DELETE/preview-token 均 403。真实 DB 复核越权请求未改正文/revision/删除状态，测试账户和内容清理为零。角色测试质量快审批准。390px 与1440px实际截图已目视检查，代码暗色背景已修正。

整体审查发现媒体原串扫描遗漏百分号编码与Markdown转义/实体；真实PG分别观察到错误成功删除（RED），修复后全部返回409（GREEN）。保留原串扫描，百分号容错规范化，并用阅读页同款Markdown解析器提取image/link/definition URL后匹配。软删、嵌套配置、组合编码覆盖，代码围栏与实际双反斜杠负例避免盲目转换。

最终根代理复跑：52项真实PG与16unit全部通过，退出0；引用修复规格与质量复审批准。格式化暴露verify只检查Zod首行，已改为完整字段定义，verify复跑退出0；没有修改环境私密文件。最后Markdown引用修复后生产build退出0，1440px文章/延迟保存E2E另复跑2项通过，gzip仍为登录107.59/文章109.86KB，verify退出0；阶段B通过。

保留截图：[文章390px](phase-b-images/article-dark-390.png)、[文章1440px](phase-b-images/article-dark-1440.png)、[EDITOR](phase-b-images/editor-writable-1440.png)、[VIEWER](phase-b-images/viewer-readonly-1440.png)。这些截图展示阶段B的文章/后台功能，完整全站视觉仍在C–F实施。
