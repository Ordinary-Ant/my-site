# 15 · EdgeOne CLI部署准备

更新：2026-10-12。用户选定国际站、项目名my-site，并明确授权代码推送Git远程。公开生产发布仍需最终确认；资源建议尚未确认为采购决策。

## 本次实际检查

- EdgeOne CLI 1.6.41已通过npm exec安装在npm缓存，未添加项目依赖或修改lock。
- 从Git忽略的.env.edgeone.local读取Token，仅向国际站API认证，不打印Token、不放命令参数。国际站DescribePagesProjects响应HTTP200，首次查询Projects为空。
- 实际执行CLI的my-site预览部署：自动创建Upload项目后退出1，错误为`Please create a production deployment first`。尚未构建/上传产物，没有生产部署或可访问预览URL。未用生产部署绕过此前的最终确认要求。
- 检查CLI 1.6.41源码：preview在构建前检查既有UsedInProd部署；自动构建会读取当前目录.env并合并到构建环境。因此不能直接在含开发.env的仓库运行正式部署，必须先准备隔离的发布目录并检查产物。
- 本机Git直接连接github.com:443失败；沿用Windows已启用代理后ls-remote成功，首次远端没有分支。代理仅作为本次Git命令参数，不修改全局配置。
- 本次npm run check退出0（已有Markdown img警告），npm test为58文件/172项通过。G性能和云端功能尚未验收，不据此标记阶段G完成。

## 推荐资源组合（待用户确认）

| 资源 | 建议 | 选择原因与验证边界 |
|---|---|---|
| 应用 | EdgeOne国际站my-site，CLI直接上传 | 先证明Node runtime、Prisma、middleware、CSP nonce和动态301兼容，再选择最终运行方式 |
| 数据库 | Supabase托管PostgreSQL，新加坡ap-southeast-1 | 官方提供该区域与Prisma连接池；应用函数区域尽量靠近数据库。只使用数据库，沿用现有账户/会话系统 |
| 媒体 | Cloudflare R2 | 沿用现有S3驱动，避免替换已验收媒体协议；需要独立公开桶和私有临时桶 |
| 调度 | Supabase Cron + pg_net + Vault | 支持分钟任务及HTTP调用；Vault保存独立Bearer密钥，每分钟调用publication，每日maintenance。配置与成功响应需真实验收 |
| 备份 | 数据库独立备份 + 第三个私有对象桶或独立备份目的地 | 不把内容JSON导出或公开媒体桶当作完整备份；云恢复另做演练 |

正式站点套餐需结合预算、暂停策略、备份保留和服务保障选择，不把免费试用当作生产可用性承诺，不自动创建付费资源。新加坡是当前建议，实际EdgeOne函数区域和目标访问地区仍需核对。

### 数据库配置

创建独立站点项目，优先核对PostgreSQL版本与现有16基线。准备两种连接：函数运行时使用transaction pooler；迁移/备份使用direct或session pooler。当前Prisma6的schema只有DATABASE_URL，迁移通过独立进程环境覆盖，不假装已经接入DIRECT_URL。

事务连接需按官方Prisma指南设置pgbouncer=true、限制单实例连接数，并验证交互事务、行锁、事务advisory lock、RT并发和共享限流。迁移连接使用适当DDL权限，运行账户最小权限；不要使用anon/service_role等HTTP API key代替PostgreSQL密码。

### R2配置

建议桶名my-site-media和my-site-upload-private；私有临时桶关闭所有匿名公开入口。公开媒体桶生产使用自定义域名，r2.dev仅用于开发验证。签名PUT仍需CORS，按实际站点Origin配置，不使用全来源通配。

需要的配置键如下，全部填写到本地.env.edgeone.local，保留已配置Token；没有实际值时不要复制占位字符串进行部署：

```dotenv
# 已有：EDGEONE_API_TOKEN
DATABASE_URL=
# 本地操作用，迁移进程单独映射为DATABASE_URL，不传入公开前端
MIGRATION_DATABASE_URL=
STORAGE_DRIVER=s3
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=my-site-media
S3_PRIVATE_BUCKET=my-site-upload-private
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
NEXT_PUBLIC_SITE_URL=
JWT_SECRET=
REVALIDATE_SECRET=
```

JWT_SECRET与REVALIDATE_SECRET必须独立生成且至少32位，不复用开发密钥。SEED_ADMIN_*由本地安全初始化过程提供，不上传默认密码或自动导入开发账户、Session、PreviewToken等记录。

## 下一步与验收

1. 用户创建并配置上述资源，或先明确替代资源；不在聊天发送凭据。
2. 隔离发布目录不包含.env、Token、.storage、.backups、.test-backups等；审查CLI生成的服务端环境与公开资产，Token只用于CLI进程授权。禁止把本机Windows Prisma引擎直接作为Linux云端验收结果。
3. 核对平台Node运行时与file-type>=22要求、Prisma引擎平台、Node middleware数据库连接；本地适配构建只能证明产物生成，不能代替云验收。
4. 准备可审阅发布候选及数据库迁移计划；由于当前CLI要求先生产部署，首次公开生产部署另请最终确认。不得发布占位生产版本绕过确认。
5. 首次部署后验证健康、登录三角色、会话轮转、文章发布阅读、媒体直传、连续改路由301保留query、开关与搜索SEO、HTTPS Cookie与CSP、真实分钟调度及恢复。随后才标记云端功能完成。

如果Pages不能保持现有运行合同，采用Node24源站+EdgeOne加速作为备选，先记录架构变更再实施。

## 官方参考

- [CLI与Token部署](https://pages.edgeone.ai/zh/document/edgeone-cli)
- [Next.js支持](https://pages.edgeone.ai/document/framework-nextjs)
- [云函数限制与运行时](https://pages.edgeone.ai/document/cloud-functions)
- [Supabase区域](https://supabase.com/docs/guides/platform/regions)
- [Prisma与连接池](https://supabase.com/docs/guides/database/prisma)
- [Supabase Cron](https://supabase.com/docs/guides/cron) / [pg_net与Vault](https://supabase.com/docs/guides/functions/schedule-functions)
- [R2公开桶](https://developers.cloudflare.com/r2/buckets/public-buckets/) / [CORS](https://developers.cloudflare.com/r2/buckets/cors/)
