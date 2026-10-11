# D05 分类标签后端验收

2026-10-09，本地真实 PostgreSQL 开发库 personal_site 与独立 personal_site_test。未 reset 开发库、未提交/推送、未生产发布。

## 实现入口

- `prisma/migrations/20261009153000_taxonomy_revision/migration.sql`：Category/Tag revision 默认 1；两库实际迁移后再次 deploy 均显示 No pending migrations to apply。Prisma Client 已 generate。
- `src/lib/validators/taxonomy.ts`：严格字段白名单、长度/颜色/order/revision 校验、批量去重、合并来源不能重复或包含目标；Tag PATCH 拒绝 slug。
- `src/lib/services/taxonomy.ts`：权威 content:read/write 授权、Origin、共享 PostgreSQL adminwrite 限流；最多两层分类、叶删除脱分类、跨三内容模型标签批删/合并、全部正文 revision 递增、审计同事务及全部派生缓存失效。
- 公共 `api/v1/categories`、`tags`；管理 categories/tags 集合、单项、category reorder、tag bulk/merge/merge preview。

管理分类返回完整有序 `CategoryNode[]`：`children`、`articleCount`（当前节点）与 `totalCount`（含子孙）；Tag 返回 `counts:{article,log,project,total}`。管理标签分页采用 `data+meta`。删除返回 200 JSON 影响数。合并预览/确认均返回 `target,sources,affected,additions`；影响数以内容去重，新增数排除已关联目标的内容，确认重新查询；确认后 target 含新 revision 和最新统计。

## RED → GREEN

- Unit 初始占位 validator：2 个真实断言失败（分类默认值缺失、Tag PATCH 未拒绝 slug）。实现后 2/2 通过。
- PostgreSQL 初始 service 占位：3 个真实业务测试失败于“待实现taxonomy”；实现后 3/3 通过，再补齐公开/权限/并发等风险验证至 8/8。
- 真实并发分类 CAS 捕获原始 PostgreSQL `40001`（Prisma raw P2010）漏映射问题；补充序列化/死锁 `40001/40P01` → 409 后原测试通过。Serializable 事务与固定模型/ID顺序正文行锁保证关系变化整次提交或回滚；未自动重试有副作用操作。

## 最终验证（23:29）

- `npx tsc --noEmit`：exit 0。
- owned 文件 `npx eslint ...`：exit 0，零警告。
- `npx vitest run tests/unit/taxonomy.test.ts`：2/2。
- `npx vitest run --config vitest.integration.config.ts tests/integration/taxonomy.test.ts`：8/8，约 1.3 秒业务执行。
- `npx prisma migrate deploy` 开发库/测试库：两库各 5 个迁移，无待迁移。
- 测试每次清理自身内容/词表/用户/审计，并恢复临时改动的模块及 Profile；finally/afterAll 断开 PostgreSQL。

真实功能覆盖：分类层级/自指约束与含子节点删除422、同父排序限制、旧 revision409、叶分类脱离包括软删文章且保留正文；Article/Log/Project 草稿/未来/软删跨类型合并去重、目标保留、来源删除、内容 revision递增、批删冲突整次回滚；公开词表过滤模块/类型/PUBLISHED/到期/软删，祖先汇总及无引用节点隐藏，管理统计包含草稿/软删；公开隐私清洗；ADMIN/EDITOR/VIEWER权限、停用账号/撤销sid拒读、Origin拒绝；路由201/400/404/409/no-store；分类与合并并发 CAS、合并与真实 updateArticle 重叠原子性、旧正文关系快照409；审计及 sitemap/article 等失效调用。

范围说明：此证据仅证明后端与真实PG功能；UI/浏览器/构建由根任务统一验收。Vite输出已有配置未来兼容提示（不影响测试结果），未修改全局测试配置。未单独验证生产网络/分布式压力与R2。

## 合并预览限流复审补验（23:38）

合并预览保留 `content:read`（VIEWER 可预览），POST仍由权威鉴权校验Origin；由于预览会锁标签及正文，显式与管理写入口共用 PostgreSQL `adminwrite:<userId>` 额度（120次/15分钟），在解析/事务锁之前扣除，超额429并携带Retry-After。

新增unit先RED（未限流即进入事务）后GREEN；taxonomy unit现3/3。新增真实API测试由VIEWER发起：PG计数119→120预览成功，第121次429；错误Origin403且不扣额度；被限流后目标和来源revision保持1，无词表写审计。taxonomy真实PG现9/9。`npx tsc --noEmit`及改动文件ESLint通过。

整仓 `npm run test:integration`：19文件、123测试全部通过，28.31秒；各fixture结束断开PG。独立规格复审已关闭原预览限流问题，无新增发现。未运行build/browser。
## D整合补验（2026-10-11）

公开标签计数原独立base条件遗漏日志记录日期。追加未来日期未置顶hidden标签、未来日期已置顶visible标签、未来发布时间已置顶visible标签真实PG用例；旧实现RED返回不应公开的hidden标签且log=1。`publicConditions.log`改为复用`publicLogWhere(types(...))`，同源检查记录日期、置顶、发布时间、删除状态和类型，再叠加模块开关。全部taxonomy9PG GREEN（本机09:49:38开始，2.29秒），fixture清理、模块恢复及disconnect完成。未改开发库，规格/质量复审另由root协调。

