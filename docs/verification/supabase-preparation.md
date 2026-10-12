# Supabase接入证据 · 2026-10-12

范围：生产资源准备，未公开部署。真实凭据只保存在Git忽略的.env.edgeone.local，本文不保存密码、密钥或带密码URI。

## 数据库

- 使用填写的密码，本地编码URI后，5432会话池与6543事务池均真实连接成功。
- 云端PostgreSQL 17.11，本地基线16。8项现有迁移部署成功；site schema共23表（22业务表、1迁移表）。不据迁移通过宣称所有PG17业务已验收。
- 使用独立site schema，撤销PUBLIC/anon/authenticated/service_role的schema、表与序列权限，并撤销postgres在site中面向这些角色的默认表/序列授权。未改Supabase自带auth/storage schema。
- my_site_runtime为独立LOGIN账户：NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOREPLICATION/NOBYPASSRLS。仅site USAGE、业务表SELECT/INSERT/UPDATE/DELETE及序列USAGE/SELECT；不授权迁移表。
- 22张业务表启用RLS，site_runtime_access策略仅允许my_site_runtime读写。应用服务层仍是角色/会话授权边界，RLS不替代业务权限检查。
- 实际验证：runtime schema CREATE=false、迁移表UPDATE=false，super/createDB/createRole/bypassRLS全部false；anon/authenticated schema USAGE=false。
- 事务池实际执行事务锁、Setting写入/读取后故意回滚，回滚后探针记录0。迁移时未导入开发账户、Session或演示内容，初始化前生产用户0；后续管理员初始化见下。
- 本地DATABASE_URL已切独立运行账户及schema=site；MIGRATION_DATABASE_URL保留迁移账户与schema=site。开发.env保持原样。

首次角色操作因把总表数23误当业务表数而被前置检查拒绝，未执行角色DDL；核对实际表名后改为22业务表再执行，事务完成。

后续迁移：先隔离备份，再用MIGRATION_DATABASE_URL作为子进程DATABASE_URL执行prisma migrate deploy；检查新表并在同次发布中补齐runtime授权和RLS策略。不得改用运行账户迁移，不能遗漏schema=site，不要执行reset或将数据库加入匿名API暴露列表。独立备份与云恢复仍未配置。

## 对象存储

- 两桶已由用户配置：my-site-media公开=true；my-site-upload-private公开=false。通过storage.buckets只读查询及S3 HeadBucket确认，大小/MIME桶级限制未配置，服务端既有实际内容限制仍保留。
- forcePathStyle缺失首先由单元测试复现：签名错误地把桶名加到Supabase域名前。增加path style后测试通过，保留R2Driver类名兼容既有调用，错误提示改为通用对象存储。
- 首轮完整探针通过签名PUT HTTP200、私有下载内容一致、匿名S3拒绝、校验后公开PNG读取一致及本地Origin预检。
- 后续增加私有桶公开REST地址验证，实际被拒绝，公开PNG仍可读取；另有复测在签名上传、下载或预检出现ECONNRESET/TimeoutError，尚未证明稳定性。沿用系统代理的尝试也有超时，未确定根因，不能以一次成功代替稳定验收。
- 每轮只使用新UUID生成的2×3纯色PNG，清理均成功；未删除用户既有媒体。
- 重跑：node --conditions=react-server --import tsx scripts/verify-cloud-storage.mts。只打印固定状态、失败阶段及网络错误类别，不打印SDK原始异常、签名URL或凭据。
- 只验证本机Origin的HTTP预检，不等于真实浏览器/EdgeOne生产Origin上传或完整媒体服务验收。超限/伪装/归属/引用保护沿用既有本地协议测试，真实云业务仍待验证。

## 本轮本地验证

- 单元59文件/173项通过，新增签名路径测试实际RED→GREEN。
- 类型/Lint及verify通过；仅既有Markdown img警告。
- 本地媒体真实PG集成15项通过。首次因Docker未启动无法连接；启动现有Docker Desktop，确认personal-site-db在15432健康后重跑通过。
- 生产构建退出0（显式本地15432/3100环境），不能把本地构建当作EdgeOne云兼容验收。

## 凭据保护与未完成

.env和.env.edgeone.local均被Git忽略，Git历史未跟踪两文件；本轮已跟踪文件扫描未发现实际云凭据。JWT_SECRET/REVALIDATE_SECRET已本地独立生成，未输出。提交时仅选择无实际凭据的代码与记录，不提交环境文件、备份或构建产物。

待完成：公开站点地址、存储网络稳定及真实浏览器验证、Pages运行时/Prisma兼容、G性能、生产调度、独立备份恢复和监控。首次公开production仍需候选齐全后的最终确认。

## 生产管理员初始化（同日补验）

用户已提供管理员邮箱，只保存在本地.env.edgeone.local的SEED_ADMIN_EMAIL，本文及Git不记录具体邮箱。初始密码本地随机生成，保存于SEED_ADMIN_PASSWORD；云端仅保存bcrypt成本12哈希。未使用默认开发账户或密码，已有账户冲突时拒绝覆盖。实际创建ADMIN/isActive=true，密码哈希比对通过，当前启用管理员1名。

在真实PG17事务池/site schema上调用既有服务层，登录、RT轮转、AT对应会话鉴权、退出后访问拒绝全部通过，退出撤销探针会话，未输出AT/RT/密码。此为服务层云库实测，不等于Pages浏览器HTTPS Cookie或完整全站验收。限流与脱敏审计保留真实验证记录。

首次登录后通过后台账户页面修改初始密码。SEED_ADMIN_*仅供本地初始化，不传入部署运行环境；发布时按所需环境键白名单提供运行配置，不上传.env.edgeone.local，也不将EdgeOne Token、迁移凭据或数据库管理员密码混入运行配置。
