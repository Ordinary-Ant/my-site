# 16 · 云资源获取步骤（新手版）

更新：2026-10-12。目标为EdgeOne Pages国际站my-site，Git主分支main。数据库已创建，文件存储改用同一项目的Supabase Storage，不再要求开通Cloudflare R2。资源配置不代表已部署。

## 一、数据库地址已取到

已登录控制台实际确认：my-site为Free项目，新加坡ap-southeast-1，项目状态Healthy。顶部Connect → Direct → URI，分别选择Transaction pooler与Session pooler：

```dotenv
# EdgeOne运行时；参数按项目Prisma6要求补充
DATABASE_URL="postgresql://postgres.yylauqjdozlbcewlwcmw:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
# 本地迁移进程单独映射为DATABASE_URL，不传入公开前端
MIGRATION_DATABASE_URL="postgresql://postgres.yylauqjdozlbcewlwcmw:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
SUPABASE_DATABASE_PASSWORD=""
```

两份模板已补到Git忽略的根目录.env.edgeone.local，保留原Token。仍含密码占位符，尚不能连接数据库。

用户现在只需：

1. 用编辑器打开.env.edgeone.local。
2. 在SUPABASE_DATABASE_PASSWORD引号中填写**创建项目时保存的数据库密码**并保存。它不是GitHub或Supabase登录密码。
3. 在聊天回复“数据库密码已在本地填写”，不要发送密码、文件全文或连接串。

开发者会本地编码密码、组合URI、验证TLS/数据库版本，创建最小权限运行角色并执行现有迁移。不要手工建业务表或reset。Prisma schema仅使用DATABASE_URL，迁移通过进程环境覆盖，不认为MIGRATION_DATABASE_URL已自动接入。

控制台不显示原密码；忘记时用户需自行通过Connect → Reset database password重设，再更新本地文件。助手不会擅自重设。

参考：[Prisma连接](https://supabase.com/docs/guides/database/prisma)、[套餐](https://supabase.com/pricing)。Free闲置一周可能暂停且不含自动备份，正式运行套餐另定，不自动购买。

## 二、文件存储使用Supabase Storage

实际检查：Storage没有桶；Storage → S3协议开关已启用，Endpoint和Region已确认，尚无Access keys。

| 计划桶名 | 可见性 | 用途 |
|---|---|---|
| my-site-media | 公开读取 | 仅存服务端验证后的网站图片、视频、PDF |
| my-site-upload-private | 始终私有 | 签名直传临时文件，不能直接成为公开媒体 |

操作步骤（也可交由助手在具体权限确认后执行）：

1. 打开[Storage](https://supabase.com/dashboard/project/yylauqjdozlbcewlwcmw/storage/files)，点击New bucket。
2. 名称my-site-media，启用Public bucket。只用于网站公开素材，任何人知道地址均可读取其中的文件。
3. 再创建my-site-upload-private，**Public bucket保持关闭**。
4. 打开[Storage → S3](https://supabase.com/dashboard/project/yylauqjdozlbcewlwcmw/storage/s3)，点击New access key，名称my-site-app，创建S3凭据。
5. Access Key ID和Secret Access Key存到.env.edgeone.local对应键，不发聊天。不是publishable/anon key，无需改现有网站登录系统。

Supabase S3服务端密钥可访问项目全部桶并绕过RLS，不能按R2教程声称限定两个桶。只交给服务器，不使用NEXT_PUBLIC_前缀、不放前端或Git，无需匿名写入策略。

```dotenv
STORAGE_DRIVER=s3
S3_ENDPOINT=https://yylauqjdozlbcewlwcmw.storage.supabase.co/storage/v1/s3
S3_REGION=ap-southeast-1
S3_BUCKET=my-site-media
S3_PRIVATE_BUCKET=my-site-upload-private
S3_ACCESS_KEY_ID=""
S3_SECRET_ACCESS_KEY=""
# 桶创建并公开后才可验证，当前尚无可用对象
S3_PUBLIC_BASE_URL=https://yylauqjdozlbcewlwcmw.supabase.co/storage/v1/object/public/my-site-media
```

代码仍需适配forcePathStyle与提供商提示，实测签名PUT、SHA256、CORS、临时私有、服务端确认和删除保护。Supabase不支持S3 PutBucketCors接口，不照搬R2 CORS JSON教程；实际网站Origin/签名头须浏览器实测，不能认定只换密钥即可部署。

参考：[S3认证与权限](https://supabase.com/docs/guides/storage/s3/authentication)、[兼容范围](https://supabase.com/docs/guides/storage/s3/compatibility)、[公开地址](https://supabase.com/docs/guides/storage/serving/downloads)。

## 三、域名、备份及后续责任

网站继续使用EdgeOne Pages。媒体使用Supabase提供的HTTPS地址，无需开通Cloudflare或先买媒体域名。网站如用自定义域名，告知名称及DNS服务商；开发者核对准确CNAME后再配置，保留邮箱等已有记录。

| 未完成项 | 用户需要做什么 | 开发者后续工作 |
|---|---|---|
| 数据库密码 | 填本地文件 | 编码URI、验证连接、运行角色及迁移 |
| 桶与S3密钥 | 按上文操作或确认助手执行具体操作 | 驱动适配、真实直传/确认/引用保护验收 |
| 管理员 | 告知管理员邮箱 | 安全初始化，不用开发默认凭据 |
| JWT/任务密钥 | 无需自行生成 | 本地生成独立随机值 |
| 分钟发布/每日维护 | 无需先开新调度平台 | 验证Supabase Cron/pg_net/Vault与实际HTTP结果 |
| 独立备份 | 后续选定站外目的地与持续在线执行环境 | 加密DB和媒体备份、保留策略、隔离恢复 |
| Pages兼容/性能 | 无需手工写代码 | 验证Node/Prisma/middleware/CSP、云业务与G性能 |
| 首次公开生产部署 | 候选与证据齐全后最终确认 | CLI实测先production才能preview，不用占位版本绕过 |

同项目第三个私有桶不能代替独立备份。S3无版本控制，删除不能依赖版本恢复；Free数据库无自动备份，数据库备份也不包含媒体文件。[备份说明](https://supabase.com/docs/guides/platform/backups)

当前仅完成控制台读取和本地模板，不创建桶/密钥、不修改云数据库、不公开部署。恢复状态见11交接。
