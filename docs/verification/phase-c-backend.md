# 阶段 C 后端验证记录

2026-10-07，独立 `personal_site_test` PostgreSQL；未操作开发库、未修改 `.env`、未提交或 push。本文仅记录后端验证，不能代替完整 C 页面、视觉和构建验收。

## 红绿证据

- 模块服务先建立测试，空导出时 3 项因缺少 update/undo 函数失败；实现后通过。后续验证首页不可关闭、CAS 409、未知键、只读/写权限、排序重复与事务 CAS、嵌套 patch/null、保留/嵌套路径、历史恢复、两个模块并发改路由仅一个成功、五秒撤销和覆盖保护。
- 设置/公开服务先以空导出运行，两项失败后实现；补测发现隐私递归把 Date 变为 `{}`，先复现再保留 Date。首页最新文章置顶排序错误先复现后改为发布时间倒序。单区块查询失败先复现整个聚合抛错，修为独立降级并返回 errors；全部区块失败为 503。
- 审计查询缺失时测试失败，实现后验证 VIEWER 读取、分页过滤、历史 before/after 脱敏及用户只返回 id/name。
- 路由解析单元测试缺失函数失败，随后验证当前路径优先、多个历史地址直达最新地址、详情后缀保留和路径边界。query 由 middleware clone URL 保留，真实 HTTP 301 待根代理浏览器验收。
- session_hint 单元测试先因缺少 Cookie 失败，验证设置属性和统一清除出口。提示只为 middleware 存在判断，不参与授权。
- 公开文章本人联系方式泄露先由真实 PG 复现，再接入统一 applyPublicPrivacy；保留正文其余文字。字符实体/百分号混合编码再由新增测试复现，public-privacy 使用 Markdown 实体语义及原文位置映射删除风险片段，Date与必填字符串保留。联系 social/link 节点去除。`safeContentUrl` 复用于设置链接，协议相对、反斜杠、编码控制字符的短单元先红后绿。

## 最后已执行结果

`npx vitest run --config vitest.integration.config.ts tests/integration/module.test.ts tests/integration/configuration.test.ts tests/integration/audit.test.ts tests/integration/article.test.ts`：4 suites、18 tests 全绿（C 后端 15 项、B 文章回归 3 项）。

`npx vitest run tests/unit/module-routing.test.ts tests/unit/cookies.test.ts tests/unit/settings.test.ts tests/unit/public-privacy.test.ts`：5 tests 全绿。

后端定向 ESLint 退出 0；`npm run typecheck` 退出 0。全仓 check 中曾出现主代理正在修改的首页普通 a 标签 lint 错误，已告知主代理；原 Markdown img warning 不属于本次后端变更。

最终公开首页/modules 复用统一 privacy helper 后，真实 PG 已复跑全绿，typecheck 与定向 lint 已复验。设置安全 URL 校验随后通过单元红绿验证。隐私映射随后又以两个单元复现并修复 320KB 长文数组展开超栈及 Unicode 大小写扩展索引偏移，最后 5 项单元全绿；后续全仓/联合验收由主代理顺序执行。

## 待联合验收

Next 15.5 Node middleware 的 Prisma/server-only 构建兼容、实际 301 及 query、Cookie 过期后后台 refresh、浏览器完整模块/设置/首页闭环，以及默认首页顺序修正迁移由主代理联合验收。动效四预设和估算展示属于 F；C 支持严格保存/读取当前 motion.config。


